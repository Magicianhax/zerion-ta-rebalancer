import { useEffect, useMemo, useState } from "react";
import { api, type Basket, type Portfolio, type RebalanceResult, type Chain } from "../api.ts";
import BasketCard from "./BasketCard.tsx";
import NewBasketModal from "./NewBasketModal.tsx";
import SettingsTab from "./SettingsPanel.tsx";
import WalletView, { type WalletData } from "./WalletView.tsx";
import StatsStrip from "./StatsStrip.tsx";
import ActivityView from "./ActivityView.tsx";
import FirstAllocOverlay, { type AllocStage } from "./FirstAllocOverlay.tsx";
import { Btn, Icon, SegBar, StatusDot, type IconName, chainColor } from "./ui.tsx";

type Tab = "baskets" | "wallet" | "activity" | "settings";

interface Props {
  baskets: Basket[] | null;
  lastEvent: { type: string; payload: any } | null;
  onRefresh: () => void;
  onLogout: () => void;
}

export default function Dashboard({ baskets, lastEvent, onRefresh, onLogout }: Props) {
  const [showNew, setShowNew] = useState(false);
  const [tab, setTab] = useState<Tab>("baskets");
  const [sidebar, setSidebar] = useState<"expanded" | "collapsed">("expanded");

  // ── Per-basket data lifted to parent ──────────────────────────────
  const [portfolios, setPortfolios] = useState<Record<string, Portfolio>>({});
  const [rebalanceHistories, setRebalanceHistories] = useState<Record<string, RebalanceResult[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // First-allocation overlay state — driven by SSE for the most recently created basket.
  const [allocBasketId, setAllocBasketId] = useState<string | null>(null);
  const [allocStage, setAllocStage] = useState<AllocStage>("queued");

  const refreshBasketData = async (basketId: string) => {
    const [pf, rb] = await Promise.all([
      api.getPortfolio(basketId).catch(() => null),
      api.listRebalances(basketId, 50).catch(() => null),
    ]);
    if (pf) setPortfolios((prev) => ({ ...prev, [basketId]: pf.portfolio }));
    if (rb) setRebalanceHistories((prev) => ({ ...prev, [basketId]: rb.rebalances }));
  };

  const basketIdsKey = useMemo(() => baskets?.map((b) => b.id).join(",") ?? "", [baskets]);
  useEffect(() => {
    if (!baskets) return;
    for (const b of baskets) refreshBasketData(b.id);
    // First basket auto-expands so the user sees the populated card without clicking.
    if (baskets.length > 0 && Object.keys(expanded).length === 0) {
      setExpanded({ [baskets[0]!.id]: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basketIdsKey]);

  useEffect(() => {
    if (!lastEvent) return;
    const basketId = (lastEvent.payload as { basketId?: string })?.basketId;
    if (lastEvent.type === "rebalance:start" && basketId === allocBasketId) {
      setAllocStage("quoting");
    }
    if (lastEvent.type === "rebalance:done") {
      if (basketId) refreshBasketData(basketId);
      if (basketId === allocBasketId) {
        setAllocStage("done");
        setTimeout(() => { setAllocBasketId(null); setAllocStage("queued"); }, 1800);
      }
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
            return { info, totalUsd: r.totalUsd, holdings: r.holdings, errors: r.errors, fetchedAt: r.fetchedAt };
          } catch (e: any) {
            return { info, totalUsd: 0, holdings: [], errors: [e.message], fetchedAt: null };
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

  // Cmd/Ctrl+K opens New Basket.
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

  const toggleExpand = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-0)", display: "flex", flexDirection: "column" }}>
      <TopBar tab={tab} setTab={setTab} onToggleSidebar={() => setSidebar((s) => s === "expanded" ? "collapsed" : "expanded")} />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <Sidebar tab={tab} setTab={setTab} mode={sidebar} baskets={baskets ?? []} portfolios={portfolios} />
        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {tab === "baskets" && (
            <StatsStrip baskets={baskets ?? []} portfolios={portfolios} rebalanceHistories={rebalanceHistories} />
          )}
          <div style={{ flex: 1, overflow: "auto" }}>
            {tab === "baskets" && (
              <BasketsTabSection
                baskets={baskets}
                portfolios={portfolios}
                rebalanceHistories={rebalanceHistories}
                expanded={expanded}
                toggleExpand={toggleExpand}
                onNew={() => setShowNew(true)}
                onRefreshBasket={refreshBasketData}
                onRefreshList={onRefresh}
                allocBasketId={allocBasketId}
                allocStage={allocStage}
              />
            )}
            {tab === "wallet" && (
              <WalletView wallets={wallets} loading={walletsLoading} onRefresh={refreshWallets} />
            )}
            {tab === "activity" && <ActivityView baskets={baskets ?? []} />}
            {tab === "settings" && <SettingsTab onLogout={onLogout} />}
          </div>
          <Footer lastEvent={lastEvent}/>
        </main>
      </div>
      {showNew && (
        <NewBasketModal
          onClose={() => setShowNew(false)}
          onCreated={(basketId: string) => {
            setShowNew(false);
            setAllocBasketId(basketId);
            setAllocStage("queued");
            setExpanded((e) => ({ ...e, [basketId]: true }));
            onRefresh();
          }}
        />
      )}
      <FirstAllocOverlay
        basketId={allocBasketId}
        stage={allocStage}
        onDismiss={() => { setAllocBasketId(null); setAllocStage("queued"); }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  TopBar                                                                    */
/* -------------------------------------------------------------------------- */
function TopBar({ tab, setTab, onToggleSidebar }: { tab: Tab; setTab: (t: Tab) => void; onToggleSidebar: () => void }) {
  const tabs: Array<{ k: Tab; label: string; icon: IconName }> = [
    { k: "baskets",  label: "Baskets",  icon: "basket"   },
    { k: "wallet",   label: "Wallet",   icon: "wallet"   },
    { k: "activity", label: "Activity", icon: "activity" },
    { k: "settings", label: "Settings", icon: "settings" },
  ];
  return (
    <header style={{
      height: 44, background: "var(--bg-1)",
      borderBottom: "1px solid var(--bd-2)",
      display: "flex", alignItems: "center", padding: "0 12px",
      gap: 10, flex: "0 0 auto",
    }}>
      <button
        onClick={onToggleSidebar}
        title="Toggle sidebar"
        style={{
          background: "transparent", border: "1px solid var(--bd-1)",
          borderRadius: 4, padding: "4px 6px", color: "var(--tx-2)", cursor: "pointer",
          display: "inline-flex", alignItems: "center",
        }}
      >
        <Icon name="panel" size={13}/>
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          width: 22, height: 22, borderRadius: 4,
          background: "linear-gradient(135deg, var(--ac), var(--ac-dd))",
          display: "grid", placeItems: "center", color: "#06120a",
        }}>
          <Icon name="bolt" size={12} stroke={2.2}/>
        </div>
        <span style={{ fontSize: 12.5, color: "var(--tx-0)", fontWeight: 600 }}>Zerion TA Rebalancer</span>
      </div>

      <div style={{ height: 18, width: 1, background: "var(--bd-2)", margin: "0 6px" }}/>

      <nav className="topbar-nav" style={{ display: "flex", gap: 2 }}>
        {tabs.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            style={{
              height: 28, padding: "0 10px",
              background: tab === t.k ? "var(--bg-3)" : "transparent",
              color: tab === t.k ? "var(--tx-0)" : "var(--tx-2)",
              border: tab === t.k ? "1px solid var(--bd-2)" : "1px solid transparent",
              borderRadius: 4, cursor: "pointer", fontSize: 12,
              display: "inline-flex", alignItems: "center", gap: 6,
              textTransform: "capitalize",
            }}
          >
            <Icon name={t.icon} size={12}/>{t.label}
          </button>
        ))}
      </nav>

      <div style={{ flex: 1 }}/>

      <div className="hide-mob" style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "4px 8px", background: "var(--bg-2)",
        border: "1px solid var(--bd-1)", borderRadius: 4, fontSize: 11,
      }}>
        <StatusDot kind="ok" pulse/>
        <span className="mono" style={{ color: "var(--tx-1)" }}>cron · live</span>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sidebar                                                                   */
/* -------------------------------------------------------------------------- */
function Sidebar({ tab, setTab, mode, baskets, portfolios }: {
  tab: Tab; setTab: (t: Tab) => void; mode: "expanded" | "collapsed";
  baskets: Basket[]; portfolios: Record<string, Portfolio>;
}) {
  const collapsed = mode === "collapsed";
  const items: Array<{ k: Tab; label: string; icon: IconName; count: number | null }> = [
    { k: "baskets",  label: "Baskets",  icon: "basket",  count: baskets.length },
    { k: "wallet",   label: "Wallet",   icon: "wallet",  count: null },
    { k: "activity", label: "Activity", icon: "activity",count: null },
    { k: "settings", label: "Settings", icon: "settings",count: null },
  ];
  // Per-chain totals — sums portfolio USD for baskets on each chain.
  const chainTotals: Record<Chain, number> = { solana: 0, base: 0 };
  for (const b of baskets) {
    chainTotals[b.chain] += portfolios[b.id]?.totalUsd ?? 0;
  }
  const fmt = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n.toFixed(0)}`;

  return (
    <aside style={{
      width: collapsed ? 48 : 200, flex: "0 0 auto",
      background: "var(--bg-1)", borderRight: "1px solid var(--bd-2)",
      padding: "10px 8px", display: "flex", flexDirection: "column",
      transition: "width .18s ease",
    }}>
      {!collapsed && (
        <div style={{ padding: "4px 6px 8px", fontSize: 10, color: "var(--tx-3)", textTransform: "uppercase", letterSpacing: ".06em" }}>
          Workspace
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {items.map((it) => {
          const active = tab === it.k;
          return (
            <button
              key={it.k}
              onClick={() => setTab(it.k)}
              title={collapsed ? it.label : undefined}
              style={{
                height: 30, padding: collapsed ? 0 : "0 8px",
                background: active ? "var(--bg-3)" : "transparent",
                color: active ? "var(--tx-0)" : "var(--tx-1)",
                border: "1px solid " + (active ? "var(--bd-2)" : "transparent"),
                borderLeft: active ? "1px solid var(--ac)" : "1px solid transparent",
                borderRadius: 4, cursor: "pointer", fontSize: 12.5,
                display: "flex", alignItems: "center", gap: 8,
                justifyContent: collapsed ? "center" : "flex-start",
              }}
            >
              <Icon name={it.icon} size={14}/>
              {!collapsed && (
                <>
                  <span style={{ flex: 1, textAlign: "left" }}>{it.label}</span>
                  {it.count != null && it.count > 0 && (
                    <span className="mono" style={{ fontSize: 10.5, color: "var(--tx-3)" }}>{it.count}</span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>

      {!collapsed && (
        <>
          <div style={{ padding: "16px 6px 8px", fontSize: 10, color: "var(--tx-3)", textTransform: "uppercase", letterSpacing: ".06em" }}>
            Chains
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {(["solana", "base"] as Chain[]).map((c) => (
              <div key={c} style={{
                height: 26, padding: "0 8px",
                display: "flex", alignItems: "center", gap: 8,
                fontSize: 11.5, color: "var(--tx-1)",
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: 999,
                  background: chainColor(c), boxShadow: "0 0 6px currentColor",
                }}/>
                <span style={{ flex: 1, textTransform: "capitalize" }}>{c}</span>
                <span className="mono num" style={{ color: "var(--tx-3)", fontSize: 10.5 }}>
                  {fmt(chainTotals[c])}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ flex: 1 }}/>

      {!collapsed && (
        <div style={{
          padding: 10, border: "1px solid var(--bd-1)", borderRadius: 4,
          background: "var(--bg-2)", fontSize: 11, color: "var(--tx-2)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--tx-1)", marginBottom: 4 }}>
            <Icon name="shield" size={11}/>
            <span style={{ fontWeight: 600 }}>OWS policy active</span>
          </div>
          <div className="mono" style={{ fontSize: 10.5, color: "var(--tx-3)", lineHeight: 1.5 }}>
            spend cap enforced<br/>
            chain-locked at sign<br/>
            session bounded
          </div>
        </div>
      )}
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/*  Footer                                                                    */
/* -------------------------------------------------------------------------- */
function Footer({ lastEvent }: { lastEvent: { type: string; payload: any } | null }) {
  const live =
    lastEvent?.type === "rebalance:start" ? "rebalancing now" :
    lastEvent?.type === "rebalance:done" ? "idle · last just now" :
    "idle";
  return (
    <footer style={{
      height: 24, borderTop: "1px solid var(--bd-2)",
      display: "flex", alignItems: "center", gap: 16, padding: "0 12px",
      fontSize: 10.5, color: "var(--tx-3)", fontFamily: "var(--f-mono)",
      flex: "0 0 auto", background: "var(--bg-1)",
    }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <StatusDot kind="ok" pulse/> sse · /api/events
      </span>
      <span>{live}</span>
      <span style={{ flex: 1 }}/>
      <span style={{ color: "var(--tx-3)" }}>powered by Zerion CLI · MIT</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Icon name="terminal" size={11}/> v0.1.0
      </span>
    </footer>
  );
}

/* -------------------------------------------------------------------------- */
/*  Baskets section                                                           */
/* -------------------------------------------------------------------------- */
type FilterKey = "all" | "active" | "paused" | "alerts";
type ChainFilter = "all" | Chain;

function BasketsTabSection({
  baskets, portfolios, rebalanceHistories, expanded, toggleExpand,
  onNew, onRefreshBasket, onRefreshList, allocBasketId, allocStage,
}: {
  baskets: Basket[] | null;
  portfolios: Record<string, Portfolio>;
  rebalanceHistories: Record<string, RebalanceResult[]>;
  expanded: Record<string, boolean>;
  toggleExpand: (id: string) => void;
  onNew: () => void;
  onRefreshBasket: (id: string) => Promise<void>;
  onRefreshList: () => void;
  allocBasketId: string | null;
  allocStage: AllocStage;
}) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [chain, setChain] = useState<ChainFilter>("all");

  if (baskets === null) {
    return (
      <div style={{ padding: 16 }}>
        <div className="skel" style={{ height: 96, marginBottom: 10 }}/>
        <div className="skel" style={{ height: 96 }}/>
      </div>
    );
  }

  const filtered = baskets.filter((b) => {
    if (filter === "active" && !b.enabled) return false;
    if (filter === "paused" && b.enabled) return false;
    if (filter === "alerts") {
      // Treat "alerts" as: paused, or last rebalance denied/errored.
      const last = rebalanceHistories[b.id]?.[0];
      const flagged = !!last && (!last.guardOutcome.allow || last.swaps.some((s) => s.error));
      if (!flagged) return false;
    }
    if (chain !== "all" && b.chain !== chain) return false;
    return true;
  });

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <SegBar
          value={filter}
          onChange={setFilter}
          options={[
            { v: "all" as FilterKey,    l: "All",     c: baskets.length },
            { v: "active" as FilterKey, l: "Active",  c: baskets.filter((b) => b.enabled).length },
            { v: "paused" as FilterKey, l: "Paused",  c: baskets.filter((b) => !b.enabled).length },
            { v: "alerts" as FilterKey, l: "Alerts" },
          ]}
        />
        <SegBar
          value={chain}
          onChange={setChain}
          options={[
            { v: "all" as ChainFilter, l: "All chains" },
            { v: "solana" as ChainFilter, l: "Solana", dot: chainColor("solana") },
            { v: "base"   as ChainFilter, l: "Base",   dot: chainColor("base") },
          ]}
        />
        <div style={{ flex: 1 }}/>
        <Btn variant="ghost" leftIcon="refresh" size="sm" onClick={onRefreshList}>Refresh</Btn>
        <Btn variant="primary" leftIcon="plus" onClick={onNew}>New basket</Btn>
      </div>

      {filtered.length === 0 ? (
        <EmptyBaskets onNew={onNew}/>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((b) => (
            <BasketCard
              key={b.id}
              basket={b}
              portfolio={portfolios[b.id]}
              history={rebalanceHistories[b.id]}
              expanded={!!expanded[b.id]}
              onToggle={() => toggleExpand(b.id)}
              onRefreshBasket={() => onRefreshBasket(b.id)}
              onChange={onRefreshList}
              firstAllocStage={allocBasketId === b.id ? allocStage : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyBaskets({ onNew }: { onNew: () => void }) {
  return (
    <div className="fade-in" style={{
      border: "1px dashed var(--bd-2)", borderRadius: 6, padding: 32,
      background: "linear-gradient(180deg, var(--bg-1), var(--bg-0))",
      display: "grid", gridTemplateColumns: "1fr", gap: 24, alignItems: "center", minHeight: 260,
    }}>
      <div>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "4px 10px", border: "1px solid var(--ac-bd)",
          background: "var(--ac-bg)", color: "var(--ac)",
          borderRadius: 3, fontSize: 10.5,
          textTransform: "uppercase", letterSpacing: ".06em",
          marginBottom: 14,
        }}>
          <StatusDot kind="ok" pulse/>Ready · agent unlocked
        </div>
        <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 600, color: "var(--tx-0)", letterSpacing: "-.015em" }}>
          Fund a wallet, then create your first basket.
        </h2>
        <p style={{ margin: "0 0 18px", color: "var(--tx-2)", fontSize: 13, maxWidth: 480 }}>
          Send USDC plus a small amount of native gas to your agent wallet on Solana or Base.
          Once funded, create a basket and the rebalancer signs its first allocation tick automatically.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="primary" leftIcon="plus" onClick={onNew}>New basket</Btn>
        </div>
        <div style={{ marginTop: 22, display: "flex", gap: 18, fontSize: 11.5, color: "var(--tx-3)", flexWrap: "wrap" }}>
          <Step n="1" label="Fund wallet" active/>
          <Step n="2" label="Create basket"/>
          <Step n="3" label="First allocation"/>
          <Step n="4" label="Rebalances hourly"/>
        </div>
      </div>
    </div>
  );
}

function Step({ n, label, active }: { n: string; label: string; active?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, color: active ? "var(--tx-0)" : "var(--tx-3)" }}>
      <span className="mono" style={{
        width: 18, height: 18, display: "inline-grid", placeItems: "center",
        border: "1px solid " + (active ? "var(--ac)" : "var(--bd-2)"),
        background: active ? "var(--ac-bg)" : "transparent",
        color: active ? "var(--ac)" : "var(--tx-3)",
        borderRadius: 3, fontSize: 10,
      }}>
        {n}
      </span>
      {label}
    </div>
  );
}
