/**
 * Read-only inspection tools. Safe for both the cron tick and chat surface —
 * agent can ask about state without changing it.
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  getBasket,
  lastRebalanceFor,
  listBaskets,
  listRebalances,
} from "../../core/db.ts";
import { positions } from "../../core/zerion.ts";
import { blendWeights, scoresToWeights, scoreToken } from "../../core/ta.ts";
import type { TokenScore } from "../../types.ts";
import { jsonResult, summariseBasket, summariseRebalance } from "./helpers.ts";

export const listBasketsTool = tool(
  "list_baskets",
  "List every basket configured in the rebalancer. Returns id, name, chain, budget, enabled state, and configured tokens.",
  {},
  async () => jsonResult(listBaskets().map(summariseBasket)),
);

export const getBasketTool = tool(
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

export const getPortfolioTool = tool(
  "get_portfolio",
  "Get the current on-chain portfolio for a basket. Returns total USD value, per-token USD values, and current weights.",
  {
    basketId: z.string().describe("The basket id"),
  },
  async ({ basketId }) => {
    const basket = getBasket(basketId);
    if (!basket) throw new Error(`Basket "${basketId}" not found`);

    const raw = await positions(basket.walletName, { mode: "simple", chain: basket.chain }).catch(() => null);
    if (!raw) {
      return jsonResult({ totalUsd: 0, byToken: {}, currentWeights: {}, note: "Wallet unfunded or unreachable" });
    }

    const want = new Set(basket.tokens.map((t) => t.symbol.toUpperCase()));
    want.add(basket.quoteToken.toUpperCase());

    const byToken: Record<string, number> = {};
    let total = 0;
    const items: any[] = raw?.positions ?? raw?.data ?? [];
    for (const item of items) {
      const sym = (item.symbol ?? item.fungible?.symbol ?? "").toUpperCase();
      if (!want.has(sym)) continue;
      const value = Number(item.value_usd ?? item.value ?? item.usd_value ?? 0);
      if (!Number.isFinite(value) || value <= 0) continue;
      byToken[sym] = (byToken[sym] ?? 0) + value;
      total += value;
    }

    const weights: Record<string, number> = {};
    for (const [sym, usd] of Object.entries(byToken)) weights[sym] = total > 0 ? usd / total : 0;

    return jsonResult({ totalUsd: Math.round(total * 100) / 100, byToken, currentWeights: weights });
  },
);

export const getTaScoresTool = tool(
  "get_ta_scores",
  "Compute TA scores for every non-quote token in a basket. Returns RSI/MACD/EMA/volatility/volume sub-scores (0-100 each), composite scores, and the TA-suggested weights blended with the user's initial bias.",
  {
    basketId: z.string().describe("The basket id"),
  },
  async ({ basketId }) => {
    const basket = getBasket(basketId);
    if (!basket) throw new Error(`Basket "${basketId}" not found`);

    const nonQuote = basket.tokens.filter(
      (t) => t.symbol.toUpperCase() !== basket.quoteToken.toUpperCase(),
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

export const getHistoryTool = tool(
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

export const getLastRebalanceTool = tool(
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
