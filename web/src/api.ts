/**
 * Backend API client + SSE subscriber. Token is stored in sessionStorage.
 */

const TOKEN_KEY = "rebalancer_token";

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`/api${path}`, { ...init, headers });
  if (res.status === 401) {
    clearToken();
    location.reload();
    throw new ApiError("unauthorized", "Session expired");
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(json?.error?.code ?? "error", json?.error?.message ?? `HTTP ${res.status}`);
  return json as T;
}

/**
 * In-flight cache for read-only GETs. Two roles:
 *  1. Dedupe concurrent calls (modal mounts mid-render and starts 4 parallel
 *     fetches; the second mount within the TTL hits an already-resolved
 *     promise instead of issuing a new request).
 *  2. Short TTL serves as a "don't refetch on every component mount" guard.
 *     Subprocess-bound endpoints (positions, wallet metadata) take 1-30s
 *     each — repeating them on every modal open is wasteful.
 */
const cacheStore = new Map<string, { promise: Promise<unknown>; expiresAt: number }>();

function cached<T>(key: string, ttlMs: number, factory: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cacheStore.get(key);
  if (hit && hit.expiresAt > now) return hit.promise as Promise<T>;
  const promise = factory();
  cacheStore.set(key, { promise, expiresAt: now + ttlMs });
  promise.catch(() => cacheStore.delete(key));
  return promise;
}

/** Drop cached entries — call after mutations that change the answer. */
export function invalidateCache(prefix?: string) {
  if (!prefix) {
    cacheStore.clear();
    return;
  }
  for (const key of cacheStore.keys()) {
    if (key.startsWith(prefix)) cacheStore.delete(key);
  }
}

const TTL_FOREVER = 1000 * 60 * 60; // 1h — token registry never changes mid-session
const TTL_LONG = 1000 * 60 * 5;     // 5min — wallets, policies, agent tokens (mutated rarely + we invalidate explicitly)
const TTL_SHORT = 1000 * 30;        // 30s  — wallet holdings (changes on swaps)

