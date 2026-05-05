/**
 * Runtime configuration loaded from environment variables.
 * Validated once on startup with Zod, exported as a frozen object.
 */

import "dotenv/config";
import { z } from "zod";
import { resolve } from "node:path";

const Schema = z.object({
  ZERION_API_KEY: z.string().min(1, "ZERION_API_KEY is required"),
  ADMIN_PASSWORD: z.string().min(8, "ADMIN_PASSWORD must be at least 8 chars"),
  ZERION_CLI_PATH: z.string().default("../zerion-ai/cli/zerion.js"),
  PORT: z.coerce.number().int().positive().default(3000),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(""),
  REBALANCE_CRON: z.string().default("0 * * * *"),
  DEFAULT_CHAIN: z.enum(["base", "solana"]).default("solana"),
  DB_PATH: z.string().default("./data/rebalancer.db"),
  MAX_DRIFT_PERCENT: z.coerce.number().min(1).max(100).default(10),
  REBALANCE_COOLDOWN_MINUTES: z.coerce.number().min(0).default(45),
  DEFAULT_SLIPPAGE: z.coerce.number().min(0).max(10).default(2),
});

const parsed = Schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  process.stderr.write(
    `\nConfiguration error — missing or invalid environment variables:\n${issues}\n\n` +
    `Copy .env.example to .env and fill in the required values.\n\n`
  );
  process.exit(1);
}

const env = parsed.data;

export const config = Object.freeze({
  zerionApiKey: env.ZERION_API_KEY,
  adminPassword: env.ADMIN_PASSWORD,
  zerionCliPath: resolve(env.ZERION_CLI_PATH),
  port: env.PORT,
  telegramBotToken: env.TELEGRAM_BOT_TOKEN,
  rebalanceCron: env.REBALANCE_CRON,
  defaultChain: env.DEFAULT_CHAIN,
  dbPath: resolve(env.DB_PATH),
  maxDriftPercent: env.MAX_DRIFT_PERCENT,
  cooldownMinutes: env.REBALANCE_COOLDOWN_MINUTES,
  defaultSlippage: env.DEFAULT_SLIPPAGE,
});

export type Config = typeof config;
