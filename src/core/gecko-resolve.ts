/**
 * Resolve a contract address → token metadata via the GeckoTerminal API.
 *
 * Used by the "add custom token" flow in the New Basket modal so users can
 * trade tokens that aren't in the curated registry. We pick the deepest
 * USDC-paired pool as the OHLCV source for TA scoring; if no USDC pair
 * exists we fall back to the deepest pool of any kind (TA can still score
 * against that quote, just less directly comparable to the basket's USDC
 * accounting).
 */

import type { Chain } from "../types.ts";
import { geckoNetwork } from "./token-registry.ts";

export interface ResolvedToken {
  chain: Chain;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Best USDC-paired pool, or empty string if none exists. */
  poolAddress: string;
  logoUrl: string | null;
}

const USDC_ADDRESSES: Record<Chain, string> = {
  base: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};

/** Loosely validate that an address looks like it could belong to a chain. */
export function looksLikeAddress(chain: Chain, address: string): boolean {
  const a = address.trim();
  if (chain === "base") return /^0x[a-fA-F0-9]{40}$/.test(a);
  // Solana addresses are base58, 32-44 chars typical.
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
}

/** Normalize an address to its on-chain canonical form (lowercase EVM, as-is Solana). */
function normalize(chain: Chain, address: string): string {
  return chain === "base" ? address.trim().toLowerCase() : address.trim();
}

interface GtTokenResponse {
  data?: {
    attributes?: {
      address?: string;
      name?: string;
      symbol?: string;
      decimals?: number;
      image_url?: string | null;
    };
    relationships?: {
      top_pools?: { data: Array<{ id: string; type: string }> };
    };
  };
  included?: Array<{
    id: string;
    type: string;
    attributes?: {
      address?: string;
      name?: string;
      reserve_in_usd?: string;
      base_token_price_usd?: string;
    };
    relationships?: {
      base_token?: { data: { id: string } };
      quote_token?: { data: { id: string } };
    };
  }>;
}

const GT_BASE = "https://api.geckoterminal.com/api/v2";

/** Fetch token metadata + best USDC pool from GeckoTerminal. */
export async function resolveTokenFromGecko(
  chain: Chain,
  address: string,
): Promise<ResolvedToken> {
  const network = geckoNetwork(chain);
  const addr = normalize(chain, address);
  const url = `${GT_BASE}/networks/${network}/tokens/${addr}?include=top_pools`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) {
    throw new Error(`Token not found on ${chain} via GeckoTerminal`);
  }
  if (!res.ok) {
    throw new Error(`GeckoTerminal returned HTTP ${res.status}`);
  }
  const json = (await res.json()) as GtTokenResponse;

  const attrs = json?.data?.attributes;
  if (!attrs?.symbol || !attrs?.name || attrs?.decimals == null) {
    throw new Error("Incomplete token metadata from GeckoTerminal");
  }

  const usdcAddr = USDC_ADDRESSES[chain].toLowerCase();
  const pools = (json.included ?? []).filter((p) => p.type === "pool");

  // Prefer USDC-paired pools, ranked by reserve_in_usd descending.
  type ScoredPool = { addr: string; reserve: number; isUsdcPair: boolean };
  const scored: ScoredPool[] = pools.map((p) => {
    const poolAddr = p.attributes?.address ?? "";
    const reserve = Number(p.attributes?.reserve_in_usd ?? 0) || 0;
    const baseTok = (p.relationships?.base_token?.data?.id ?? "").toLowerCase();
    const quoteTok = (p.relationships?.quote_token?.data?.id ?? "").toLowerCase();
    const isUsdcPair = baseTok.endsWith(usdcAddr) || quoteTok.endsWith(usdcAddr);
    return { addr: poolAddr, reserve, isUsdcPair };
  });

  scored.sort((a, b) => {
    if (a.isUsdcPair !== b.isUsdcPair) return a.isUsdcPair ? -1 : 1;
    return b.reserve - a.reserve;
  });

  const bestPool = scored[0];
  const poolAddress = bestPool && bestPool.reserve > 0 ? bestPool.addr : "";

  return {
    chain,
    address: attrs.address ?? addr,
    symbol: attrs.symbol.toUpperCase(),
    name: attrs.name,
    decimals: attrs.decimals,
    poolAddress,
    logoUrl: attrs.image_url ?? null,
  };
}
