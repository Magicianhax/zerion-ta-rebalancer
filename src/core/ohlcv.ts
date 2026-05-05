/**
 * GeckoTerminal OHLCV client.
 * Free public API, ~30 req/min rate limit. We fetch 4h candles, last 100 bars.
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
 * Fetch OHLCV bars for a token by symbol on the given chain.
 * Returns up to `limit` bars at the given timeframe, oldest first.
 */
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

  const network = geckoNetwork(chain);
  const url = `${BASE_URL}/networks/${network}/pools/${token.poolAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "zerion-ta-rebalancer/0.1" },
  });

  if (!res.ok) {
    throw new Error(`GeckoTerminal returned ${res.status} for ${symbol}: ${await res.text()}`);
  }

  const json = (await res.json()) as GeckoOhlcvResponse;
  if (json.errors?.length) {
    throw new Error(`GeckoTerminal error: ${json.errors[0]?.title}`);
  }

  const list = json.data?.attributes?.ohlcv_list ?? [];
  return list
    .map<OhlcvBar>((row) => ({
      time: row[0]!,
      open: row[1]!,
      high: row[2]!,
      low: row[3]!,
      close: row[4]!,
      volume: row[5]!,
    }))
    .sort((a, b) => a.time - b.time);
}
