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
  recordAuthorizedChat,
  setBasketEnabled,
} from "../core/db.ts";

/** Single source of truth for the bot's auth — TELEGRAM_AUTHORIZED_USER_IDS in .env. */
function isAuthorizedUserId(userId: string | number): boolean {
  if (config.telegramAuthorizedUserIds.length === 0) return false;
  return config.telegramAuthorizedUserIds.includes(String(userId));
}
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

/** Escape characters that Telegram's Markdown parser treats as formatting. */
function escapeMd(text: string): string {
  return String(text).replace(/[_*`\[\]()~>#+\-=|{}.!\\]/g, "\\$&");
}

/** Pull the human-readable error out of a CLI stderr blob. */
function summarizeError(raw: string): string {
  try {
    const match = raw.match(/\{[\s\S]*\}\s*$/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed?.error?.message) return String(parsed.error.message);
    }
  } catch {
    // fall through
  }
  const firstLine = raw.split("\n").find((l) => l.trim() && !l.includes("DeprecationWarning"));
  return (firstLine ?? raw).slice(0, 200);
}

function formatRebalance(r: RebalanceResult): string {
  const basket = getBasket(r.basketId);
  const head = `*${escapeMd(basket?.name ?? r.basketId)}* — ${escapeMd(new Date(r.startedAt).toLocaleString())}`;

  if (!r.guardOutcome.allow) {
    return `${head}\nDenied: ${escapeMd(r.guardOutcome.reason)}`;
  }

  if (r.swaps.length === 0) {
    return `${head}\nNo action needed \\(within tolerance\\)\\.`;
  }

  const lines = r.swaps.map((s) => {
    const arrow = `${escapeMd(s.plan.fromToken)} → ${escapeMd(s.plan.toToken)}`;
    if (s.error) return `❌ ${arrow}: ${escapeMd(summarizeError(s.error))}`;
    const usd = `$${s.plan.estimatedUsd.toFixed(2)}`;
    const hash = s.txHash ? ` · \`${s.txHash.slice(0, 10)}…\`` : "";
    return `✅ ${arrow}: ${escapeMd(usd)}${hash}`;
  });
  return `${head}\n${lines.join("\n")}`;
}

export async function startBot() {
  const bot = new Bot(config.telegramBotToken);

  // Auth middleware — every interaction must come from a whitelisted Telegram
  // user ID. The whitelist is set during `npm run setup` and editable from
  // the web Settings panel. Unknown users get a polite refusal and the
  // server logs the attempted user ID so the operator can decide whether to
  // whitelist them. The legacy /start <pairing-code> path is kept as a
  // fallback for first-time bootstrapping when no IDs have been set yet.
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId == null) return; // Service messages, ignore.

    if (isAuthorizedUserId(userId)) {
      // Authorized — also persist this chat so push notifications can reach it.
      if (ctx.chat?.id != null) {
        recordAuthorizedChat(String(ctx.chat.id), String(userId));
      }
      await next();
      return;
    }

    // Unauthorized: allow only `/start <pairing-code>` for bootstrapping.
    const text = (ctx.message?.text ?? "").trim();
    const isPairing = text.startsWith("/start ") && text.length > 7;
    if (isPairing) {
      await next();
      return;
    }

    process.stderr.write(
      `[bot] unauthorized message from user ${userId} (@${ctx.from?.username ?? "?"}): ${text.slice(0, 60)}\n`,
    );
    await ctx.reply(
      `Not authorized. Your Telegram user ID is \`${userId}\` — ask the operator to add it to the whitelist (Settings → Authorized users in the dashboard, or via the setup wizard).`,
      { parse_mode: "Markdown" },
    );
  });

  bot.command("start", async (ctx) => {
    const code = ctx.match?.trim();
    const userId = ctx.from?.id ? String(ctx.from.id) : null;

    if (code) {
      const ok = consumePairing(code, String(ctx.chat.id));
      if (ok) {
        return ctx.reply("✅ Paired via code. You'll receive rebalance notifications here.");
      }
      return ctx.reply("Invalid or expired pairing code. Generate a fresh one in the dashboard.");
    }

    return ctx.reply(
      `Welcome${ctx.from?.first_name ? `, ${ctx.from.first_name}` : ""}! ` +
      `Your chat is now paired and you'll get rebalance notifications here.\n\n` +
      `Send \`/status\`, \`/balance\`, or just chat in plain English to talk to the agent.\n\n` +
      `Your user ID: \`${userId ?? "?"}\``,
      { parse_mode: "Markdown" },
    );
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
