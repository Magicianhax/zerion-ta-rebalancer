/**
 * Pure logic for converting a portfolio + target weights into an ordered list
 * of swap steps. No I/O, no side effects — easy to unit-test.
 *
 * Strategy: every swap routes through the basket's quote token (USDC). Sells
 * fire first to free up quote, then buys spend it. Skips dust (<$1 USD) to
 * avoid pointless gas burn on rebalances that produce trivial deltas.
 */

import type { Basket, SwapPlan } from "../../types.ts";

export interface PortfolioSnapshot {
  totalUsd: number;
  /** symbol → USD value held */
  byToken: Record<string, number>;
}

const DUST_THRESHOLD_USD = 1;

export function computeCurrentWeights(snapshot: PortfolioSnapshot): Record<string, number> {
  if (snapshot.totalUsd === 0) return {};
  const out: Record<string, number> = {};
  for (const [sym, usd] of Object.entries(snapshot.byToken)) {
    out[sym] = usd / snapshot.totalUsd;
  }
  return out;
}

export function buildSwapPlan(
  basket: Basket,
  snapshot: PortfolioSnapshot,
  targetWeights: Record<string, number>,
): SwapPlan[] {
  const plan: SwapPlan[] = [];
  const total = snapshot.totalUsd;
  const quote = basket.quoteToken.toUpperCase();

  const deltas: Array<{ symbol: string; deltaUsd: number }> = [];
  for (const tok of basket.tokens) {
    const sym = tok.symbol.toUpperCase();
    if (sym === quote) continue;
    const target = (targetWeights[sym] ?? 0) * total;
    const current = snapshot.byToken[sym] ?? 0;
    deltas.push({ symbol: sym, deltaUsd: target - current });
  }

  // Sells first — they generate the quote token used by the buys.
  for (const d of deltas.filter((d) => d.deltaUsd < -DUST_THRESHOLD_USD)) {
    plan.push({
      fromToken: d.symbol,
      toToken: quote,
      amountFrom: Math.abs(d.deltaUsd),
      estimatedUsd: Math.abs(d.deltaUsd),
    });
  }

  for (const d of deltas.filter((d) => d.deltaUsd > DUST_THRESHOLD_USD)) {
    plan.push({
      fromToken: quote,
      toToken: d.symbol,
      amountFrom: d.deltaUsd,
      estimatedUsd: d.deltaUsd,
    });
  }

  return plan;
}
