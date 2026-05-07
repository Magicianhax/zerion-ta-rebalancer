import { useMemo, useState } from "react";
import { api, type Basket, type Portfolio, type RebalanceResult } from "../api.ts";
import { fmtUsd, fmtRelative } from "../utils/format.ts";
import {
  ChainBadge, ColCell, DriftBar, Icon, IconBtn,
  Tag, TaScore, TokenChip, WeightBar, GuardRow,
  AllocationDonut, ActionDot,
  type ActionKind,
} from "./ui.tsx";
import PolicyCard from "./PolicyCard.tsx";
import type { AllocStage } from "./FirstAllocOverlay.tsx";

interface Props {
  basket: Basket;
  portfolio?: Portfolio;
  history?: RebalanceResult[];
  expanded: boolean;
  onToggle: () => void;
  onRefreshBasket: () => Promise<void>;
  onChange: () => void;
  firstAllocStage: AllocStage | null;
}

const DRIFT_TOLERANCE = 3.0;

export default function BasketCard({
  basket, portfolio, history, expanded,
  onToggle, onRefreshBasket, onChange, firstAllocStage,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const last = history?.[0];

  // Drift % across the basket: sum |current - target| / 2.
  const drift = useMemo(() => {
    if (!last) return 0;
    const target = last.proposal.targetWeights;
    const current = last.proposal.currentWeights;
    const symbols = new Set([...Object.keys(target), ...Object.keys(current)]);
    let sum = 0;
    for (const s of symbols) sum += Math.abs((current[s] ?? 0) - (target[s] ?? 0));
    return (sum / 2) * 100;
  }, [last]);

  const tone: "ok" | "warn" | "paused" =
    !basket.enabled ? "paused" :
    last && !last.guardOutcome.allow ? "warn" :
    drift > DRIFT_TOLERANCE ? "warn" : "ok";

  const refreshBalance = async () => {
    setRefreshing(true);
    try { await onRefreshBasket(); }
    finally { setRefreshing(false); }
  };

  const trigger = async () => {
    setBusy(true);
    try {
      await api.rebalance(basket.id);
      await onRefreshBasket();
      onChange();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const togglePause = async () => {
    setBusy(true);
    try {
      if (basket.enabled) await api.pauseBasket(basket.id);
      else await api.resumeBasket(basket.id);
      onChange();
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!confirm(`Delete basket "${basket.name}"? This does not touch your wallet — just removes it from the dashboard.`)) return;
    setBusy(true);
    try {
      await api.deleteBasket(basket.id);
      onChange();
    } finally { setBusy(false); }
  };

  const lastAction: ActionKind = !last
    ? "no-action"
    : !last.guardOutcome.allow
    ? "denied"
    : last.swaps.some((s) => s.error)
    ? "error"
    : last.swaps.length > 0
    ? "swaps"
    : "no-action";

  const accentColor =
    tone === "ok" ? "var(--ac)" :
    tone === "warn" ? "var(--warn)" :
    "var(--tx-3)";

  return (
    <article style={{
      border: "1px solid var(--bd-2)", borderRadius: 5,
      background: "var(--bg-1)", overflow: "hidden", position: "relative",
    }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: accentColor }}/>

      {/* Header row */}
      <div
        className="basket-header"
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr auto",
          alignItems: "center",
          padding: "12px 16px", gap: 12, cursor: "pointer",
        }}
        onClick={onToggle}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <Icon name={expanded ? "chevron-down" : "chevron-right"} size={12}/>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14, color: "var(--tx-0)", fontWeight: 600, letterSpacing: "-.01em" }}>{basket.name}</span>
              <ChainBadge chain={basket.chain} size="sm"/>
              {tone === "paused" && <Tag tone="muted">paused</Tag>}
              {tone === "warn" && <Tag tone="warn">drift</Tag>}
              {tone === "ok" && <Tag tone="accent">healthy</Tag>}
            </div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--tx-3)" }}>
              {basket.id} · {basket.tokens.length} tokens · 1h · bias {basket.taBias.toFixed(2)}
            </div>
          </div>
        </div>

        <ColCell
          label="Value"
          main={portfolio ? fmtUsd(portfolio.totalUsd) : "—"}
          sub={<span style={{ color: "var(--tx-2)" }}>{fmtUsd(basket.budgetUsd)} budget</span>}
        />

        <ColCell
          label="Drift"
          main={
            <span style={{ color: drift > DRIFT_TOLERANCE ? "var(--warn)" : "var(--tx-0)" }}>
              {last ? `${drift.toFixed(2)}%` : "—"}
            </span>
          }
          sub={<DriftBar pct={drift / DRIFT_TOLERANCE}/>}
        />

        <ColCell
          label="Last rebalance"
          main={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ActionDot a={lastAction}/>
              <span className="mono" style={{ fontSize: 12, color: "var(--tx-0)" }}>
                {last
                  ? lastAction === "swaps"
                    ? `${last.swaps.length} swap${last.swaps.length > 1 ? "s" : ""}`
                    : lastAction
                  : "queued"}
              </span>
            </span>
          }
          sub={<span style={{ color: "var(--tx-2)" }}>{last ? fmtRelative(last.startedAt) : "—"}</span>}
        />

        <ColCell
          label="Next tick"
          main={
            <span className="mono" style={{ fontSize: 12, color: !basket.enabled ? "var(--tx-3)" : "var(--tx-0)" }}>
              {basket.enabled ? "next hour" : "paused"}
            </span>
          }
          sub={<span className="mono" style={{ color: "var(--tx-3)" }}>cron · 1h</span>}
        />

        <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
          <IconBtn icon="refresh" title="Refresh balance" onClick={refreshBalance} disabled={refreshing}/>
          <IconBtn icon={basket.enabled ? "pause" : "play"} title={basket.enabled ? "Pause" : "Resume"} onClick={togglePause} active={!basket.enabled} disabled={busy}/>
          <IconBtn icon="bolt" title="Rebalance now" onClick={trigger} disabled={busy}/>
          <IconBtn icon="trash" title="Delete" onClick={remove} disabled={busy}/>
        </div>
      </div>

      {expanded && (
        <div className="fade-in" style={{ borderTop: "1px solid var(--bd-1)", background: "var(--bg-2)" }}>
          {firstAllocStage && <FirstAllocStrip stage={firstAllocStage}/>}
          <div className="basket-expanded" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 280px", gap: 0 }}>
            <BasketTokenTable basket={basket} portfolio={portfolio} history={history}/>
            <SidePanel basket={basket} drift={drift} history={history}/>
          </div>
        </div>
      )}
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/*  Token table                                                               */
/* -------------------------------------------------------------------------- */
function BasketTokenTable({ basket, portfolio, history }: { basket: Basket; portfolio?: Portfolio; history?: RebalanceResult[] }) {
  const last = history?.[0];
  const rows = basket.tokens.map((t) => {
    const sym = t.symbol.toUpperCase();
    const target = (last?.proposal.targetWeights[sym] ?? t.initialWeight) * 100;
    const current = (portfolio?.currentWeights[sym] ?? last?.proposal.currentWeights[sym] ?? 0) * 100;
    const score = last?.proposal.scores.find((s) => s.symbol.toUpperCase() === sym);
    const ta = Math.round(score?.score ?? 50);
    const value = portfolio?.byToken[sym] ?? 0;
    return { sym, target, current, delta: current - target, ta, value };
  });

  const cols = "1.6fr 80px 90px 90px 1fr 90px 110px";

  return (
    <div>
      <div className="t-row t-head" style={{ gridTemplateColumns: cols }}>
        <span>Token</span>
        <span style={{ textAlign: "right" }}>Target</span>
        <span style={{ textAlign: "right" }}>Current</span>
        <span style={{ textAlign: "right" }}>Δ</span>
        <span/>
        <span style={{ textAlign: "right" }}>TA score</span>
        <span style={{ textAlign: "right" }}>Value</span>
      </div>
      {rows.map((r) => (
        <TokenRow key={r.sym} row={r} cols={cols}/>
      ))}
      <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, borderTop: "1px solid var(--bd-1)" }}>
        <span style={{ fontSize: 10.5, color: "var(--tx-3)", textTransform: "uppercase", letterSpacing: ".06em" }}>Last</span>
        <span className="mono" style={{ fontSize: 11.5, color: "var(--tx-1)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {last && !last.guardOutcome.allow
            ? last.guardOutcome.reason
            : last && last.swaps.length === 0
            ? "Within tolerance"
            : last && last.swaps.length > 0
            ? `${last.swaps.length} swap${last.swaps.length > 1 ? "s" : ""} executed`
            : "First allocation pending"}
        </span>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--tx-3)" }}>
          {last ? fmtRelative(last.startedAt) : "—"}
        </span>
      </div>
    </div>
  );
}

