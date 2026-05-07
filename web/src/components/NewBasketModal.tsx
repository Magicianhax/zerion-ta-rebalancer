import { useEffect, useMemo, useState } from "react";
import { api, type Chain, type PolicySummary, type TokenEntry, type WalletInfo } from "../api.ts";
import { fmtUsd } from "../utils/format.ts";
import {
  Btn, chainColor, Field, Icon, IconBtn, inputStyle, TokenChip,
} from "./ui.tsx";

interface Props {
  onClose: () => void;
  onCreated: (basketId: string) => void;
}

interface Selection { symbol: string; weight: number }

interface Template {
  id: string;
  name: string;
  desc: string;
  taBias: number;
  tokens: Record<Chain, Array<{ symbol: string; weight: number }>>;
}

const TEMPLATES: Template[] = [
  {
    id: "majors",
    name: "Majors",
    desc: "Blue-chips weighted toward the dominant L1.",
    taBias: 0.4,
    tokens: {
      solana: [
        { symbol: "SOL",  weight: 60 },
        { symbol: "USDC", weight: 40 },
      ],
      base: [
        { symbol: "ETH",  weight: 60 },
        { symbol: "USDC", weight: 40 },
      ],
    },
  },
  {
    id: "memes",
    name: "Memes",
    desc: "Higher TA bias, momentum-driven, more volatile.",
    taBias: 0.6,
    tokens: {
      solana: [
        { symbol: "BONK", weight: 30 },
        { symbol: "WIF",  weight: 30 },
        { symbol: "JUP",  weight: 20 },
        { symbol: "JTO",  weight: 20 },
      ],
      base: [
        { symbol: "DEGEN", weight: 35 },
        { symbol: "BRETT", weight: 35 },
        { symbol: "AERO",  weight: 30 },
      ],
    },
  },
  {
    id: "diversified",
    name: "Diversified",
    desc: "Spread across majors, mid-caps, and a stable buffer.",
    taBias: 0.5,
    tokens: {
      solana: [
        { symbol: "SOL",  weight: 40 },
        { symbol: "JUP",  weight: 20 },
        { symbol: "BONK", weight: 20 },
        { symbol: "JTO",  weight: 20 },
      ],
      base: [
        { symbol: "ETH",   weight: 40 },
        { symbol: "AERO",  weight: 25 },
        { symbol: "CBBTC", weight: 20 },
        { symbol: "DEGEN", weight: 15 },
      ],
    },
  },
];

