/**
 * System-level routes that don't belong to a domain resource.
 *   - /health   liveness check, no auth required
 *   - /tokens   the static chain → tokens registry (used by the basket UI)
 *   - /events/stream  SSE for live rebalance updates
 *   - /auth/login     bearer-token login
 */

import { Hono } from "hono";
import { config } from "../../config.ts";
import { listTokens } from "../../core/token-registry.ts";
import { events } from "../../core/rebalancer.ts";
import type { Chain } from "../../types.ts";

export const systemRouter = new Hono();

systemRouter.get("/health", (c) => c.json({ ok: true, version: "0.1.0" }));

systemRouter.post("/auth/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const password = body?.password;
  if (typeof password !== "string" || password !== config.adminPassword) {
    return c.json({ error: { code: "invalid_credentials", message: "Wrong password" } }, 401);
  }
  return c.json({ token: config.adminPassword });
});

systemRouter.get("/tokens", (c) => {
  const chain = (c.req.query("chain") ?? "base") as Chain;
  if (chain !== "base" && chain !== "solana") {
    return c.json({ error: { code: "invalid_chain" } }, 400);
  }
  return c.json({ tokens: listTokens(chain) });
});

/**
 * SSE — `EventSource` can't set the Authorization header, so we accept
 * `?token=...` in the URL. The wildcard auth middleware mounted in
 * server.ts already enforced the same check before this handler runs.
 */
systemRouter.get("/events/stream", (c) => {
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

      c.req.raw.signal.addEventListener("abort", () => {
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
