/**
 * Claude agent runtime — wraps the Anthropic SDK tool runner for two surfaces:
 *
 *   runHourlyTick(basket)         — autonomous decision per cron firing
 *   handleChatMessage(chatId,text) — plain-English Telegram chat
 *
 * Both use the same underlying tool surface (tools.ts) and the same hard
 * rules (prompts.ts). The agent cannot bypass guards or OWS policy — every
 * action ultimately routes through the same code path as a manual rebalance.
 *
 * If ANTHROPIC_API_KEY is unset, the agent is disabled and we fall back to
 * deterministic behaviour (cron just calls rebalance() directly; the bot
 * replies with a "set ANTHROPIC_API_KEY to enable chat" message).
 */

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.ts";
import {
  loadConversation,
  saveConversation,
  clearConversation,
} from "../core/db.ts";
import { events, rebalance } from "../core/rebalancer.ts";
import { allTools, readOnlyTools } from "./tools.ts";
import { chatSystemPrompt, tickSystemPrompt } from "./prompts.ts";
import type { Basket, RebalanceResult } from "../types.ts";

let _client: Anthropic | null = null;

function client(): Anthropic {
  if (!config.agentEnabled) {
    throw new Error("Agent disabled — set ANTHROPIC_API_KEY in .env");
  }
  if (!_client) _client = new Anthropic({ apiKey: config.anthropicApiKey });
  return _client;
}

const MAX_HISTORY_MESSAGES = 30;

function trimHistory(history: Anthropic.Beta.BetaMessageParam[]): Anthropic.Beta.BetaMessageParam[] {
  if (history.length <= MAX_HISTORY_MESSAGES) return history;
  return history.slice(-MAX_HISTORY_MESSAGES);
}

function extractText(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

// ── Cron tick ────────────────────────────────────────────────────────

export async function runHourlyTick(basket: Basket): Promise<RebalanceResult> {
  if (!config.agentEnabled) {
    const result = await rebalance(basket.id);
    return { ...result, source: "cron" };
  }

  const userPrompt =
    `Hourly check for basket "${basket.name}" (id=${basket.id}, ${basket.chain}).\n\n` +
    `Use your tools to:\n` +
    `1. Inspect the current portfolio (get_portfolio)\n` +
    `2. Score the tokens (get_ta_scores)\n` +
    `3. Check the last rebalance (get_last_rebalance) — am I still in cooldown?\n` +
    `4. Decide: rebalance now, hold, or pause.\n\n` +
    `If you decide to rebalance, call execute_rebalance.\n` +
    `If you decide to hold, just explain in 2-3 sentences why holding is right now.\n` +
    `If something looks wrong (signals broken, weird price action), pause the basket.`;

  let executedResult: RebalanceResult | null = null;
  events.on("rebalance:done", captureResult);
  function captureResult(r: RebalanceResult) {
    if (r.basketId === basket.id) executedResult = r;
  }

  try {
    const finalMessage = await client().beta.messages.toolRunner({
      model: config.anthropicModel,
      max_tokens: 16000,
      system: [
        {
          type: "text",
          text: tickSystemPrompt(),
          cache_control: { type: "ephemeral" },
        },
      ],
      thinking: { type: "adaptive" },
      output_config: { effort: config.agentEffort },
      tools: allTools,
      messages: [{ role: "user", content: userPrompt }],
    });

    const reasoning = extractText(finalMessage.content);

    if (executedResult) {
      const result: RebalanceResult = {
        ...(executedResult as RebalanceResult),
        reasoning,
        source: "agent",
      };
      events.emit("agent:tick", { basketId: basket.id, reasoning, action: "rebalanced" });
      return result;
    }

    const synthetic: RebalanceResult = {
      basketId: basket.id,
      proposal: {
        basketId: basket.id,
        currentWeights: {},
        targetWeights: {},
        scores: [],
        computedAt: new Date().toISOString(),
      },
      plan: [],
      guardOutcome: { allow: true },
      swaps: [],
      reasoning,
      source: "agent",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
    events.emit("agent:tick", { basketId: basket.id, reasoning, action: "held" });
    return synthetic;
  } finally {
    events.off("rebalance:done", captureResult);
  }
}

// ── Telegram chat ────────────────────────────────────────────────────

export async function handleChatMessage(chatId: string, text: string): Promise<string> {
  if (!config.agentEnabled) {
    return (
      "Chat is disabled — the host has not configured ANTHROPIC_API_KEY.\n" +
      "Use /status for a deterministic overview, or set the API key in .env to enable chat."
    );
  }

  const history = trimHistory(
    loadConversation(chatId) as Anthropic.Beta.BetaMessageParam[]
  );
  history.push({ role: "user", content: text });

  try {
    const finalMessage = await client().beta.messages.toolRunner({
      model: config.anthropicModel,
      max_tokens: 8000,
      system: [
        {
          type: "text",
          text: chatSystemPrompt(),
          cache_control: { type: "ephemeral" },
        },
      ],
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      tools: readOnlyTools,
      messages: history,
    });

    history.push({ role: "assistant", content: finalMessage.content });
    saveConversation(chatId, history);

    const reply = extractText(finalMessage.content);
    return reply || "(I didn't have anything to say. Try asking more specifically?)";
  } catch (err: any) {
    if (err instanceof Anthropic.RateLimitError) {
      return "Rate limited by the API — try again in a minute.";
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return "Anthropic API key is invalid. Check your .env.";
    }
    process.stderr.write(`agent.handleChatMessage error: ${err.message}\n`);
    return `Sorry, I hit an error: ${err.message}`;
  }
}

export function resetConversation(chatId: string): void {
  clearConversation(chatId);
}
