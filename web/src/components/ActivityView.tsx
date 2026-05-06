import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowRight, AlertCircle, Check, X as XIcon, ExternalLink, RefreshCw } from "lucide-react";
import { api, type Basket, type RebalanceResult } from "../api.ts";
import { fmtUsd, fmtRelative } from "../utils/format.ts";

interface Row extends RebalanceResult {
  basketName: string;
  basketChain: "solana" | "base";
}

type Filter = "all" | "swaps" | "denied" | "no-action";

export default function ActivityView({ baskets }: { baskets: Basket[] }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [activeBasket, setActiveBasket] = useState<string>("all");

  const refresh = async () => {
    setLoading(true);
    try {
      const all = await Promise.all(
        baskets.map(async (b) => {
          try {
            const r = await api.listRebalances(b.id, 50);
            return r.rebalances.map<Row>((reb) => ({
              ...reb,
              basketName: b.name,
              basketChain: b.chain,
            }));
          } catch {
            return [];
          }
        }),
      );
      const flat = all.flat().sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      );
      setRows(flat);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    return rows.filter((r) => {
      if (activeBasket !== "all" && r.basketId !== activeBasket) return false;
      if (filter === "swaps") return r.guardOutcome.allow && r.swaps.length > 0;
      if (filter === "denied") return !r.guardOutcome.allow;
      if (filter === "no-action") return r.guardOutcome.allow && r.swaps.length === 0;
      return true;
    });
  }, [rows, filter, activeBasket]);

  const explorerUrl = (chain: "solana" | "base", hash: string) =>
    chain === "solana" ? `https://solscan.io/tx/${hash}` : `https://basescan.org/tx/${hash}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Activity className="w-5 h-5 text-accent" /> Activity
        </h2>
        <button
          onClick={refresh}
          disabled={loading}
          className="bg-ink-700 hover:bg-ink-600 disabled:opacity-50 text-sm rounded-lg px-3 py-2 flex items-center gap-2 transition"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 text-xs">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>All</FilterChip>
        <FilterChip active={filter === "swaps"} onClick={() => setFilter("swaps")}>Swaps</FilterChip>
        <FilterChip active={filter === "denied"} onClick={() => setFilter("denied")}>Denied</FilterChip>
        <FilterChip active={filter === "no-action"} onClick={() => setFilter("no-action")}>No action</FilterChip>
        <div className="w-px h-5 bg-ink-700 mx-1" />
        <select
          value={activeBasket}
          onChange={(e) => setActiveBasket(e.target.value)}
          className="bg-ink-800 border border-ink-700 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-accent"
        >
          <option value="all">All baskets</option>
          {baskets.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>

      {filtered === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-ink-800 border border-ink-700 rounded-xl p-4 h-20 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-dashed border-ink-600 rounded-xl p-12 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-ink-700 flex items-center justify-center">
            <Activity className="w-5 h-5 text-ink-400" />
          </div>
          <div className="text-ink-300 mb-1">Nothing yet</div>
          <p className="text-xs text-ink-400 max-w-sm mx-auto">
            Activity shows up here every time the cron fires or you trigger Rebalance now.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r, idx) => (
            <div key={idx} className="bg-ink-800 border border-ink-700 rounded-xl overflow-hidden">
              <div className="flex items-start gap-3 p-4">
                <StatusIcon row={r} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="font-medium text-sm truncate">
                      {r.basketName}
                      <span className="text-ink-400 font-normal text-xs ml-2 capitalize">{r.basketChain}</span>
                    </div>
                    <span className="text-xs text-ink-400 shrink-0 tabular-nums">{fmtRelative(r.startedAt)}</span>
                  </div>
                  <RowSummary row={r} explorerUrl={explorerUrl} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-md transition border ${
        active
          ? "bg-accent text-white border-accent"
          : "bg-ink-800 border-ink-700 text-ink-300 hover:bg-ink-700"
      }`}
    >
      {children}
    </button>
  );
}

function StatusIcon({ row }: { row: Row }) {
  if (!row.guardOutcome.allow) {
    return (
      <div className="w-8 h-8 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
        <AlertCircle className="w-4 h-4 text-amber-400" />
      </div>
    );
  }
  if (row.swaps.length === 0) {
    return (
      <div className="w-8 h-8 rounded-full bg-ink-700 border border-ink-600 flex items-center justify-center shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-ink-400" />
      </div>
    );
  }
  const anyError = row.swaps.some((s) => s.error);
  return (
    <div
      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${
        anyError ? "bg-red-500/10 border-red-500/30" : "bg-emerald-500/10 border-emerald-500/30"
      }`}
    >
      {anyError ? <XIcon className="w-4 h-4 text-red-400" /> : <Check className="w-4 h-4 text-emerald-400" />}
    </div>
  );
}

function RowSummary({
  row,
  explorerUrl,
}: {
  row: Row;
  explorerUrl: (chain: "solana" | "base", hash: string) => string;
}) {
  if (!row.guardOutcome.allow) {
    return <div className="text-xs text-amber-400/90 leading-relaxed">{row.guardOutcome.reason}</div>;
  }
  if (row.swaps.length === 0) {
    return <div className="text-xs text-ink-400">No action — basket within tolerance</div>;
  }
  return (
    <div className="space-y-1">
      {row.swaps.map((s, i) => (
        <div key={i} className="text-xs flex items-center gap-2 text-ink-300">
          <span className="font-medium">{s.plan.fromToken}</span>
          <ArrowRight className="w-3 h-3 text-ink-500" />
          <span className="font-medium">{s.plan.toToken}</span>
          <span className="text-ink-400 tabular-nums">{fmtUsd(s.plan.estimatedUsd)}</span>
          {s.error ? (
            <span className="text-red-400 ml-1 truncate">· {s.error.split("\n")[0]?.slice(0, 80) ?? "failed"}</span>
          ) : s.txHash ? (
            <a
              href={explorerUrl(row.basketChain, s.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:text-white inline-flex items-center gap-1 ml-1"
            >
              <code className="font-mono text-[10px]">{s.txHash.slice(0, 8)}…</code>
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
}
