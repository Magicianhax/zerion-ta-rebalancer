/**
 * Claude Agent SDK runtime — uses the same SDK that powers Claude Code.
 *
 * Authentication priority (handled by the SDK):
 *   1. ANTHROPIC_API_KEY env var → direct API billing
 *   2. Claude Code subscription credentials at ~/.claude/.credentials.json
 *   3. Otherwise → agent disabled, fall back to deterministic mode
 *
 * Two surfaces, one SDK:
 *   runHourlyTick(basket)         — autonomous decision per cron firing
 *   handleChatMessage(chatId,text) — plain-English Telegram chat
 *
 * Both use the same underlying tool surface and hard rules. The agent cannot
 * bypass guards or OWS policy — every action routes through the same code
 * path as a manual rebalance.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config.ts";
import {
  loadConversation,
  saveConversation,
  clearConversation,
} from "../core/db.ts";
import { events, rebalance } from "../core/rebalancer.ts";
import {
  fullServer,
  readOnlyServer,
  FULL_TOOL_NAMES,
  READ_ONLY_TOOL_NAMES,
} from "./tools.ts";
import { chatSystemPrompt, tickSystemPrompt } from "./prompts.ts";
import type { Basket, RebalanceResult } from "../types.ts";

const MAX_HISTORY_TURNS = 12;

/**
 * Detect whether we have credentials available — either an API key or a
 * Claude Code subscription credentials file. The SDK does its own auth, but
 * we want to know upfront so we can fall back to deterministic mode cleanly.
 */
function authIsAvailable(): boolean {
  if (config.anthropicApiKey) return true;
  const credPaths = [
    join(homedir(), ".claude", ".credentials.json"),
    join(homedir(), ".claude", "credentials.json"),
  ];
  return credPaths.some((p) => existsSync(p));
}

/**
 * Locate the globally-installed `claude` CLI to pass to the SDK.
 *
 * The Claude Agent SDK ships per-platform native binaries via optional npm
 * dependencies. On some platforms (e.g. Linux glibc with a musl-detection
 * mismatch, or non-mainstream architectures) npm doesn't install the right
 * variant and the SDK fails with "Claude Code native binary not found at
 * .../claude-agent-sdk-linux-x64-musl/claude". The fix is to point the SDK
 * at the globally-installed `claude` CLI from `npm install -g @anthropic-ai/claude-code`,
 * which we can resolve via `which`.
 *
 * Returns null if no global `claude` exists; the SDK then falls back to its
 * bundled binary (which fails loudly if absent).
 */
function findClaudeBinary(): string | null {
  try {
    const path = execFileSync("which", ["claude"], { encoding: "utf8" }).trim();
    return path && existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

const _hasAuth = authIsAvailable();
const _claudeBinary = findClaudeBinary();

if (_hasAuth) {
  process.stdout.write(
    `[agent] auth: ${config.anthropicApiKey ? "ANTHROPIC_API_KEY (direct API)" : "Claude Code subscription"}\n`,
  );
  if (_claudeBinary) {
    process.stdout.write(`[agent] claude CLI: ${_claudeBinary}\n`);
  } else {
    process.stdout.write(
      `[agent] claude CLI not on PATH — relying on SDK's bundled binary. Install with:\n` +
      `        npm install -g @anthropic-ai/claude-code\n`,
    );
  }
}

interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

function buildHistoryPreamble(history: ChatTurn[]): string {
  if (history.length === 0) return "";
  const recent = history.slice(-MAX_HISTORY_TURNS);
  const lines = recent.map(
    (t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`,
  );
  return `Prior conversation:\n${lines.join("\n\n")}\n\n---\n\nCurrent message:\n`;
}

async function runQuery(
  prompt: string,
  options: Partial<Options>,
): Promise<{ text: string; toolCalls: number }> {
  let assistantText = "";
  let toolCalls = 0;
  let resultText: string | null = null;

  const fullOptions: Options = {
    ...(options as Options),
    // Point the SDK at the globally-installed `claude` if we found one.
    // Avoids the per-platform native-binary mismatch some setups hit.
    ...(_claudeBinary ? { pathToClaudeCodeExecutable: _claudeBinary } : {}),
  };
  const stream = query({ prompt, options: fullOptions });

  for await (const message of stream as AsyncIterable<SDKMessage>) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") {
          assistantText += block.text;
        } else if (block.type === "tool_use") {
          toolCalls++;
        }
      }
    } else if (message.type === "result") {
      if (message.subtype === "success") {
        resultText = message.result;
      } else {
        throw new Error(
          `Agent query failed: ${(message as any).is_error ? "error" : "no result"}`,
        );
      }
    }
  }

  return { text: resultText ?? assistantText.trim(), toolCalls };
}

// ── Cron tick ────────────────────────────────────────────────────────

export async function runHourlyTick(basket: Basket): Promise<RebalanceResult> {
  if (!_hasAuth) {
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
  function captureResult(r: RebalanceResult) {
    if (r.basketId === basket.id) executedResult = r;
  }
  events.on("rebalance:done", captureResult);

  try {
    const { text } = await runQuery(userPrompt, {
      model: config.anthropicModel,
      systemPrompt: tickSystemPrompt(),
      mcpServers: { "rebalancer-full": fullServer },
      allowedTools: FULL_TOOL_NAMES,
      maxTurns: 12,
      permissionMode: "bypassPermissions",
    });

    if (executedResult) {
      const result: RebalanceResult = {
        ...(executedResult as RebalanceResult),
        reasoning: text,
        source: "agent",
      };
      events.emit("agent:tick", { basketId: basket.id, reasoning: text, action: "rebalanced" });
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
      reasoning: text,
      source: "agent",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
    events.emit("agent:tick", { basketId: basket.id, reasoning: text, action: "held" });
    return synthetic;
  } finally {
    events.off("rebalance:done", captureResult);
  }
}

// ── Telegram chat ────────────────────────────────────────────────────

export async function handleChatMessage(chatId: string, text: string): Promise<string> {
  if (!_hasAuth) {
    return (
      "Chat is disabled — no Anthropic credentials available.\n" +
      "Either set ANTHROPIC_API_KEY in .env, or sign in with Claude Code (`claude login`)."
    );
  }

  const history = loadConversation(chatId) as ChatTurn[];
  const prompt = buildHistoryPreamble(history) + text;

  try {
    const { text: reply } = await runQuery(prompt, {
      model: config.anthropicModel,
      systemPrompt: chatSystemPrompt(),
      mcpServers: { "rebalancer-read": readOnlyServer },
      allowedTools: READ_ONLY_TOOL_NAMES,
      maxTurns: 8,
      permissionMode: "bypassPermissions",
    });

    history.push({ role: "user", text });
    history.push({ role: "assistant", text: reply });
    saveConversation(chatId, history.slice(-MAX_HISTORY_TURNS * 2));

    return reply || "(I didn't have anything to say. Try asking more specifically?)";
  } catch (err: any) {
    process.stderr.write(`agent.handleChatMessage error: ${err.message}\n`);
    return `Sorry, I hit an error: ${err.message}`;
  }
}

export function resetConversation(chatId: string): void {
  clearConversation(chatId);
}

/** Whether the agent has credentials configured. Used by status / diagnostics. */
export function isAgentEnabled(): boolean {
  return _hasAuth;
}
