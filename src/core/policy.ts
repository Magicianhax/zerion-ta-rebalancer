/**
 * Application-layer guard rails. These run BEFORE the Zerion CLI is invoked.
 *
 * The OWS policy (chain-lock, allowlist, spend-cap) runs again at the signing
 * layer — even if the guards here are bypassed, OWS still enforces.
 *
 * Pure functions, easy to unit-test.
 */

import type { Basket, GuardOutcome, RebalanceResult, SwapPlan } from "../types.ts";
import { config } from "../config.ts";

export interface GuardInputs {
  basket: Basket;
  currentWeights: Record<string, number>;
  targetWeights: Record<string, number>;
  swapPlan: SwapPlan[];
  lastRebalance: RebalanceResult | null;
  now?: Date;
}

export function evaluateGuards(input: GuardInputs): GuardOutcome {
  const now = input.now ?? new Date();

  if (!input.basket.enabled) {
    return { allow: false, reason: "Basket is paused — toggle it in the dashboard to resume." };
  }

  const isFirstRebalance =
    input.lastRebalance == null ||
    !input.lastRebalance.guardOutcome.allow ||
    input.lastRebalance.swaps.length === 0;

  // 1. Cooldown — only meaningful once we have an allowed prior rebalance
  if (input.lastRebalance && input.lastRebalance.guardOutcome.allow) {
    const last = new Date(input.lastRebalance.startedAt).getTime();
    const minutesSince = (now.getTime() - last) / 60_000;
    if (minutesSince < config.cooldownMinutes) {
      return {
        allow: false,
        reason: `Cooldown — last rebalance was ${minutesSince.toFixed(1)} min ago, must wait ${config.cooldownMinutes}.`,
      };
    }
  }

  // 2. Max drift per rebalance — skipped on the first allocation since going
  //    from all-quote to target weights necessarily moves each token by more
  //    than the per-tick drift cap. The cap is meant to prevent churn on
  //    later rebalances, not block initial allocation.
  if (!isFirstRebalance) {
    const driftLimit = config.maxDriftPercent / 100;
    for (const [sym, target] of Object.entries(input.targetWeights)) {
      const current = input.currentWeights[sym] ?? 0;
      const drift = Math.abs(target - current);
      if (drift > driftLimit) {
        return {
          allow: false,
          reason: `Drift guard — ${sym} would shift ${(drift * 100).toFixed(1)}% (limit ${config.maxDriftPercent}%).`,
        };
      }
    }
  }

  // 3. Per-token min/max %
  for (const tok of input.basket.tokens) {
    const target = input.targetWeights[tok.symbol] ?? 0;
    if (tok.minWeight != null && target < tok.minWeight) {
      return {
        allow: false,
        reason: `${tok.symbol} target ${(target * 100).toFixed(1)}% below configured min ${(tok.minWeight * 100).toFixed(1)}%.`,
      };
    }
    if (tok.maxWeight != null && target > tok.maxWeight) {
      return {
        allow: false,
        reason: `${tok.symbol} target ${(target * 100).toFixed(1)}% above configured max ${(tok.maxWeight * 100).toFixed(1)}%.`,
      };
    }
  }

  // 4. Empty plan — nothing to do is allowed (no-op rebalance)
  if (input.swapPlan.length === 0) {
    return { allow: true };
  }

  return { allow: true };
}
