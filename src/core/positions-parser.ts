/**
 * Tolerant parser for Zerion CLI positions output.
 *
 * The CLI is a thin wrapper over Zerion's REST API which uses JSON:API. Some
 * commands flatten the response (e.g. items at the top level), some preserve
 * the JSON:API shape (`{data: [...]}`), and the symbol/value fields move
 * around depending on whether the position is a fungible token, a DeFi
 * position, or a Solana SPL holding.
 *
 * This module accepts any of those shapes.
 */

import type { Basket } from "../types.ts";

export interface PortfolioSnapshot {
  totalUsd: number;
  byToken: Record<string, number>;
}

export function extractSymbol(item: any): string {
  const candidates = [
    item?.symbol,
    item?.fungible?.symbol,
    item?.attributes?.symbol,
    item?.attributes?.fungible_info?.symbol,
    item?.fungible_info?.symbol,
    item?.token?.symbol,
    item?.asset?.symbol,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c) return c.toUpperCase();
  }
  return "";
}

export function extractValueUsd(item: any): number {
  const candidates = [
    item?.value_usd,
    item?.usd_value,
    item?.value,
    item?.attributes?.value,
    item?.attributes?.value_usd,
    item?.attributes?.quantity?.value,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

export function extractItems(raw: any): any[] {
  return (
    raw?.positions ??
    raw?.data ??
    raw?.attributes?.positions ??
    (Array.isArray(raw) ? raw : [])
  );
}

export function summarizePositions(
  raw: any,
  basket: Basket,
): PortfolioSnapshot & { rawSymbols: string[] } {
  const byToken: Record<string, number> = {};
  let totalUsd = 0;

  const items = extractItems(raw);
  const wantSymbols = new Set(basket.tokens.map((t) => t.symbol.toUpperCase()));
  wantSymbols.add(basket.quoteToken.toUpperCase());

  const rawSymbols: string[] = [];

  for (const item of items) {
    const symbol = extractSymbol(item);
    if (symbol) rawSymbols.push(symbol);
    if (!wantSymbols.has(symbol)) continue;
    const valueUsd = extractValueUsd(item);
    if (valueUsd <= 0) continue;
    byToken[symbol] = (byToken[symbol] ?? 0) + valueUsd;
    totalUsd += valueUsd;
  }

  return { totalUsd, byToken, rawSymbols };
}
