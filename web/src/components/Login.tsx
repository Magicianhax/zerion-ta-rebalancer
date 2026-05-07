import { useState } from "react";
import { api, setToken } from "../api.ts";
import { Btn, Icon } from "./ui.tsx";

export default function Login({ onAuthed }: { onAuthed: () => void }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!pw) return setErr("Passphrase required");
    setBusy(true);
    setErr("");
    try {
      const res = await api.login(pw);
      setToken(res.token);
      onAuthed();
    } catch (e: any) {
      setErr(e.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-0)", display: "grid", placeItems: "center", padding: 24, position: "relative", overflow: "hidden" }}>
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage:
          "radial-gradient(circle at 20% 30%, color-mix(in oklab, var(--ac) 8%, transparent), transparent 50%)," +
          "radial-gradient(circle at 80% 70%, color-mix(in oklab, var(--info) 6%, transparent), transparent 50%)",
      }}/>

      <div className="scale-in" style={{
        width: 380, background: "var(--bg-1)",
        border: "1px solid var(--bd-2)", borderRadius: 6,
        padding: 28, position: "relative",
        boxShadow: "var(--sh-2)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 4,
            background: "linear-gradient(135deg, var(--ac), var(--ac-dd))",
            display: "grid", placeItems: "center", color: "#06120a",
          }}>
            <Icon name="bolt" size={16} stroke={2.2}/>
          </div>
          <div>
            <div style={{ fontSize: 13, color: "var(--tx-0)", fontWeight: 600, letterSpacing: ".01em" }}>Zerion TA Rebalancer</div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--tx-3)", marginTop: 2 }}>self-hosted · localhost</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "var(--tx-0)", letterSpacing: "-.01em" }}>Unlock dashboard</h1>
          <p style={{ margin: 0, fontSize: 12, color: "var(--tx-2)" }}>
            Sign in with the admin password from your <span className="mono" style={{ color: "var(--tx-1)" }}>.env</span>. Nothing leaves this machine.
          </p>
        </div>

        <form onSubmit={submit}>
          <label style={{ display: "block", marginBottom: 14 }}>
            <div style={{
              fontSize: 10.5, color: "var(--tx-3)",
              textTransform: "uppercase", letterSpacing: ".06em",
              marginBottom: 6, display: "flex", justifyContent: "space-between",
            }}>
              <span>Password</span>
              <span className="mono" style={{ textTransform: "none", letterSpacing: 0 }}>ADMIN_PASSWORD</span>
            </div>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--tx-3)" }}>
                <Icon name="key" size={13}/>
              </span>
              <input
                type="password"
                autoFocus
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="••••••••••••"
                style={{
                  width: "100%", height: 36, padding: "0 12px 0 30px",
                  background: "var(--bg-3)",
                  border: `1px solid ${err ? "var(--danger)" : "var(--bd-2)"}`,
                  color: "var(--tx-0)", borderRadius: 4, outline: "none",
                  fontSize: 13, fontFamily: "var(--f-mono)", letterSpacing: ".05em",
                }}
              />
            </div>
            {err && <div style={{ marginTop: 6, color: "var(--danger)", fontSize: 11.5 }}>{err}</div>}
          </label>

          <Btn variant="primary" size="lg" type="submit" disabled={busy}
            style={{ width: "100%", justifyContent: "center" }} onClick={() => submit()}>
            {busy ? "Unlocking…" : "Unlock"}
            {!busy && (
              <span style={{ opacity: .6, marginLeft: 8 }}>
                <span className="kbd" style={{ background: "rgba(0,0,0,.2)", borderColor: "rgba(0,0,0,.3)", color: "#06120a" }}>↵</span>
              </span>
            )}
          </Btn>
        </form>

        <div style={{
          marginTop: 18, paddingTop: 14,
          borderTop: "1px solid var(--bd-1)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--tx-3)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="lock" size={11}/> Single-user · self-hosted
          </span>
          <span style={{ fontSize: 11, color: "var(--tx-3)" }}>OWS-bounded</span>
        </div>
      </div>
    </div>
  );
}
