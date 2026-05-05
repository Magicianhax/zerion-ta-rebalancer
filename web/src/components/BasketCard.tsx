import { useEffect, useState } from "react";
import { Pause, Play, RefreshCw, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { api, type Basket, type RebalanceResult } from "../api.ts";

export default function BasketCard({ basket, onChange }: { basket: Basket; onChange: () => void }) {
  const [history, setHistory] = useState<RebalanceResult[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.listRebalances(basket.id, 5).then((r) => alive && setHistory(r.rebalances)).catch(() => {});
    return () => { alive = false; };
  }, [basket.id]);

  const last = history?.[0];

  const trigger = async () => {
    setBusy(true);
    try { await api.rebalance(basket.id); onChange(); } catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
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
    try { await api.deleteBasket(basket.id); onChange(); } finally { setBusy(false); }
  };

  return (
    <div className="bg-ink-800 border border-ink-700 rounded-xl overflow-hidden">
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-semibold text-base">{basket.name}</h3>
            <div className="text-xs text-ink-400 mt-0.5">
              {basket.chain} · ${basket.budgetUsd.toFixed(0)} budget · {basket.tokens.length} tokens
            </div>
          </div>
          <div className={`text-xs px-2 py-0.5 rounded-full ${basket.enabled ? "bg-emerald-900/40 text-emerald-300" : "bg-ink-700 text-ink-400"}`}>
            {basket.enabled ? "active" : "paused"}
          </div>
        </div>

        <div className="space-y-1.5">
          {basket.tokens.map((t) => {
            const current = last?.proposal.currentWeights[t.symbol.toUpperCase()] ?? 0;
            const target = last?.proposal.targetWeights[t.symbol.toUpperCase()] ?? t.initialWeight;
            return (
              <div key={t.symbol} className="text-xs">
                <div className="flex justify-between mb-0.5">
                  <span className="font-mono text-ink-200">{t.symbol}</span>
                  <span className="text-ink-400">
                    {(current * 100).toFixed(1)}% → <span className="text-accent">{(target * 100).toFixed(1)}%</span>
                  </span>
                </div>
                <div className="h-1.5 bg-ink-700 rounded-full overflow-hidden">
                  <div className="h-full bg-accent transition-all" style={{ width: `${target * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        {last && (
          <div className="mt-4 pt-4 border-t border-ink-700 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-ink-400">Last tick: {new Date(last.startedAt).toLocaleString()}</span>
              <span className={last.guardOutcome.allow ? "text-emerald-400" : "text-amber-400"}>
                {last.guardOutcome.allow ? `${last.swaps.length} swap(s)` : "denied"}
              </span>
            </div>
            {!last.guardOutcome.allow && (
              <p className="text-amber-400/80 mt-1">{last.guardOutcome.reason}</p>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={trigger}
            disabled={busy}
            className="flex-1 bg-ink-700 hover:bg-ink-600 disabled:opacity-50 text-sm rounded-lg py-2 px-3 flex items-center justify-center gap-2 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} /> Rebalance now
          </button>
          <button
            onClick={togglePause}
            disabled={busy}
            className="bg-ink-700 hover:bg-ink-600 disabled:opacity-50 rounded-lg p-2 transition"
            title={basket.enabled ? "Pause" : "Resume"}
          >
            {basket.enabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="bg-ink-700 hover:bg-ink-600 rounded-lg p-2 transition"
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={remove}
            disabled={busy}
            className="bg-ink-700 hover:bg-red-900/40 hover:text-red-300 disabled:opacity-50 rounded-lg p-2 transition"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {expanded && history && (
        <div className="border-t border-ink-700 bg-ink-900/40 p-5">
          <h4 className="text-xs uppercase tracking-wide text-ink-400 mb-3">Recent rebalances</h4>
          {history.length === 0 ? (
            <p className="text-xs text-ink-400">No rebalances yet.</p>
          ) : (
            <div className="space-y-2">
              {history.map((r, i) => (
                <div key={i} className="text-xs flex items-center justify-between border border-ink-700 rounded-lg px-3 py-2">
                  <span className="text-ink-300">{new Date(r.startedAt).toLocaleString()}</span>
                  <span className={r.guardOutcome.allow ? "text-emerald-400" : "text-amber-400"}>
                    {r.guardOutcome.allow ? `${r.swaps.length} swap(s)` : "denied"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
