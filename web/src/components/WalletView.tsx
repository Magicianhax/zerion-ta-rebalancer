import { useState } from "react";
import type { Chain, WalletInfo } from "../api.ts";
import { fmtUsd, fmtPercent, fmtRelative } from "../utils/format.ts";
import { Btn, ChainBadge, ColCell, DriftBar, Icon, TokenChip } from "./ui.tsx";

interface Holding {
  symbol: string;
  chain: Chain;
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
  wallets: WalletData[] | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
}

export default function WalletView({ wallets, loading, onRefresh }: Props) {
  if (wallets === null) {
    return (
      <div style={{ padding: 16 }}>
        <div className="skel" style={{ height: 96, marginBottom: 10 }}/>
        <div className="skel" style={{ height: 96 }}/>
      </div>
    );
  }

  if (wallets.length === 0) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{
          border: "1px dashed var(--bd-2)", borderRadius: 6,
          padding: 32, background: "var(--bg-1)",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
        }}>
          <span style={{ color: "var(--tx-3)" }}><Icon name="wallet" size={20}/></span>
          <h3 style={{ margin: 0, fontSize: 14, color: "var(--tx-0)", fontWeight: 600 }}>No wallets yet</h3>
          <p style={{ margin: 0, fontSize: 12, color: "var(--tx-2)", maxWidth: 400, textAlign: "center" }}>
            Create one via the setup wizard:
          </p>
          <code style={{
            fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--tx-1)",
            background: "var(--bg-2)", border: "1px solid var(--bd-2)",
            borderRadius: 4, padding: "4px 10px",
          }}>npm run setup</code>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 14, color: "var(--tx-0)", fontWeight: 600 }}>Wallets</h2>
        <span className="mono" style={{ fontSize: 11, color: "var(--tx-3)" }}>· {wallets.length} keystore{wallets.length === 1 ? "" : "s"} · OWS-managed</span>
        <span style={{ flex: 1 }}/>
        <Btn variant="ghost" size="sm" leftIcon="refresh" onClick={onRefresh} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh balances"}
        </Btn>
      </div>

      {wallets.map((w) => (
        <WalletPanel key={w.info.name} w={w}/>
      ))}
    </div>
  );
}

