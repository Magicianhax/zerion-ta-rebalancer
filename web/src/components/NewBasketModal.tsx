import { useEffect, useMemo, useState } from "react";
import { X, AlertCircle, Sparkles, Wallet as WalletIcon, ChevronDown, Wand2 } from "lucide-react";
import { api, type Chain, type TokenEntry, type WalletInfo } from "../api.ts";
import { fmtUsd } from "../utils/format.ts";

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

interface Selection {
  symbol: string;
  weight: number;
}

interface Template {
  name: string;
  description: string;
  taBias: number;
  tokens: Record<Chain, Array<{ symbol: string; weight: number }>>;
}

const TEMPLATES: Template[] = [
  {
    name: "Major",
    description: "Largest cap tokens, lower volatility",
    taBias: 0.4,
    tokens: {
      solana: [
        { symbol: "SOL", weight: 60 },
        { symbol: "USDC", weight: 40 },
      ],
      base: [
        { symbol: "ETH", weight: 60 },
        { symbol: "USDC", weight: 40 },
      ],
    },
  },
  {
    name: "Memes",
    description: "Higher risk, momentum-driven",
    taBias: 0.6,
    tokens: {
      solana: [
        { symbol: "BONK", weight: 30 },
        { symbol: "WIF", weight: 30 },
        { symbol: "JUP", weight: 20 },
        { symbol: "JTO", weight: 20 },
      ],
      base: [
        { symbol: "DEGEN", weight: 35 },
        { symbol: "BRETT", weight: 35 },
        { symbol: "AERO", weight: 30 },
      ],
    },
  },
  {
    name: "Diversified",
    description: "Balanced across the basket",
    taBias: 0.5,
    tokens: {
      solana: [
        { symbol: "SOL", weight: 40 },
        { symbol: "JUP", weight: 20 },
        { symbol: "BONK", weight: 20 },
        { symbol: "JTO", weight: 20 },
      ],
      base: [
        { symbol: "ETH", weight: 40 },
        { symbol: "AERO", weight: 25 },
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
  const [tokens, setTokens] = useState<TokenEntry[]>([]);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [policies, setPolicies] = useState<any[]>([]);
  const [agentTokens, setAgentTokens] = useState<any[]>([]);
  const [walletName, setWalletName] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [agentTokenName, setAgentTokenName] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.listTokens(chain).then((r) => setTokens(r.tokens.filter((t) => !t.isQuote))).catch(() => {});
  }, [chain]);

  // Auto-pick the only available wallet/policy/token — common case for personal self-host.
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

  const applyTemplate = (template: Template) => {
    const presets = template.tokens[chain];
    const known = new Set(tokens.map((t) => t.symbol));
    const valid = presets.filter((p) => known.has(p.symbol));
    setSelections(valid.map((p) => ({ symbol: p.symbol, weight: p.weight })));
    setTaBias(template.taBias);
  };

  const toggleToken = (sym: string) => {
    setSelections((cur) => {
      if (cur.find((s) => s.symbol === sym)) return cur.filter((s) => s.symbol !== sym);
      return [...cur, { symbol: sym, weight: 0 }];
    });
  };

  const setWeight = (sym: string, w: number) => {
    setSelections((cur) => cur.map((s) => (s.symbol === sym ? { ...s, weight: w } : s)));
  };

  const autoBalance = () => {
    if (selections.length === 0) return;
    const equal = Math.floor(100 / selections.length);
    const remainder = 100 - equal * selections.length;
    setSelections(selections.map((s, i) => ({ ...s, weight: equal + (i === 0 ? remainder : 0) })));
  };

  const totalWeight = selections.reduce((sum, s) => sum + s.weight, 0);
  const weightOk = selections.length >= 2 && Math.abs(totalWeight - 100) < 0.01;
  const credentialsOk = walletName && policyId && agentTokenName;
  const canSubmit = name && weightOk && credentialsOk && budget > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      await api.createBasket({
        id: `basket-${Date.now()}`,
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
      onCreated();
    } catch (e: any) {
      setError(e.message ?? "Failed to create basket");
    } finally {
      setLoading(false);
    }
  };

  const credentialsAutoFilled = useMemo(
    () => wallets.length === 1 && policies.length === 1 && agentTokens.length >= 1,
    [wallets.length, policies.length, agentTokens.length],
  );

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-20" onClick={onClose}>
      <div
        className="bg-ink-800 border border-ink-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-ink-700 flex items-center justify-between sticky top-0 bg-ink-800 z-10">
          <div>
            <h2 className="text-lg font-semibold">New basket</h2>
            <p className="text-xs text-ink-400 mt-0.5">Pick a template or build your own</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-ink-700 rounded-lg"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6 space-y-6">
          {/* Name + chain */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="text-xs text-ink-400 block mb-1.5">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-basket"
                autoFocus
                className="w-full bg-ink-700 border border-ink-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent transition"
              />
            </div>
            <div>
              <label className="text-xs text-ink-400 block mb-1.5">Chain</label>
              <div className="grid grid-cols-2 gap-1 bg-ink-700 border border-ink-600 rounded-lg p-1">
                {(["solana", "base"] as Chain[]).map((c) => (
                  <button
                    key={c}
                    onClick={() => { setChain(c); setSelections([]); }}
                    className={`text-xs rounded-md py-1.5 transition capitalize ${
                      chain === c ? "bg-accent text-white" : "text-ink-300 hover:bg-ink-600"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Templates */}
          <div>
            <div className="flex items-center gap-2 text-xs text-ink-400 mb-2">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Quick start</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  onClick={() => applyTemplate(t)}
                  className="text-left bg-ink-700 hover:bg-ink-600 border border-ink-600 hover:border-accent/50 rounded-lg p-3 transition group"
                >
                  <div className="font-medium text-sm">{t.name}</div>
                  <div className="text-xs text-ink-400 mt-0.5 leading-tight">{t.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Tokens */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-ink-400">Tokens & weights</label>
              <button
                onClick={autoBalance}
                disabled={selections.length === 0}
                className="text-xs text-accent hover:text-white disabled:opacity-30 flex items-center gap-1 transition"
              >
                <Wand2 className="w-3 h-3" /> Auto-balance
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {tokens.map((t) => {
                const sel = selections.find((s) => s.symbol === t.symbol);
                const isSelected = !!sel;
                return (
                  <button
                    key={t.symbol}
                    onClick={() => toggleToken(t.symbol)}
                    className={`flex items-center gap-2 p-2.5 rounded-lg border transition ${
                      isSelected
                        ? "bg-accent/10 border-accent text-white"
                        : "bg-ink-700 border-ink-600 text-ink-300 hover:bg-ink-600"
                    }`}
                  >
                    {t.logoUrl ? (
                      <img src={t.logoUrl} alt={t.symbol} className="w-6 h-6 rounded-full bg-ink-800" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-accent/20 text-[10px] flex items-center justify-center text-accent font-mono">
                        {t.symbol.slice(0, 2)}
                      </div>
                    )}
                    <div className="text-left min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">{t.symbol}</div>
                      <div className="text-[10px] text-ink-400 truncate">{t.name}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            {selections.length > 0 && (
              <div className="space-y-2 bg-ink-900/40 border border-ink-700 rounded-lg p-3">
                {selections.map((s) => (
                  <div key={s.symbol} className="flex items-center gap-3">
                    <span className="font-medium text-sm w-16">{s.symbol}</span>
                    <input
                      type="range"
                      min={0} max={100} step={1}
                      value={s.weight}
                      onChange={(e) => setWeight(s.symbol, Number(e.target.value))}
                      className="flex-1 accent-accent"
                    />
                    <input
                      type="number"
                      min={0} max={100} step={1}
                      value={s.weight}
                      onChange={(e) => setWeight(s.symbol, Number(e.target.value))}
                      className="w-14 bg-ink-700 border border-ink-600 rounded px-2 py-1 text-xs text-right tabular-nums"
                    />
                    <span className="text-xs text-ink-400 w-3">%</span>
                  </div>
                ))}
                <div className={`text-xs flex items-center gap-2 pt-1 ${weightOk ? "text-emerald-400" : "text-amber-400"}`}>
                  <AlertCircle className="w-3.5 h-3.5" />
                  Total: <span className="tabular-nums font-medium">{totalWeight}%</span>
                  {!weightOk && (selections.length < 2 ? "(pick ≥2 tokens)" : "(must equal 100%)")}
                </div>
              </div>
            )}
          </div>

          {/* Budget + TA bias */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-ink-400 block mb-1.5">Initial budget</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 text-sm">$</span>
                <input
                  type="number"
                  value={budget}
                  onChange={(e) => setBudget(Number(e.target.value))}
                  min={5}
                  className="w-full bg-ink-700 border border-ink-600 rounded-lg pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:border-accent tabular-nums"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-ink-400 block mb-1.5">
                TA bias: <span className="text-accent font-medium tabular-nums">{(taBias * 100).toFixed(0)}%</span>
              </label>
              <input
                type="range" min={0} max={1} step={0.05}
                value={taBias}
                onChange={(e) => setTaBias(Number(e.target.value))}
                className="w-full accent-accent mt-2.5"
              />
            </div>
          </div>

          {/* Wallet (auto-filled if only one) */}
          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between text-xs text-ink-400 hover:text-ink-200 transition"
            >
              <span className="flex items-center gap-2">
                <WalletIcon className="w-3.5 h-3.5" />
                Wallet & policy
                {credentialsAutoFilled && credentialsOk && (
                  <span className="text-emerald-400 text-[10px]">· auto-filled</span>
                )}
              </span>
              <ChevronDown className={`w-3.5 h-3.5 transition ${showAdvanced ? "rotate-180" : ""}`} />
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3 bg-ink-900/40 border border-ink-700 rounded-lg p-3">
                <div>
                  <label className="text-[11px] text-ink-400 block mb-1">Wallet</label>
                  <select
                    value={walletName}
                    onChange={(e) => setWalletName(e.target.value)}
                    className="w-full bg-ink-700 border border-ink-600 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-accent"
                  >
                    <option value="">Choose…</option>
                    {wallets.map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-ink-400 block mb-1">Policy</label>
                  <select
                    value={policyId}
                    onChange={(e) => setPolicyId(e.target.value)}
                    className="w-full bg-ink-700 border border-ink-600 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-accent"
                  >
                    <option value="">Choose…</option>
                    {policies.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-ink-400 block mb-1">Agent token</label>
                  <select
                    value={agentTokenName}
                    onChange={(e) => setAgentTokenName(e.target.value)}
                    className="w-full bg-ink-700 border border-ink-600 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-accent"
                  >
                    <option value="">Choose…</option>
                    {agentTokens.map((t: any) => <option key={t.name} value={t.name}>{t.name}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="text-sm text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg p-3">{error}</div>
          )}

          <div className="flex items-center gap-3 pt-2 border-t border-ink-700">
            <div className="flex-1 text-xs text-ink-400">
              {canSubmit
                ? `Will buy ${fmtUsd(budget)} of ${selections.length} tokens on ${chain}`
                : "Fill in name, pick ≥2 tokens, weights to 100%"}
            </div>
            <button
              onClick={onClose}
              className="text-sm text-ink-300 hover:text-white px-3 py-2 transition"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={loading || !canSubmit}
              className="bg-accent hover:bg-accent-dim disabled:opacity-30 disabled:cursor-not-allowed text-white font-medium rounded-lg px-5 py-2 text-sm transition"
            >
              {loading ? "Creating…" : "Create basket"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
