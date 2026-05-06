/**
 * Cron scheduler — calls rebalance() for every enabled basket on the configured
 * schedule (default: top of each hour).
 *
 * Failures of one basket do not block the others; everything gets a try/catch
 * with stderr logging.
 */

import cron from "node-cron";
import { config } from "./config.ts";
import { getBasket, listBaskets } from "./core/db.ts";
import { isAgentEnabled, runHourlyTick } from "./agent/index.ts";

export function startCron() {
  if (!cron.validate(config.rebalanceCron)) {
    throw new Error(`Invalid REBALANCE_CRON expression: ${config.rebalanceCron}`);
  }

  const task = cron.schedule(config.rebalanceCron, async () => {
    const baskets = listBaskets().filter((b) => b.enabled);
    if (baskets.length === 0) return;
    process.stdout.write(
      `[cron] tick — ${baskets.length} basket(s) ${isAgentEnabled() ? "(agent on)" : "(deterministic)"}\n`
    );

    for (const basket of baskets) {
      // Re-check between iterations — a long-running tick on basket A could
      // span a deletion of basket B by the user. Skip cleanly if so.
      if (!getBasket(basket.id)) {
        process.stdout.write(`[cron] ${basket.name} → deleted before tick, skipping\n`);
        continue;
      }
      try {
        const result = await runHourlyTick(basket);
        const verdict = result.guardOutcome.allow
          ? `${result.swaps.length} swap(s)`
          : `denied: ${result.guardOutcome.reason}`;
        process.stdout.write(`[cron] ${basket.name} → ${verdict}\n`);
        if (result.reasoning) {
          process.stdout.write(`[cron] ${basket.name} reasoning: ${result.reasoning}\n`);
        }
      } catch (e: any) {
        process.stderr.write(`[cron] ${basket.name} failed: ${e.message}\n`);
      }
    }
  });

  task.start();

  return {
    stop() {
      task.stop();
    },
  };
}
