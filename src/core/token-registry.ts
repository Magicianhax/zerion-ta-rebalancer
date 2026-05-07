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
  /** Logo URL — pinned to a stable CDN; fallback to letter avatar if absent */
  logoUrl?: string;
}

const COINGECKO = "https://assets.coingecko.com/coins/images";

const BASE_TOKENS: TokenEntry[] = [
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    decimals: 6,
    poolAddress: "",
    isQuote: true,
    logoUrl: `${COINGECKO}/6319/standard/usdc.png`,
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    address: "0x0000000000000000000000000000000000000000",
    decimals: 18,
    poolAddress: "0xd0b53d9277642d899df5c87a3966a349a798f224",
    logoUrl: `${COINGECKO}/279/standard/ethereum.png`,
  },
  {
    symbol: "AERO",
    name: "Aerodrome",
    address: "0x940181a94a35a4569e4529a3cdfb74e38fd98631",
    decimals: 18,
    poolAddress: "0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d",
    logoUrl: `${COINGECKO}/31745/standard/token.png`,
  },
  {
    symbol: "DEGEN",
    name: "Degen",
    address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed",
    decimals: 18,
    poolAddress: "0x7c89d8cffc3909c7c11b0ef8b9b2a7e3a3a1c2d4",
    logoUrl: `${COINGECKO}/34515/standard/android-chrome-512x512.png`,
  },
  {
    symbol: "BRETT",
    name: "Brett",
    address: "0x532f27101965dd16442e59d40670faf5ebb142e4",
    decimals: 18,
    poolAddress: "0xbA3F945812a83471d709BCe9C3CA699A19FB46f7",
    logoUrl: `${COINGECKO}/35529/standard/1000050750.png`,
  },
  {
    symbol: "CBBTC",
    name: "Coinbase Wrapped BTC",
    address: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
    decimals: 8,
    poolAddress: "0x4e962bb3889bf030368f56810a9c96b83cb3e778",
    logoUrl: `${COINGECKO}/40143/standard/cbbtc.webp`,
  },
  {
    symbol: "VIRTUAL",
    name: "Virtuals Protocol",
    address: "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b",
    decimals: 18,
    poolAddress: "",
    logoUrl: `${COINGECKO}/34057/standard/LOGOMARK.png`,
  },
  {
    symbol: "TOSHI",
    name: "Toshi",
    address: "0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4",
    decimals: 18,
    poolAddress: "",
    logoUrl: `${COINGECKO}/31415/standard/Toshi_Logo_-_Circular.png`,
  },
  {
    symbol: "HIGHER",
    name: "Higher",
    address: "0x0578d8a44db98b23bf096a382e016e29a5ce0ffe",
    decimals: 18,
    poolAddress: "",
    logoUrl: `${COINGECKO}/36205/standard/higher.jpeg`,
  },
  {
    symbol: "KEYCAT",
    name: "Keyboard Cat",
    address: "0x9a26f5433671751c3276a065f57e5a02d2817973",
    decimals: 18,
    poolAddress: "",
    logoUrl: `${COINGECKO}/36608/standard/keyboard_cat.jpeg`,
  },
  {
    symbol: "MOG",
    name: "Mog Coin",
    address: "0x2da56acb9ea78330f947bd57c54119debda7af71",
    decimals: 18,
    poolAddress: "",
    logoUrl: `${COINGECKO}/33147/standard/Mog_Logo.jpeg`,
  },
  {
    symbol: "PRIME",
    name: "Echelon Prime",
    address: "0xfa980ced6895ac314e7de34ef1bfae90a5add21b",
    decimals: 18,
    poolAddress: "",
    logoUrl: `${COINGECKO}/29053/standard/PRIME_logo.png`,
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
    logoUrl: `${COINGECKO}/6319/standard/usdc.png`,
  },
  {
    symbol: "SOL",
    name: "Solana",
    address: "So11111111111111111111111111111111111111112",
    decimals: 9,
    poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtL2eWBaeskRTLB",
    logoUrl: `${COINGECKO}/4128/standard/solana.png`,
  },
  {
    symbol: "BONK",
    name: "Bonk",
    address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    decimals: 5,
    poolAddress: "8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj",
    logoUrl: `${COINGECKO}/28600/standard/bonk.jpg`,
  },
  {
    symbol: "JUP",
    name: "Jupiter",
    address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    decimals: 6,
    poolAddress: "C1MgLojNLWBKADvu9BHdtgzz1oZX4dZ5zGdGcgvvW8Wz",
    logoUrl: `${COINGECKO}/34188/standard/jup.png`,
  },
  {
    symbol: "WIF",
    name: "dogwifhat",
    address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    decimals: 6,
    poolAddress: "EP2ib6dYdEeqD8MfE2ezHCxX3kP3K2eLKkirfPm5eyMx",
    logoUrl: `${COINGECKO}/33767/standard/dogwifhat.jpg`,
  },
  {
    symbol: "JTO",
    name: "Jito",
    address: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
    decimals: 9,
    poolAddress: "C9U2Ksk6KKWvLEeo5yUQ7Xu46X7NzeBJtd9PBfuXaUSM",
    logoUrl: `${COINGECKO}/33228/standard/jto.png`,
  },
  {
    symbol: "PYTH",
    name: "Pyth Network",
    address: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
    decimals: 6,
    poolAddress: "",
    logoUrl: `${COINGECKO}/31924/standard/pyth.png`,
  },
  {
    symbol: "RAY",
    name: "Raydium",
    address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
    decimals: 6,
    poolAddress: "",
    logoUrl: `${COINGECKO}/13928/standard/PSigc4ie_400x400.jpg`,
  },
  {
    symbol: "ORCA",
    name: "Orca",
    address: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE",
    decimals: 6,
    poolAddress: "",
    logoUrl: `${COINGECKO}/17547/standard/Orca_Logo.png`,
  },
  {
    symbol: "JITOSOL",
    name: "Jito Staked SOL",
    address: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
    decimals: 9,
    poolAddress: "",
    logoUrl: `${COINGECKO}/28046/standard/JitoSOL-200.png`,
  },
  {
    symbol: "MSOL",
    name: "Marinade Staked SOL",
    address: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
    decimals: 9,
    poolAddress: "",
    logoUrl: `${COINGECKO}/17752/standard/mSOL.png`,
  },
  {
    symbol: "W",
    name: "Wormhole",
    address: "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ",
    decimals: 6,
    poolAddress: "",
    logoUrl: `${COINGECKO}/35087/standard/womrhole_logo_full_color_rgb_2000px_72ppi_fb766ac85a.png`,
  },
  {
    symbol: "DRIFT",
    name: "Drift",
    address: "DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7",
    decimals: 6,
    poolAddress: "",
    logoUrl: `${COINGECKO}/37077/standard/drift.png`,
  },
  {
    symbol: "TNSR",
    name: "Tensor",
    address: "TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6",
    decimals: 9,
    poolAddress: "",
    logoUrl: `${COINGECKO}/36761/standard/tnsr.png`,
  },
  {
    symbol: "HNT",
    name: "Helium",
    address: "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux",
    decimals: 8,
    poolAddress: "",
    logoUrl: `${COINGECKO}/4284/standard/Helium_HNT.png`,
  },
  {
    symbol: "POPCAT",
    name: "Popcat",
    address: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
    decimals: 9,
    poolAddress: "",
    logoUrl: `${COINGECKO}/33760/standard/image.jpg`,
  },
  {
    symbol: "MEW",
    name: "cat in a dogs world",
    address: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5",
    decimals: 5,
    poolAddress: "",
    logoUrl: `${COINGECKO}/36659/standard/mew.png`,
  },
  {
    symbol: "PUMP",
    name: "Pump.fun",
    address: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn",
    decimals: 6,
    poolAddress: "",
    logoUrl: `${COINGECKO}/54455/standard/Pump_fun_logo.png`,
  },
  {
    symbol: "PENGU",
    name: "Pudgy Penguins",
    address: "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv",
    decimals: 6,
    poolAddress: "",
    logoUrl: `${COINGECKO}/52622/standard/PUDGY_PENGUINS_PENGU_PFP.png`,
  },
  {
    symbol: "FARTCOIN",
    name: "Fartcoin",
    address: "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump",
    decimals: 6,
    poolAddress: "",
    logoUrl: `${COINGECKO}/33597/standard/fart.png`,
  },
];

