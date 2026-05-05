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

export const api = {
  health: () => request<{ ok: true; version: string }>("/health"),
  login: (password: string) =>
    request<{ token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  listBaskets: () => request<{ baskets: Basket[] }>("/baskets"),
  getBasket: (id: string) => request<{ basket: Basket }>(`/baskets/${id}`),
  createBasket: (basket: BasketCreatePayload) =>
    request<{ basket: Basket }>("/baskets", {
      method: "POST",
      body: JSON.stringify(basket),
    }),
  pauseBasket: (id: string) => request<{ ok: true }>(`/baskets/${id}/pause`, { method: "POST" }),
  resumeBasket: (id: string) => request<{ ok: true }>(`/baskets/${id}/resume`, { method: "POST" }),
  deleteBasket: (id: string) => request<{ ok: true }>(`/baskets/${id}`, { method: "DELETE" }),
  rebalance: (id: string) =>
    request<{ result: RebalanceResult }>(`/baskets/${id}/rebalance`, { method: "POST" }),
  listRebalances: (id: string, limit = 50) =>
    request<{ rebalances: RebalanceResult[] }>(`/baskets/${id}/rebalances?limit=${limit}`),
  getPortfolio: (id: string) =>
    request<{ portfolio: Portfolio }>(`/baskets/${id}/portfolio`),
  listTokens: (chain: "base" | "solana") => request<{ tokens: TokenEntry[] }>(`/tokens?chain=${chain}`),
  listWallets: () => request<{ wallets: WalletInfo[] }>("/wallets"),
  listPolicies: () => request<{ policies: any[] }>("/agent/policies"),
  listAgentTokens: () => request<{ tokens: any[] }>("/agent/tokens"),
  pairTelegram: () => request<{ pairingCode: string; expiresIn: string }>("/telegram/pair", { method: "POST" }),
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
