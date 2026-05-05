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
import { initDb } from "../src/core/db.ts";
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
  // CLI may print non-JSON noise before the JSON block; find first { ... }
  const match = str.match(/\{[\s\S]*\}\s*$/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
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
  stdout.write("Tip: When the CLI asks for a passphrase, type carefully —\n");
  stdout.write("     masking hides typos. Use 12+ alphanumeric chars; avoid\n");
  stdout.write("     symbols that some terminals mangle. Same string twice.\n\n");
  stdout.write("Listing your existing wallets...\n\n");
  await runCli(["wallet", "list", "--pretty"]);

  let walletName = "";
  if (await askYN("\nCreate a new wallet now?")) {
    walletName = await ask("Wallet name", "rebalancer");
    if (!walletName || /\s/.test(walletName) || !/^[a-z0-9-]+$/i.test(walletName)) {
      fail(`Wallet name must be alphanumeric or '-' (no spaces). Got: "${walletName}"`);
    }
    stdout.write(`\nRunning: zerion wallet create --name ${walletName}\n`);
    stdout.write("(OWS will encrypt this with your passphrase. Takes ~5 seconds.)\n\n");
    const result = await runCli(["wallet", "create", "--name", walletName]);
    if (result.code !== 0) {
      fail(
        "Wallet creation failed. Most common cause: the two passphrase entries didn't match.\n" +
        "Re-run setup and type the same passphrase both times — write it down beforehand if needed.",
        result
      );
    }
  } else {
    walletName = await ask("Existing wallet name to use");
    if (!walletName) fail("No wallet name provided.");
  }

  // ── Step 2: policy ─────────────────────────────────────────────────
  stdout.write("\nStep 2 — Policy\n");
  stdout.write("───────────────\n");
  stdout.write("Builds a tight policy: chain-locked + deny-transfers + deny-approvals\n");
  stdout.write("+ daily transaction cap. All enforced at the OWS signing layer.\n\n");

  const chain = await ask("Chain to lock to (base or solana)", config.defaultChain);
  if (chain !== "base" && chain !== "solana") {
    fail(`Chain must be 'base' or 'solana'. Got: "${chain}"`);
  }

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
  const policyId = policyJson?.policy?.id;
  if (!policyId) {
    fail(
      "Could not extract policy id from CLI output. The policy may still have been created — \n" +
      "check 'zerion agent list-policies' and re-run setup with the existing policy if so.",
      policyRes
    );
  }
  stdout.write(`\n✅ Policy created: ${policyId}\n`);

  // ── Step 3: agent token ────────────────────────────────────────────
  stdout.write("\nStep 3 — Agent Token\n");
  stdout.write("────────────────────\n");
  const tokenName = await ask("Agent token name", `${walletName}-agent`);
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
      tokenRes
    );
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

  // ── Step 5: deposit instructions ───────────────────────────────────
  stdout.write("\nStep 5 — Fund Your Wallet\n");
  stdout.write("─────────────────────────\n");
  stdout.write("Run this to see the deposit address:\n\n");
  stdout.write(`    zerion wallet fund --wallet ${walletName}\n\n`);
  stdout.write("Then send USDC (and gas, if needed) to the address shown.\n\n");

  stdout.write("Setup complete.\n");
  stdout.write(`  • Wallet:        ${walletName}\n`);
  stdout.write(`  • Policy:        ${policyId}\n`);
  stdout.write(`  • Agent token:   ${tokenName}\n`);
  stdout.write(`  • Chain:         ${chain}\n`);
  stdout.write(`  • Daily tx cap:  ${dailyLimit} swaps / 24h\n\n`);
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
