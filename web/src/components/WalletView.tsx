import { useEffect, useState } from "react";
import { Wallet, RefreshCw, Copy, Check, AlertCircle, ExternalLink } from "lucide-react";
import { api, type WalletInfo } from "../api.ts";

interface Holding {
  symbol: string;
  chain: "solana" | "base";
  usd: number;
}

interface WalletData {
  info: WalletInfo;
  totalUsd: number;
  holdings: Holding[];
  errors: string[];
  fetchedAt: string | null;
}

export default function WalletView() {
  const [wallets, setWallets] = useState<WalletData[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
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
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };

  if (wallets === null) {
    return <div className="text-ink-400 text-sm">Loading wallets…</div>;
  }

  if (wallets.length === 0) {
    return (
      <div className="border border-dashed border-ink-600 rounded-xl p-12 text-center">
        <div className="text-ink-300 mb-2">No wallets yet</div>
        <p className="text-sm text-ink-400 max-w-md mx-auto mb-4">
          Create a wallet via the setup wizard:
        </p>
        <code className="text-xs bg-ink-800 border border-ink-700 rounded px-2 py-1 text-ink-200">
          npm run setup
        </code>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Wallets</h2>
        <button
          onClick={refresh}
          disabled={loading}
          className="bg-ink-700 hover:bg-ink-600 disabled:opacity-50 text-sm rounded-lg px-3 py-2 flex items-center gap-2 transition"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {wallets.map((w) => (
        <div key={w.info.name} className="bg-ink-800 border border-ink-700 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-ink-700">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-base flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-accent" />
                  {w.info.name}
                </h3>
                <div className="text-xs text-ink-400 mt-0.5">
                  Created {new Date(w.info.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-mono">${w.totalUsd.toFixed(2)}</div>
                <div className="text-xs text-ink-400">
                  {w.fetchedAt ? `as of ${new Date(w.fetchedAt).toLocaleTimeString()}` : "—"}
                </div>
              </div>
            </div>

            <div className="space-y-2 mt-4">
              {w.info.evmAddress && (
                <AddressRow
                  chain="EVM (Base)"
                  address={w.info.evmAddress}
                  explorer={`https://basescan.org/address/${w.info.evmAddress}`}
                  copied={copied === `${w.info.name}-evm`}
                  onCopy={() => copy(w.info.evmAddress, `${w.info.name}-evm`)}
                />
              )}
              {w.info.solAddress && (
                <AddressRow
                  chain="Solana"
                  address={w.info.solAddress}
                  explorer={`https://solscan.io/account/${w.info.solAddress}`}
                  copied={copied === `${w.info.name}-sol`}
                  onCopy={() => copy(w.info.solAddress!, `${w.info.name}-sol`)}
                />
              )}
            </div>

            {w.errors.length > 0 && (
              <div className="mt-3 flex items-start gap-2 text-xs text-amber-400 bg-amber-900/10 border border-amber-900/30 rounded-lg px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <div>{w.errors.join(" · ")}</div>
              </div>
            )}
          </div>

          {w.holdings.length === 0 ? (
            <div className="p-5 text-sm text-ink-400 text-center">
              No holdings yet. Send USDC + native gas to one of the addresses above.
            </div>
          ) : (
            <div className="divide-y divide-ink-700">
              {w.holdings.map((h, i) => (
                <div key={`${h.chain}-${h.symbol}-${i}`} className="flex items-center justify-between px-5 py-3 hover:bg-ink-900/30 transition">
                  <div>
                    <div className="font-mono text-sm">{h.symbol}</div>
                    <div className="text-xs text-ink-400 capitalize">{h.chain}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm">${h.usd.toFixed(2)}</div>
                    <div className="text-xs text-ink-400">
                      {((h.usd / w.totalUsd) * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AddressRow({
  chain,
  address,
  explorer,
  copied,
  onCopy,
}: {
  chain: string;
  address: string;
  explorer: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs bg-ink-900/40 rounded-lg px-3 py-2">
      <span className="text-ink-400 w-20 shrink-0">{chain}</span>
      <code className="font-mono text-ink-200 flex-1 truncate">{address}</code>
      <button onClick={onCopy} className="p-1 hover:bg-ink-700 rounded" title="Copy">
        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      </button>
      <a
        href={explorer}
        target="_blank"
        rel="noopener noreferrer"
        className="p-1 hover:bg-ink-700 rounded"
        title="View on explorer"
      >
        <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}
