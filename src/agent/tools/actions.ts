/**
 * State-changing tools. Restricted to the cron-tick surface only — the chat
 * surface gets read-only access to prevent the agent from acting on a user's
 * casual question.
 *
 * Every action still routes through the same guard rails + OWS policy as a
 * manual rebalance. The agent cannot bypass any safety layer; structured
 * errors flow back as tool results instead of throws so the agent narrates
 * failures honestly without inventing details.
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { getBasket, setBasketEnabled } from "../../core/db.ts";
import { rebalance } from "../../core/rebalancer.ts";
import { jsonResult, summariseRebalance } from "./helpers.ts";

export const executeRebalanceTool = tool(
  "execute_rebalance",
  "Execute a rebalance for the basket. The TA pipeline computes target weights, app-layer guards apply (cooldown, max-drift, slippage), and approved swaps route through Zerion CLI — which OWS still enforces against the wallet's policy. Use this only when you've decided action is appropriate.",
  {
    basketId: z.string().describe("The basket id"),
  },
  async ({ basketId }) => {
    if (!getBasket(basketId)) {
      return jsonResult({
        ok: false,
        error: "basket_not_found",
        message: `Basket "${basketId}" no longer exists. The user may have deleted it.`,
      });
    }
    try {
      const result = await rebalance(basketId);
      return jsonResult({ ok: true, ...summariseRebalance(result) });
    } catch (e: any) {
      return jsonResult({
        ok: false,
        error: "rebalance_failed",
        message: e.message ?? String(e),
      });
    }
  },
);

export const setBasketEnabledTool = tool(
  "set_basket_enabled",
  "Pause or resume a basket. Paused baskets are skipped by the cron and rejected by the guard layer. Use this if you detect something is wrong (price feed broken, unusual market) and want to stop trading until the user reviews.",
  {
    basketId: z.string().describe("The basket id"),
    enabled: z.boolean().describe("True to resume, false to pause"),
  },
  async ({ basketId, enabled }) => {
    if (!getBasket(basketId)) {
      return jsonResult({
        ok: false,
        error: "basket_not_found",
        message: `Basket "${basketId}" no longer exists.`,
      });
    }
    setBasketEnabled(basketId, enabled);
    return jsonResult({ ok: true, basketId, enabled });
  },
);
