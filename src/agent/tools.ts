/**
 * Tool surface for the Claude Agent SDK. Each tool is registered into an
 * in-process MCP server (no IPC, no subprocess overhead).
 *
 * Every tool is a thin wrapper around our existing core/* modules. The agent
 * can read state and propose actions; everything ultimately routes through
 * the same guard rails + OWS policy as a manual rebalance, so the agent
 * cannot bypass any of the safety layers.
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  getBasket,
  listBaskets,
  listRebalances,
  setBasketEnabled,
  lastRebalanceFor,
} from "../core/db.ts";
import { positions } from "../core/zerion.ts";
import { rebalance } from "../core/rebalancer.ts";
import { scoreToken, scoresToWeights, blendWeights } from "../core/ta.ts";
import type { Basket, RebalanceResult, TokenScore } from "../types.ts";

function summariseBasket(b: Basket) {
  return {
    id: b.id,
    name: b.name,
    chain: b.chain,
    budgetUsd: b.budgetUsd,
    enabled: b.enabled,
    taBias: b.taBias,
    tokens: b.tokens.map((t) => ({
      symbol: t.symbol,
      initialWeight: t.initialWeight,
      minWeight: t.minWeight ?? null,
      maxWeight: t.maxWeight ?? null,
    })),
  };
}

function summariseRebalance(r: RebalanceResult) {
  return {
    startedAt: r.startedAt,
    allowed: r.guardOutcome.allow,
    deniedReason: r.guardOutcome.allow ? null : r.guardOutcome.reason,
    swapCount: r.swaps.length,
    swaps: r.swaps.map((s) => ({
      from: s.plan.fromToken,
      to: s.plan.toToken,
      usd: Math.round(s.plan.estimatedUsd * 100) / 100,
      txHash: s.txHash ?? null,
      error: s.error ?? null,
    })),
    targetWeights: r.proposal.targetWeights,
    currentWeights: r.proposal.currentWeights,
    reasoning: r.reasoning ?? null,
  };
}

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

// ── Read-only tools ──────────────────────────────────────────────────

const listBasketsTool = tool(
  "list_baskets",
  "List every basket configured in the rebalancer. Returns id, name, chain, budget, enabled state, and configured tokens.",
  {},
  async () => jsonResult(listBaskets().map(summariseBasket)),
);

const getBasketTool = tool(
  "get_basket",
  "Get details for a specific basket — tokens, weights, settings, and whether it is currently enabled.",
  {
    basketId: z.string().describe("The basket id from list_baskets"),
  },
  async ({ basketId }) => {
    const b = getBasket(basketId);
    if (!b) throw new Error(`Basket "${basketId}" not found`);
    return jsonResult(summariseBasket(b));
  },
);

const getPortfolioTool = tool(
  "get_portfolio",
  "Get the current on-chain portfolio for a basket. Returns total USD value, per-token USD values, and current weights.",
  {
    basketId: z.string().describe("The basket id"),
  },
  async ({ basketId }) => {
    const basket = getBasket(basketId);
    if (!basket) throw new Error(`Basket "${basketId}" not found`);
    const raw = await positions(basket.walletName, {
      mode: "simple",
      chain: basket.chain,
    }).catch(() => null);
    if (!raw) {
      return jsonResult({ totalUsd: 0, byToken: {}, currentWeights: {}, note: "Wallet unfunded or unreachable" });
    }
    const items: any[] = raw?.positions ?? raw?.data ?? [];
    const want = new Set(basket.tokens.map((t) => t.symbol.toUpperCase()));
    want.add(basket.quoteToken.toUpperCase());
    const byToken: Record<string, number> = {};
    let total = 0;
    for (const item of items) {
      const sym = (item.symbol ?? item.fungible?.symbol ?? "").toUpperCase();
      if (!want.has(sym)) continue;
      const value = Number(item.value_usd ?? item.value ?? item.usd_value ?? 0);
      if (!Number.isFinite(value) || value <= 0) continue;
      byToken[sym] = (byToken[sym] ?? 0) + value;
      total += value;
    }
    const weights: Record<string, number> = {};
    for (const [sym, usd] of Object.entries(byToken)) {
      weights[sym] = total > 0 ? usd / total : 0;
    }
    return jsonResult({ totalUsd: Math.round(total * 100) / 100, byToken, currentWeights: weights });
  },
);

const getTaScoresTool = tool(
  "get_ta_scores",
  "Compute TA scores for every non-quote token in a basket. Returns RSI/MACD/EMA/volatility/volume sub-scores (0-100 each), composite scores, and the TA-suggested weights blended with the user's initial bias.",
  {
    basketId: z.string().describe("The basket id"),
  },
  async ({ basketId }) => {
    const basket = getBasket(basketId);
    if (!basket) throw new Error(`Basket "${basketId}" not found`);
    const nonQuote = basket.tokens.filter(
      (t) => t.symbol.toUpperCase() !== basket.quoteToken.toUpperCase()
    );
    const scores: TokenScore[] = [];
    for (const t of nonQuote) {
      try {
        scores.push(await scoreToken(basket.chain, t.symbol));
      } catch {
        scores.push({
          symbol: t.symbol,
          score: 50,
          breakdown: { rsi: 50, macd: 50, ema: 50, volatility: 50, volume: 50 },
        });
      }
    }
    const initial: Record<string, number> = {};
    for (const t of nonQuote) initial[t.symbol.toUpperCase()] = t.initialWeight;
    const taWeights = scoresToWeights(scores);
    const blended = blendWeights(initial, taWeights, basket.taBias);
    return jsonResult({ scores, taSuggestedWeights: taWeights, blendedWeights: blended, taBias: basket.taBias });
  },
);

const getHistoryTool = tool(
  "get_history",
  "Get recent rebalance attempts for a basket — including denied attempts and the reason. Useful for understanding cooldown state and recent decisions.",
  {
    basketId: z.string().describe("The basket id"),
    limit: z.number().int().positive().max(50).default(10),
  },
  async ({ basketId, limit }) => {
    const list = listRebalances(basketId, limit);
    return jsonResult(list.map(summariseRebalance));
  },
);

const getLastRebalanceTool = tool(
  "get_last_rebalance",
  "Get the single most recent rebalance attempt for a basket.",
  {
    basketId: z.string().describe("The basket id"),
  },
  async ({ basketId }) => {
    const last = lastRebalanceFor(basketId);
    return jsonResult(last ? summariseRebalance(last) : null);
  },
);

// ── State-changing tools (still gated by guards + OWS policy) ────────

const executeRebalanceTool = tool(
  "execute_rebalance",
  "Execute a rebalance for the basket. The TA pipeline computes target weights, app-layer guards apply (cooldown, max-drift, slippage), and approved swaps route through Zerion CLI — which OWS still enforces against the wallet's policy. Use this only when you've decided action is appropriate.",
  {
    basketId: z.string().describe("The basket id"),
  },
  async ({ basketId }) => {
    const result = await rebalance(basketId);
    return jsonResult(summariseRebalance(result));
  },
);

const setBasketEnabledTool = tool(
  "set_basket_enabled",
  "Pause or resume a basket. Paused baskets are skipped by the cron and rejected by the guard layer. Use this if you detect something is wrong (price feed broken, unusual market) and want to stop trading until the user reviews.",
  {
    basketId: z.string().describe("The basket id"),
    enabled: z.boolean().describe("True to resume, false to pause"),
  },
  async ({ basketId, enabled }) => {
    setBasketEnabled(basketId, enabled);
    return jsonResult({ basketId, enabled });
  },
);

// ── MCP server bundles ───────────────────────────────────────────────

/**
 * Read-only MCP server — used for chat (Telegram). Agent can inspect state
 * but cannot trigger swaps or pause baskets.
 */
