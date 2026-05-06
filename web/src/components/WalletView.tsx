import { useEffect, useState } from "react";
import { Wallet, RefreshCw, Copy, Check, AlertCircle, ExternalLink } from "lucide-react";
import { api, type WalletInfo } from "../api.ts";
import { fmtUsd, fmtPercent, fmtAddress, fmtRelative } from "../utils/format.ts";

interface Holding {
  symbol: string;
  chain: "solana" | "base";
  usd: number;
  logoUrl: string | null;
}

export interface WalletData {
  info: WalletInfo;
  totalUsd: number;
  holdings: Holding[];
  errors: string[];
  fetchedAt: string | null;
}

interface Props {
  /** Cached wallet data lifted to a parent so tab switches don't refetch. */
  wallets: WalletData[] | null;
  loading: boolean;
  /** Manual refresh — only fires on user click. */
  onRefresh: () => Promise<void>;
}

export default function WalletView({ wallets, loading, onRefresh }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

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
          onClick={onRefresh}
          disabled={loading}
          className="bg-ink-700 hover:bg-ink-600 disabled:opacity-50 text-sm rounded-lg px-3 py-2 flex items-center gap-2 transition"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {wallets.map((w) => (
        <div key={w.info.name} className="bg-ink-800 border border-ink-700 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-ink-700 bg-gradient-to-br from-accent/5 via-transparent to-transparent">
            <div className="flex items-start justify-between mb-4">
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
                <div className="text-3xl font-semibold tracking-tight tabular-nums">{fmtUsd(w.totalUsd)}</div>
                <div className="text-xs text-ink-400">
                  {w.fetchedAt ? `Updated ${fmtRelative(w.fetchedAt)}` : "—"}
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
                  <div className="flex items-center gap-3 min-w-0">
                    <TokenAvatar symbol={h.symbol} logoUrl={h.logoUrl} />
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{h.symbol}</div>
                      <div className="text-xs text-ink-400 capitalize">{h.chain}</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-medium text-sm tabular-nums">{fmtUsd(h.usd)}</div>
                    <div className="text-xs text-ink-400 tabular-nums">{fmtPercent(h.usd / w.totalUsd)}</div>
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

/**
 * Token avatar — real logo when we have a URL, falls back to a colored
 * letter chip. The img onError swap handles dead/blocked CDNs at runtime.
 */
function TokenAvatar({ symbol, logoUrl }: { symbol: string; logoUrl: string | null }) {
  const [errored, setErrored] = useState(false);
  if (!logoUrl || errored) {
    return (
      <div className="w-9 h-9 rounded-full bg-accent/10 flex items-center justify-center text-xs font-mono font-medium text-accent border border-accent/20 shrink-0">
        {symbol.slice(0, 3)}
      </div>
    );
  }
  return (
    <img
      src={logoUrl}
      alt={symbol}
      loading="lazy"
      onError={() => setErrored(true)}
      className="w-9 h-9 rounded-full shrink-0 bg-ink-700 ring-1 ring-ink-700"
    />
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
    <div className="flex items-center gap-2 text-xs bg-ink-900/40 rounded-lg px-3 py-2 group">
      <span className="text-ink-400 w-20 shrink-0">{chain}</span>
      <code className="font-mono text-ink-200 flex-1 truncate" title={address}>
        <span className="hidden sm:inline">{address}</span>
        <span className="sm:hidden">{fmtAddress(address)}</span>
      </code>
      <button onClick={onCopy} className="p-1.5 hover:bg-ink-700 rounded transition" title="Copy">
        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      </button>
      <a
        href={explorer}
        target="_blank"
        rel="noopener noreferrer"
        className="p-1.5 hover:bg-ink-700 rounded transition"
        title="View on explorer"
      >
        <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}
