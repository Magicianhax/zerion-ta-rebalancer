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
import {
  consumePairing,
  getBasket,
  listBaskets,
  getPairedChatIds,
  setBasketEnabled,
} from "../core/db.ts";
import { events } from "../core/rebalancer.ts";
import { positions } from "../core/zerion.ts";
import { summarizePositions } from "../core/positions-parser.ts";
import { handleChatMessage, resetConversation } from "../agent/index.ts";
import type { Basket, RebalanceResult } from "../types.ts";

async function fetchBalance(basket: Basket): Promise<string> {
  try {
    const raw = await positions(basket.walletName, {
      mode: "simple",
      chain: basket.chain,
    });
    const { totalUsd, byToken, rawSymbols } = summarizePositions(raw, basket);
    if (totalUsd === 0) {
      const seen = rawSymbols.length
        ? `\nZerion sees: ${[...new Set(rawSymbols)].slice(0, 8).join(", ")}`
        : "";
      return (
        `*${basket.name}* (${basket.chain}) — wallet \`${basket.walletName}\` shows $0.\n` +
        `Fund it with USDC + gas to start (or wait ~60s for Zerion to index a fresh deposit).${seen}`
      );
    }
    const tokenLines = Object.entries(byToken)
      .sort((a, b) => b[1] - a[1])
      .map(
        ([sym, usd]) =>
          `  ${sym.padEnd(6)} $${usd.toFixed(2).padStart(7)} (${((usd / totalUsd) * 100).toFixed(1)}%)`,
      )
      .join("\n");
    return `*${basket.name}* (${basket.chain}) — *$${totalUsd.toFixed(2)}* total\n\`\`\`\n${tokenLines}\n\`\`\``;
  } catch (e: any) {
    return `*${basket.name}* — error fetching balance: ${e.message}`;
  }
}

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

  bot.command("balance", async (ctx) => {
    const baskets = listBaskets();
    if (baskets.length === 0) return ctx.reply("No baskets configured yet.");
    await ctx.api.sendChatAction(ctx.chat.id, "typing");
    const lines: string[] = [];
    for (const b of baskets) {
      const summary = await fetchBalance(b);
      lines.push(summary);
    }
    return ctx.reply(lines.join("\n\n"), { parse_mode: "Markdown" });
  });

  bot.command("reset", async (ctx) => {
    resetConversation(String(ctx.chat.id));
    return ctx.reply("Conversation history cleared. Fresh start.");
  });

  bot.command(["pause", "resume"], async (ctx) => {
    const targetName = ctx.match?.trim();
    if (!targetName) return ctx.reply(`Usage: /${ctx.message?.text?.startsWith("/pause") ? "pause" : "resume"} <basket name or id>`);
    const baskets = listBaskets();
    const target = baskets.find((b) => b.id === targetName || b.name === targetName);
    if (!target) return ctx.reply(`No basket named "${targetName}". Try /status to see what's available.`);
    const wantEnabled = ctx.message?.text?.startsWith("/resume") ?? false;
    setBasketEnabled(target.id, wantEnabled);
    return ctx.reply(`${target.name} → ${wantEnabled ? "resumed" : "paused"}.`);
  });

  // Plain-text messages (non-commands) → route to the Claude agent.
  // Long-running tool calls can take 10-30s, so show typing indicator.
  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;
    const chatId = String(ctx.chat.id);
    try {
      await ctx.api.sendChatAction(ctx.chat.id, "typing");
      const reply = await handleChatMessage(chatId, ctx.message.text);
      await ctx.reply(reply, { parse_mode: "Markdown" });
    } catch (e: any) {
      process.stderr.write(`bot text handler error: ${e.message}\n`);
      await ctx.reply(`Hit an error: ${e.message}`);
    }
  });

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
