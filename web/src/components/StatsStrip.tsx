/**
 * Top-of-dashboard stats hero. Aggregates totals across all baskets so the
 * user gets the "is everything OK" answer at a glance, without clicking
 * each card.
 *
 * Data is fetched by the parent (Dashboard) and passed down — see comment
 * in Dashboard.tsx about why we lifted it.
 */

import { Activity, Briefcase, Clock, TrendingUp } from "lucide-react";
import type { Basket, Portfolio, RebalanceResult } from "../api.ts";
import { fmtUsd, fmtRelative } from "../utils/format.ts";

interface Props {
  baskets: Basket[];
  portfolios: Record<string, Portfolio>;
  rebalanceHistories: Record<string, RebalanceResult[]>;
}

export default function StatsStrip({ baskets, portfolios, rebalanceHistories }: Props) {
  const totalUsd = Object.values(portfolios).reduce((sum, p) => sum + (p?.totalUsd ?? 0), 0);
  const activeBaskets = baskets.filter((b) => b.enabled).length;

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const allRebalances = Object.values(rebalanceHistories).flat();
  const realRebalances = allRebalances.filter(
    (r) => r.guardOutcome.allow && r.swaps.length > 0,
  );
  const rebalances24h = realRebalances.filter(
    (r) => new Date(r.startedAt).getTime() > dayAgo,
  ).length;
  const lastRebalance = realRebalances
    .map((r) => r.startedAt)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
      <Tile
        label="Total portfolio"
        value={fmtUsd(totalUsd)}
        icon={<TrendingUp className="w-4 h-4" />}
        accent
      />
      <Tile
        label="Baskets"
        value={`${activeBaskets}/${baskets.length}`}
        sublabel={baskets.length > 0 ? "active" : undefined}
        icon={<Briefcase className="w-4 h-4" />}
      />
      <Tile
        label="Rebalances · 24h"
        value={String(rebalances24h)}
        icon={<Activity className="w-4 h-4" />}
      />
      <Tile
        label="Last rebalance"
        value={lastRebalance ? fmtRelative(lastRebalance) : "—"}
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
