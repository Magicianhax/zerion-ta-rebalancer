/**
 * Tool surface available to the Claude agent.
 *
 * Each tool is a thin Zod-validated wrapper around our existing core/* modules.
 * The agent can read state and propose actions; everything ultimately routes
 * through the same guard rails + OWS policy as a manual rebalance, so the
 * agent cannot bypass any of the safety layers.
 */

import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
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

/** Tool runner expects a string or content blocks; serialize objects as JSON. */
function jsonReply(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

// ── Read-only inspection ─────────────────────────────────────────────

export const listBasketsTool = betaZodTool({
  name: "list_baskets",
  description:
    "List every basket configured in the rebalancer. Returns id, name, chain, budget, enabled state, and the configured tokens.",
  inputSchema: z.object({}),
  run: async () => jsonReply(listBaskets().map(summariseBasket)),
});

export const getBasketTool = betaZodTool({
  name: "get_basket",
  description:
    "Get details for a specific basket — tokens, weights, settings, and whether it is currently enabled.",
  inputSchema: z.object({
    basketId: z.string().describe("The basket id from list_baskets"),
  }),
  run: async ({ basketId }) => {
    const b = getBasket(basketId);
    if (!b) throw new Error(`Basket "${basketId}" not found`);
    return jsonReply(summariseBasket(b));
  },
});

export const getPortfolioTool = betaZodTool({
  name: "get_portfolio",
  description:
    "Get the current on-chain portfolio for a basket. Returns total USD value, per-token USD values, and current weights.",
  inputSchema: z.object({
    basketId: z.string().describe("The basket id"),
  }),
  run: async ({ basketId }) => {
    const basket = getBasket(basketId);
    if (!basket) throw new Error(`Basket "${basketId}" not found`);
    const raw = await positions(basket.walletName, "simple").catch(() => null);
    if (!raw) {
      return jsonReply({ totalUsd: 0, byToken: {}, currentWeights: {}, note: "Wallet unfunded or unreachable" });
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
    return jsonReply({ totalUsd: Math.round(total * 100) / 100, byToken, currentWeights: weights });
  },
});

export const getTaScoresTool = betaZodTool({
  name: "get_ta_scores",
  description:
    "Compute TA scores for every non-quote token in a basket. Returns RSI/MACD/EMA/volatility/volume sub-scores (0-100 each) and the composite score that drives weight proposals. Also returns the TA-suggested weights and the weights blended with the user's initial bias.",
  inputSchema: z.object({
    basketId: z.string().describe("The basket id"),
  }),
  run: async ({ basketId }) => {
    const basket = getBasket(basketId);
    if (!basket) throw new Error(`Basket "${basketId}" not found`);
    const nonQuote = basket.tokens.filter(
      (t) => t.symbol.toUpperCase() !== basket.quoteToken.toUpperCase()
    );
    const scores: TokenScore[] = [];
    for (const t of nonQuote) {
      try {
        scores.push(await scoreToken(basket.chain, t.symbol));
      } catch (e: any) {
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
    return jsonReply({ scores, taSuggestedWeights: taWeights, blendedWeights: blended, taBias: basket.taBias });
  },
});

export const getHistoryTool = betaZodTool({
  name: "get_history",
  description:
    "Get recent rebalance attempts for a basket — including denied attempts and the reason. Useful for understanding cooldown state and recent decisions.",
  inputSchema: z.object({
    basketId: z.string().describe("The basket id"),
    limit: z.number().int().positive().max(50).optional().default(10),
  }),
  run: async ({ basketId, limit }) => {
    const list = listRebalances(basketId, limit);
    return jsonReply(list.map(summariseRebalance));
  },
});

export const getLastRebalanceTool = betaZodTool({
  name: "get_last_rebalance",
  description: "Get the single most recent rebalance attempt for a basket.",
  inputSchema: z.object({
    basketId: z.string().describe("The basket id"),
  }),
  run: async ({ basketId }) => {
    const last = lastRebalanceFor(basketId);
    return jsonReply(last ? summariseRebalance(last) : null);
  },
});

// ── State-changing actions (still gated by guards + OWS policy) ──────

export const executeRebalanceTool = betaZodTool({
  name: "execute_rebalance",
  description:
    "Execute a rebalance for the basket. The TA pipeline computes target weights, app-layer guards are applied (cooldown, max-drift, slippage), and approved swaps are routed through Zerion CLI — which OWS still enforces against the wallet's policy. Returns the full result including any guard denial, swap plan, and tx hashes. Use this when you have decided action is appropriate.",
  inputSchema: z.object({
    basketId: z.string().describe("The basket id"),
  }),
  run: async ({ basketId }) => {
    const result = await rebalance(basketId);
    return jsonReply(summariseRebalance(result));
  },
});

export const setBasketEnabledTool = betaZodTool({
  name: "set_basket_enabled",
  description:
    "Pause or resume a basket. Paused baskets are skipped by the cron and rejected by the guard layer. Use this if you detect something is wrong (price feed broken, unusual market) and want to stop trading until the user reviews.",
  inputSchema: z.object({
    basketId: z.string().describe("The basket id"),
    enabled: z.boolean().describe("True to resume, false to pause"),
  }),
  run: async ({ basketId, enabled }) => {
    setBasketEnabled(basketId, enabled);
    return jsonReply({ basketId, enabled });
  },
});

// ── Bundle exports ───────────────────────────────────────────────────

/** Read-only tools — safe for the chat surface (Telegram). */
export const readOnlyTools = [
  listBasketsTool,
  getBasketTool,
  getPortfolioTool,
  getTaScoresTool,
  getHistoryTool,
  getLastRebalanceTool,
];

/** Full tool surface — read + state changes. Used by the cron tick. */
export const allTools = [
  ...readOnlyTools,
  executeRebalanceTool,
  setBasketEnabledTool,
];