function TokenRow({ row, cols }: {
  row: { sym: string; target: number; current: number; delta: number; ta: number; value: number };
  cols: string;
}) {
  return (
    <div className="t-row" style={{ gridTemplateColumns: cols }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <TokenChip sym={row.sym} size={20}/>
        <span className="mono" style={{ color: "var(--tx-0)", fontSize: 12, fontWeight: 600 }}>{row.sym}</span>
      </div>
      <span className="num" style={{ textAlign: "right", color: "var(--tx-1)" }}>{row.target.toFixed(1)}%</span>
      <span className="num" style={{ textAlign: "right", color: "var(--tx-0)" }}>{row.current.toFixed(1)}%</span>
      <span className="num" style={{ textAlign: "right", color: Math.abs(row.delta) > 1 ? "var(--warn)" : "var(--tx-2)" }}>
        {row.delta > 0 ? "+" : ""}{row.delta.toFixed(1)}
      </span>
      <WeightBar target={row.target} current={row.current}/>
      <div style={{ textAlign: "right", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
        <TaScore score={row.ta}/>
      </div>
      <span className="num" style={{ textAlign: "right", color: "var(--tx-1)" }}>{fmtUsd(row.value)}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Side panel — donut + guards + OWS                                         */
/* -------------------------------------------------------------------------- */
function SidePanel({ basket, drift, history }: { basket: Basket; drift: number; history?: RebalanceResult[] }) {
  const last = history?.[0];

  // Trades-per-day count (rough): real (allow + swaps>0) rebalances in last 24h.
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const tradesToday = (history ?? []).filter(
    (r) => r.guardOutcome.allow && r.swaps.length > 0 && new Date(r.startedAt).getTime() > dayAgo,
  ).length;

  // Cooldown — minutes since the last rebalance attempt.
  const cooldownMin = last
    ? Math.max(0, Math.round((Date.now() - new Date(last.startedAt).getTime()) / 60000))
    : 0;

  const slices = basket.tokens.map((t) => ({
    sym: t.symbol.toUpperCase(),
    weight: (last?.proposal.targetWeights[t.symbol.toUpperCase()] ?? t.initialWeight) * 100,
  }));

  return (
    <div style={{ borderLeft: "1px solid var(--bd-1)", padding: 16 }}>
      <div style={{ fontSize: 10.5, color: "var(--tx-3)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>
        Allocation
      </div>
      <AllocationDonut slices={slices}/>

      <div style={{ marginTop: 14, fontSize: 10.5, color: "var(--tx-3)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>
        Guards
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <GuardRow name={`drift ≤ ${DRIFT_TOLERANCE.toFixed(2)}%`} status={drift <= DRIFT_TOLERANCE ? "ok" : "warn"} value={`${drift.toFixed(2)}%`}/>
        <GuardRow name="cooldown ≥ 15m" status={cooldownMin >= 15 || !last ? "ok" : "warn"} value={last ? `${cooldownMin}m` : "—"}/>
        <GuardRow name="trades/day ≤ 12" status={tradesToday <= 12 ? "ok" : "warn"} value={`${tradesToday} / 12`}/>
        <GuardRow name="quote = USDC" status="ok" value={basket.quoteToken}/>
      </div>

      <div style={{
        marginTop: 14, fontSize: 10.5, color: "var(--tx-3)",
        textTransform: "uppercase", letterSpacing: ".06em",
        marginBottom: 6, display: "flex", justifyContent: "space-between",
      }}>
        <span>OWS policy</span>
        <span style={{ color: "var(--ac)", textTransform: "none", letterSpacing: 0, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Icon name="shield" size={10}/> with keys
        </span>
      </div>
      <PolicyCard policyId={basket.policyId}/>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  First-allocation strip — banner inside the expanded card while the        */
/*  initial swap pipeline runs.                                               */
/* -------------------------------------------------------------------------- */
function FirstAllocStrip({ stage }: { stage: AllocStage }) {
  const stages: Array<{ k: AllocStage; label: string }> = [
    { k: "queued",   label: "Queued for first allocation" },
    { k: "quoting",  label: "Computing TA scores · routing quotes" },
    { k: "signing",  label: "Signing through OWS policy…" },
    { k: "swapping", label: "Submitting swaps to RPC" },
    { k: "settling", label: "Settling on-chain" },
    { k: "done",     label: "Allocation complete" },
  ];
  const idx = Math.max(0, stages.findIndex((s) => s.k === stage));
  return (
    <div className="fade-in" style={{
      padding: "10px 16px", borderBottom: "1px solid var(--bd-1)",
      background: "color-mix(in oklab, var(--ac) 6%, var(--bg-2))",
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <span className="dot-pulse" style={{ width: 8, height: 8, borderRadius: 999, background: "var(--ac)", boxShadow: "0 0 10px var(--ac)" }}/>
      <span className="mono" style={{ fontSize: 11.5, color: "var(--tx-0)" }}>{stages[idx]?.label}</span>
      <div style={{ flex: 1, display: "flex", gap: 4 }}>
        {stages.map((s, i) => (
          <div key={s.k} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: i <= idx ? "var(--ac)" : "var(--bd-2)",
            transition: "background .3s",
          }}/>
        ))}
      </div>
      <span className="mono" style={{ fontSize: 10.5, color: "var(--tx-3)" }}>{idx + 1}/{stages.length}</span>
    </div>
  );
}
