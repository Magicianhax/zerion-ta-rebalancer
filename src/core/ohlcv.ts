/**
 * GeckoTerminal OHLCV client.
 *
 * Free public API has a ~30 req/min limit. Two layers of protection:
 *   1. In-memory TTL cache — hourly OHLCV only changes once an hour, so a
 *      15-min cache lets a basket with N tokens cost N requests every 15
 *      minutes instead of N per tick.
 *   2. Serial throttle — even on cache miss, we space requests so concurrent
 *      ticks (e.g., a manual rebalance running while cron fires) can't
 *      burst past the limit.
 *
 * Returns 4h candles, last 100 bars by default.
 */

import type { Chain, OhlcvBar } from "../types.ts";
import { findToken, geckoNetwork } from "./token-registry.ts";

const BASE_URL = "https://api.geckoterminal.com/api/v2";

interface GeckoOhlcvResponse {
  data?: {
    attributes?: {
      ohlcv_list?: number[][]; // [timestamp, open, high, low, close, volume]
    };
  };
  errors?: Array<{ status: string; title: string }>;
}

/**
 * Cache TTL — hourly bars realistically only need refreshing once an hour.
 * 15 min is conservative: the user gets a fresh signal every cron tick at
 * most 15 min stale, and our request budget drops by ~75% for 1h ticks.
 */
const CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Min spacing between GT requests. The free tier is ~30/min = one every
 * 2.0s; we add 100ms slack so we never trip the limiter under clock skew.
 */
const MIN_REQUEST_INTERVAL_MS = 2_100;

interface CacheEntry {
  bars: OhlcvBar[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Single shared throttle promise. Each new request waits for the previous
 * one to finish + the min interval before issuing.
 */
let lastRequestAt = 0;
let throttleChain: Promise<void> = Promise.resolve();

function throttle(): Promise<void> {
  throttleChain = throttleChain.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, MIN_REQUEST_INTERVAL_MS - (now - lastRequestAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  });
  return throttleChain;
}

export async function fetchOhlcv(
  chain: Chain,
  symbol: string,
  timeframe: "hour" | "day" = "hour",
  aggregate: 1 | 4 = 4,
  limit = 100,
): Promise<OhlcvBar[]> {
  const token = findToken(chain, symbol);
  if (!token) {
    throw new Error(`Unknown token "${symbol}" on ${chain}. Add it to token-registry.ts.`);
  }
  if (token.isQuote) {
    return [];
  }
  if (!token.poolAddress) {
    throw new Error(`Token "${symbol}" on ${chain} has no pool address configured.`);
  }

  const key = `${chain}:${token.poolAddress}:${timeframe}:${aggregate}:${limit}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.bars;

  await throttle();

  const network = geckoNetwork(chain);
  const url = `${BASE_URL}/networks/${network}/pools/${token.poolAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "zerion-ta-rebalancer/0.1" },
  });

  if (res.status === 429) {
    // Serve a stale cache entry if we have one — better than failing the
    // whole tick. The TA score is already a noisy signal; a 15-min-old bar
    // is not meaningfully less accurate than a 30-min-old one.
    if (hit) return hit.bars;
    throw new Error(`GeckoTerminal rate-limited ${symbol}; no cached data to fall back to.`);
  }
  if (!res.ok) {
    throw new Error(`GeckoTerminal returned ${res.status} for ${symbol}: ${await res.text()}`);
  }

  const json = (await res.json()) as GeckoOhlcvResponse;
  if (json.errors?.length) {
    throw new Error(`GeckoTerminal error: ${json.errors[0]?.title}`);
  }

  const list = json.data?.attributes?.ohlcv_list ?? [];
  const bars = list
    .map<OhlcvBar>((row) => ({
      time: row[0]!,
      open: row[1]!,
      high: row[2]!,
      low: row[3]!,
      close: row[4]!,
      volume: row[5]!,
    }))
    .sort((a, b) => a.time - b.time);

  cache.set(key, { bars, expiresAt: now + CACHE_TTL_MS });
  return bars;
}