export default function NewBasketModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [chain, setChain] = useState<Chain>("solana");
  const [budget, setBudget] = useState(100);
  const [taBias, setTaBias] = useState(0.5);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [advOpen, setAdvOpen] = useState(false);

  const [tokens, setTokens] = useState<TokenEntry[]>([]);
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [policies, setPolicies] = useState<PolicySummary[]>([]);
  const [agentTokens, setAgentTokens] = useState<any[]>([]);
  const [walletName, setWalletName] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [agentTokenName, setAgentTokenName] = useState("");
  const [availableUsdc, setAvailableUsdc] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Custom token (by contract address) state
  const [customAddr, setCustomAddr] = useState("");
  const [resolvingCustom, setResolvingCustom] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  // Token registry per chain
  const refreshTokenList = () =>
    api.listTokens(chain).then((r) => setTokens(r.tokens.filter((t) => !t.isQuote))).catch(() => {});

  useEffect(() => { refreshTokenList(); /* eslint-disable-next-line */ }, [chain]);

  const addCustomFromAddress = async () => {
    const addr = customAddr.trim();
    if (!addr) return;
    setResolvingCustom(true);
    setCustomError(null);
    try {
      const r = await api.resolveCustomToken(chain, addr);
      const sym = r.token.symbol.toUpperCase();
      // Refresh the chain's token list so the new entry shows in the grid.
      await refreshTokenList();
      // Auto-select the freshly-added token.
      setSelections((cur) =>
        cur.find((s) => s.symbol === sym) ? cur : [...cur, { symbol: sym, weight: 0 }],
      );
      setActiveTemplate(null);
      setCustomAddr("");
    } catch (e: any) {
      setCustomError(e.message ?? "Failed to resolve token");
    } finally {
      setResolvingCustom(false);
    }
  };

  // Auto-pick the only available wallet/policy/agent token (common self-host case)
  useEffect(() => {
    api.listWallets().then((r) => {
      setWallets(r.wallets);
      if (r.wallets.length === 1) setWalletName(r.wallets[0]!.name);
    }).catch(() => {});
    api.listPolicies().then((r) => {
      setPolicies(r.policies);
      if (r.policies.length === 1) setPolicyId(r.policies[0].id);
    }).catch(() => {});
    api.listAgentTokens().then((r) => {
      setAgentTokens(r.tokens);
      const active = r.tokens.find((t: any) => t.active) ?? r.tokens[0];
      if (active) setAgentTokenName(active.name);
    }).catch(() => {});
  }, []);

  // Refresh USDC balance whenever wallet/chain changes.
  useEffect(() => {
    if (!walletName) return;
    let alive = true;
    setLoadingBalance(true);
    api.walletHoldings(walletName)
      .then((r) => {
        if (!alive) return;
        const usdc = r.holdings.find(
          (h) => h.symbol.toUpperCase() === "USDC" && h.chain === chain,
        );
        setAvailableUsdc(usdc?.usd ?? 0);
      })
      .catch(() => alive && setAvailableUsdc(null))
      .finally(() => alive && setLoadingBalance(false));
    return () => { alive = false; };
  }, [walletName, chain]);

  const knownSymbols = useMemo(() => new Set(tokens.map((t) => t.symbol)), [tokens]);

  const applyTemplate = (template: Template) => {
    const presets = template.tokens[chain];
    const valid = presets.filter((p) => knownSymbols.has(p.symbol));
    setSelections(valid.map((p) => ({ symbol: p.symbol, weight: p.weight })));
    setTaBias(template.taBias);
    setActiveTemplate(template.id);
    if (!name) setName(template.name);
  };

  const toggleToken = (sym: string) => {
    setSelections((cur) => {
      if (cur.find((s) => s.symbol === sym)) return cur.filter((s) => s.symbol !== sym);
      return [...cur, { symbol: sym, weight: 0 }];
    });
    setActiveTemplate(null);
  };

  const setWeight = (sym: string, w: number) => {
    setSelections((cur) => cur.map((s) => (s.symbol === sym ? { ...s, weight: Math.max(0, Math.min(100, w)) } : s)));
  };

  const removeToken = (sym: string) => {
    setSelections((cur) => cur.filter((s) => s.symbol !== sym));
  };

  const autoBalance = () => {
    if (selections.length === 0) return;
    const equal = Math.floor(100 / selections.length);
    const remainder = 100 - equal * selections.length;
    setSelections(selections.map((s, i) => ({ ...s, weight: equal + (i === 0 ? remainder : 0) })));
  };

  const totalWeight = selections.reduce((sum, s) => sum + s.weight, 0);
  const weightOk = selections.length >= 2 && Math.abs(totalWeight - 100) < 0.01;
  const credentialsOk = !!(walletName && policyId && agentTokenName);
  const canSubmit = !!(name && weightOk && credentialsOk && budget > 0);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const id = `basket-${Date.now()}`;
      await api.createBasket({
        id,
        name,
        chain,
        walletName,
        agentTokenName,
        policyId,
        budgetUsd: budget,
        quoteToken: "USDC",
        taBias,
        tokens: selections.map((s) => ({ symbol: s.symbol, initialWeight: s.weight / 100 })),
      });
      onCreated(id);
    } catch (e: any) {
      setError(e.message ?? "Failed to create basket");
    } finally {
      setSubmitting(false);
    }
  };

  const credentialsAutoFilled =
    wallets.length === 1 && policies.length === 1 && agentTokens.length >= 1;

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const availableTokens = tokens.filter((t) => !selections.find((s) => s.symbol === t.symbol));

  return (
    <div
      onClick={onClose}
      className="fade-in"
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,.6)", backdropFilter: "blur(2px)",
        display: "grid", placeItems: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="scale-in"
        style={{
          width: 720, maxHeight: "90vh", overflow: "auto",
          background: "var(--bg-1)", border: "1px solid var(--bd-3)",
          borderRadius: 6, boxShadow: "var(--sh-2)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--bd-2)" }}>
          <Icon name="basket" size={14}/>
          <h2 style={{ margin: "0 0 0 8px", fontSize: 13.5, color: "var(--tx-0)", fontWeight: 600, flex: 1 }}>New basket</h2>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--tx-3)", marginRight: 12 }}>esc to cancel</span>
          <IconBtn icon="x" onClick={onClose} title="Close"/>
        </div>

        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Templates */}
          <Field label="Template" hint="Starting weights and policy defaults">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {TEMPLATES.map((t) => {
                const active = activeTemplate === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => applyTemplate(t)}
                    style={{
                      textAlign: "left", padding: 12,
                      border: `1px solid ${active ? "var(--ac-bd)" : "var(--bd-2)"}`,
                      background: active ? "var(--ac-bg)" : "var(--bg-2)",
                      color: "var(--tx-1)", borderRadius: 4, cursor: "pointer",
                      display: "flex", flexDirection: "column", gap: 6,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: "var(--tx-0)", fontWeight: 600, fontSize: 12.5 }}>{t.name}</span>
                      {active && <Icon name="check" size={11}/>}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--tx-2)", lineHeight: 1.35 }}>{t.desc}</div>
                    <div style={{ display: "flex", marginTop: 2 }}>
                      {t.tokens[chain].map((tk, i) => (
                        <span key={tk.symbol} style={{ marginLeft: i === 0 ? 0 : -3 }}>
                          <TokenChip sym={tk.symbol} size={16}/>
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: 12 }}>
            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-basket"
                autoFocus
                style={inputStyle()}
              />
            </Field>
            <Field label="Chain">
              <div style={{ display: "flex", gap: 4 }}>
                {(["solana", "base"] as Chain[]).map((c) => {
                  const active = chain === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => { setChain(c); setSelections([]); setActiveTemplate(null); }}
                      style={{
                        flex: 1, height: 32,
                        background: active ? "var(--bg-3)" : "var(--bg-2)",
                        color: active ? "var(--tx-0)" : "var(--tx-2)",
                        border: `1px solid ${active ? "var(--bd-3)" : "var(--bd-2)"}`,
                        borderRadius: 4, cursor: "pointer", fontSize: 12,
                        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                        textTransform: "capitalize",
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: 999, background: chainColor(c) }}/>
                      {c}
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>

          {/* Tokens & weights */}
          <Field
            label="Weights"
            hint={
              <span>
                Allocations sum to{" "}
                <span className="num" style={{ color: weightOk ? "var(--ok)" : "var(--warn)" }}>{totalWeight}%</span>
                <button
                  type="button"
                  onClick={autoBalance}
                  disabled={selections.length === 0}
                  style={{
                    marginLeft: 8, padding: "1px 6px", fontSize: 10.5,
                    background: "var(--bg-3)", border: "1px solid var(--bd-2)",
                    color: "var(--tx-2)", borderRadius: 3, cursor: "pointer",
                    fontFamily: "var(--f-sans)", textTransform: "uppercase", letterSpacing: ".05em",
                    opacity: selections.length === 0 ? .4 : 1,
                  }}
                >
                  auto-balance
                </button>
              </span>
            }
          >
            <div style={{ border: "1px solid var(--bd-2)", borderRadius: 4, overflow: "hidden" }}>
              {selections.length === 0 ? (
                <div style={{ padding: 16, fontSize: 11.5, color: "var(--tx-3)", background: "var(--bg-2)" }}>
                  Pick a template above or add tokens below.
                </div>
              ) : (
                selections.map((sel, i) => (
                  <div
                    key={sel.symbol}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "180px 1fr 70px 26px",
                      alignItems: "center", gap: 12,
                      padding: "8px 12px",
                      borderBottom: i < selections.length - 1 ? "1px solid var(--bd-1)" : "none",
                      background: "var(--bg-2)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <TokenChip sym={sel.symbol} size={20}/>
                      <span className="mono" style={{ color: "var(--tx-0)", fontSize: 12 }}>{sel.symbol}</span>
                      <span style={{ fontSize: 10.5, color: "var(--tx-3)" }}>
                        {tokens.find((t) => t.symbol === sel.symbol)?.name ?? ""}
                      </span>
                    </div>
                    <input
                      type="range" min={0} max={100} value={sel.weight}
                      onChange={(e) => setWeight(sel.symbol, Number(e.target.value))}
                      style={{ accentColor: "var(--ac)" }}
                    />
                    <div style={{ position: "relative" }}>
                      <input
                        value={sel.weight}
                        onChange={(e) => setWeight(sel.symbol, Number(e.target.value) || 0)}
                        style={{ ...inputStyle(28), textAlign: "right", paddingRight: 22 }}
                      />
                      <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "var(--tx-3)", fontSize: 11 }}>%</span>
                    </div>
                    <IconBtn icon="trash" onClick={() => removeToken(sel.symbol)} title="Remove"/>
                  </div>
                ))
              )}
              {availableTokens.length > 0 && (
                <div style={{ padding: "8px 12px", display: "flex", gap: 6, flexWrap: "wrap", borderTop: "1px solid var(--bd-2)" }}>
                  <span style={{
                    fontSize: 10.5, color: "var(--tx-3)",
                    textTransform: "uppercase", letterSpacing: ".06em",
                    marginRight: 4, alignSelf: "center",
                  }}>add</span>
                  {availableTokens.slice(0, 24).map((t) => (
                    <button
                      key={t.symbol}
                      type="button"
                      onClick={() => toggleToken(t.symbol)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        padding: "3px 6px 3px 4px",
                        border: "1px solid var(--bd-2)",
                        background: "var(--bg-3)", color: "var(--tx-1)",
                        borderRadius: 3, fontSize: 11, cursor: "pointer",
                      }}
                    >
                      <TokenChip sym={t.symbol} size={14}/>
                      <span className="mono">{t.symbol}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Add custom token by contract address */}
              <div style={{
                padding: "8px 12px",
                borderTop: "1px solid var(--bd-2)",
                background: "var(--bg-1)",
                display: "flex", flexDirection: "column", gap: 4,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{
                    fontSize: 10.5, color: "var(--tx-3)",
                    textTransform: "uppercase", letterSpacing: ".06em",
                    flex: "0 0 auto",
                  }}>Custom</span>
                  <input
                    type="text"
                    value={customAddr}
                    onChange={(e) => { setCustomAddr(e.target.value); setCustomError(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomFromAddress(); } }}
                    placeholder={chain === "solana" ? "Paste Solana mint address" : "Paste Base contract address (0x…)"}
                    style={{
                      flex: 1, height: 28, padding: "0 10px",
                      background: "var(--bg-3)",
                      border: `1px solid ${customError ? "var(--danger)" : "var(--bd-2)"}`,
                      color: "var(--tx-0)", borderRadius: 4, outline: "none",
                      fontSize: 11.5, fontFamily: "var(--f-mono)",
                    }}
                  />
                  <Btn
                    size="sm"
                    variant="ghost"
                    onClick={addCustomFromAddress}
                    disabled={!customAddr.trim() || resolvingCustom}
                    leftIcon={resolvingCustom ? "refresh" : "plus"}
                  >
                    {resolvingCustom ? "Resolving…" : "Add"}
                  </Btn>
                </div>
                {customError ? (
                  <span style={{ fontSize: 10.5, color: "var(--danger)" }}>{customError}</span>
                ) : (
                  <span style={{ fontSize: 10.5, color: "var(--tx-3)" }}>
                    Looks up symbol, decimals, and best USDC pool from GeckoTerminal.
                  </span>
                )}
              </div>
            </div>
          </Field>

          {/* Budget + TA bias */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Field
              label="Budget"
              hint={
                loadingBalance ? <span className="mono">checking…</span> :
                availableUsdc != null ? <span className="num">USDC: {fmtUsd(availableUsdc)}</span> :
                <span className="mono">—</span>
              }
            >
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--tx-3)" }}>$</span>
                <input
                  type="number"
                  value={budget}
                  onChange={(e) => setBudget(Number(e.target.value) || 0)}
                  min={5}
                  step={1}
                  style={{ ...inputStyle(), paddingLeft: 22, fontFamily: "var(--f-mono)" }}
                />
                <div style={{
                  position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                  display: "flex", gap: 4,
                }}>
                  {[50, 100, 250].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setBudget(v)}
                      style={{
                        padding: "2px 6px", fontSize: 10.5,
                        background: "var(--bg-3)", border: "1px solid var(--bd-2)",
                        color: "var(--tx-2)", borderRadius: 3, cursor: "pointer",
                        fontFamily: "var(--f-mono)",
                      }}
                    >
                      ${v}
                    </button>
                  ))}
                </div>
              </div>
              {availableUsdc != null && availableUsdc > 0 && availableUsdc >= 5 && (
                <button
                  type="button"
                  onClick={() => setBudget(Math.max(5, Math.floor(availableUsdc * 100) / 100))}
                  style={{
                    background: "transparent", border: "none",
                    color: "var(--ac)", fontSize: 10.5,
                    textTransform: "uppercase", letterSpacing: ".05em",
                    cursor: "pointer", padding: 0, alignSelf: "flex-start", marginTop: 2,
                  }}
                >
                  use max
                </button>
              )}
            </Field>

            <Field
              label={
                <span>
                  TA bias <span className="num" style={{ color: "var(--ac)", marginLeft: 6 }}>{taBias.toFixed(2)}</span>
                </span>
              }
              hint={<span className="mono">0 user · 1 pure TA</span>}
            >
              <div style={{ position: "relative", padding: "10px 0 0" }}>
                <input
                  type="range" min={0} max={100} value={taBias * 100}
                  onChange={(e) => setTaBias(Number(e.target.value) / 100)}
                  style={{ width: "100%", accentColor: "var(--ac)" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--tx-3)", fontFamily: "var(--f-mono)" }}>
                  <span>user weights</span>
                  <span>balanced</span>
                  <span>pure TA</span>
                </div>
              </div>
            </Field>
          </div>

          {/* Wallet & policy */}
          <div style={{ borderTop: "1px solid var(--bd-1)" }}>
            <button
              type="button"
              onClick={() => setAdvOpen(!advOpen)}
              style={{
                width: "100%", textAlign: "left", padding: "10px 0",
                background: "transparent", border: "none",
                color: "var(--tx-2)", cursor: "pointer", fontSize: 12,
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              <Icon name={advOpen ? "chevron-down" : "chevron-right"} size={11}/>
              Wallet & policy
              {credentialsAutoFilled && credentialsOk && (
                <span className="mono" style={{ marginLeft: "auto", color: "var(--ac)", fontSize: 10.5 }}>
                  auto-filled · {wallets.length} wallet · {policies.length} policy
                </span>
              )}
            </button>
            {advOpen && (
              <div className="fade-in" style={{ padding: "8px 0 4px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Wallet">
                  <select
                    value={walletName}
                    onChange={(e) => setWalletName(e.target.value)}
                    style={inputStyle()}
                  >
                    <option value="">Choose…</option>
                    {wallets.map((w) => (
                      <option key={w.name} value={w.name}>{w.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="OWS policy">
                  <select
                    value={policyId}
                    onChange={(e) => setPolicyId(e.target.value)}
                    style={inputStyle()}
                  >
                    <option value="">Choose…</option>
                    {policies.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Agent token">
                  <select
                    value={agentTokenName}
                    onChange={(e) => setAgentTokenName(e.target.value)}
                    style={inputStyle()}
                  >
                    <option value="">Choose…</option>
                    {agentTokens.map((t: any) => (
                      <option key={t.name} value={t.name}>{t.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Drift tolerance">
                  <div style={inputStyle(32, true)}>
                    <span className="mono" style={{ flex: 1, color: "var(--tx-0)" }}>3.00%</span>
                    <span style={{ color: "var(--tx-3)", fontSize: 10.5 }}>before guard fires</span>
                  </div>
                </Field>
              </div>
            )}
          </div>

          {error && (
            <div style={{
              fontSize: 12, color: "var(--danger)",
              background: "color-mix(in oklab, var(--danger) 10%, var(--bg-2))",
              border: "1px solid color-mix(in oklab, var(--danger) 30%, var(--bd-2))",
              borderRadius: 4, padding: "8px 10px",
            }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          borderTop: "1px solid var(--bd-2)",
          padding: "12px 18px",
          display: "flex", alignItems: "center", gap: 10,
          background: "var(--bg-2)",
        }}>
          <span className="mono" style={{ fontSize: 11, color: "var(--tx-2)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Icon name="bolt" size={11}/> First allocation fires immediately on create.
          </span>
          <span style={{ flex: 1 }}/>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" rightIcon="bolt" onClick={submit} disabled={!canSubmit || submitting}>
            {submitting ? "Creating…" : "Create & allocate"}
          </Btn>
        </div>
      </div>
    </div>
  );
}
