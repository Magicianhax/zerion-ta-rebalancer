import { Fragment, useEffect, useMemo, useState } from "react";
import { api, type Basket, type RebalanceResult, type Chain } from "../api.ts";
import { fmtUsd, fmtRelative } from "../utils/format.ts";
import {
  ActionDot, Btn, ChainBadge, Icon, SegBar, TaScore, TokenChip,
  type ActionKind,
} from "./ui.tsx";

interface Row extends RebalanceResult {
  basketName: string;
  basketChain: Chain;
}

type Filter = "all" | "swaps" | "denied" | "no-action" | "error";

export default function ActivityView({ baskets }: { baskets: Basket[] }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});

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

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [baskets.length]);

  const actionFor = (r: Row): ActionKind => {
    if (!r.guardOutcome.allow) return "denied";
    if (r.swaps.some((s) => s.error)) return "error";
    if (r.swaps.length > 0) return "swaps";
    return "no-action";
  };

  const filtered = useMemo(() => {
    if (!rows) return null;
    if (filter === "all") return rows;
    return rows.filter((r) => actionFor(r) === filter);
  }, [rows, filter]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, swaps: 0, denied: 0, "no-action": 0, error: 0 };
    if (!rows) return c;
    c.all = rows.length;
    for (const r of rows) c[actionFor(r)]++;
    return c;
  }, [rows]);

  const explorerUrl = (chain: Chain, hash: string) =>
    chain === "solana" ? `https://solscan.io/tx/${hash}` : `https://basescan.org/tx/${hash}`;

  const cols = "26px 110px 1.4fr 130px 90px 1fr 100px";

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 14, color: "var(--tx-0)", fontWeight: 600 }}>Activity</h2>
        <span className="mono" style={{ fontSize: 11, color: "var(--tx-3)" }}>
          · {filtered?.length ?? 0} event{(filtered?.length ?? 0) === 1 ? "" : "s"}
        </span>
        <span style={{ flex: 1 }}/>
        <SegBar
          value={filter}
          onChange={setFilter}
          options={[
            { v: "all" as Filter,       l: "All",       c: counts.all },
            { v: "swaps" as Filter,     l: "Swaps",     c: counts.swaps },
            { v: "denied" as Filter,    l: "Denied",    c: counts.denied },
            { v: "no-action" as Filter, l: "No-action", c: counts["no-action"] },
            { v: "error" as Filter,     l: "Error",     c: counts.error },
          ]}
        />
        <Btn size="sm" variant="ghost" leftIcon="refresh" onClick={refresh} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Btn>
      </div>

      <div style={{
        border: "1px solid var(--bd-2)", borderRadius: 5,
        background: "var(--bg-1)", overflow: "hidden",
      }}>
        <div className="t-row t-head" style={{ gridTemplateColumns: cols }}>
          <span/>
          <span>Time</span>
          <span>Basket</span>
          <span>Action</span>
          <span style={{ textAlign: "right" }}>Swaps</span>
          <span>Summary</span>
          <span style={{ textAlign: "right" }}>Tx</span>
        </div>

        {filtered === null ? (
          <div style={{ padding: 16 }}>
            <div className="skel" style={{ height: 36, marginBottom: 6 }}/>
            <div className="skel" style={{ height: 36, marginBottom: 6 }}/>
            <div className="skel" style={{ height: 36 }}/>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center" }}>
            <div style={{
              width: 36, height: 36, margin: "0 auto 12px",
              borderRadius: 999, background: "var(--bg-3)",
              display: "grid", placeItems: "center", color: "var(--tx-3)",
            }}>
              <Icon name="activity" size={16}/>
            </div>
            <div style={{ fontSize: 13, color: "var(--tx-1)", marginBottom: 4 }}>Nothing yet</div>
            <p style={{ margin: 0, fontSize: 11.5, color: "var(--tx-3)", maxWidth: 360, marginInline: "auto" }}>
              Events appear here every time the cron fires or you trigger a manual rebalance.
            </p>
          </div>
        ) : (
          filtered.map((r, idx) => {
            const action = actionFor(r);
            const key = `${r.basketId}-${r.startedAt}-${idx}`;
            const isOpen = !!open[key];
            const summary = summarize(r);
            return (
              <Fragment key={key}>
                <div
                  className="t-row"
                  style={{ gridTemplateColumns: cols, cursor: "pointer" }}
                  onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
                >
                  <Icon name={isOpen ? "chevron-down" : "chevron-right"} size={11}/>
                  <span className="mono" style={{ color: "var(--tx-2)", fontSize: 11 }}>
                    {fmtRelative(r.startedAt)}
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <ChainBadge chain={r.basketChain} size="sm" withLabel={false}/>
                    <span style={{
                      color: "var(--tx-0)", fontSize: 12, fontWeight: 500,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{r.basketName}</span>
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <ActionDot a={action}/>
                    <span className="mono" style={{
                      fontSize: 11.5,
                      color: action === "error" ? "var(--danger)" :
                             action === "denied" ? "var(--warn)" :
                             action === "swaps" ? "var(--ac)" : "var(--tx-2)",
                    }}>{action}</span>
                  </span>
                  <span className="num" style={{ textAlign: "right", color: r.swaps.length ? "var(--tx-0)" : "var(--tx-3)" }}>
                    {r.swaps.length}
                  </span>
                  <span style={{
                    color: "var(--tx-1)", fontSize: 11.5,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{summary}</span>
                  <span className="mono" style={{
                    textAlign: "right", color: "var(--tx-3)", fontSize: 10.5,
                  }}>{r.swaps.filter((s) => s.txHash).length || "—"}</span>
                </div>

                {isOpen && (
                  <div className="fade-in" style={{
                    padding: "12px 16px 14px 42px",
                    borderBottom: "1px solid var(--bd-1)",
                    background: "var(--bg-2)",
                    display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16,
                  }}>
                    <div>
                      <div style={{ fontSize: 10.5, color: "var(--tx-3)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>
                        TA scores
                      </div>
                      {r.proposal.scores.length === 0 ? (
                        <span className="mono" style={{ color: "var(--tx-3)", fontSize: 11 }}>—</span>
                      ) : (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {r.proposal.scores.map((s) => (
                            <div
                              key={s.symbol}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 6,
                                padding: "3px 6px 3px 4px",
                                background: "var(--bg-1)", border: "1px solid var(--bd-2)",
                                borderRadius: 3,
                              }}
                            >
                              <TokenChip sym={s.symbol} size={14}/>
                              <span className="mono" style={{ fontSize: 11, color: "var(--tx-1)" }}>{s.symbol}</span>
                              <TaScore score={Math.round(s.score)}/>
                            </div>
                          ))}
                        </div>
                      )}
                      {!r.guardOutcome.allow && (
                        <div style={{
                          marginTop: 10, fontSize: 11, color: "var(--warn)",
                          fontFamily: "var(--f-mono)", lineHeight: 1.5,
                        }}>
                          {r.guardOutcome.reason}
                        </div>
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, color: "var(--tx-3)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>
                        Swaps
                      </div>
                      {r.swaps.length === 0 ? (
                        <span className="mono" style={{ color: "var(--tx-3)", fontSize: 11 }}>—</span>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {r.swaps.map((s, i) => (
                            <div key={i} style={{
                              display: "flex", alignItems: "center", gap: 8,
                              fontSize: 11, color: "var(--tx-1)",
                              padding: "4px 6px",
                              background: "var(--bg-1)", border: "1px solid var(--bd-1)",
                              borderRadius: 3,
                            }}>
                              <span className="mono" style={{ color: "var(--tx-0)" }}>{s.plan.fromToken}</span>
                              <Icon name="chevron-right" size={11}/>
                              <span className="mono" style={{ color: "var(--tx-0)" }}>{s.plan.toToken}</span>
                              <span className="num" style={{ color: "var(--tx-2)" }}>{fmtUsd(s.plan.estimatedUsd)}</span>
                              <span style={{ flex: 1 }}/>
                              {s.error ? (
                                <span style={{ color: "var(--danger)", fontSize: 10.5 }}>
                                  {s.error.split("\n")[0]?.slice(0, 60) ?? "failed"}
                                </span>
                              ) : s.txHash ? (
                                <a
                                  href={explorerUrl(r.basketChain, s.txHash)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    display: "inline-flex", alignItems: "center", gap: 4,
                                    color: "var(--ac)", textDecoration: "none",
                                    fontFamily: "var(--f-mono)", fontSize: 10.5,
                                  }}
                                >
                                  {s.txHash.slice(0, 8)}…
                                  <Icon name="external" size={10}/>
                                </a>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}

function summarize(r: RebalanceResult): string {
  if (!r.guardOutcome.allow) return r.guardOutcome.reason;
  if (r.swaps.length === 0) return "Within tolerance — no action";
  return r.swaps
    .map((s) => `${s.plan.fromToken} → ${s.plan.toToken} ${fmtUsd(s.plan.estimatedUsd)}`)
    .join("; ");
}
