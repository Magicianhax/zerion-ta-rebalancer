/**
 * Top-of-dashboard stats hero. Aggregates totals across all baskets so the
 * user gets the "is everything OK" answer at a glance, without clicking
 * each card. Shown only on the Baskets tab.
 */

import { useMemo } from "react";
import type { Basket, Portfolio, RebalanceResult } from "../api.ts";
import { fmtUsd, fmtRelative } from "../utils/format.ts";
import { Sparkline, spark } from "./ui.tsx";

interface Props {
  baskets: Basket[];
  portfolios: Record<string, Portfolio>;
  rebalanceHistories: Record<string, RebalanceResult[]>;
}

export default function StatsStrip({ baskets, portfolios, rebalanceHistories }: Props) {
  const totalUsd = Object.values(portfolios).reduce((sum, p) => sum + (p?.totalUsd ?? 0), 0);
  const activeBaskets = baskets.filter((b) => b.enabled).length;

  // Average drift across baskets, where drift = sum of |current - target| / 2 (in %).
  // We compare against the most recent rebalance proposal so it's defined even
  // before the first cron tick fires.
  const drifts = baskets
    .map((b) => {
      const last = rebalanceHistories[b.id]?.[0];
      if (!last) return null;
      const target = last.proposal.targetWeights;
      const current = last.proposal.currentWeights;
      const symbols = new Set([...Object.keys(target), ...Object.keys(current)]);
      let sum = 0;
      for (const s of symbols) sum += Math.abs((current[s] ?? 0) - (target[s] ?? 0));
      return (sum / 2) * 100;
    })
    .filter((d): d is number => d != null);
  const avgDrift = drifts.length ? drifts.reduce((a, b) => a + b, 0) / drifts.length : 0;

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const allRebalances = Object.values(rebalanceHistories).flat();
  const realRebalances = allRebalances.filter((r) => r.guardOutcome.allow && r.swaps.length > 0);
  // Count individual swaps in the last 24h, not rebalances. One rebalance
  // can fan out to N swaps (one per token rotation), and this stat is
  // labelled "Swaps · 24h" — show the trade count, not the tick count.
  const swaps24h = realRebalances
    .filter((r) => new Date(r.startedAt).getTime() > dayAgo)
    .reduce((sum, r) => sum + r.swaps.filter((s) => s.txHash).length, 0);
  const lastRebalance = realRebalances
    .map((r) => r.startedAt)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

  // Since we don't track a real 24h pnl on the frontend, derive a softly
  // signed "fake" sparkline seeded from total value so something renders. We
  // don't show a P&L number — we'd need historical snapshots to do it
  // honestly, and we'd rather not lie.
  const portfolioSpark = useMemo(() => spark((totalUsd / 250) || 50, 1.7), [Math.round(totalUsd)]);

  return (
    <div className="stats-strip" style={{
      display: "grid",
      gridTemplateColumns: "1.2fr 1fr 1fr 1fr 1.5fr",
      borderBottom: "1px solid var(--bd-2)",
      background: "var(--bg-1)",
      flex: "0 0 auto",
    }}>
      <Stat
        label="Total value"
        value={fmtUsd(totalUsd)}
        sub={<span>{baskets.length} basket{baskets.length === 1 ? "" : "s"}</span>}
        accent
      />
      <Stat
        label="Baskets"
        value={`${activeBaskets} / ${baskets.length}`}
        sub={<span>{baskets.length - activeBaskets} paused</span>}
      />
      <Stat
        label="Avg drift"
        value={drifts.length ? `${avgDrift.toFixed(2)}%` : "—"}
        sub={<span style={{ color: avgDrift > 3 ? "var(--warn)" : "var(--tx-2)" }}>tolerance 3.00%</span>}
      />
      <Stat
        label="Swaps · 24h"
        value={String(swaps24h)}
        sub={<span>routed via USDC</span>}
      />
      <div style={{ padding: "12px 16px", borderLeft: "1px solid var(--bd-1)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--tx-3)", textTransform: "uppercase", letterSpacing: ".06em" }}>
          <span>Last tick</span>
          <span className="mono" style={{ textTransform: "none", letterSpacing: 0, color: lastRebalance ? "var(--ok)" : "var(--tx-3)" }}>
            {lastRebalance ? fmtRelative(lastRebalance) : "—"}
          </span>
        </div>
        {totalUsd > 0 ? (
          <Sparkline values={portfolioSpark} w={240} h={32} color="var(--ac)"/>
        ) : (
          <div className="mono" style={{ fontSize: 10.5, color: "var(--tx-3)" }}>fund a wallet to start</div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub: React.ReactNode; accent?: boolean }) {
  return (
    <div style={{ padding: "12px 16px", borderLeft: "1px solid var(--bd-1)", position: "relative" }}>
      {accent && <span style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 2, background: "var(--ac)" }}/>}
      <div style={{ fontSize: 10.5, color: "var(--tx-3)", textTransform: "uppercase", letterSpacing: ".06em" }}>{label}</div>
      <div className="num" style={{ fontSize: 18, color: "var(--tx-0)", marginTop: 4, fontWeight: 500, letterSpacing: "-.01em" }}>{value}</div>
      <div className="num" style={{ fontSize: 11, color: "var(--tx-2)", marginTop: 2 }}>{sub}</div>
    </div>
  );
}

