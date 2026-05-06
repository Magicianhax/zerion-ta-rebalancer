/**
 * Shared helpers for the agent's tool implementations.
 * Tools must return a CallToolResult — text content blocks, in our case JSON
 * stringified. Pulling this into one place keeps each tool definition focused
 * on its actual logic.
 */

import type { Basket, RebalanceResult } from "../../types.ts";

export function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

export function summariseBasket(b: Basket) {
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

export function summariseRebalance(r: RebalanceResult) {
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
