/**
 * Interactive setup wizard.
 *
 * Walks a fresh user from "I have an API key" to "I have a wallet, an agent
 * token, and a policy attached." Shells out to the forked Zerion CLI for the
 * commands that need a passphrase prompt — stdio inherits the TTY so the user
 * types directly into the CLI.
 *
 * Run: npm run setup
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync } from "node:fs";
import { config } from "../src/config.ts";
import { initDb } from "../src/core/db.ts";

const rl = createInterface({ input: stdin, output: stdout });

async function ask(question: string, fallback?: string): Promise<string> {
  const suffix = fallback ? ` [${fallback}] ` : " ";
  const answer = (await rl.question(`${question}${suffix}`)).trim();
  return answer || fallback || "";
}

async function askYN(question: string, defaultYes = true): Promise<boolean> {
  const answer = (await rl.question(`${question} ${defaultYes ? "[Y/n]" : "[y/N]"} `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer.startsWith("y");
}

function runCli(args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(process.execPath, [config.zerionCliPath, ...args], {
      stdio: ["inherit", "pipe", "inherit"],
      env: { ...process.env, ZERION_API_KEY: config.zerionApiKey },
    });
    child.stdout.on("data", (chunk) => {
      const s = chunk.toString();
      output += s;
      stdout.write(s);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout: output }));
  });
}

function tryParse(str: string): any {
  // CLI may print non-JSON noise before the JSON block; find first { ... }
  const match = str.match(/\{[\s\S]*\}\s*$/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

async function main() {
  stdout.write("\n╭─ Zerion TA Rebalancer — Setup Wizard ─╮\n");
  stdout.write("│                                       │\n");
  stdout.write("│  Sets up wallet, policy, agent token  │\n");
  stdout.write("╰───────────────────────────────────────╯\n\n");

  if (!existsSync(config.zerionCliPath)) {
    stdout.write(`❌ Zerion CLI not found at ${config.zerionCliPath}\n`);
    stdout.write(`   Set ZERION_CLI_PATH in .env to the absolute path of cli/zerion.js in your fork.\n\n`);
    process.exit(1);
  }

  initDb();

  // Step 1: wallet
  stdout.write("Step 1 — Wallet\n");
  stdout.write("───────────────\n");
  stdout.write("Listing your existing wallets...\n\n");
  await runCli(["wallet", "list", "--pretty"]);

  let walletName = "";
  if (await askYN("\nCreate a new wallet now?")) {
    walletName = await ask("Wallet name", "rebalancer");
    stdout.write(`\nRunning: zerion wallet create --name ${walletName}\n`);
    stdout.write("(You'll be prompted for a passphrase — choose a strong one and remember it.)\n\n");
    const result = await runCli(["wallet", "create", "--name", walletName]);
    if (result.code !== 0) {
      stdout.write("❌ Wallet creation failed.\n");
      process.exit(1);
    }
  } else {
    walletName = await ask("Existing wallet name to use");
    if (!walletName) {
      stdout.write("❌ No wallet name provided.\n");
      process.exit(1);
    }
  }

  // Step 2: policy
  stdout.write("\nStep 2 — Policy\n");
  stdout.write("───────────────\n");
  stdout.write("This wizard creates a tight policy: chain-locked, deny-transfers,\n");
  stdout.write("deny-approvals, with a daily transaction cap.\n\n");

  const chain = await ask("Chain to lock to (base or solana)", config.defaultChain);
  if (chain !== "base" && chain !== "solana") {
    stdout.write("❌ Chain must be 'base' or 'solana'.\n");
    process.exit(1);
  }
  const dailyLimit = await ask("Max swaps per 24h (anti-churn)", "8");
  const expires = await ask("Token expiry (e.g. 7d, 30d)", "30d");
  const policyName = await ask("Policy name", `rebalancer-${chain}`);

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
    stdout.write("❌ Policy creation failed.\n");
    process.exit(1);
  }
  const policyJson = tryParse(policyRes.stdout);
  const policyId = policyJson?.policy?.id;
  if (!policyId) {
    stdout.write("\n⚠ Could not extract policy id from CLI output. You'll need to attach manually.\n");
    process.exit(1);
  }
  stdout.write(`\n✅ Policy created: ${policyId}\n`);

  // Step 3: agent token
  stdout.write("\nStep 3 — Agent Token\n");
  stdout.write("────────────────────\n");
  const tokenName = await ask("Agent token name", `${walletName}-agent`);
  const tokenArgs = [
    "agent", "create-token",
    "--name", tokenName,
    "--wallet", walletName,
    "--policy", policyId,
  ];
  stdout.write(`\nRunning: zerion ${tokenArgs.join(" ")}\n`);
  stdout.write("(You'll be prompted for the wallet passphrase.)\n\n");
  const tokenRes = await runCli(tokenArgs);
  if (tokenRes.code !== 0) {
    stdout.write("❌ Agent token creation failed.\n");
    process.exit(1);
  }

  // Step 4: deposit instructions
  stdout.write("\nStep 4 — Fund Your Wallet\n");
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
  stdout.write("  2. npm run build  — build the web dashboard\n");
  stdout.write("  3. npm start      — boot the rebalancer\n");
  stdout.write("  4. Visit http://localhost:" + config.port + " and create your basket\n\n");

  rl.close();
}

main().catch((e) => {
  stdout.write(`\nFatal: ${e.message}\n`);
  process.exit(1);
});
