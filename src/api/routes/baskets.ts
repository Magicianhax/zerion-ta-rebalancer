/**
 * Basket CRUD + per-basket actions: rebalance, pause/resume, history, portfolio.
 */

import { Hono } from "hono";
import { z } from "zod";
import {
  createBasket as dbCreateBasket,
  deleteBasket,
  getBasket,
  listBaskets,
  listRebalances,
  setBasketEnabled,
} from "../../core/db.ts";
import { rebalance } from "../../core/rebalancer.ts";
import { positions, invalidateMetaCache } from "../../core/zerion.ts";
import { summarizePositions } from "../../core/positions-parser.ts";
import type { Basket } from "../../types.ts";

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

export const basketsRouter = new Hono();

basketsRouter.get("/", (c) => c.json({ baskets: listBaskets() }));

basketsRouter.get("/:id", (c) => {
  const basket = getBasket(c.req.param("id"));
  if (!basket) return c.json({ error: { code: "not_found" } }, 404);
  return c.json({ basket });
});

basketsRouter.post("/", async (c) => {
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
  invalidateMetaCache();
  return c.json({ basket }, 201);
});

basketsRouter.post("/:id/pause", (c) => {
  const id = c.req.param("id");
  if (!getBasket(id)) return c.json({ error: { code: "not_found" } }, 404);
  setBasketEnabled(id, false);
  return c.json({ ok: true });
});

basketsRouter.post("/:id/resume", (c) => {
  const id = c.req.param("id");
  if (!getBasket(id)) return c.json({ error: { code: "not_found" } }, 404);
  setBasketEnabled(id, true);
  return c.json({ ok: true });
});

basketsRouter.delete("/:id", (c) => {
  const id = c.req.param("id");
  if (!getBasket(id)) return c.json({ error: { code: "not_found" } }, 404);
  deleteBasket(id);
  return c.json({ ok: true });
});

basketsRouter.post("/:id/rebalance", async (c) => {
  const id = c.req.param("id");
  if (!getBasket(id)) return c.json({ error: { code: "not_found" } }, 404);
  try {
    const result = await rebalance(id);
    return c.json({ result });
  } catch (e: any) {
    return c.json({ error: { code: "rebalance_failed", message: e.message } }, 500);
  }
});

basketsRouter.get("/:id/rebalances", (c) => {
  const id = c.req.param("id");
  const limit = Number(c.req.query("limit") ?? 50);
  return c.json({ rebalances: listRebalances(id, limit) });
});

basketsRouter.get("/:id/portfolio", async (c) => {
  const id = c.req.param("id");
  const basket = getBasket(id);
  if (!basket) return c.json({ error: { code: "not_found" } }, 404);
  try {
    const raw = await positions(basket.walletName, { mode: "simple", chain: basket.chain });
    const summary = summarizePositions(raw, basket);
    return c.json({
      portfolio: {
        totalUsd: Math.round(summary.totalUsd * 100) / 100,
        byToken: summary.byToken,
        currentWeights: computeWeights(summary.byToken, summary.totalUsd),
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (e: any) {
    return c.json({ error: { code: "zerion_error", message: e.message } }, 500);
  }
});

function computeWeights(byToken: Record<string, number>, total: number): Record<string, number> {
  if (total === 0) return {};
  const out: Record<string, number> = {};
  for (const [sym, usd] of Object.entries(byToken)) out[sym] = usd / total;
  return out;
}