const REGISTRY: Record<Chain, TokenEntry[]> = {
  base: BASE_TOKENS,
  solana: SOLANA_TOKENS,
};

/**
 * Lazy import for `listCustomTokens` to avoid a hard dependency from the
 * token registry on the DB layer (the DB might not be initialized yet at
 * module-load time, e.g. during tests). Required is fine because both
 * modules are CommonJS-compatible under tsx.
 */
function customFromDb(chain: Chain): TokenEntry[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { listCustomTokens } = require("./db.ts") as typeof import("./db.ts");
    return listCustomTokens(chain).map<TokenEntry>((c) => ({
      symbol: c.symbol,
      name: c.name,
      address: c.address,
      decimals: c.decimals,
      poolAddress: c.poolAddress,
      logoUrl: c.logoUrl ?? undefined,
    }));
  } catch {
    return [];
  }
}

export function listTokens(chain: Chain): TokenEntry[] {
  // Custom tokens go after static so curated entries win on symbol collisions.
  const seen = new Set<string>();
  const out: TokenEntry[] = [];
  for (const t of REGISTRY[chain]) {
    out.push(t);
    seen.add(t.symbol.toUpperCase());
  }
  for (const t of customFromDb(chain)) {
    if (!seen.has(t.symbol.toUpperCase())) {
      out.push(t);
      seen.add(t.symbol.toUpperCase());
    }
  }
  return out;
}

export function findToken(chain: Chain, symbol: string): TokenEntry | null {
  const upper = symbol.toUpperCase();
  return listTokens(chain).find((t) => t.symbol === upper) ?? null;
}

/** Map our chain to GeckoTerminal's network slug */
export function geckoNetwork(chain: Chain): string {
  return chain === "base" ? "base" : "solana";
}
