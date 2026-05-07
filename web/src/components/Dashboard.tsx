import { useEffect, useMemo, useState } from "react";
import {
  LogOut,
  Plus,
  Settings as SettingsIcon,
  Activity as ActivityIcon,
  Wallet as WalletIcon,
  LayoutGrid,
  Briefcase,
} from "lucide-react";
import { api, type Basket, type Portfolio, type RebalanceResult } from "../api.ts";
import BasketCard from "./BasketCard.tsx";
import NewBasketModal from "./NewBasketModal.tsx";
import SettingsPanel from "./SettingsPanel.tsx";
import WalletView, { type WalletData } from "./WalletView.tsx";
import StatsStrip from "./StatsStrip.tsx";
import ActivityView from "./ActivityView.tsx";
import { BasketCardSkeleton } from "./Skeleton.tsx";

type Tab = "baskets" | "wallet" | "activity";

interface Props {
  baskets: Basket[] | null;
  lastEvent: { type: string; payload: any } | null;
  onRefresh: () => void;
  onLogout: () => void;
}

export default function Dashboard({ baskets, lastEvent, onRefresh, onLogout }: Props) {
  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [tab, setTab] = useState<Tab>("baskets");

  // ── Per-basket data lifted to parent ──────────────────────────────
  // Both StatsStrip (for aggregate stats) and BasketCard (for per-card
  // display) need the same per-basket portfolio + rebalance history.
  // Fetching from each component caused duplicate network calls on every
  // mount. Lifting here means one fetch per basket per dependency change.
  const [portfolios, setPortfolios] = useState<Record<string, Portfolio>>({});
  const [rebalanceHistories, setRebalanceHistories] = useState<Record<string, RebalanceResult[]>>({});

  const refreshBasketData = async (basketId: string) => {
    const [pf, rb] = await Promise.all([
      api.getPortfolio(basketId).catch(() => null),
      api.listRebalances(basketId, 50).catch(() => null),
    ]);
    if (pf) setPortfolios((prev) => ({ ...prev, [basketId]: pf.portfolio }));
    if (rb) setRebalanceHistories((prev) => ({ ...prev, [basketId]: rb.rebalances }));
  };

  // Fetch on basket list change (initial load, basket created/deleted).
  // The cache in api.ts dedupes if the same basket data was already fetched
  // within the TTL window, so this is cheap on re-renders.
  const basketIdsKey = useMemo(() => baskets?.map((b) => b.id).join(",") ?? "", [baskets]);
  useEffect(() => {
    if (!baskets) return;
    for (const b of baskets) refreshBasketData(b.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basketIdsKey]);

  // SSE rebalance:done events arrive with the basket id — refresh just
  // that basket's data so the dashboard reflects post-trade balances.
  useEffect(() => {
    if (lastEvent?.type === "rebalance:done") {
      const basketId = (lastEvent.payload as { basketId?: string })?.basketId;
      if (basketId) refreshBasketData(basketId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent]);

  // Wallet data lifted to parent so tab switches don't refetch.
  const [wallets, setWallets] = useState<WalletData[] | null>(null);
  const [walletsLoading, setWalletsLoading] = useState(false);

  const refreshWallets = async () => {
    setWalletsLoading(true);
    try {
      const list = await api.listWallets();
      const enriched = await Promise.all(
        list.wallets.map(async (info) => {
          try {
            const r = await api.walletHoldings(info.name);
            return {
              info,
              totalUsd: r.totalUsd,
              holdings: r.holdings,
              errors: r.errors,
              fetchedAt: r.fetchedAt,
            };
          } catch (e: any) {
            return {
              info,
              totalUsd: 0,
              holdings: [],
              errors: [e.message],
              fetchedAt: null,
            };
          }
        }),
      );
      setWallets(enriched);
    } catch {
      setWallets([]);
    } finally {
      setWalletsLoading(false);
    }
  };

  useEffect(() => {
    if (tab === "wallet" && wallets === null && !walletsLoading) refreshWallets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Global keyboard shortcuts — Cmd/Ctrl+K opens New Basket modal.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowNew(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const liveStatus =
    lastEvent?.type === "rebalance:start"
      ? { label: "Rebalancing now", color: "text-amber-400" }
      : lastEvent?.type === "rebalance:done"
      ? { label: "Idle · last just now", color: "text-ink-400" }
      : { label: "Idle", color: "text-ink-400" };

  return (
    <div className="min-h-full flex">
      {/* Sidebar */}
      <aside className="hidden md:flex w-56 flex-col border-r border-ink-700 bg-ink-900/40">
        <div className="px-5 py-5 border-b border-ink-700">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-accent-dim flex items-center justify-center shadow-md shadow-accent/20">
              <ActivityIcon className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-tight">Zerion TA</div>
              <div className={`text-[11px] truncate ${liveStatus.color}`}>{liveStatus.label}</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-2 space-y-0.5">
          <SidebarItem active={tab === "baskets"} onClick={() => setTab("baskets")} icon={<Briefcase className="w-4 h-4" />} count={baskets?.length}>
            Baskets
          </SidebarItem>
          <SidebarItem active={tab === "wallet"} onClick={() => setTab("wallet")} icon={<WalletIcon className="w-4 h-4" />}>
            Wallet
          </SidebarItem>
          <SidebarItem active={tab === "activity"} onClick={() => setTab("activity")} icon={<LayoutGrid className="w-4 h-4" />}>
            Activity
          </SidebarItem>
        </nav>

        <div className="p-3 border-t border-ink-700 space-y-1">
          <button
            onClick={() => setShowNew(true)}
            className="w-full bg-accent hover:bg-accent-dim text-white text-sm font-medium rounded-lg py-2 flex items-center justify-center gap-2 transition shadow-md shadow-accent/20"
          >
            <Plus className="w-4 h-4" /> New basket
            <kbd className="ml-1 text-[10px] bg-white/10 px-1.5 py-0.5 rounded">⌘K</kbd>
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="w-full hover:bg-ink-700 text-ink-300 text-xs rounded-lg py-1.5 flex items-center justify-center gap-2 transition"
          >
            <SettingsIcon className="w-3.5 h-3.5" /> Settings
          </button>
          <button
            onClick={onLogout}
            className="w-full hover:bg-ink-700 text-ink-400 text-xs rounded-lg py-1.5 flex items-center justify-center gap-2 transition"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden border-b border-ink-700 sticky top-0 backdrop-blur bg-ink-900/80 z-10 w-full">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent to-accent-dim flex items-center justify-center">
              <ActivityIcon className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-semibold text-sm">Zerion TA</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowNew(true)} className="p-2 hover:bg-ink-700 rounded-lg" title="New basket">
              <Plus className="w-4 h-4" />
            </button>
            <button onClick={() => setShowSettings(true)} className="p-2 hover:bg-ink-700 rounded-lg" title="Settings">
              <SettingsIcon className="w-4 h-4" />
            </button>
            <button onClick={onLogout} className="p-2 hover:bg-ink-700 rounded-lg" title="Sign out">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
        <nav className="flex border-t border-ink-700">
          <MobileTab active={tab === "baskets"} onClick={() => setTab("baskets")}>Baskets</MobileTab>
          <MobileTab active={tab === "wallet"} onClick={() => setTab("wallet")}>Wallet</MobileTab>
          <MobileTab active={tab === "activity"} onClick={() => setTab("activity")}>Activity</MobileTab>
        </nav>
      </header>

      <main className="flex-1 max-w-5xl mx-auto px-6 py-8 w-full">
        {tab === "baskets" && (
          <>
            {baskets && baskets.length > 0 && (
              <StatsStrip
                baskets={baskets}
                portfolios={portfolios}
                rebalanceHistories={rebalanceHistories}
              />
            )}

            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">Baskets</h2>
              <button
                onClick={() => setShowNew(true)}
                className="bg-accent hover:bg-accent-dim text-white text-sm font-medium rounded-lg px-3 py-2 flex items-center gap-2 transition md:hidden"
              >
                <Plus className="w-4 h-4" /> New
              </button>
            </div>

            {baskets === null ? (
              <div className="grid gap-4 md:grid-cols-2">
                <BasketCardSkeleton />
                <BasketCardSkeleton />
              </div>
            ) : baskets.length === 0 ? (
              <EmptyState
                title="No baskets yet"
                body="A basket holds tokens you want auto-rebalanced. The bot holds the weights you set, then nudges them every hour based on TA — within your policy limits."
                action="Create your first basket"
                onAction={() => setShowNew(true)}
                shortcut="⌘K"
              />
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {baskets.map((b) => (
                  <BasketCard
                    key={b.id}
                    basket={b}
                    portfolio={portfolios[b.id]}
                    history={rebalanceHistories[b.id]}
                    onRefreshBasket={() => refreshBasketData(b.id)}
                    onChange={onRefresh}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {tab === "wallet" && (
          <WalletView wallets={wallets} loading={walletsLoading} onRefresh={refreshWallets} />
        )}

        {tab === "activity" && <ActivityView baskets={baskets ?? []} />}
      </main>

      {showNew && <NewBasketModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); onRefresh(); }} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function SidebarItem({
  active,
  onClick,
  icon,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition ${
        active
          ? "bg-accent/15 text-white border border-accent/30"
          : "text-ink-300 hover:bg-ink-800 border border-transparent"
      }`}
    >
      <span className={active ? "text-accent" : ""}>{icon}</span>
      <span className="flex-1 text-left">{children}</span>
      {count != null && count > 0 && (
        <span className="text-[11px] tabular-nums bg-ink-700 text-ink-300 rounded-md px-1.5 py-0.5">{count}</span>
      )}
    </button>
  );
}

function MobileTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 text-xs py-2.5 border-b-2 transition ${
        active ? "border-accent text-white" : "border-transparent text-ink-400"
      }`}
    >
      {children}
    </button>
  );
}

function EmptyState({
  title,
  body,
  action,
  onAction,
  shortcut,
}: {
  title: string;
  body: string;
  action: string;
  onAction: () => void;
  shortcut?: string;
}) {
  return (
    <div className="border border-dashed border-ink-600 rounded-xl p-12 text-center">
      <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center border border-accent/30">
        <Plus className="w-6 h-6 text-accent" />
      </div>
      <div className="text-ink-100 font-medium text-base mb-2">{title}</div>
      <p className="text-sm text-ink-400 max-w-md mx-auto mb-5 leading-relaxed">{body}</p>
      <button
        onClick={onAction}
        className="bg-accent hover:bg-accent-dim text-white text-sm font-medium rounded-lg px-5 py-2.5 inline-flex items-center gap-2 shadow-md shadow-accent/20 transition"
      >
        {action}
        {shortcut && <kbd className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded">{shortcut}</kbd>}
      </button>
    </div>
  );
}
