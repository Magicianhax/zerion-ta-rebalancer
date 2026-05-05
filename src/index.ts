/**
 * Entry point — boots the Hono server, cron scheduler, and (optional) Telegram bot
 * in a single Node process.
 */

import { config } from "./config.ts";
import { initDb } from "./core/db.ts";
import { startServer } from "./api/server.ts";
import { startCron } from "./cron.ts";
import { startBot } from "./bot/index.ts";

async function main() {
  initDb();

  const server = startServer();
  const cron = startCron();
  const bot = config.telegramBotToken ? await startBot() : null;

  process.stdout.write(
    `\nZerion TA Rebalancer ready\n` +
    `  → Web dashboard: http://localhost:${config.port}\n` +
    `  → Cron schedule: ${config.rebalanceCron}\n` +
    `  → Telegram bot:  ${bot ? "running" : "disabled"}\n\n`
  );

  const shutdown = async (signal: string) => {
    process.stdout.write(`\nReceived ${signal}, shutting down gracefully...\n`);
    cron.stop();
    if (bot) await bot.stop();
    server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
