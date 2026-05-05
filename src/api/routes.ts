/**
 * REST + SSE routes. Mounted under /api in server.ts.
 */

import { Hono } from "hono";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { isAuthenticated, requireAuth } from "./auth.ts";
import {
  createBasket as dbCreateBasket,
  createPairing,
  deleteBasket,
  getBasket,
  listBaskets,
  listRebalances,
  setBasketEnabled,
} from "../core/db.ts";
import { events, rebalance } from "../core/rebalancer.ts";
import { listTokens } from "../core/token-registry.ts";
import { listAgentTokens, listPolicies, positions, walletList } from "../core/zerion.ts";
import { summarizePositions } from "../core/positions-parser.ts";
import type { Basket, Chain } from "../types.ts";
import { config } from "../config.ts";

const api = new Hono();

// ── Public ───────────────────────────────────────────────────────────

api.get("/health", (c) => c.json({ ok: true, version: "0.1.0" }));

api.post("/auth/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const password = body?.password;
  if (typeof password !== "string" || password !== config.adminPassword) {
    return c.json({ error: { code: "invalid_credentials", message: "Wrong password" } }, 401);
  }
  return c.json({ token: config.adminPassword });
});

// ── Authenticated ────────────────────────────────────────────────────

api.use("*", async (c, next) => {
  // Skip auth for public routes already handled above
  if (c.req.path === "/api/health" || c.req.path === "/api/auth/login") {
    await next();
    return;
  }
  return requireAuth(c, next);
});

api.get("/baskets", (c) => c.json({ baskets: listBaskets() }));

api.get("/baskets/:id", (c) => {
  const basket = getBasket(c.req.param("id"));
  if (!basket) return c.json({ error: { code: "not_found" } }, 404);
  return c.json({ basket });
});

const CreateBasketSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  chain: z.enum(["base", "solana"]),
  walletName: z.string().min(1),
  agentTokenName: z.string().min(1),
  policyId: z.string().min(1),
  budgetUsd: z.number().positive(),
  quoteToken: z.string().default("USDC"),
  taBias: z.number().min(0).max(1).default(0.5),
  tokens: z
    .array(
      z.object({
        symbol: z.string().min(1),
        initialWeight: z.number().min(0).max(1),
        minWeight: z.number().min(0).max(1).optional(),
        maxWeight: z.number().min(0).max(1).optional(),
      }),
    )
    .min(2),
});

api.post("/baskets", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CreateBasketSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "invalid_payload", issues: parsed.error.issues } }, 400);
  }
  const basket: Basket = {
    ...parsed.data,
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  dbCreateBasket(basket);
  return c.json({ basket }, 201);
});

api.post("/baskets/:id/pause", (c) => {
  const id = c.req.param("id");
  if (!getBasket(id)) return c.json({ error: { code: "not_found" } }, 404);
  setBasketEnabled(id, false);
  return c.json({ ok: true });
});

api.post("/baskets/:id/resume", (c) => {
  const id = c.req.param("id");
  if (!getBasket(id)) return c.json({ error: { code: "not_found" } }, 404);
  setBasketEnabled(id, true);
  return c.json({ ok: true });
});

api.delete("/baskets/:id", (c) => {
  const id = c.req.param("id");
  if (!getBasket(id)) return c.json({ error: { code: "not_found" } }, 404);
  deleteBasket(id);
  return c.json({ ok: true });
});

api.post("/baskets/:id/rebalance", async (c) => {
  const id = c.req.param("id");
  if (!getBasket(id)) return c.json({ error: { code: "not_found" } }, 404);
  try {
    const result = await rebalance(id);
    return c.json({ result });
  } catch (e: any) {
    return c.json({ error: { code: "rebalance_failed", message: e.message } }, 500);
  }
});

api.get("/baskets/:id/rebalances", (c) => {
  const id = c.req.param("id");
  const limit = Number(c.req.query("limit") ?? 50);
  return c.json({ rebalances: listRebalances(id, limit) });
});

api.get("/tokens", (c) => {
  const chain = (c.req.query("chain") ?? "base") as Chain;
  if (chain !== "base" && chain !== "solana") {
    return c.json({ error: { code: "invalid_chain" } }, 400);
  }
  return c.json({ tokens: listTokens(chain) });
});

api.get("/baskets/:id/portfolio", async (c) => {
  const id = c.req.param("id");
  const basket = getBasket(id);
  if (!basket) return c.json({ error: { code: "not_found" } }, 404);
  try {
    const raw = await positions(basket.walletName, "simple");
    const summary = summarizePositions(raw, basket);
    const weights: Record<string, number> = {};
    for (const [sym, usd] of Object.entries(summary.byToken)) {
      weights[sym] = summary.totalUsd > 0 ? usd / summary.totalUsd : 0;
    }
    return c.json({
      portfolio: {
        totalUsd: Math.round(summary.totalUsd * 100) / 100,
        byToken: summary.byToken,
        currentWeights: weights,
        rawSymbolsSeen: summary.rawSymbols.slice(0, 20),
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (e: any) {
    return c.json({ error: { code: "zerion_error", message: e.message } }, 500);
  }
});

api.get("/wallets", async (c) => {
  try {
    const wallets = await walletList();
    return c.json({ wallets });
  } catch (e: any) {
    return c.json({ error: { code: "zerion_error", message: e.message } }, 500);
  }
});

api.get("/agent/policies", async (c) => {
  try {
    return c.json({ policies: await listPolicies() });
  } catch (e: any) {
    return c.json({ error: { code: "zerion_error", message: e.message } }, 500);
  }
});

api.get("/agent/tokens", async (c) => {
  try {
    return c.json({ tokens: await listAgentTokens() });
  } catch (e: any) {
    return c.json({ error: { code: "zerion_error", message: e.message } }, 500);
  }
});

api.post("/telegram/pair", (c) => {
  const code = randomBytes(4).toString("hex");
  createPairing(code, 30);
  return c.json({ pairingCode: code, expiresIn: "30m" });
});

// ── SSE stream ───────────────────────────────────────────────────────
//
// EventSource can't set Authorization headers, so we accept ?token= in the URL.
// The wildcard middleware above already handled auth.

api.get("/events/stream", (c) => {
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      send("hello", { ok: true });

      const onStart = (payload: unknown) => send("rebalance:start", payload);
      const onDone = (payload: unknown) => send("rebalance:done", payload);
      events.on("rebalance:start", onStart);
      events.on("rebalance:done", onDone);

      const heartbeat = setInterval(() => send("ping", { t: Date.now() }), 30_000);

      const abort = c.req.raw.signal;
      abort.addEventListener("abort", () => {
        clearInterval(heartbeat);
        events.off("rebalance:start", onStart);
        events.off("rebalance:done", onDone);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
});

export { api };
export { isAuthenticated };
