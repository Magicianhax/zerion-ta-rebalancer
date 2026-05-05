/**
 * Core type definitions shared across the rebalancer.
 */

export type Chain = "base" | "solana";

export interface BasketToken {
  /** Token symbol as Zerion knows it (e.g. "USDC", "ETH", "SOL") */
  symbol: string;
  /** User-defined initial allocation weight, 0..1 */
  initialWeight: number;
  /** Optional minimum % the rebalancer will hold (0..1) */
  minWeight?: number;
  /** Optional maximum % the rebalancer will hold (0..1) */
  maxWeight?: number;
}

export interface Basket {
  id: string;
  name: string;
  chain: Chain;
  /** Wallet name in the Zerion keystore */
  walletName: string;
  /** Agent token name (scoped credential) */
  agentTokenName: string;
  /** Policy id attached to the agent token */
  policyId: string;
  /** Starting budget in USDC, used for sizing initial swaps */
  budgetUsd: number;
  /** Quote token for rebalances (typically USDC) */
  quoteToken: string;
  tokens: BasketToken[];
  /** Bias toward TA suggestion vs initial weights, 0..1 (0 = ignore TA, 1 = pure TA) */
  taBias: number;
  /** Whether the cron is allowed to act on this basket */
  enabled: boolean;
  createdAt: string;
}

export interface TokenScore {
  symbol: string;
  /** Composite TA score, 0..100 */
  score: number;
  /** Per-indicator breakdown for transparency */
  breakdown: {
    rsi: number;
    macd: number;
    ema: number;
    volatility: number;
    volume: number;
  };
}

export interface WeightProposal {
  basketId: string;
  currentWeights: Record<string, number>;
  targetWeights: Record<string, number>;
  scores: TokenScore[];
  computedAt: string;
}

export type GuardOutcome =
  | { allow: true }
  | { allow: false; reason: string };

export interface SwapPlan {
  fromToken: string;
  toToken: string;
  amountFrom: number;
  /** Estimated USD value of the swap, for spend-cap checks */
  estimatedUsd: number;
}

export interface RebalanceResult {
  basketId: string;
  proposal: WeightProposal;
  plan: SwapPlan[];
  guardOutcome: GuardOutcome;
  swaps: Array<{
    plan: SwapPlan;
    txHash?: string;
    error?: string;
  }>;
  /** Plain-English reasoning from the Claude agent (when ANTHROPIC_API_KEY is set) */
  reasoning?: string;
  /** Source of this rebalance: "cron" | "manual" | "agent" */
  source?: "cron" | "manual" | "agent";
  startedAt: string;
  finishedAt: string;
}

export interface OhlcvBar {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
