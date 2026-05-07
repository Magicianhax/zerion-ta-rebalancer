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
  "Pause or resume a basket. Reserved for systemic failures only — repeated rebalance errors across consecutive ticks, misconfigured chain, OWS signing returning unusable results. DO NOT pause for portfolio composition changes (USDC inflows, token balances dropping, total value moving). Those are user actions or normal market behavior, not faults. Default to NOT calling this tool.",
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
