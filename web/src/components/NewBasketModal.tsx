import { useEffect, useState } from "react";
import { X, AlertCircle } from "lucide-react";
import { api, type Chain, type TokenEntry, type WalletInfo } from "../api.ts";

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

interface Selection {
  symbol: string;
  weight: number;
}

export default function NewBasketModal({ onClose, onCreated }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [chain, setChain] = useState<Chain>("base");
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.listTokens(chain).then((r) => setTokens(r.tokens.filter((t) => !t.isQuote))).catch(() => {});
  }, [chain]);

  useEffect(() => {
    api.listWallets().then((r) => setWallets(r.wallets)).catch(() => {});
    api.listPolicies().then((r) => setPolicies(r.policies)).catch(() => {});
    api.listAgentTokens().then((r) => setAgentTokens(r.tokens)).catch(() => {});
  }, []);

  const toggleToken = (sym: string) => {
    setSelections((cur) => {
      if (cur.find((s) => s.symbol === sym)) return cur.filter((s) => s.symbol !== sym);
      return [...cur, { symbol: sym, weight: 0 }];
    });
  };

  const setWeight = (sym: string, w: number) => {
    setSelections((cur) => cur.map((s) => (s.symbol === sym ? { ...s, weight: w } : s)));
  };

  const totalWeight = selections.reduce((sum, s) => sum + s.weight, 0);
  const weightOk = selections.length >= 2 && Math.abs(totalWeight - 100) < 0.01;

  const submit = async () => {
    if (!walletName || !policyId || !agentTokenName) {
      setError("Pick a wallet, policy, and agent token first.");
      return;
    }
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
        tokens: selections.map((s) => ({
          symbol: s.symbol,
          initialWeight: s.weight / 100,
        })),
      });
      onCreated();
    } catch (e: any) {
      setError(e.message ?? "Failed to create basket");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-20">
      <div className="bg-ink-800 border border-ink-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-ink-700 flex items-center justify-between sticky top-0 bg-ink-800 z-10">
          <div>
            <h2 className="text-lg font-semibold">New basket</h2>
            <p className="text-xs text-ink-400 mt-0.5">Step {step} of 3</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-ink-700 rounded-lg"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6 space-y-5">
          {step === 1 && (
            <>
              <div>
                <label className="text-sm text-ink-300 block mb-2">Basket name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-basket"
                  className="w-full bg-ink-700 border border-ink-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                />
              </div>

              <div>
                <label className="text-sm text-ink-300 block mb-2">Chain</label>
                <div className="grid grid-cols-2 gap-2">
                  {(["base", "solana"] as Chain[]).map((c) => (
                    <button
                      key={c}
                      onClick={() => { setChain(c); setSelections([]); }}
                      className={`text-sm rounded-lg py-2.5 transition border ${
                        chain === c
                          ? "bg-accent/10 border-accent text-white"
                          : "bg-ink-700 border-ink-600 text-ink-300 hover:bg-ink-600"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm text-ink-300 block mb-2">Initial budget (USDC)</label>
                <input
                  type="number"
                  value={budget}
                  onChange={(e) => setBudget(Number(e.target.value))}
                  min={10}
                  className="w-full bg-ink-700 border border-ink-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                />
                <p className="text-xs text-ink-400 mt-1">You'll fund this manually after the basket is created.</p>
              </div>

              <div>
                <label className="text-sm text-ink-300 block mb-2">
                  TA bias: <span className="text-accent">{(taBias * 100).toFixed(0)}%</span>
                </label>
                <input
                  type="range" min={0} max={1} step={0.05}
                  value={taBias}
                  onChange={(e) => setTaBias(Number(e.target.value))}
                  className="w-full"
                />
                <p className="text-xs text-ink-400 mt-1">
                  0% = stick to your initial weights. 100% = fully follow TA signals each tick.
                </p>
              </div>

              <button
                onClick={() => setStep(2)}
                disabled={!name}
                className="w-full bg-accent hover:bg-accent-dim disabled:opacity-50 text-white font-medium rounded-lg py-2.5 transition"
              >
                Pick tokens →
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-sm text-ink-300">
                Pick at least 2 tokens. Set initial weights (must sum to 100%).
              </p>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {tokens.map((t) => {
                  const sel = selections.find((s) => s.symbol === t.symbol);
                  return (
                    <div key={t.symbol} className="flex items-center gap-3 p-3 bg-ink-700 rounded-lg">
                      <input type="checkbox" checked={!!sel} onChange={() => toggleToken(t.symbol)} className="w-4 h-4 accent-accent" />
                      <div className="flex-1">
                        <div className="font-mono text-sm">{t.symbol}</div>
                        <div className="text-xs text-ink-400">{t.name}</div>
                      </div>
                      {sel && (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0} max={100} step={1}
                            value={sel.weight}
                            onChange={(e) => setWeight(t.symbol, Number(e.target.value))}
                            className="w-16 bg-ink-800 border border-ink-600 rounded px-2 py-1 text-sm text-right"
                          />
                          <span className="text-xs text-ink-400">%</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className={`text-sm flex items-center gap-2 ${weightOk ? "text-emerald-400" : "text-amber-400"}`}>
                <AlertCircle className="w-4 h-4" /> Total: {totalWeight}% {weightOk ? "" : "(must equal 100%)"}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 bg-ink-700 hover:bg-ink-600 text-sm rounded-lg py-2.5 transition"
                >
                  ← Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!weightOk}
                  className="flex-1 bg-accent hover:bg-accent-dim disabled:opacity-50 text-white font-medium rounded-lg py-2.5 transition"
                >
                  Wallet & policy →
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <p className="text-sm text-ink-300">
                Pick a wallet, policy, and agent token (created via <code className="text-ink-200">npm run setup</code>).
              </p>

              <div>
                <label className="text-sm text-ink-300 block mb-2">Wallet</label>
                <select
                  value={walletName}
                  onChange={(e) => setWalletName(e.target.value)}
                  className="w-full bg-ink-700 border border-ink-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                >
                  <option value="">Choose…</option>
                  {wallets.map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
                </select>
              </div>

              <div>
                <label className="text-sm text-ink-300 block mb-2">Policy</label>
                <select
                  value={policyId}
                  onChange={(e) => setPolicyId(e.target.value)}
                  className="w-full bg-ink-700 border border-ink-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                >
                  <option value="">Choose…</option>
                  {policies.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
                </select>
              </div>

              <div>
                <label className="text-sm text-ink-300 block mb-2">Agent token</label>
                <select
                  value={agentTokenName}
                  onChange={(e) => setAgentTokenName(e.target.value)}
                  className="w-full bg-ink-700 border border-ink-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                >
                  <option value="">Choose…</option>
                  {agentTokens.map((t: any) => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>
              </div>

              {error && <div className="text-sm text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg p-3">{error}</div>}

              <div className="flex gap-2">
                <button
                  onClick={() => setStep(2)}
                  className="flex-1 bg-ink-700 hover:bg-ink-600 text-sm rounded-lg py-2.5 transition"
                >
                  ← Back
                </button>
                <button
                  onClick={submit}
                  disabled={loading || !walletName || !policyId || !agentTokenName}
                  className="flex-1 bg-accent hover:bg-accent-dim disabled:opacity-50 text-white font-medium rounded-lg py-2.5 transition"
                >
                  {loading ? "Creating…" : "Create basket"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