export const readOnlyServer = createSdkMcpServer({
  name: "rebalancer-read",
  version: "1.0.0",
  tools: [
    listBasketsTool,
    getBasketTool,
    getPortfolioTool,
    getTaScoresTool,
    getHistoryTool,
    getLastRebalanceTool,
  ],
});

/**
 * Full MCP server — read + state-changing. Used for the cron tick.
 */
export const fullServer = createSdkMcpServer({
  name: "rebalancer-full",
  version: "1.0.0",
  tools: [
    listBasketsTool,
    getBasketTool,
    getPortfolioTool,
    getTaScoresTool,
    getHistoryTool,
    getLastRebalanceTool,
    executeRebalanceTool,
    setBasketEnabledTool,
  ],
});

/** Tool name prefixes per the SDK's mcp__<server>__<tool> convention. */
export const READ_ONLY_TOOL_NAMES = [
  "mcp__rebalancer-read__list_baskets",
  "mcp__rebalancer-read__get_basket",
  "mcp__rebalancer-read__get_portfolio",
  "mcp__rebalancer-read__get_ta_scores",
  "mcp__rebalancer-read__get_history",
  "mcp__rebalancer-read__get_last_rebalance",
];

export const FULL_TOOL_NAMES = [
  "mcp__rebalancer-full__list_baskets",
  "mcp__rebalancer-full__get_basket",
  "mcp__rebalancer-full__get_portfolio",
  "mcp__rebalancer-full__get_ta_scores",
  "mcp__rebalancer-full__get_history",
  "mcp__rebalancer-full__get_last_rebalance",
  "mcp__rebalancer-full__execute_rebalance",
  "mcp__rebalancer-full__set_basket_enabled",
];