function WalletPanel({ w }: { w: WalletData }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
  };

  // Group holdings by chain so each chain's USDC and tokens are visible at once.
  const byChain: Record<Chain, Holding[]> = { solana: [], base: [] };
  for (const h of w.holdings) byChain[h.chain].push(h);

  return (
    <div style={{
      border: "1px solid var(--bd-2)", borderRadius: 5,
      background: "var(--bg-1)", overflow: "hidden",
    }}>
      <div style={{
        padding: "12px 16px", borderBottom: "1px solid var(--bd-1)",
        display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr auto",
        alignItems: "center", gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 4,
            background: "var(--bg-3)", border: "1px solid var(--bd-2)",
            display: "grid", placeItems: "center", color: "var(--ac)",
          }}>
            <Icon name="wallet" size={14}/>
          </div>
          <div>
            <div style={{ fontSize: 13, color: "var(--tx-0)", fontWeight: 600 }}>{w.info.name}</div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--tx-3)", marginTop: 2 }}>
              created {new Date(w.info.createdAt).toLocaleDateString()}
            </div>
          </div>
        </div>
        <ColCell
          label="Balance"
          main={fmtUsd(w.totalUsd)}
          sub={<span>{w.holdings.length} token{w.holdings.length === 1 ? "" : "s"}</span>}
        />
        <ColCell
          label="Updated"
          main={<span className="mono" style={{ fontSize: 12 }}>{w.fetchedAt ? fmtRelative(w.fetchedAt) : "—"}</span>}
          sub={<DriftBar pct={0}/>}
        />
        <div style={{ display: "flex", gap: 4 }}>
          {w.info.solAddress && (
            <Btn
              size="sm" variant="ghost" leftIcon={copied === `${w.info.name}-sol` ? "check" : "copy"}
              onClick={() => copy(w.info.solAddress!, `${w.info.name}-sol`)}
              title="Copy Solana address"
            >
              {copied === `${w.info.name}-sol` ? "Copied" : "SOL addr"}
            </Btn>
          )}
          {w.info.evmAddress && (
            <Btn
              size="sm" variant="ghost" leftIcon={copied === `${w.info.name}-evm` ? "check" : "copy"}
              onClick={() => copy(w.info.evmAddress!, `${w.info.name}-evm`)}
              title="Copy Base address"
            >
              {copied === `${w.info.name}-evm` ? "Copied" : "Base addr"}
            </Btn>
          )}
        </div>
      </div>

      {/* Addresses */}
      <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 6, borderBottom: "1px solid var(--bd-1)" }}>
        {w.info.solAddress && (
          <AddressRow
            chain="solana"
            address={w.info.solAddress}
            explorer={`https://solscan.io/account/${w.info.solAddress}`}
            copied={copied === `${w.info.name}-sol-addr`}
            onCopy={() => copy(w.info.solAddress!, `${w.info.name}-sol-addr`)}
          />
        )}
        {w.info.evmAddress && (
          <AddressRow
            chain="base"
            address={w.info.evmAddress}
            explorer={`https://basescan.org/address/${w.info.evmAddress}`}
            copied={copied === `${w.info.name}-evm-addr`}
            onCopy={() => copy(w.info.evmAddress, `${w.info.name}-evm-addr`)}
          />
        )}
      </div>

      {w.errors.length > 0 && (
        <div style={{
          padding: "8px 16px", display: "flex", alignItems: "center", gap: 8,
          background: "color-mix(in oklab, var(--warn) 8%, var(--bg-2))",
          color: "var(--warn)", fontSize: 11,
          borderBottom: "1px solid var(--bd-1)",
        }}>
          <Icon name="alert" size={12}/>
          <span className="mono" style={{ flex: 1 }}>{w.errors.join(" · ")}</span>
        </div>
      )}

      {/* Holdings table */}
      {w.holdings.length === 0 ? (
        <div style={{ padding: 16, fontSize: 11.5, color: "var(--tx-3)" }}>
          No holdings yet. Send USDC + native gas to one of the addresses above.
        </div>
      ) : (
        <>
          <div className="t-row t-head" style={{ gridTemplateColumns: "2fr 1fr 130px 130px" }}>
            <span>Token</span>
            <span>Chain</span>
            <span style={{ textAlign: "right" }}>Value</span>
            <span style={{ textAlign: "right" }}>Share</span>
          </div>
          {w.holdings.map((h, i) => (
            <div
              key={`${h.chain}-${h.symbol}-${i}`}
              className="t-row"
              style={{ gridTemplateColumns: "2fr 1fr 130px 130px" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <TokenChip sym={h.symbol} size={20}/>
                <span className="mono" style={{ color: "var(--tx-0)", fontSize: 12, fontWeight: 600 }}>{h.symbol}</span>
              </div>
              <ChainBadge chain={h.chain} size="sm"/>
              <span className="num" style={{ textAlign: "right", color: "var(--tx-0)" }}>{fmtUsd(h.usd)}</span>
              <span className="num" style={{ textAlign: "right", color: "var(--tx-2)" }}>
                {w.totalUsd > 0 ? fmtPercent(h.usd / w.totalUsd) : "—"}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function AddressRow({ chain, address, explorer, copied, onCopy }: {
  chain: Chain; address: string; explorer: string; copied: boolean; onCopy: () => void;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "6px 10px",
      background: "var(--bg-3)", border: "1px solid var(--bd-1)",
      borderRadius: 4,
    }}>
      <ChainBadge chain={chain} size="sm" withLabel={false}/>
      <span className="mono" style={{
        fontSize: 11, color: "var(--tx-1)", flex: 1,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{address}</span>
      <button
        onClick={onCopy}
        title="Copy"
        style={{
          background: "transparent", border: "1px solid var(--bd-2)",
          color: copied ? "var(--ac)" : "var(--tx-2)",
          borderRadius: 3, padding: "2px 6px", fontSize: 10.5,
          cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4,
          fontFamily: "var(--f-sans)", textTransform: "uppercase", letterSpacing: ".05em",
        }}
      >
        <Icon name={copied ? "check" : "copy"} size={11}/>{copied ? "copied" : "copy"}
      </button>
      <a
        href={explorer}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "var(--tx-3)", display: "inline-flex", padding: 4 }}
      >
        <Icon name="external" size={11}/>
      </a>
    </div>
  );
}
