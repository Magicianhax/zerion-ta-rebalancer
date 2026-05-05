/**
 * Rebalancer orchestrator.
 *
 * One tick:
 *   1. Read basket + last rebalance
 *   2. Pull positions from Zerion (current weights)
 *   3. Score every non-quote token via TA
 *   4. Convert scores → target weights, blended with user's initial weights
 *   5. Build swap plan (delta vs current, all routed through quote token)
 *   6. Run app-layer guards
 *   7. If allowed, execute swaps sequentially via Zerion CLI
 *   8. Persist result and emit event
 */

import { EventEmitter } from "node:events";
import { findToken } from "./token-registry.ts";
import { blendWeights, scoresToWeights, scoreToken } from "./ta.ts";
import { evaluateGuards } from "./policy.ts";
import { lastRebalanceFor, recordRebalance, getBasket } from "./db.ts";
import { positions, swap, swapSolana, type SwapArgs } from "./zerion.ts";
import { summarizePositions as summarizePositionsCore } from "./positions-parser.ts";
import { config } from "../config.ts";
import type {
  Basket,
  RebalanceResult,
  SwapPlan,
  TokenScore,
  WeightProposal,
} from "../types.ts";

/** Single shared event bus — SSE and Telegram both subscribe. */
export const events = new EventEmitter();

interface PortfolioSnapshot {
  totalUsd: number;
  /** symbol → USD value held */
  byToken: Record<string, number>;
}

/**
 * Translate Zerion's positions response into a flat by-symbol USD map.
 * The CLI's positions output shape is documented but loose; we walk fungible
 * positions on the basket's chain only.
 */
function summarizePositions(raw: any, basket: Basket): PortfolioSnapshot {
  const result = summarizePositionsCore(raw, basket);
  if (result.rawSymbols.length > 0 && Object.keys(result.byToken).length === 0) {
    const wanted = basket.tokens.map((t) => t.symbol.toUpperCase());
    wanted.push(basket.quoteToken.toUpperCase());
    process.stderr.write(
      `[rebalancer] positions returned ${result.rawSymbols.length} item(s) but none matched basket "${basket.name}".\n` +
      `  Wanted:  ${[...new Set(wanted)].sort().join(", ")}\n` +
      `  Got:     ${[...new Set(result.rawSymbols)].sort().slice(0, 15).join(", ")}\n`,
    );
  }
  return { totalUsd: result.totalUsd, byToken: result.byToken };
}

function computeCurrentWeights(snapshot: PortfolioSnapshot): Record<string, number> {
  if (snapshot.totalUsd === 0) return {};
  const out: Record<string, number> = {};
  for (const [sym, usd] of Object.entries(snapshot.byToken)) {
    out[sym] = usd / snapshot.totalUsd;
  }
  return out;
}

function buildSwapPlan(
  basket: Basket,
  snapshot: PortfolioSnapshot,
  targetWeights: Record<string, number>,
): SwapPlan[] {
  const plan: SwapPlan[] = [];
  const total = snapshot.totalUsd;
  const quote = basket.quoteToken.toUpperCase();

  // Compute USD delta per token
  const deltas: Array<{ symbol: string; deltaUsd: number }> = [];
  for (const tok of basket.tokens) {
    const sym = tok.symbol.toUpperCase();
    if (sym === quote) continue;
    const target = (targetWeights[sym] ?? 0) * total;
    const current = snapshot.byToken[sym] ?? 0;
    deltas.push({ symbol: sym, deltaUsd: target - current });
  }

  // Skip dust — < $1 swaps not worth the gas
  const dustThreshold = 1;

  // Sells first → frees up quote token
  for (const d of deltas.filter((d) => d.deltaUsd < -dustThreshold)) {
    plan.push({
      fromToken: d.symbol,
      toToken: quote,
      amountFrom: Math.abs(d.deltaUsd), // approximate — Zerion routes by USD value
      estimatedUsd: Math.abs(d.deltaUsd),
    });
  }

  // Then buys
  for (const d of deltas.filter((d) => d.deltaUsd > dustThreshold)) {
    plan.push({
      fromToken: quote,
      toToken: d.symbol,
      amountFrom: d.deltaUsd,
      estimatedUsd: d.deltaUsd,
    });
  }

  return plan;
}

