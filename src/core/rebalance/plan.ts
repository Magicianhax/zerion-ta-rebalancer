/**
 * Pure logic for converting a portfolio + target weights into an ordered list
 * of swap steps. No I/O, no side effects — easy to unit-test.
 *
 * Strategy: every swap routes through the basket's quote token (USDC).
 *   1. Sells fire first — they generate the quote token used by the buys.
 *   2. Buys are capped at available USDC (current + planned sells, with a
 *      slippage haircut). Without this cap, a basket holding tiny USDC could
 *      schedule a buy that the router will reject for insufficient quote.
 *   3. Dust trades (<$1 USD) are dropped to avoid pointless gas burn.
 */

import type { Basket, SwapPlan } from "../../types.ts";

export interface PortfolioSnapshot {
  totalUsd: number;
  /** symbol → USD value held */
  byToken: Record<string, number>;
}

const DUST_THRESHOLD_USD = 1;

/**
 * Slippage + fee buffer applied to projected USDC from sells when funding
 * buys. Sells settle through the same router as buys, so 0.5% slack covers
 * routing fees and avoids buys failing right at the margin.
 */
const SELL_PROCEEDS_HAIRCUT = 0.995;

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

  // 1. Sells first — capture how much USDC they'll generate.
  let sellsUsd = 0;
  for (const d of deltas.filter((d) => d.deltaUsd < -DUST_THRESHOLD_USD)) {
    const amount = Math.abs(d.deltaUsd);
    plan.push({
      fromToken: d.symbol,
      toToken: quote,
      amountFrom: amount,
      estimatedUsd: amount,
    });
    sellsUsd += amount;
  }

  // 2. Buys — capped at available USDC. We start from the basket's actual
  // USDC holding plus the haircut-adjusted sell proceeds.
  let availableUsdc = (snapshot.byToken[quote] ?? 0) + sellsUsd * SELL_PROCEEDS_HAIRCUT;

  // Pro-rata scale-down if total wanted buys exceed available USDC. This
  // keeps the basket's relative direction correct rather than buying the
  // first token greedily and starving the rest.
  const buys = deltas.filter((d) => d.deltaUsd > DUST_THRESHOLD_USD);
  const wantedBuysUsd = buys.reduce((s, d) => s + d.deltaUsd, 0);
  const scale = wantedBuysUsd > 0 && availableUsdc < wantedBuysUsd
    ? availableUsdc / wantedBuysUsd
    : 1;

  for (const d of buys) {
    const sized = d.deltaUsd * scale;
    if (sized < DUST_THRESHOLD_USD) continue;
    if (sized > availableUsdc + 0.01) continue; // ran out — skip remaining buys
    plan.push({
      fromToken: quote,
      toToken: d.symbol,
      amountFrom: sized,
      estimatedUsd: sized,
    });
    availableUsdc -= sized;
  }

  return plan;
}