export const api = {
  // Reads are cached at the client to avoid duplicate fetches when multiple
  // components mount within milliseconds (e.g. closing/reopening a modal).
  listBaskets: () =>
    cached("baskets", TTL_SHORT, () => request<{ baskets: Basket[] }>("/baskets")),
  getBasket: (id: string) =>
    cached(`basket:${id}`, TTL_SHORT, () => request<{ basket: Basket }>(`/baskets/${id}`)),
  listRebalances: (id: string, limit = 50) =>
    cached(`rebalances:${id}:${limit}`, TTL_SHORT, () =>
      request<{ rebalances: RebalanceResult[] }>(`/baskets/${id}/rebalances?limit=${limit}`),
    ),
  getPortfolio: (id: string) =>
    cached(`portfolio:${id}`, TTL_SHORT, () =>
      request<{ portfolio: Portfolio }>(`/baskets/${id}/portfolio`),
    ),
  listTokens: (chain: "base" | "solana") =>
    cached(`tokens:${chain}`, TTL_FOREVER, () =>
      request<{ tokens: TokenEntry[] }>(`/tokens?chain=${chain}`),
    ),
  listWallets: () =>
    cached("wallets", TTL_LONG, () => request<{ wallets: WalletInfo[] }>("/wallets")),
  walletHoldings: (name: string) =>
    cached(`holdings:${name}`, TTL_SHORT, () =>
      request<{
        wallet: string;
        totalUsd: number;
        holdings: Array<{ symbol: string; chain: Chain; usd: number; logoUrl: string | null }>;
        errors: string[];
        fetchedAt: string;
      }>(`/wallets/${encodeURIComponent(name)}/holdings`),
    ),
  listPolicies: () =>
    cached("policies", TTL_LONG, () => request<{ policies: any[] }>("/agent/policies")),
  listAgentTokens: () =>
    cached("agent-tokens", TTL_LONG, () => request<{ tokens: any[] }>("/agent/tokens")),
  getAuthorizedTelegramUsers: () =>
    cached("authorized-tg", TTL_LONG, () =>
      request<{ userIds: string[] }>("/telegram/authorized"),
    ),

  // Writes — invalidate the relevant cache prefixes after the response.
  health: () => request<{ ok: true; version: string }>("/health"),
  login: (password: string) =>
    request<{ token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  createBasket: async (basket: BasketCreatePayload) => {
    const r = await request<{ basket: Basket }>("/baskets", {
      method: "POST",
      body: JSON.stringify(basket),
    });
    invalidateCache("baskets");
    return r;
  },
  pauseBasket: async (id: string) => {
    const r = await request<{ ok: true }>(`/baskets/${id}/pause`, { method: "POST" });
    invalidateCache("baskets");
    invalidateCache(`basket:${id}`);
    return r;
  },
  resumeBasket: async (id: string) => {
    const r = await request<{ ok: true }>(`/baskets/${id}/resume`, { method: "POST" });
    invalidateCache("baskets");
    invalidateCache(`basket:${id}`);
    return r;
  },
  deleteBasket: async (id: string) => {
    const r = await request<{ ok: true }>(`/baskets/${id}`, { method: "DELETE" });
    invalidateCache("baskets");
    invalidateCache(`basket:${id}`);
    invalidateCache(`portfolio:${id}`);
    invalidateCache(`rebalances:${id}`);
    return r;
  },
  rebalance: async (id: string) => {
    const r = await request<{ result: RebalanceResult }>(`/baskets/${id}/rebalance`, {
      method: "POST",
    });
    invalidateCache(`portfolio:${id}`);
    invalidateCache(`rebalances:${id}`);
    invalidateCache(`holdings:`);
    return r;
  },
  pairTelegram: () =>
    request<{ pairingCode: string; expiresIn: string }>("/telegram/pair", { method: "POST" }),
};

export function subscribeEvents(
  handler: (event: string, payload: unknown) => void,
): () => void {
  const token = getToken();
  if (!token) return () => {};
  const url = `/api/events/stream?token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);
  const types = ["hello", "ping", "rebalance:start", "rebalance:done"];
  const listeners = types.map((t) => {
    const fn = (e: MessageEvent) => {
      try { handler(t, JSON.parse(e.data)); } catch { /* ignore parse error */ }
    };
    es.addEventListener(t, fn);
    return [t, fn] as const;
  });
  return () => {
    listeners.forEach(([t, fn]) => es.removeEventListener(t, fn));
    es.close();
  };
}

// ── Types ────────────────────────────────────────────────────────────

export type Chain = "base" | "solana";

export interface Basket {
  id: string;
  name: string;
  chain: Chain;
  walletName: string;
  agentTokenName: string;
  policyId: string;
  budgetUsd: number;
  quoteToken: string;
  taBias: number;
  enabled: boolean;
  createdAt: string;
  tokens: BasketToken[];
}

export interface BasketToken {
  symbol: string;
  initialWeight: number;
  minWeight?: number;
  maxWeight?: number;
}

export interface BasketCreatePayload {
  id: string;
  name: string;
  chain: Chain;
  walletName: string;
  agentTokenName: string;
  policyId: string;
  budgetUsd: number;
  quoteToken: string;
  taBias: number;
  tokens: BasketToken[];
}

export interface TokenEntry {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  poolAddress: string;
  isQuote?: boolean;
  logoUrl?: string | null;
}

export interface WalletInfo {
  name: string;
  evmAddress: string;
  solAddress: string | null;
  chains: string[];
  createdAt: string;
}

export interface TokenScore {
  symbol: string;
  score: number;
  breakdown: {
    rsi: number; macd: number; ema: number; volatility: number; volume: number;
  };
}

export interface SwapPlan {
  fromToken: string;
  toToken: string;
  amountFrom: number;
  estimatedUsd: number;
}

export interface Portfolio {
  totalUsd: number;
  byToken: Record<string, number>;
  currentWeights: Record<string, number>;
  fetchedAt: string;
}

export interface RebalanceResult {
  basketId: string;
  proposal: {
    currentWeights: Record<string, number>;
    targetWeights: Record<string, number>;
    scores: TokenScore[];
    computedAt: string;
  };
  plan: SwapPlan[];
  guardOutcome: { allow: true } | { allow: false; reason: string };
  swaps: Array<{ plan: SwapPlan; txHash?: string; error?: string }>;
  startedAt: string;
  finishedAt: string;
}
