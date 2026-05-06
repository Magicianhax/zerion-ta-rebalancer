/**
 * Interactive setup wizard.
 *
 * Walks a fresh user from "I have an API key" to "I have a wallet, an agent
 * token, and a policy attached." Shells out to the forked Zerion CLI for the
 * commands that need a passphrase prompt — stdin is inherited so the user
 * types directly into the CLI; stdout and stderr are tee'd so output is
 * visible AND captured for error reporting.
 *
 * Run: npm run setup
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";
import { existsSync } from "node:fs";
import { config } from "../src/config.ts";
import { initDb, getAuthorizedUserIds, setAuthorizedUserIds } from "../src/core/db.ts";
import { syncZerionConfig } from "../src/core/zerion-config-sync.ts";

/**
 * Open readline only for the duration of one prompt, then close it.
 *
 * Critical: a persistent readline keeps stdin in line-buffered mode and
 * fights with the Zerion CLI's setRawMode() when it asks for a passphrase
 * (manifests as corrupted/duplicated chars in some terminals like VS Code's
 * WSL integrated terminal). Closing readline between prompts releases stdin
 * fully so the child process owns it cleanly.
 */
async function ask(question: string, fallback?: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const suffix = fallback ? ` [${fallback}] ` : " ";
    const answer = (await rl.question(`${question}${suffix}`)).trim();
    return answer || fallback || "";
  } finally {
    rl.close();
  }
}

async function askYN(question: string, defaultYes = true): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(
      `${question} ${defaultYes ? "[Y/n]" : "[y/N]"} `,
    )).trim().toLowerCase();
    if (!answer) return defaultYes;
    return answer.startsWith("y");
  } finally {
    rl.close();
  }
}

async function pressEnter(prompt: string): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    await rl.question(prompt);
  } finally {
    rl.close();
  }
}

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    let stdoutBuf = "";
    let stderrBuf = "";
    const child = spawn(process.execPath, [config.zerionCliPath, ...args], {
      stdio: ["inherit", "pipe", "pipe"],
      env: { ...process.env, ZERION_API_KEY: config.zerionApiKey },
    });
    child.stdout.on("data", (chunk) => {
      const s = chunk.toString();
      stdoutBuf += s;
      stdout.write(s);
    });
    child.stderr.on("data", (chunk) => {
      const s = chunk.toString();
      stderrBuf += s;
      stderr.write(s);
    });
    child.on("close", (code) =>
      resolve({ code: code ?? 1, stdout: stdoutBuf, stderr: stderrBuf })
    );
  });
}

