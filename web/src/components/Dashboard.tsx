import { useEffect, useState } from "react";
import { LogOut, Plus, Settings as SettingsIcon, Activity, Wallet as WalletIcon, LayoutGrid } from "lucide-react";
import { api, type Basket } from "../api.ts";
import BasketCard from "./BasketCard.tsx";
import NewBasketModal from "./NewBasketModal.tsx";
import SettingsPanel from "./SettingsPanel.tsx";
import WalletView, { type WalletData } from "./WalletView.tsx";
import StatsStrip from "./StatsStrip.tsx";
import { BasketCardSkeleton } from "./Skeleton.tsx";

type Tab = "baskets" | "wallet";

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

  // Wallet data lives at this level so tab switches don't refetch.
  // First mount of the Wallet tab triggers an initial fetch; after that,
  // refresh is only manual via the Refresh button.
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

  // Fetch wallets the first time the user opens the Wallet tab — never again
  // unless they hit Refresh. Tab switches are pure render, no network.
  useEffect(() => {
    if (tab === "wallet" && wallets === null && !walletsLoading) {
      refreshWallets();
    }
  }, [tab]);

  return (
    <div className="min-h-full">
      <header className="border-b border-ink-700 sticky top-0 backdrop-blur bg-ink-900/80 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center">
              <Activity className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-base leading-tight">Zerion TA Rebalancer</h1>
              <p className="text-xs text-ink-400">
                {lastEvent?.type === "rebalance:start" ? "Rebalancing…"
                  : lastEvent?.type === "rebalance:done" ? "Idle (last: just now)"
                  : "Idle"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 hover:bg-ink-700 rounded-lg transition"
              title="Settings"
            >
              <SettingsIcon className="w-4 h-4" />
            </button>
            <button
              onClick={onLogout}
              className="p-2 hover:bg-ink-700 rounded-lg transition"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="border-b border-ink-700">
        <div className="max-w-6xl mx-auto px-6 flex gap-1">
          <TabButton active={tab === "baskets"} onClick={() => setTab("baskets")} icon={<LayoutGrid className="w-4 h-4" />}>
            Baskets
          </TabButton>
          <TabButton active={tab === "wallet"} onClick={() => setTab("wallet")} icon={<WalletIcon className="w-4 h-4" />}>
            Wallet
          </TabButton>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {tab === "baskets" && (
          <>
            {baskets && baskets.length > 0 && <StatsStrip baskets={baskets} />}

            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">Baskets</h2>
              <button
                onClick={() => setShowNew(true)}
                className="bg-accent hover:bg-accent-dim text-white text-sm font-medium rounded-lg px-3 py-2 flex items-center gap-2 transition"
              >
                <Plus className="w-4 h-4" /> New basket
              </button>
            </div>

            {baskets === null ? (
              <div className="grid gap-4 md:grid-cols-2">
                <BasketCardSkeleton />
                <BasketCardSkeleton />
              </div>
            ) : baskets.length === 0 ? (
              <div className="border border-dashed border-ink-600 rounded-xl p-12 text-center">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-accent/10 flex items-center justify-center">
                  <Plus className="w-5 h-5 text-accent" />
                </div>
                <div className="text-ink-200 font-medium mb-2">No baskets yet</div>
                <p className="text-sm text-ink-400 max-w-md mx-auto mb-4">
                  A basket holds the tokens you want auto-rebalanced. The bot will hold initial weights you set,
                  then nudge them every hour based on TA signals — within your policy limits.
                </p>
                <button
                  onClick={() => setShowNew(true)}
                  className="bg-accent hover:bg-accent-dim text-white text-sm font-medium rounded-lg px-4 py-2"
                >
                  Create your first basket
                </button>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {baskets.map((b) => (
                  <BasketCard key={b.id} basket={b} onChange={onRefresh} />
                ))}
              </div>
            )}
          </>
        )}

        {tab === "wallet" && (
          <WalletView wallets={wallets} loading={walletsLoading} onRefresh={refreshWallets} />
        )}
      </main>

      {showNew && <NewBasketModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); onRefresh(); }} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 text-sm border-b-2 transition ${
        active
          ? "border-accent text-white"
          : "border-transparent text-ink-400 hover:text-ink-200"
      }`}
    >
      {icon} {children}
    </button>
  );
}
