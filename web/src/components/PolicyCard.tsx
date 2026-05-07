/**
 * Renders a real OWS policy in the basket side panel.
 *
 * The policy comes from `zerion agent show-policy --id <id>` via the
 * /agent/policies/:id endpoint. This is the actual source of truth — the
 * keystore enforces these rules at signing time, not the app layer — so
 * the display here doubles as the user's audit trail of "what did I
 * actually authorize?".
 */

import { useEffect, useState } from "react";
import { api, type PolicyDetail } from "../api.ts";
import { Icon } from "./ui.tsx";

interface Props {
  policyId: string;
}

export default function PolicyCard({ policyId }: Props) {
  const [policy, setPolicy] = useState<PolicyDetail | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    api.getPolicy(policyId)
      .then((r) => alive && setPolicy(r.policy))
      .catch(() => alive && setPolicy(null));
    return () => { alive = false; };
  }, [policyId]);

  if (policy === undefined) return <Stub><span className="mono" style={{ color: "var(--tx-3)" }}>loading policy…</span></Stub>;
  if (policy === null) return <Stub><span className="mono" style={{ color: "var(--tx-3)" }}>policy {policyId} unavailable</span></Stub>;

  const lines = renderRules(policy);

  return (
    <div style={{ background: "var(--bg-1)", border: "1px solid var(--bd-1)", borderRadius: 4, padding: 8 }}>
      <div className="mono" style={{ fontSize: 11, color: "var(--tx-1)", lineHeight: 1.6 }}>
        <div style={{ color: "var(--tx-3)", fontSize: 10.5, marginBottom: 4 }}>
          <span style={{ color: "var(--tx-1)" }}>{policy.name}</span>
          <span style={{ marginLeft: 6, color: "var(--tx-3)" }}>· {policy.id}</span>
        </div>
        {lines.length === 0 ? (
          <div style={{ color: "var(--tx-3)" }}>No rules — open policy</div>
        ) : (
          lines.map((line, i) => <div key={i}>{line}</div>)
        )}
      </div>
    </div>
  );
}

function Stub({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--bg-1)", border: "1px solid var(--bd-1)", borderRadius: 4, padding: 8 }}>
      {children}
    </div>
  );
}

/**
 * Translate a policy's rules + config into a list of human-readable lines.
 * Each line is intentionally one fact so the user can scan top-to-bottom.
 */
function renderRules(policy: PolicyDetail): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const rules = policy.rules ?? [];

  for (const r of rules) {
    if (r.type === "allowed_chains") {
      const chains = (r as { chains?: unknown }).chains;
      const list = Array.isArray(chains) ? chains.filter((x) => typeof x === "string") : [];
      if (list.length === 0) {
        out.push(<span style={{ color: "var(--tx-3)" }}>chain lock (no chains listed)</span>);
      } else {
        out.push(
          <span>
            chain == <span style={{ color: "var(--tx-0)" }}>{list.join(", ")}</span>
          </span>,
        );
      }
    } else if (r.type === "expires_at" || r.type === "expiry") {
      // Tolerate seconds, ms, ISO strings, or missing values without crashing
      // — keystore versions have differed on this field's shape.
      const raw = (r as { timestamp?: unknown; expires_at?: unknown }).timestamp
        ?? (r as { expires_at?: unknown }).expires_at;
      const ms = parseTimestamp(raw);
      if (ms == null) {
        out.push(<span style={{ color: "var(--tx-3)" }}>expiry set (date unparseable)</span>);
      } else {
        const when = new Date(ms).toISOString().slice(0, 10);
        const expired = ms < Date.now();
        out.push(
          <span>
            expires <span style={{ color: expired ? "var(--danger)" : "var(--tx-0)" }}>{when}</span>
            {expired && <span style={{ marginLeft: 6, color: "var(--danger)" }}>· expired</span>}
          </span>,
        );
      }
    } else {
      // Unknown rule type — show the type so we don't silently hide it.
      out.push(<span style={{ color: "var(--tx-3)" }}>rule: {r.type}</span>);
    }
  }

  // Executable script details — daily spend cap is the most common.
  const cfg = policy.config;
  if (cfg?.daily_tx_limit != null) {
    const tok = cfg.token_name ? ` ${cfg.token_name}` : "";
    out.push(
      <span>
        spend ≤ <span style={{ color: "var(--tx-0)" }}>${cfg.daily_tx_limit}</span>
        <span style={{ color: "var(--tx-3)" }}> / 24h{tok}</span>
      </span>,
    );
  }
  if (cfg?.allowed_addresses && cfg.allowed_addresses.length > 0) {
    out.push(
      <span>
        allowlist <span style={{ color: "var(--tx-0)" }}>{cfg.allowed_addresses.length} address{cfg.allowed_addresses.length === 1 ? "" : "es"}</span>
      </span>,
    );
  }
  if (cfg?.scripts && cfg.scripts.length > 0) {
    out.push(
      <span>
        scripts: <span style={{ color: "var(--tx-0)" }}>{cfg.scripts.map((s) => s.split(/[\\/]/).pop()).join(", ")}</span>
      </span>,
    );
  } else if (policy.executable && (!cfg?.scripts || cfg.scripts.length === 0)) {
    // Executable wrapper present but no scripts listed — just acknowledge it.
    out.push(<span style={{ color: "var(--tx-3)" }}>executable wrapper attached</span>);
  }

  if (out.length === 0) {
    out.push(
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Icon name="alert" size={11}/> open policy — no rules set
      </span>,
    );
  }
  return out;
}

/**
 * Coerce whatever the keystore returned into milliseconds since epoch,
 * or null if it can't be parsed. Accepts:
 *   - number (seconds if < 1e12, ms otherwise)
 *   - numeric string ("1735689600" or "1735689600000")
 *   - ISO string ("2026-06-01T00:00:00Z")
 */
function parseTimestamp(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw < 1e12 ? raw * 1000 : raw;
  }
  if (typeof raw === "string" && raw.length > 0) {
    const asNum = Number(raw);
    if (Number.isFinite(asNum)) return asNum < 1e12 ? asNum * 1000 : asNum;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
