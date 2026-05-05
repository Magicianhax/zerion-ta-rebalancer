/**
 * Technical-analysis pipeline.
 *
 * For each token in a basket, fetch OHLCV and compute a composite score [0..100]
 * that blends 5 signals. Higher score = stronger conviction to allocate weight.
 *
 * Signals (weighted sum):
 *   25% RSI(14) — sweet spot 40-60, oversold 30 = bullish, overbought 70 = bearish
 *   25% MACD histogram — positive & rising = bullish
 *   25% Price vs EMA(50) — above and rising = bullish
 *   15% Volatility (ATR%) — lower is better (stable allocation)
 *   10% Volume trend (24h vs 7d avg) — higher = stronger conviction
 *
 * Pure functions, easy to unit-test.
 */

import { ATR, EMA, MACD, RSI } from "technicalindicators";
import type { OhlcvBar, TokenScore } from "../types.ts";
import type { Chain } from "../types.ts";
import { fetchOhlcv } from "./ohlcv.ts";

const WEIGHTS = {
  rsi: 0.25,
  macd: 0.25,
  ema: 0.25,
  volatility: 0.15,
  volume: 0.10,
};

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0.5;
  return Math.max(0, Math.min(1, x));
}

export function scoreRsi(bars: OhlcvBar[]): number {
  if (bars.length < 15) return 0.5;
  const closes = bars.map((b) => b.close);
  const series = RSI.calculate({ values: closes, period: 14 });
  const last = series.at(-1);
  if (last == null) return 0.5;
  // Triangular: peak at 50, fade to 0 at 0 and 100
  const distance = Math.abs(50 - last);
  return clamp01(1 - distance / 50);
}

export function scoreMacd(bars: OhlcvBar[]): number {
  if (bars.length < 35) return 0.5;
  const closes = bars.map((b) => b.close);
  const series = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const last = series.at(-1);
  const prev = series.at(-2);
  if (!last?.histogram || !prev?.histogram) return 0.5;
  const positive = last.histogram > 0 ? 1 : 0;
  const rising = last.histogram > prev.histogram ? 1 : 0;
  return clamp01(0.5 * positive + 0.5 * rising);
}

export function scoreEma(bars: OhlcvBar[]): number {
  if (bars.length < 50) return 0.5;
  const closes = bars.map((b) => b.close);
  const ema = EMA.calculate({ values: closes, period: 50 });
  const lastEma = ema.at(-1);
  const lastClose = closes.at(-1);
  if (lastEma == null || lastClose == null) return 0.5;
  // Distance above EMA, capped at +/- 20%
  const ratio = (lastClose - lastEma) / lastEma;
  return clamp01(0.5 + ratio / 0.4);
}

export function scoreVolatility(bars: OhlcvBar[]): number {
  if (bars.length < 15) return 0.5;
  const atr = ATR.calculate({
    high: bars.map((b) => b.high),
    low: bars.map((b) => b.low),
    close: bars.map((b) => b.close),
    period: 14,
  });
  const lastAtr = atr.at(-1);
  const lastClose = bars.at(-1)?.close;
  if (lastAtr == null || lastClose == null || lastClose === 0) return 0.5;
  const atrPct = lastAtr / lastClose;
  // Reward low volatility: 0% → 1.0, 10% → 0
  return clamp01(1 - atrPct / 0.1);
}

export function scoreVolume(bars: OhlcvBar[]): number {
  // 24h vs 7d avg — assumes 4h bars: 6 bars/day
  if (bars.length < 42) return 0.5;
  const recent = bars.slice(-6).reduce((sum, b) => sum + b.volume, 0) / 6;
  const baseline = bars.slice(-42, -6).reduce((sum, b) => sum + b.volume, 0) / 36;
  if (baseline === 0) return 0.5;
  const ratio = recent / baseline;
  // 1.0 (parity) → 0.5; 2x → 1.0; 0.5x → 0
  return clamp01(0.5 + (Math.log2(ratio) / 2));
}

export function compositeScore(bars: OhlcvBar[]): TokenScore["breakdown"] & { composite: number } {
  const breakdown = {
    rsi: scoreRsi(bars),
    macd: scoreMacd(bars),
    ema: scoreEma(bars),
    volatility: scoreVolatility(bars),
    volume: scoreVolume(bars),
  };
  const composite =
    breakdown.rsi * WEIGHTS.rsi +
    breakdown.macd * WEIGHTS.macd +
    breakdown.ema * WEIGHTS.ema +
    breakdown.volatility * WEIGHTS.volatility +
    breakdown.volume * WEIGHTS.volume;
  return { ...breakdown, composite };
}

export async function scoreToken(chain: Chain, symbol: string): Promise<TokenScore> {
  const bars = await fetchOhlcv(chain, symbol, "hour", 4, 100);
  const { composite, ...breakdown } = compositeScore(bars);
  return {
    symbol,
    score: Math.round(composite * 100),
    breakdown: {
      rsi: Math.round(breakdown.rsi * 100),
      macd: Math.round(breakdown.macd * 100),
      ema: Math.round(breakdown.ema * 100),
      volatility: Math.round(breakdown.volatility * 100),
      volume: Math.round(breakdown.volume * 100),
    },
  };
}

/**
 * Convert per-token scores into normalized target weights via softmax.
 * Higher temperature = flatter distribution, lower = sharper concentration.
 */
export function scoresToWeights(
  scores: TokenScore[],
  temperature = 25,
): Record<string, number> {
  if (scores.length === 0) return {};
  const exps = scores.map((s) => Math.exp(s.score / temperature));
  const sum = exps.reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  scores.forEach((s, i) => {
    out[s.symbol] = exps[i]! / sum;
  });
  return out;
}

/**
 * Blend TA-suggested weights with the user's initial weights.
 * bias = 0 → ignore TA, bias = 1 → pure TA.
 */
export function blendWeights(
  initial: Record<string, number>,
  taSuggested: Record<string, number>,
  bias: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const symbol of Object.keys(initial)) {
    const ti = initial[symbol] ?? 0;
    const ta = taSuggested[symbol] ?? 0;
    out[symbol] = ti * (1 - bias) + ta * bias;
  }
  // Normalize to sum to 1 (in case of floating-point drift)
  const sum = Object.values(out).reduce((a, b) => a + b, 0);
  if (sum === 0) return initial;
  for (const k of Object.keys(out)) out[k] = out[k]! / sum;
  return out;
}
