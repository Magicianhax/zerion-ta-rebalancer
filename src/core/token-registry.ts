/**
 * Symbol → token address + GeckoTerminal pool registry.
 *
 * v1 ships with a curated list of liquid tokens on Base and Solana.
 * Users can extend by editing this file or the future data/registry.json
 * override (TODO: registry merge from data/).
 *
 * Pool addresses are picked for highest-liquidity USDC pair on each chain so
 * OHLCV data is meaningful for TA.
 */

import type { Chain } from "../types.ts";

export interface TokenEntry {
  symbol: string;
  /** Display name */
  name: string;
  /** Token address (case-sensitive on Solana) */
  address: string;
  decimals: number;
  /** Highest-liquidity pool against USDC on the same chain — used for OHLCV */
  poolAddress: string;
  /** Whether this token is a stable quote (USDC/USDT) */
  isQuote?: boolean;
}

const BASE_TOKENS: TokenEntry[] = [
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    decimals: 6,
    poolAddress: "",
    isQuote: true,
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    address: "0x0000000000000000000000000000000000000000",
    decimals: 18,
    poolAddress: "0xd0b53d9277642d899df5c87a3966a349a798f224", // Uniswap V3 ETH/USDC 0.05%
  },
  {
    symbol: "AERO",
    name: "Aerodrome",
    address: "0x940181a94a35a4569e4529a3cdfb74e38fd98631",
    decimals: 18,
    poolAddress: "0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d",
  },
  {
    symbol: "DEGEN",
    name: "Degen",
    address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed",
    decimals: 18,
    poolAddress: "0x7c89d8cffc3909c7c11b0ef8b9b2a7e3a3a1c2d4",
  },
  {
    symbol: "BRETT",
    name: "Brett",
    address: "0x532f27101965dd16442e59d40670faf5ebb142e4",
    decimals: 18,
    poolAddress: "0xbA3F945812a83471d709BCe9C3CA699A19FB46f7",
  },
  {
    symbol: "CBBTC",
    name: "Coinbase Wrapped BTC",
    address: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
    decimals: 8,
    poolAddress: "0x4e962bb3889bf030368f56810a9c96b83cb3e778",
  },
];

const SOLANA_TOKENS: TokenEntry[] = [
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
    poolAddress: "",
    isQuote: true,
  },
  {
    symbol: "SOL",
    name: "Solana",
    address: "So11111111111111111111111111111111111111112",
    decimals: 9,
    poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtL2eWBaeskRTLB", // Orca SOL/USDC
  },
  {
    symbol: "BONK",
    name: "Bonk",
    address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    decimals: 5,
    poolAddress: "8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj",
  },
  {
    symbol: "JUP",
    name: "Jupiter",
    address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    decimals: 6,
    poolAddress: "C1MgLojNLWBKADvu9BHdtgzz1oZX4dZ5zGdGcgvvW8Wz",
  },
  {
    symbol: "WIF",
    name: "dogwifhat",
    address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    decimals: 6,
    poolAddress: "EP2ib6dYdEeqD8MfE2ezHCxX3kP3K2eLKkirfPm5eyMx",
  },
  {
    symbol: "JTO",
    name: "Jito",
    address: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
    decimals: 9,
    poolAddress: "C9U2Ksk6KKWvLEeo5yUQ7Xu46X7NzeBJtd9PBfuXaUSM",
  },
];

const REGISTRY: Record<Chain, TokenEntry[]> = {
  base: BASE_TOKENS,
  solana: SOLANA_TOKENS,
};

export function listTokens(chain: Chain): TokenEntry[] {
  return REGISTRY[chain];
}

export function findToken(chain: Chain, symbol: string): TokenEntry | null {
  const upper = symbol.toUpperCase();
  return REGISTRY[chain].find((t) => t.symbol === upper) ?? null;
}

/** Map our chain to GeckoTerminal's network slug */
export function geckoNetwork(chain: Chain): string {
  return chain === "base" ? "base" : "solana";
}