export async function rebalance(basketId: string): Promise<RebalanceResult> {
  const basket = getBasket(basketId);
  if (!basket) throw new Error(`Basket "${basketId}" not found`);

  const startedAt = new Date().toISOString();
  events.emit("rebalance:start", { basketId, startedAt });

  // 1. Current portfolio
  const positionsRaw = await positions(basket.walletName, "simple").catch((e) => {
    process.stderr.write(`positions() failed: ${e.message}\n`);
    return null;
  });
  const snapshot: PortfolioSnapshot = positionsRaw
    ? summarizePositions(positionsRaw, basket)
    : { totalUsd: 0, byToken: {} };
  const currentWeights = computeCurrentWeights(snapshot);

  // 2. Score tokens
  const nonQuoteTokens = basket.tokens.filter(
    (t) => t.symbol.toUpperCase() !== basket.quoteToken.toUpperCase()
  );
  const scores: TokenScore[] = [];
  for (const t of nonQuoteTokens) {
    try {
      scores.push(await scoreToken(basket.chain, t.symbol));
    } catch (e: any) {
      process.stderr.write(`scoreToken(${t.symbol}) failed: ${e.message}\n`);
      scores.push({
        symbol: t.symbol,
        score: 50,
        breakdown: { rsi: 50, macd: 50, ema: 50, volatility: 50, volume: 50 },
      });
    }
  }

  // 3. Target weights
  const initial: Record<string, number> = {};
  for (const t of nonQuoteTokens) initial[t.symbol.toUpperCase()] = t.initialWeight;
  const taWeights = scoresToWeights(scores);
  const targetWeights = blendWeights(initial, taWeights, basket.taBias);

  const proposal: WeightProposal = {
    basketId,
    currentWeights,
    targetWeights,
    scores,
    computedAt: new Date().toISOString(),
  };

  // 4. Swap plan
  const plan = buildSwapPlan(basket, snapshot, targetWeights);

  // 5. Guards
  const guardOutcome = evaluateGuards({
    basket,
    currentWeights,
    targetWeights,
    swapPlan: plan,
    lastRebalance: lastRebalanceFor(basketId),
  });

  // 6. Execute (only if allowed)
  const swaps: RebalanceResult["swaps"] = [];
  if (guardOutcome.allow && plan.length > 0) {
    for (const step of plan) {
      try {
        const result = await executeSwap(basket, step);
        swaps.push({ plan: step, txHash: extractTxHash(result) });
      } catch (e: any) {
        swaps.push({ plan: step, error: e.message });
        process.stderr.write(`swap ${step.fromToken}→${step.toToken} failed: ${e.message}\n`);
        break;
      }
    }
  }

  const result: RebalanceResult = {
    basketId,
    proposal,
    plan,
    guardOutcome,
    swaps,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  recordRebalance(result);
  events.emit("rebalance:done", result);
  return result;
}

async function executeSwap(basket: Basket, step: SwapPlan): Promise<any> {
  const fromToken = findToken(basket.chain, step.fromToken);
  if (!fromToken) throw new Error(`Unknown token ${step.fromToken} on ${basket.chain}`);

  const args = {
    walletName: basket.walletName,
    amount: step.amountFrom,
    fromToken: step.fromToken,
    toToken: step.toToken,
    slippage: config.defaultSlippage,
  };

  if (basket.chain === "solana") {
    return swapSolana(args);
  }
  return swap({ ...args, chain: "base" } as SwapArgs);
}

function extractTxHash(result: any): string | undefined {
  // Zerion CLI swap response shape varies — try common keys
  return result?.transaction?.hash ?? result?.tx_hash ?? result?.hash ?? undefined;
}
