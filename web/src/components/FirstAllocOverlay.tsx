/**
 * Bottom-right "first allocation in flight" toast.
 *
 * Driven by the parent (Dashboard): shows up when a basket is created, and
 * advances via SSE rebalance:start / rebalance:done events. The overlay
 * synthesizes the intermediate stages on a timer so the user sees motion
 * while the backend chews through the swap pipeline.
 */

import { useEffect, useRef, useState } from "react";
import { Btn, Icon } from "./ui.tsx";

export type AllocStage = "queued" | "quoting" | "signing" | "swapping" | "settling" | "done";

const STAGES: Array<{ k: AllocStage; label: string; desc: string }> = [
  { k: "queued",   label: "Queued",   desc: "Waiting for first tick"    },
  { k: "quoting",  label: "Quoting",  desc: "Routing through USDC"      },
  { k: "signing",  label: "Signing",  desc: "OWS policy enforced"       },
  { k: "swapping", label: "Swapping", desc: "Transactions submitted"    },
  { k: "settling", label: "Settling", desc: "Waiting for confirmations" },
  { k: "done",     label: "Done",     desc: "Basket populated"          },
];

interface Props {
  basketId: string | null;
  /** Stage hint from the parent — usually "queued" then "quoting" then "done". */
  stage: AllocStage;
  onDismiss: () => void;
}

export default function FirstAllocOverlay({ basketId, stage, onDismiss }: Props) {
  // Local stage walks the timeline so the user sees motion while the parent
  // only knows queued/quoting/done. The parent's stage is the upper bound.
  const [localStage, setLocalStage] = useState<AllocStage>("queued");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!basketId) {
      setLocalStage("queued");
      return;
    }
    setLocalStage("queued");

    // Walk through stages until we reach the parent's max, pausing on each.
    const order: AllocStage[] = ["queued", "quoting", "signing", "swapping", "settling", "done"];
    const delays: Record<AllocStage, number> = {
      queued: 600, quoting: 900, signing: 700, swapping: 1200, settling: 900, done: 0,
    };

    let cancelled = false;
    const advance = (i: number) => {
      if (cancelled) return;
      const cur = order[i]!;
      setLocalStage(cur);
      const parentIdx = order.indexOf(stage);
      const next = order[i + 1];
      if (!next) return;
      // Don't run past the parent's stage unless parent is "done".
      if (parentIdx >= 0 && i + 1 > parentIdx && stage !== "done") return;
      timerRef.current = window.setTimeout(() => advance(i + 1), delays[cur]);
    };
    advance(0);

    return () => {
      cancelled = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basketId, stage]);

  // When the parent flips to "done", jump there visually.
  useEffect(() => {
    if (stage === "done") setLocalStage("done");
  }, [stage]);

  if (!basketId) return null;

  const idx = Math.max(0, STAGES.findIndex((s) => s.k === localStage));
  const isDone = localStage === "done";

  return (
    <div className="fade-in" style={{
      position: "fixed", right: 16, bottom: 36, zIndex: 90,
      width: 360, background: "var(--bg-1)",
      border: "1px solid var(--bd-3)", borderRadius: 6,
      boxShadow: "var(--sh-2)", overflow: "hidden",
    }}>
      <div style={{
        padding: "12px 14px 8px",
        display: "flex", alignItems: "center", gap: 8,
        borderBottom: "1px solid var(--bd-1)",
      }}>
        <span
          className={isDone ? "" : "dot-pulse"}
          style={{
            width: 8, height: 8, borderRadius: 999,
            background: isDone ? "var(--ok)" : "var(--ac)",
            boxShadow: `0 0 10px ${isDone ? "var(--ok)" : "var(--ac)"}`,
          }}
        />
        <span style={{ fontSize: 12.5, color: "var(--tx-0)", fontWeight: 600 }}>
          {isDone ? "First allocation complete" : "First allocation in flight"}
        </span>
        <span style={{ flex: 1 }}/>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--tx-3)" }}>{idx + 1}/{STAGES.length}</span>
      </div>

      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        {STAGES.map((s, i) => (
          <div key={s.k} style={{ display: "flex", alignItems: "center", gap: 8, opacity: i > idx ? .35 : 1 }}>
            <span style={{
              width: 16, height: 16, borderRadius: 999,
              border: `1px solid ${i <= idx ? "var(--ac)" : "var(--bd-2)"}`,
              background: i < idx ? "var(--ac)" : (i === idx ? "var(--ac-bg)" : "transparent"),
              display: "grid", placeItems: "center", flex: "0 0 auto",
            }}>
              {i < idx && <Icon name="check" size={9} stroke={2.5}/>}
              {i === idx && !isDone && (
                <span className="dot-pulse" style={{ width: 6, height: 6, borderRadius: 999, background: "var(--ac)" }}/>
              )}
              {i === idx && isDone && <Icon name="check" size={9} stroke={2.5}/>}
            </span>
            <span className="mono" style={{ fontSize: 11.5, color: i <= idx ? "var(--tx-0)" : "var(--tx-2)" }}>{s.label}</span>
            <span style={{ fontSize: 11, color: "var(--tx-3)", flex: 1 }}>{s.desc}</span>
            {i < idx && <span className="mono" style={{ fontSize: 10.5, color: "var(--tx-3)" }}>ok</span>}
          </div>
        ))}
      </div>

      {isDone && (
        <div className="fade-in" style={{
          padding: "8px 14px 12px",
          borderTop: "1px solid var(--bd-1)",
          display: "flex", gap: 6, justifyContent: "flex-end",
        }}>
          <Btn size="sm" variant="bare" onClick={onDismiss}>Dismiss</Btn>
        </div>
      )}
    </div>
  );
}
