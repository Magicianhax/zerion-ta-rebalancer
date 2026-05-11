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
import {
  createBasket as dbCreateBasket,
  getBasket,
  setBasketEnabled,
} from "../../core/db.ts";
import { rebalance } from "../../core/rebalancer.ts";
import { listTokens } from "../../core/token-registry.ts";
import { invalidateMetaCache, listAgentTokens, listPolicies, walletList } from "../../core/zerion.ts";
import type { Basket, BasketToken, Chain } from "../../types.ts";
import { jsonResult, summariseBasket, summariseRebalance } from "./helpers.ts";

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

export const createBasketTool = tool(
  "create_basket",
  "Create a new basket with the given tokens at EQUAL initial weights. Wallet, policy, and agent token are auto-picked from the user's setup. The first allocation fires immediately. ALWAYS read back name, chain, tokens, and budget to the user and ask 'should I create this?' before calling. For finer control (custom weights, paste-by-contract-address), tell the user to use the web dashboard instead.",
  {
    name: z.string().min(1).describe("Display name for the basket, e.g. 'Majors' or 'AI Plays'"),
    chain: z.enum(["solana", "base"]),
    tokens: z
      .array(z.string().min(1))
      .min(2)
      .describe("Token symbols, uppercase. Must include at least one and at most one quote token (USDC). 2-8 entries typical."),
    budgetUsd: z.number().positive().describe("USDC amount to deploy on the first allocation"),
    taBias: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("0..1 slider: how much to follow TA vs initial weights. Default 0.5 (balanced)."),
  },
  async ({ name, chain, tokens, budgetUsd, taBias }) => {
    const upperTokens = tokens.map((t) => t.toUpperCase());
    const seen = new Set<string>();
    for (const t of upperTokens) {
      if (seen.has(t)) {
        return jsonResult({ ok: false, error: "duplicate_token", message: `'${t}' appears twice` });
      }
      seen.add(t);
    }

    // Validate tokens against the chain registry (custom tokens previously
    // resolved via /tokens/resolve are merged in by listTokens).
    const registry = listTokens(chain as Chain);
    const known = new Map(registry.map((r) => [r.symbol.toUpperCase(), r]));
    const unknown = upperTokens.filter((t) => !known.has(t));
    if (unknown.length > 0) {
      return jsonResult({
        ok: false,
        error: "unknown_tokens",
        message:
          `These tokens aren't in the ${chain} registry: ${unknown.join(", ")}. ` +
          `The user can add custom tokens by pasting a contract address in the web dashboard.`,
      });
    }

    // Auto-pick wallet / policy / agent token. Same defaults as the dashboard.
    let wallets: any[] = [];
    let policies: any[] = [];
    let agentTokens: any[] = [];
    try {
      [wallets, policies, agentTokens] = await Promise.all([
        walletList(),
        listPolicies(),
        listAgentTokens(),
      ]);
    } catch (e: any) {
      return jsonResult({
        ok: false,
        error: "setup_query_failed",
        message: `Couldn't read wallet/policy/agent token: ${e.message}`,
      });
    }
    if (wallets.length === 0 || policies.length === 0 || agentTokens.length === 0) {
      return jsonResult({
        ok: false,
        error: "setup_incomplete",
        message:
          "Wallet, policy, or agent token is missing. Run `npm run setup` once to create them.",
      });
    }
    const wallet = wallets[0];
    const policy = policies[0];
    const active = agentTokens.find((t: any) => t.active) ?? agentTokens[0];

    // Equal weights normalised to 1.0 across all selected tokens.
    const equal = 1 / upperTokens.length;
    const basketTokens: BasketToken[] = upperTokens.map((symbol) => ({
      symbol,
      initialWeight: equal,
    }));

    const basket: Basket = {
      id: `basket-${Date.now()}`,
      name,
      chain: chain as Chain,
      walletName: wallet.name,
      agentTokenName: active.name,
      policyId: policy.id,
      budgetUsd,
      quoteToken: "USDC",
      taBias: taBias ?? 0.5,
      enabled: true,
      createdAt: new Date().toISOString(),
      tokens: basketTokens,
    };

    try {
      dbCreateBasket(basket);
      invalidateMetaCache();
    } catch (e: any) {
      return jsonResult({
        ok: false,
        error: "db_insert_failed",
        message: e.message ?? String(e),
      });
    }

    // Kick off the first allocation in the background. Same fire-and-forget
    // pattern the dashboard's create endpoint uses — the user gets visible
    // progress via SSE rebalance:start/done events while the swaps execute.
    rebalance(basket.id).catch((err: any) => {
      process.stderr.write(
        `[agent.create_basket] first allocation failed for "${basket.id}": ${err.message}\n`,
      );
    });

    return jsonResult({
      ok: true,
      basket: summariseBasket(basket),
      equalWeightPct: Math.round(equal * 1000) / 10,
      note: "First allocation is firing now. Status visible in the dashboard.",
    });
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