function tryParseJson(str: string): any {
  const match = str.match(/\{[\s\S]*\}\s*$/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

interface ExistingWallet { name: string; isDefault?: boolean }
interface ExistingPolicy { id: string; name: string; summary?: string }
interface ExistingToken { name: string; wallet: string; policies?: Array<{ id: string }>; active?: boolean }

async function listExistingWallets(): Promise<ExistingWallet[]> {
  const r = await runCli(["wallet", "list"]);
  if (r.code !== 0) return [];
  const json = tryParseJson(r.stdout);
  return Array.isArray(json?.wallets) ? json.wallets : [];
}

async function listExistingPolicies(): Promise<ExistingPolicy[]> {
  const r = await runCli(["agent", "list-policies"]);
  if (r.code !== 0) return [];
  const json = tryParseJson(r.stdout);
  return Array.isArray(json?.policies) ? json.policies : [];
}

async function listExistingTokens(): Promise<ExistingToken[]> {
  const r = await runCli(["agent", "list-tokens"]);
  if (r.code !== 0) return [];
  const json = tryParseJson(r.stdout);
  return Array.isArray(json?.tokens) ? json.tokens : [];
}

/**
 * Generic single-or-pick selector.
 *   - 0 items → null (caller decides what to do)
 *   - 1 item  → auto-select with confirmation message
 *   - 2+      → numbered list, user picks by number; default = first/marked
 */
async function pickOne<T>(
  label: string,
  items: T[],
  render: (item: T, idx: number) => string,
  defaultIdx: number = 0,
): Promise<T | null> {
  if (items.length === 0) return null;
  if (items.length === 1) {
    stdout.write(`✓ Using existing ${label}: ${render(items[0]!, 0)}\n`);
    return items[0]!;
  }
  stdout.write(`\nWhich ${label}?\n`);
  items.forEach((it, i) => {
    const marker = i === defaultIdx ? " (default)" : "";
    stdout.write(`  ${i + 1}. ${render(it, i)}${marker}\n`);
  });
  const raw = await ask("Pick a number", String(defaultIdx + 1));
  const idx = parseInt(raw, 10) - 1;
  return items[idx >= 0 && idx < items.length ? idx : defaultIdx]!;
}

function fail(message: string, result?: CliResult): never {
  stdout.write("\n┌─────────────────────────────────────────────────┐\n");
  stdout.write("│ ❌  Setup failed                                 │\n");
  stdout.write("└─────────────────────────────────────────────────┘\n\n");
  stdout.write(`${message}\n\n`);
  if (result) {
    stdout.write(`Exit code: ${result.code}\n`);
    if (result.stderr.trim()) {
      stdout.write(`\nStderr from Zerion CLI:\n  ${result.stderr.trim().split("\n").join("\n  ")}\n`);
    }
    if (result.stdout.trim() && !result.stdout.trim().endsWith("}")) {
      stdout.write(`\nStdout from Zerion CLI:\n  ${result.stdout.trim().split("\n").join("\n  ")}\n`);
    }
  }
  stdout.write("\nFix the issue, then re-run: npm run setup\n\n");
  process.exit(1);
}

function parseDuration(input: string): boolean {
  return /^\d+[hd]$/i.test(input.trim());
}

async function main() {
  stdout.write("\n╭─ Zerion TA Rebalancer — Setup Wizard ─╮\n");
  stdout.write("│                                       │\n");
  stdout.write("│  Sets up wallet, policy, agent token  │\n");
  stdout.write("╰───────────────────────────────────────╯\n\n");

  if (!existsSync(config.zerionCliPath)) {
    fail(
      `Zerion CLI not found at ${config.zerionCliPath}.\n` +
      `Set ZERION_CLI_PATH in .env to the absolute path of cli/zerion.js in your fork.`
    );
  }

  initDb();

  const synced = await syncZerionConfig();
  if (synced) {
    stdout.write("✓ Synced ZERION_API_KEY into ~/.zerion/config.json so direct `zerion` commands work.\n\n");
  }

  // ── Step 1: wallet ─────────────────────────────────────────────────
  stdout.write("Step 1 — Wallet\n");
  stdout.write("───────────────\n");
  const existingWallets = await listExistingWallets();

  let walletName = "";

  if (existingWallets.length > 0) {
    stdout.write(`Found ${existingWallets.length} existing wallet${existingWallets.length === 1 ? "" : "s"}:\n`);
    for (const w of existingWallets) {
      stdout.write(`  • ${w.name}${w.isDefault ? " (default)" : ""}\n`);
    }
    stdout.write("\n");
    if (await askYN("Create a new wallet?", false)) {
      walletName = await ask("Wallet name", "rebalancer");
      if (!walletName || /\s/.test(walletName) || !/^[a-z0-9-]+$/i.test(walletName)) {
        fail(`Wallet name must be alphanumeric or '-' (no spaces). Got: "${walletName}"`);
      }
      stdout.write("\nTip: passphrase is masked. Use 12+ alphanumeric chars. Type the same string twice.\n");
      stdout.write(`\nRunning: zerion wallet create --name ${walletName}\n\n`);
      const result = await runCli(["wallet", "create", "--name", walletName]);
      if (result.code !== 0) {
        fail(
          "Wallet creation failed. Most common cause: the two passphrase entries didn't match.\n" +
          "Re-run setup and type the same passphrase both times.",
          result,
        );
      }
    } else {
      const defaultIdx = Math.max(0, existingWallets.findIndex((w) => w.isDefault));
      const picked = await pickOne(
        "wallet",
        existingWallets,
        (w) => w.name,
        defaultIdx,
      );
      walletName = picked!.name;
    }
  } else {
    stdout.write("No existing wallets — creating a new one.\n");
    stdout.write("Tip: passphrase is masked. Use 12+ alphanumeric chars. Type the same string twice.\n\n");
    walletName = await ask("Wallet name", "rebalancer");
    if (!walletName || /\s/.test(walletName) || !/^[a-z0-9-]+$/i.test(walletName)) {
      fail(`Wallet name must be alphanumeric or '-' (no spaces). Got: "${walletName}"`);
    }
    stdout.write(`\nRunning: zerion wallet create --name ${walletName}\n\n`);
    const result = await runCli(["wallet", "create", "--name", walletName]);
    if (result.code !== 0) {
      fail(
        "Wallet creation failed. Most common cause: the two passphrase entries didn't match.\n" +
        "Re-run setup and type the same passphrase both times.",
        result,
      );
    }
  }

  // ── Step 2: policy ─────────────────────────────────────────────────
  stdout.write("\nStep 2 — Policy\n");
  stdout.write("───────────────\n");
  const existingPolicies = await listExistingPolicies();

  let policyId = "";
  let chain = config.defaultChain;

  const useExistingPolicy =
    existingPolicies.length > 0 &&
    !(await askYN(
      `Found ${existingPolicies.length} existing polic${existingPolicies.length === 1 ? "y" : "ies"}. Create a new one instead?`,
      false,
    ));

  if (useExistingPolicy) {
    const picked = await pickOne(
      "policy",
      existingPolicies,
      (p) => `${p.name} — ${p.summary ?? p.id}`,
    );
    policyId = picked!.id;
    // Pull chain from summary if possible: "chains: solana | expires ..."
    const chainMatch = picked!.summary?.match(/chains?:\s*(\w+)/i);
    if (chainMatch) chain = chainMatch[1] as typeof chain;
  } else {
    stdout.write("Building a tight policy: chain-lock + deny-transfers + deny-approvals + daily-tx cap.\n\n");
    const chainAns = await ask("Chain to lock to (base or solana)", config.defaultChain);
    if (chainAns !== "base" && chainAns !== "solana") {
      fail(`Chain must be 'base' or 'solana'. Got: "${chainAns}"`);
    }
    chain = chainAns as typeof chain;

    const dailyLimit = await ask("Max swaps per 24h (anti-churn)", "8");
    const dailyLimitN = parseInt(dailyLimit, 10);
    if (!Number.isFinite(dailyLimitN) || dailyLimitN <= 0) {
      fail(`Daily limit must be a positive integer. Got: "${dailyLimit}"`);
    }

    const expires = await ask("Token expiry (e.g. 7d, 30d)", "30d");
    if (!parseDuration(expires)) {
      fail(`Expiry must be in the form '<number><h|d>' — e.g. "24h" or "30d". Got: "${expires}"`);
    }

    const policyName = await ask("Policy name", `rebalancer-${chain}`);
    if (!/^[a-z0-9-]+$/i.test(policyName)) {
      fail(`Policy name must be alphanumeric or '-'. Got: "${policyName}"`);
    }

    const policyArgs = [
      "agent", "create-policy",
      "--name", policyName,
      "--chains", chain,
      "--expires", expires,
      "--deny-transfers",
      "--deny-approvals",
      "--daily-tx-limit", dailyLimit,
    ];
    stdout.write(`\nRunning: zerion ${policyArgs.join(" ")}\n\n`);
    const policyRes = await runCli(policyArgs);
    if (policyRes.code !== 0) {
      fail("Policy creation failed.", policyRes);
    }
    const policyJson = tryParseJson(policyRes.stdout);
    policyId = policyJson?.policy?.id;
    if (!policyId) {
      fail(
        "Could not extract policy id from CLI output. The policy may still have been created — \n" +
        "check 'zerion agent list-policies' and re-run setup with the existing policy if so.",
        policyRes,
      );
    }
    stdout.write(`\n✅ Policy created: ${policyId}\n`);
  }

  // ── Step 3: agent token ────────────────────────────────────────────
  stdout.write("\nStep 3 — Agent Token\n");
  stdout.write("────────────────────\n");
  const existingTokens = await listExistingTokens();
  // Tokens that match the chosen wallet AND have the chosen policy attached
  const compatibleTokens = existingTokens.filter(
    (t) => t.wallet === walletName && t.policies?.some((p) => p.id === policyId),
  );

  let tokenName = "";

  if (
    compatibleTokens.length > 0 &&
    !(await askYN(
      `Found ${compatibleTokens.length} agent token${compatibleTokens.length === 1 ? "" : "s"} already bound to wallet "${walletName}" and the chosen policy. Create a new one instead?`,
      false,
    ))
  ) {
    const picked = await pickOne(
      "agent token",
      compatibleTokens,
      (t) => `${t.name}${t.active ? " (active)" : ""}`,
    );
    tokenName = picked!.name;
  } else {
    tokenName = await ask("Agent token name", `${walletName}-agent`);
    if (!/^[a-z0-9-]+$/i.test(tokenName)) {
      fail(`Token name must be alphanumeric or '-'. Got: "${tokenName}"`);
    }
    const tokenArgs = [
      "agent", "create-token",
      "--name", tokenName,
      "--wallet", walletName,
      "--policy", policyId,
    ];
    stdout.write(`\nRunning: zerion ${tokenArgs.join(" ")}\n`);
    stdout.write("(Re-enter the wallet passphrase you set in step 1.)\n\n");
    const tokenRes = await runCli(tokenArgs);
    if (tokenRes.code !== 0) {
      fail(
        "Agent token creation failed. Most common cause: wrong passphrase. Try again.",
        tokenRes,
      );
    }
  }

  // ── Step 4: backup ─────────────────────────────────────────────────
  stdout.write("\nStep 4 — Back up the recovery phrase\n");
  stdout.write("────────────────────────────────────\n");
  stdout.write("This is the most important step. Without the recovery phrase,\n");
  stdout.write("you cannot restore the wallet if you lose this machine.\n\n");
  if (await askYN("Show recovery phrase now?", true)) {
    stdout.write(`\nRunning: zerion wallet backup --wallet ${walletName}\n`);
    stdout.write("(Re-enter your passphrase when prompted.)\n\n");
    const backupRes = await runCli(["wallet", "backup", "--wallet", walletName]);
    if (backupRes.code !== 0) {
      stdout.write("\n⚠ Backup display failed (passphrase mismatch?). Run later:\n");
      stdout.write(`    zerion wallet backup --wallet ${walletName}\n\n`);
    } else {
      stdout.write("\n⚠  Write the 12 words on paper. Store offline. Do NOT screenshot.\n");
      await pressEnter("Press Enter once you've recorded it... ");
    }
  } else {
    stdout.write(`\nSkipped. Run later: zerion wallet backup --wallet ${walletName}\n`);
  }

  // ── Step 5: Telegram authorization ─────────────────────────────────
  if (config.telegramBotToken) {
    stdout.write("\nStep 5 — Telegram authorization\n");
    stdout.write("───────────────────────────────\n");
    stdout.write("The bot will only respond to whitelisted Telegram user IDs.\n");
    stdout.write("To find your user ID:\n");
    stdout.write("  1. Open Telegram\n");
    stdout.write("  2. Message @userinfobot — it replies with your numeric user ID\n");
    stdout.write("     (looks like 5800688332, not @username)\n\n");

    const existing = getAuthorizedUserIds();
    if (existing.length > 0) {
      stdout.write(`Currently authorized: ${existing.join(", ")}\n\n`);
    }

    if (await askYN("Add a Telegram user ID now?", existing.length === 0)) {
      const raw = await ask("Telegram user ID(s) (comma-separated for multiple)");
      const candidates = raw.split(",").map((s) => s.trim()).filter(Boolean);
      const valid = candidates.filter((s) => /^-?\d+$/.test(s));
      const invalid = candidates.filter((s) => !/^-?\d+$/.test(s));
      if (invalid.length > 0) {
        stdout.write(`⚠ Skipped non-numeric entries: ${invalid.join(", ")}\n`);
      }
      if (valid.length > 0) {
        const merged = [...new Set([...existing, ...valid])];
        setAuthorizedUserIds(merged);
        stdout.write(`✅ Authorized: ${merged.join(", ")}\n`);
      } else {
        stdout.write("No valid IDs added.\n");
      }
    } else {
      stdout.write("Skipped. Edit later via the web dashboard's Settings panel.\n");
    }
  } else {
    stdout.write("\nStep 5 — Telegram\n");
    stdout.write("─────────────────\n");
    stdout.write("Skipped (no TELEGRAM_BOT_TOKEN in .env). Set one and re-run setup\n");
    stdout.write("if you want bot notifications + chat.\n");
  }

  // ── Step 6: deposit instructions ───────────────────────────────────
  stdout.write("\nStep 6 — Fund Your Wallet\n");
  stdout.write("─────────────────────────\n");
  stdout.write("Run this to see the deposit address:\n\n");
  stdout.write(`    zerion wallet fund --wallet ${walletName}\n\n`);
  stdout.write("Then send USDC (and gas, if needed) to the address shown.\n\n");

  stdout.write("Setup complete.\n");
  stdout.write(`  • Wallet:        ${walletName}\n`);
  stdout.write(`  • Policy:        ${policyId}\n`);
  stdout.write(`  • Agent token:   ${tokenName}\n`);
  stdout.write(`  • Chain:         ${chain}\n\n`);
  stdout.write("Next steps:\n");
  stdout.write("  1. Fund the wallet (see above)\n");
  stdout.write("  2. npm start      — boot the rebalancer (if not already running)\n");
  stdout.write("  3. Visit http://localhost:" + config.port + " and create your basket\n");
  stdout.write("  4. See docs/RECOVERY.md for restoring the wallet later\n\n");
}

main().catch((e) => {
  stdout.write(`\nFatal: ${e.message}\n`);
  process.exit(1);
});
