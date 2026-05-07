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
import { getBasket, lastRebalanceFor, recordRebalance } from "./db.ts";
import {
  invalidatePositionsCache,
  positions,
  swap,
  swapSolana,
  type SwapArgs,
} from "./zerion.ts";
import { summarizePositions as summarizePositionsCore } from "./positions-parser.ts";
import {
  buildSwapPlan,
  computeCurrentWeights,
  type PortfolioSnapshot,
} from "./rebalance/plan.ts";
import { config } from "../config.ts";
import type {
  Basket,
  RebalanceResult,
  SwapPlan,
  TokenScore,
  WeightProposal,
} from "../types.ts";

/** Shared event bus — SSE and Telegram bot both subscribe to rebalance lifecycle. */
export const events = new EventEmitter();

/**
 * Adapt the tolerant positions parser to the rebalancer's snapshot shape and
 * surface a debug line when Zerion returned positions but none matched the
 * basket's token set (usually means a token symbol mismatch in the registry).
 */
function summarizePositions(raw: unknown, basket: Basket): PortfolioSnapshot {
  const result = summarizePositionsCore(raw, basket);
  if (result.rawSymbols.length > 0 && Object.keys(result.byToken).length === 0) {
    const wanted = [
      ...basket.tokens.map((t) => t.symbol.toUpperCase()),
      basket.quoteToken.toUpperCase(),
    ];
    process.stderr.write(
      `[rebalancer] positions returned ${result.rawSymbols.length} item(s) but none matched basket "${basket.name}".\n` +
      `  Wanted: ${[...new Set(wanted)].sort().join(", ")}\n` +
      `  Got:    ${[...new Set(result.rawSymbols)].sort().slice(0, 15).join(", ")}\n`,
    );
  }
  return { totalUsd: result.totalUsd, byToken: result.byToken };
}

export async function rebalance(basketId: string): Promise<RebalanceResult> {
  const basket = getBasket(basketId);
  if (!basket) throw new Error(`Basket "${basketId}" not found`);

  const startedAt = new Date().toISOString();
  events.emit("rebalance:start", { basketId, startedAt });

  /** Bail if the basket was deleted between checks (race during long ticks). */
  function bailIfDeleted(): boolean {
    if (!getBasket(basketId)) {
      process.stderr.write(
        `[rebalancer] basket "${basketId}" was deleted mid-tick — aborting cleanly.\n`,
      );
      return true;
    }
    return false;
  }

  // 1. Current portfolio — pass basket.chain so the CLI queries the right
  //    address (EVM by default; Solana wallets need --chain solana)
  const positionsRaw = await positions(basket.walletName, {
    mode: "simple",
    chain: basket.chain,
  }).catch((e) => {
    process.stderr.write(`positions() failed: ${e.message}\n`);
    return null;
  });
  const snapshot: PortfolioSnapshot = positionsRaw
    ? summarizePositions(positionsRaw, basket)
    : { totalUsd: 0, byToken: {} };
  const currentWeights = computeCurrentWeights(snapshot);

  // 2. Decide allocation mode
  // First allocation = the basket has never had a successful, non-empty
  // rebalance. In that case we honor the user's initial weights exactly,
  // skipping TA entirely. TA only kicks in once the basket is established
  // and the user has signaled (by funding + first allocation) that they
  // want the algorithm to start adjusting.
  const lastReal = lastRebalanceFor(basketId);
  const isFirstAllocation =
    !lastReal || !lastReal.guardOutcome.allow || lastReal.swaps.length === 0;

  const nonQuoteTokens = basket.tokens.filter(
    (t) => t.symbol.toUpperCase() !== basket.quoteToken.toUpperCase()
  );
  const initial: Record<string, number> = {};
  for (const t of nonQuoteTokens) initial[t.symbol.toUpperCase()] = t.initialWeight;

  let scores: TokenScore[] = [];
  let targetWeights: Record<string, number>;

  if (isFirstAllocation) {
    targetWeights = initial;
    process.stdout.write(
      `[rebalancer] ${basket.name}: first allocation — buying user's initial weights, skipping TA.\n`,
    );
  } else {
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
    const taWeights = scoresToWeights(scores);
    targetWeights = blendWeights(initial, taWeights, basket.taBias);
  }

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
        // Continue to the next step rather than aborting the whole tick.
        // Each swap is independent; a single failure (slippage, RPC blip,
        // funding edge case) shouldn't strand the rest of the rebalance.
        // Plan ordering guarantees sells run before buys, so sells that
        // succeeded already have funded the wallet for retried buys.
        continue;
      }
    }
    // Drop cached positions for this wallet so post-trade balances refresh
    // on the next dashboard fetch instead of returning a stale 10s view.
    if (swaps.some((s) => s.txHash)) invalidatePositionsCache(basket.walletName);
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

  // Persistence is best-effort: if the basket was deleted mid-tick, the
  // foreign-key insert fails. We log and return the in-memory result so
  // the caller (cron / agent) can finish gracefully without crashing.
  if (!bailIfDeleted()) {
    try {
      recordRebalance(result);
    } catch (e: any) {
      process.stderr.write(
        `[rebalancer] recordRebalance failed for "${basketId}": ${e.message}\n`,
      );
    }
  }
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
  // Zerion CLI swap response shape: { swap: {...}, tx: { hash, status, ... }, executed: true }
  // Verified by reading cli/commands/trading/swap.js — tx hash lives at result.tx.hash.
  // Other keys kept as fallbacks for bridge/send commands which may differ.
  return (
    result?.tx?.hash ??
    result?.transaction?.hash ??
    result?.tx_hash ??
    result?.hash ??
    undefined
  );
}
