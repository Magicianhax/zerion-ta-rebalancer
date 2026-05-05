/**
 * Telegram bot via grammy. Optional surface — disabled if TELEGRAM_BOT_TOKEN is
 * empty.
 *
 * Pairing flow:
 *   1. Web UI → POST /api/telegram/pair → returns 8-char code (30-min TTL)
 *   2. User sends "/start <code>" to the bot
 *   3. Bot looks up code in DB, marks chat_id paired
 *   4. Future rebalance events push to all paired chats
 */

import { Bot } from "grammy";
import { config } from "../config.ts";
import { consumePairing, getBasket, listBaskets, getPairedChatIds } from "../core/db.ts";
import { events } from "../core/rebalancer.ts";
import type { RebalanceResult } from "../types.ts";

function formatRebalance(r: RebalanceResult): string {
  const basket = getBasket(r.basketId);
  const head = `*${basket?.name ?? r.basketId}* — ${new Date(r.startedAt).toLocaleString()}`;

  if (!r.guardOutcome.allow) {
    return `${head}\nDenied: ${r.guardOutcome.reason}`;
  }

  if (r.swaps.length === 0) {
    return `${head}\nNo action needed (within tolerance).`;
  }

  const lines = r.swaps.map((s) => {
    const arrow = `${s.plan.fromToken} → ${s.plan.toToken}`;
    if (s.error) return `❌ ${arrow}: ${s.error}`;
    return `✅ ${arrow}: $${s.plan.estimatedUsd.toFixed(2)}${s.txHash ? ` · \`${s.txHash.slice(0, 10)}…\`` : ""}`;
  });
  return `${head}\n${lines.join("\n")}`;
}

export async function startBot() {
  const bot = new Bot(config.telegramBotToken);

  bot.command("start", async (ctx) => {
    const code = ctx.match?.trim();
    if (!code) {
      return ctx.reply(
        "Welcome! To pair this chat with your Rebalancer dashboard, generate a pairing code there and send it as `/start <code>`."
      );
    }
    const ok = consumePairing(code, String(ctx.chat.id));
    if (ok) {
      return ctx.reply("✅ Paired. You'll receive rebalance notifications here.");
    }
    return ctx.reply("Invalid or expired pairing code. Generate a fresh one in the dashboard.");
  });

  bot.command("status", async (ctx) => {
    const baskets = listBaskets();
    if (baskets.length === 0) return ctx.reply("No baskets configured yet.");
    const lines = baskets.map(
      (b) =>
        `• ${b.name} (${b.chain}) — ${b.enabled ? "active" : "paused"}, $${b.budgetUsd}`,
    );
    return ctx.reply(`Baskets:\n${lines.join("\n")}`);
  });

  bot.command("ping", (ctx) => ctx.reply("pong"));

  events.on("rebalance:done", async (result: RebalanceResult) => {
    const chats = getPairedChatIds();
    if (chats.length === 0) return;
    const message = formatRebalance(result);
    for (const chatId of chats) {
      try {
        await bot.api.sendMessage(chatId, message, { parse_mode: "Markdown" });
      } catch (e: any) {
        process.stderr.write(`telegram push to ${chatId} failed: ${e.message}\n`);
      }
    }
  });

  // Start in background — grammy's start() blocks until shutdown
  bot.start({ drop_pending_updates: true }).catch((e) =>
    process.stderr.write(`Telegram bot error: ${e.message}\n`)
  );

  return {
    async stop() {
      await bot.stop();
    },
  };
}
