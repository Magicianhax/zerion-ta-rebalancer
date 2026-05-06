/**
 * Wallet inspection routes: list wallets and aggregated holdings across chains.
 */

import { Hono } from "hono";
import { positions, walletList } from "../../core/zerion.ts";
import { findToken } from "../../core/token-registry.ts";
import type { Chain } from "../../types.ts";

const SUPPORTED_CHAINS: Chain[] = ["solana", "base"];

export const walletsRouter = new Hono();

walletsRouter.get("/", async (c) => {
  try {
    const wallets = await walletList();
    return c.json({ wallets });
  } catch (e: any) {
    return c.json({ error: { code: "zerion_error", message: e.message } }, 500);
  }
});

/**
 * Aggregated holdings across every supported chain. Native + wrapped variants
 * of the same token are summed into a single row by (chain, symbol).
 */
walletsRouter.get("/:name/holdings", async (c) => {
  const name = c.req.param("name");
  const aggregated = new Map<string, { symbol: string; chain: Chain; usd: number }>();
  let totalUsd = 0;
  const errors: string[] = [];

  // Per-chain calls run in parallel — each subprocess spawn is the long pole.
  const results = await Promise.all(
    SUPPORTED_CHAINS.map(async (chain) => {
      try {
        const raw = await positions(name, { mode: "simple", chain });
        return { chain, raw, error: null as string | null };
      } catch (e: any) {
        return { chain, raw: null, error: e.message };
      }
    }),
  );

  for (const { chain, raw, error } of results) {
    if (error) {
      errors.push(`${chain}: ${error}`);
      continue;
    }
    const items: any[] = raw?.positions ?? raw?.data ?? [];
    for (const item of items) {
      const symbol = (item?.symbol ?? item?.fungible?.symbol ?? "").toUpperCase();
      if (!symbol) continue;
      const usd = Number(item?.value ?? item?.value_usd ?? 0);
      if (!Number.isFinite(usd) || usd <= 0) continue;
      const key = `${chain}:${symbol}`;
      const existing = aggregated.get(key);
      if (existing) existing.usd += usd;
      else aggregated.set(key, { symbol, chain, usd });
      totalUsd += usd;
    }
  }

  const holdings = [...aggregated.values()]
    .sort((a, b) => b.usd - a.usd)
    .map((h) => ({ ...h, logoUrl: findToken(h.chain, h.symbol)?.logoUrl ?? null }));

  return c.json({
    wallet: name,
    totalUsd: Math.round(totalUsd * 100) / 100,
    holdings,
    errors,
    fetchedAt: new Date().toISOString(),
  });
});
