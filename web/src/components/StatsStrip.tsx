/**
 * Top-of-dashboard stats hero. Aggregates totals across all baskets so the
 * user gets the "is everything OK" answer at a glance, without clicking
 * each card.
 */

import { useEffect, useState } from "react";
import { Activity, Briefcase, Clock, TrendingUp } from "lucide-react";
import { api, type Basket, type RebalanceResult } from "../api.ts";
import { fmtUsd, fmtRelative } from "../utils/format.ts";

interface Stats {
  totalUsd: number;
  activeBaskets: number;
  totalBaskets: number;
  rebalances24h: number;
  lastRebalanceAt: string | null;
}

export default function StatsStrip({ baskets }: { baskets: Basket[] }) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      // Fetch portfolios + recent rebalances per basket in parallel
      const results = await Promise.all(
        baskets.map(async (b) => {
          const [pf, rb] = await Promise.all([
            api.getPortfolio(b.id).catch(() => null),
            api.listRebalances(b.id, 50).catch(() => null),
          ]);
          return { basket: b, portfolio: pf?.portfolio, rebalances: rb?.rebalances ?? [] };
        }),
      );
      if (!alive) return;

      const totalUsd = results.reduce((sum, r) => sum + (r.portfolio?.totalUsd ?? 0), 0);
      const activeBaskets = baskets.filter((b) => b.enabled).length;
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const allRebalances: RebalanceResult[] = results.flatMap((r) => r.rebalances);
      const rebalances24h = allRebalances.filter(
        (r) => new Date(r.startedAt).getTime() > dayAgo && r.guardOutcome.allow && r.swaps.length > 0,
      ).length;
      const lastReal = allRebalances
        .filter((r) => r.guardOutcome.allow && r.swaps.length > 0)
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];

      setStats({
        totalUsd,
        activeBaskets,
        totalBaskets: baskets.length,
        rebalances24h,
        lastRebalanceAt: lastReal?.startedAt ?? null,
      });
    }
    if (baskets.length > 0) load();
    else setStats({ totalUsd: 0, activeBaskets: 0, totalBaskets: 0, rebalances24h: 0, lastRebalanceAt: null });
    return () => { alive = false; };
  }, [baskets]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
      <Tile
        label="Total portfolio"
        value={stats ? fmtUsd(stats.totalUsd) : "—"}
        icon={<TrendingUp className="w-4 h-4" />}
        accent
      />
      <Tile
        label="Baskets"
        value={stats ? `${stats.activeBaskets}/${stats.totalBaskets}` : "—"}
        sublabel={stats && stats.totalBaskets > 0 ? "active" : undefined}
        icon={<Briefcase className="w-4 h-4" />}
      />
      <Tile
        label="Rebalances · 24h"
        value={stats ? String(stats.rebalances24h) : "—"}
        icon={<Activity className="w-4 h-4" />}
      />
      <Tile
        label="Last rebalance"
        value={stats?.lastRebalanceAt ? fmtRelative(stats.lastRebalanceAt) : "—"}
        icon={<Clock className="w-4 h-4" />}
      />
    </div>
  );
}

function Tile({
  label,
  value,
  sublabel,
  icon,
  accent,
}: {
  label: string;
  value: string;
  sublabel?: string;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 transition ${
        accent
          ? "bg-gradient-to-br from-accent/15 to-transparent border-accent/30"
          : "bg-ink-800 border-ink-700"
      }`}
    >
      <div className="flex items-center gap-2 text-xs text-ink-400 mb-2">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
        {sublabel && <div className="text-xs text-ink-400">{sublabel}</div>}
      </div>
    </div>
  );
}
