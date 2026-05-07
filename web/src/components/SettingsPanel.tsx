/**
 * Settings tab — Telegram, Agent, Environment, and Danger zone panels.
 *
 * Used to be a modal; now a full tab so the four panel cards can sit side
 * by side instead of stacking inside a 400px modal.
 */

import { useEffect, useState, type ReactNode } from "react";
import { api, type PolicySummary } from "../api.ts";
import { Btn, Icon, Tag, Toggle, type IconName } from "./ui.tsx";
import PolicyCard from "./PolicyCard.tsx";

interface Props {
  onLogout: () => void;
}

export default function SettingsTab({ onLogout }: Props) {
  const [authorized, setAuthorized] = useState<string[] | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [policies, setPolicies] = useState<PolicySummary[] | null>(null);

  useEffect(() => {
    api.getAuthorizedTelegramUsers()
      .then((r) => setAuthorized(r.userIds))
      .catch(() => setAuthorized([]));
    api.listPolicies()
      .then((r) => setPolicies(r.policies))
      .catch(() => setPolicies([]));
  }, []);

  const generate = async () => {
    try {
      const r = await api.pairTelegram();
      setPairingCode(r.pairingCode);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const copy = () => {
    if (!pairingCode) return;
    navigator.clipboard?.writeText(`/start ${pairingCode}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div style={{
      padding: 16,
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 12,
      maxWidth: 1100,
    }}>
      <Panel title="Telegram" icon="telegram">
        <Row label="Authorized users">
          {authorized === null ? (
            <span className="mono" style={{ fontSize: 11, color: "var(--tx-3)" }}>loading…</span>
          ) : authorized.length === 0 ? (
            <Tag tone="warn">none</Tag>
          ) : (
            <Tag tone="accent">{authorized.length} user{authorized.length === 1 ? "" : "s"}</Tag>
          )}
        </Row>
        {authorized && authorized.length > 0 && (
          <div style={{ padding: "6px 0 8px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {authorized.map((id) => (
                <code
                  key={id}
                  style={{
                    fontFamily: "var(--f-mono)", fontSize: 11,
                    color: "var(--tx-1)",
                    background: "var(--bg-2)", border: "1px solid var(--bd-1)",
                    borderRadius: 3, padding: "3px 8px",
                  }}
                >
                  {id}
                </code>
              ))}
            </div>
          </div>
        )}
        <Row label="Source">
          <span className="mono" style={{ fontSize: 11 }}>TELEGRAM_AUTHORIZED_USER_IDS</span>
        </Row>
        <Row label="Find your ID">
          <a
            href="https://t.me/userinfobot"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--ac)", fontSize: 11.5, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            @userinfobot <Icon name="external" size={11}/>
          </a>
        </Row>
        <div style={{ paddingTop: 8 }}>
          {!pairingCode ? (
            <Btn size="sm" variant="ghost" onClick={generate}>Generate one-time pairing code</Btn>
          ) : (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 10px",
              background: "var(--bg-3)", border: "1px solid var(--bd-2)",
              borderRadius: 4,
            }}>
              <code style={{ flex: 1, color: "var(--ac)", fontSize: 12, fontFamily: "var(--f-mono)" }}>
                /start {pairingCode}
              </code>
              <button
                onClick={copy}
                style={{
                  background: "transparent", border: "1px solid var(--bd-2)",
                  color: copied ? "var(--ac)" : "var(--tx-2)",
                  borderRadius: 3, padding: "2px 6px", fontSize: 10.5,
                  cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4,
                  textTransform: "uppercase", letterSpacing: ".05em",
                }}
              >
                <Icon name={copied ? "check" : "copy"} size={11}/> {copied ? "copied" : "copy"}
              </button>
            </div>
          )}
          {pairingCode && (
            <p style={{ marginTop: 6, fontSize: 11, color: "var(--tx-3)" }}>
              Code expires in 30 minutes. Send <code className="mono" style={{ color: "var(--tx-1)" }}>/start &lt;code&gt;</code> to the bot.
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Agent" icon="bolt">
        <Row label="Cron schedule">
          <span className="mono" style={{ fontSize: 11.5 }}>0 * * * *</span>
        </Row>
        <Row label="Quote token">
          <span className="mono" style={{ fontSize: 11.5 }}>USDC</span>
        </Row>
        <Row label="Default chain">
          <span className="mono" style={{ fontSize: 11.5 }}>solana</span>
        </Row>
        <Row label="Drift tolerance">
          <span className="mono num" style={{ fontSize: 11.5 }}>3.00%</span>
        </Row>
        <Row label="Daily digest">
          <Toggle on/>
        </Row>
        <Row label="Alert on denied">
          <Toggle on/>
        </Row>
      </Panel>

      <Panel title="Environment" icon="terminal">
        <Row label="Storage">
          <span className="mono" style={{ fontSize: 11.5 }}>./data/state.sqlite</span>
        </Row>
        <Row label="Solana RPC">
          <span className="mono" style={{ fontSize: 11.5 }}>helius · mainnet</span>
        </Row>
        <Row label="Base RPC">
          <span className="mono" style={{ fontSize: 11.5 }}>alchemy · mainnet</span>
        </Row>
        <Row label="OWS keystore">
          <span className="mono" style={{ fontSize: 11.5 }}>~/.ows/</span>
        </Row>
        <Row label="Web port">
          <span className="mono" style={{ fontSize: 11.5 }}>8080</span>
        </Row>
        <Row label="Version">
          <span className="mono" style={{ fontSize: 11.5 }}>v0.1.0</span>
        </Row>
      </Panel>

      <Panel title="OWS policies" icon="shield">
        {policies === null ? (
          <span className="mono" style={{ fontSize: 11, color: "var(--tx-3)" }}>loading…</span>
        ) : policies.length === 0 ? (
          <p style={{ margin: 0, fontSize: 11.5, color: "var(--tx-3)", lineHeight: 1.5 }}>
            No policies yet. Run{" "}
            <code className="mono" style={{ color: "var(--tx-1)" }}>zerion agent create-policy</code>
            {" "}from your terminal to set one.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
            {policies.map((p) => (
              <PolicyCard key={p.id} policyId={p.id}/>
            ))}
            <p style={{ margin: 0, fontSize: 11, color: "var(--tx-3)", lineHeight: 1.45 }}>
              These rules are enforced by your local OWS keystore at signing time —
              the dashboard only displays them. They cannot be bypassed by the agent.
            </p>
          </div>
        )}
      </Panel>

      <Panel title="Danger zone" icon="alert" tone="danger">
        <Row label="Sign out">
          <Btn size="sm" variant="ghost" onClick={onLogout}>Sign out</Btn>
        </Row>
        <Row label="Pause every basket">
          <Btn size="sm" variant="ghost" disabled>Pause all</Btn>
        </Row>
        <Row label="Wipe local state">
          <Btn size="sm" danger disabled title="Coming soon">Wipe</Btn>
        </Row>
        <p style={{
          marginTop: 8, fontSize: 11, color: "var(--tx-3)",
          padding: "8px 10px", background: "var(--bg-2)",
          border: "1px solid var(--bd-1)", borderRadius: 3,
          lineHeight: 1.45,
        }}>
          Wiping clears the local SQLite cache only. Your OWS keystore at <code className="mono" style={{ color: "var(--tx-1)" }}>~/.ows/</code> is untouched.
        </p>
      </Panel>
    </div>
  );
}

function Panel({ title, icon, tone, children }: { title: string; icon: IconName; tone?: "danger"; children: ReactNode }) {
  return (
    <section style={{
      border: "1px solid " + (tone === "danger" ? "color-mix(in oklab, var(--danger) 30%, var(--bd-2))" : "var(--bd-2)"),
      borderRadius: 5,
      background: "var(--bg-1)",
    }}>
      <div style={{
        padding: "10px 14px", borderBottom: "1px solid var(--bd-1)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ color: tone === "danger" ? "var(--danger)" : "var(--ac)" }}>
          <Icon name={icon} size={13}/>
        </span>
        <span style={{ fontSize: 12.5, color: "var(--tx-0)", fontWeight: 600 }}>{title}</span>
      </div>
      <div style={{ padding: "4px 14px 12px" }}>{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center",
      minHeight: 32, padding: "4px 0",
      borderBottom: "1px solid var(--bd-1)",
    }}>
      <span style={{ fontSize: 12, color: "var(--tx-2)", flex: 1 }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}
