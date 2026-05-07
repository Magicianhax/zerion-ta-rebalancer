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
import { addCustomToken, findCustomTokenBySymbol } from "../../core/db.ts";
import { looksLikeAddress, resolveTokenFromGecko } from "../../core/gecko-resolve.ts";
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
 * Resolve a contract address → token entry via GeckoTerminal, then persist
 * to the custom_tokens table so it shows up in subsequent /tokens listings
 * and in createBasket validation.
 *
 * Errors are surfaced verbatim — invalid address, not-found, network error
 * — so the modal can show the actual reason instead of a generic failure.
 */
systemRouter.get("/tokens/resolve", async (c) => {
  const chain = (c.req.query("chain") ?? "") as Chain;
  const address = (c.req.query("address") ?? "").trim();

  if (chain !== "base" && chain !== "solana") {
    return c.json({ error: { code: "invalid_chain", message: "chain must be base or solana" } }, 400);
  }
  if (!address) {
    return c.json({ error: { code: "missing_address", message: "address is required" } }, 400);
  }
  if (!looksLikeAddress(chain, address)) {
    return c.json(
      { error: { code: "invalid_address", message: `Doesn't look like a valid ${chain} address` } },
      400,
    );
  }

  try {
    const resolved = await resolveTokenFromGecko(chain, address);

    // Symbol collision check — custom_tokens has UNIQUE(chain, symbol).
    // If the symbol already exists at a *different* address, surface that
    // clearly rather than silently overwriting. Same address re-resolution
    // is a no-op upsert.
    const existingBySym = findCustomTokenBySymbol(chain, resolved.symbol);
    if (existingBySym && existingBySym.address.toLowerCase() !== resolved.address.toLowerCase()) {
      return c.json(
        {
          error: {
            code: "symbol_collision",
            message: `Symbol "${resolved.symbol}" is already registered to a different address.`,
          },
        },
        409,
      );
    }

    addCustomToken({
      chain,
      address: resolved.address,
      symbol: resolved.symbol,
      name: resolved.name,
      decimals: resolved.decimals,
      poolAddress: resolved.poolAddress,
      logoUrl: resolved.logoUrl,
    });

    return c.json({
      token: {
        symbol: resolved.symbol,
        name: resolved.name,
        address: resolved.address,
        decimals: resolved.decimals,
        poolAddress: resolved.poolAddress,
        logoUrl: resolved.logoUrl,
      },
    });
  } catch (e: any) {
    return c.json(
      { error: { code: "resolve_failed", message: e.message ?? String(e) } },
      502,
    );
  }
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
