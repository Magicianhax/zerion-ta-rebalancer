/**
 * Shared atoms used across screens — Icon, ChainBadge, StatusDot, Btn,
 * IconBtn, Tag, Sparkline, TokenChip, SegBar, ColCell, ActionDot, DriftBar,
 * WeightBar, TaScore, GuardRow, AllocationDonut.
 *
 * Style is inline-CSS-variable-driven to match the design tokens; we only
 * lean on Tailwind for layout helpers in screen-level components.
 */

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { Chain } from "../api.ts";

/* -------------------------------------------------------------------------- */
/*  Icon                                                                      */
/* -------------------------------------------------------------------------- */
export type IconName =
  | "basket" | "wallet" | "activity" | "settings" | "play" | "pause" | "refresh"
  | "trash" | "copy" | "external" | "plus" | "search" | "chevron-down"
  | "chevron-right" | "chevron-left" | "check" | "x" | "alert" | "shield"
  | "lock" | "key" | "bolt" | "more" | "filter" | "send" | "panel" | "dot"
  | "sparkles" | "telegram" | "terminal";

interface IconProps {
  name: IconName;
  size?: number;
  stroke?: number;
}
export function Icon({ name, size = 14, stroke = 1.6 }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "basket":   return <svg {...common}><path d="M5 11h14l-1.4 8.2a2 2 0 0 1-2 1.8H8.4a2 2 0 0 1-2-1.8L5 11Z"/><path d="M9 11 12 4l3 7"/></svg>;
    case "wallet":   return <svg {...common}><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M16 13h2"/><path d="M3 10h18"/></svg>;
    case "activity": return <svg {...common}><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>;
    case "settings": return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>;
    case "play":     return <svg {...common}><polygon points="6 4 20 12 6 20 6 4"/></svg>;
    case "pause":    return <svg {...common}><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>;
    case "refresh":  return <svg {...common}><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>;
    case "trash":    return <svg {...common}><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>;
    case "copy":     return <svg {...common}><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>;
    case "external": return <svg {...common}><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5"/></svg>;
    case "plus":     return <svg {...common}><path d="M12 5v14"/><path d="M5 12h14"/></svg>;
    case "search":   return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>;
    case "chevron-down":  return <svg {...common}><polyline points="6 9 12 15 18 9"/></svg>;
    case "chevron-right": return <svg {...common}><polyline points="9 6 15 12 9 18"/></svg>;
    case "chevron-left":  return <svg {...common}><polyline points="15 6 9 12 15 18"/></svg>;
    case "check":    return <svg {...common}><polyline points="4 12 10 18 20 6"/></svg>;
    case "x":        return <svg {...common}><path d="M6 6l12 12"/><path d="M18 6 6 18"/></svg>;
    case "alert":    return <svg {...common}><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>;
    case "shield":   return <svg {...common}><path d="M12 2 4 6v6c0 5 4 9 8 10 4-1 8-5 8-10V6l-8-4Z"/></svg>;
    case "lock":     return <svg {...common}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 1 1 8 0v4"/></svg>;
    case "key":      return <svg {...common}><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9"/><path d="m17 6 3 3"/></svg>;
    case "bolt":     return <svg {...common}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
    case "more":     return <svg {...common}><circle cx="6"  cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/></svg>;
    case "filter":   return <svg {...common}><path d="M3 5h18l-7 9v6l-4-2v-4L3 5Z"/></svg>;
    case "send":     return <svg {...common}><path d="m22 2-7 20-4-9-9-4 20-7Z"/></svg>;
    case "panel":    return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>;
    case "dot":      return <svg {...common}><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/></svg>;
    case "sparkles": return <svg {...common}><path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="m6 6 2.5 2.5"/><path d="m15.5 15.5 2.5 2.5"/><path d="m6 18 2.5-2.5"/><path d="m15.5 8.5 2.5-2.5"/></svg>;
    case "telegram": return <svg {...common}><path d="m22 3-9 18-2-8-8-2 19-8Z"/></svg>;
    case "terminal": return <svg {...common}><polyline points="4 7 9 12 4 17"/><path d="M12 19h8"/></svg>;
  }
}

/* -------------------------------------------------------------------------- */
/*  ChainBadge                                                                */
/* -------------------------------------------------------------------------- */
const CHAIN_META: Record<Chain, { name: string; short: string; color: string }> = {
  solana: { name: "Solana", short: "SOL",  color: "var(--chain-sol)" },
  base:   { name: "Base",   short: "BASE", color: "var(--chain-base)" },
};

interface ChainBadgeProps {
  chain: Chain;
  withLabel?: boolean;
  size?: "sm" | "md";
}
export function ChainBadge({ chain, withLabel = true, size = "sm" }: ChainBadgeProps) {
  const c = CHAIN_META[chain];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      fontSize: size === "sm" ? 10.5 : 11.5,
      padding: size === "sm" ? "2px 6px 2px 5px" : "3px 8px 3px 6px",
      border: "1px solid var(--bd-2)", borderRadius: 3,
      background: "var(--bg-2)", color: "var(--tx-1)",
      textTransform: "uppercase", letterSpacing: ".05em",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: c.color, boxShadow: `0 0 8px ${c.color}` }}/>
      {withLabel ? c.name : c.short}
    </span>
  );
}

export function chainColor(chain: Chain) {
  return CHAIN_META[chain].color;
}

/* -------------------------------------------------------------------------- */
/*  StatusDot                                                                 */
/* -------------------------------------------------------------------------- */
type DotKind = "ok" | "warn" | "danger" | "paused" | "info";
export function StatusDot({ kind = "ok", pulse = false }: { kind?: DotKind; pulse?: boolean }) {
  const map: Record<DotKind, string> = {
    ok: "var(--ok)",
    warn: "var(--warn)",
    danger: "var(--danger)",
    paused: "var(--tx-3)",
    info: "var(--info)",
  };
  return (
    <span
      className={pulse ? "dot-pulse" : ""}
      style={{
        width: 7, height: 7, borderRadius: 999,
        background: map[kind],
        boxShadow: kind !== "paused" ? `0 0 6px ${map[kind]}` : "none",
        display: "inline-block",
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  Btn / IconBtn                                                             */
/* -------------------------------------------------------------------------- */
type Variant = "primary" | "secondary" | "ghost" | "bare" | "danger";
interface BtnProps {
  children?: ReactNode;
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  leftIcon?: IconName;
  rightIcon?: IconName;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
  title?: string;
  type?: "button" | "submit";
  style?: CSSProperties;
}
export function Btn({
  children, variant = "ghost", size = "md", leftIcon, rightIcon,
  onClick, disabled, danger, active, title, type = "button", style,
}: BtnProps) {
  const sizes = {
    sm: { h: 24, px: 8, fs: 11.5 },
    md: { h: 30, px: 12, fs: 12.5 },
    lg: { h: 36, px: 14, fs: 13 },
  };
  const s = sizes[size];
  const variants: Record<Variant, { bg: string; color: string; border: string; hover: string }> = {
    primary:   { bg: "var(--ac)", color: "#06120a", border: "1px solid color-mix(in oklab, var(--ac) 70%, #000)", hover: "var(--ac-d)" },
    secondary: { bg: "var(--bg-3)", color: "var(--tx-0)", border: "1px solid var(--bd-2)", hover: "var(--bg-4)" },
    ghost:     { bg: "transparent", color: "var(--tx-1)", border: "1px solid var(--bd-1)", hover: "var(--bg-3)" },
    bare:      { bg: "transparent", color: "var(--tx-2)", border: "1px solid transparent", hover: "var(--bg-3)" },
    danger:    { bg: "transparent", color: "var(--danger)", border: "1px solid color-mix(in oklab, var(--danger) 35%, var(--bd-2))", hover: "color-mix(in oklab, var(--danger) 12%, var(--bg-2))" },
  };
  const v = danger ? variants.danger : variants[variant];
  const [h, setH] = useState(false);
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        height: s.h,
        padding: `0 ${s.px}px`,
        background: active ? v.hover : (h && !disabled ? v.hover : v.bg),
        color: v.color,
        border: v.border,
        borderRadius: 4,
        font: `500 ${s.fs}px/1 var(--f-sans)`,
        letterSpacing: ".01em",
        display: "inline-flex", alignItems: "center", gap: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background .12s, color .12s",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {leftIcon && <Icon name={leftIcon} size={s.fs + 1.5} />}
      {children}
      {rightIcon && <Icon name={rightIcon} size={s.fs + 1.5} />}
    </button>
  );
}

interface IconBtnProps {
  icon: IconName;
  size?: number;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}
export function IconBtn({ icon, size = 26, onClick, title, active, danger, disabled }: IconBtnProps) {
  const [h, setH] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        width: size, height: size,
        background: active ? "var(--bg-4)" : (h && !disabled ? "var(--bg-3)" : "transparent"),
        color: danger ? "var(--danger)" : (active ? "var(--tx-0)" : "var(--tx-2)"),
        border: "1px solid var(--bd-1)",
        borderRadius: 4,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        transition: "background .1s, color .1s",
      }}
    >
      <Icon name={icon} size={size <= 22 ? 12 : 14} />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tag                                                                       */
/* -------------------------------------------------------------------------- */
type Tone = "neutral" | "accent" | "warn" | "danger" | "info" | "muted";
export function Tag({ children, tone = "neutral", size = "sm" }: { children: ReactNode; tone?: Tone; size?: "sm" | "md" }) {
  const tones: Record<Tone, { bg: string; bd: string; c: string }> = {
    neutral: { bg: "var(--bg-3)",  bd: "var(--bd-2)", c: "var(--tx-1)" },
    accent:  { bg: "var(--ac-bg)", bd: "var(--ac-bd)", c: "var(--ac)" },
    warn:    { bg: "color-mix(in oklab, var(--warn) 12%, var(--bg-2))",   bd: "color-mix(in oklab, var(--warn) 30%, var(--bd-2))",   c: "var(--warn)" },
    danger:  { bg: "color-mix(in oklab, var(--danger) 12%, var(--bg-2))", bd: "color-mix(in oklab, var(--danger) 30%, var(--bd-2))", c: "var(--danger)" },
    info:    { bg: "color-mix(in oklab, var(--info) 10%, var(--bg-2))",   bd: "color-mix(in oklab, var(--info) 30%, var(--bd-2))",   c: "var(--info)" },
    muted:   { bg: "transparent", bd: "var(--bd-1)", c: "var(--tx-3)" },
  };
  const t = tones[tone];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: size === "sm" ? "2px 6px" : "3px 8px",
      fontSize: size === "sm" ? 10.5 : 11.5,
      fontFamily: "var(--f-sans)",
      background: t.bg, border: `1px solid ${t.bd}`, color: t.c,
      borderRadius: 3, lineHeight: 1.3,
      textTransform: "uppercase", letterSpacing: ".05em",
    }}>
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sparkline                                                                 */
/* -------------------------------------------------------------------------- */
export function Sparkline({ values, w = 72, h = 20, color }: {
  values: number[]; w?: number; h?: number; color?: string;
}) {
  if (!values?.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const r = max - min || 1;
  const step = w / (values.length - 1);
  const pts = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / r) * h).toFixed(1)}`)
    .join(" ");
  const last = values[values.length - 1]!;
  const lastY = h - ((last - min) / r) * h;
  const up = last >= values[0]!;
  const c = color || (up ? "var(--ok)" : "var(--danger)");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={c} strokeWidth="1.2"/>
      <circle cx={w - 0.5} cy={lastY} r="1.6" fill={c}/>
    </svg>
  );
}

/** Deterministic spark from a numeric seed — visual filler when we lack OHLCV. */
export function spark(seed: number, off = 0): number[] {
  const pts: number[] = [];
  let v = seed;
  for (let i = 0; i < 28; i++) {
    v += (Math.sin(i * 0.7 + off) + Math.cos(i * 1.3 + off * 0.6)) * 6;
    v = Math.max(10, Math.min(95, v));
    pts.push(v);
  }
  return pts;
}

/* -------------------------------------------------------------------------- */
/*  TokenChip                                                                 */
/* -------------------------------------------------------------------------- */
/** Hash a symbol to a stable hue so chips don't all look identical. */
function hueFor(sym: string): number {
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) % 360;
  return h;
}

export function tokenColor(sym: string): string {
  if (sym === "USDC" || sym === "USDT") return "oklch(72% 0.12 240)";
  if (sym === "SOL")  return "oklch(72% 0.18 305)";
  if (sym === "ETH" || sym === "WETH")  return "oklch(78% 0.06 270)";
  if (sym === "WBTC" || sym === "CBBTC") return "oklch(74% 0.14 60)";
  return `oklch(72% 0.16 ${hueFor(sym.toUpperCase())})`;
}

/**
 * Symbol → CDN logo URL. Mirrors the backend token registry but lives on the
 * frontend so TokenChip doesn't need logoUrl plumbing through every caller.
 * If a symbol isn't here, or the image errors at runtime, we fall back to
 * the colored letter chip — that's a feature, not a bug, for unknown tokens.
 */
const COINGECKO_IMG = "https://assets.coingecko.com/coins/images";
const SYMBOL_LOGOS: Record<string, string> = {
  USDC:    `${COINGECKO_IMG}/6319/standard/usdc.png`,
  // Solana
  SOL:     `${COINGECKO_IMG}/4128/standard/solana.png`,
  BONK:    `${COINGECKO_IMG}/28600/standard/bonk.jpg`,
  JUP:     `${COINGECKO_IMG}/34188/standard/jup.png`,
  WIF:     `${COINGECKO_IMG}/33767/standard/dogwifhat.jpg`,
  JTO:     `${COINGECKO_IMG}/33228/standard/jto.png`,
  PYTH:    `${COINGECKO_IMG}/31924/standard/pyth.png`,
  RAY:     `${COINGECKO_IMG}/13928/standard/PSigc4ie_400x400.jpg`,
  ORCA:    `${COINGECKO_IMG}/17547/standard/Orca_Logo.png`,
  JITOSOL: `${COINGECKO_IMG}/28046/standard/JitoSOL-200.png`,
  MSOL:    `${COINGECKO_IMG}/17752/standard/mSOL.png`,
  W:       `${COINGECKO_IMG}/35087/standard/womrhole_logo_full_color_rgb_2000px_72ppi_fb766ac85a.png`,
  DRIFT:   `${COINGECKO_IMG}/37077/standard/drift.png`,
  TNSR:    `${COINGECKO_IMG}/36761/standard/tnsr.png`,
  HNT:     `${COINGECKO_IMG}/4284/standard/Helium_HNT.png`,
  POPCAT:  `${COINGECKO_IMG}/33760/standard/image.jpg`,
  MEW:     `${COINGECKO_IMG}/36659/standard/mew.png`,
  PUMP:    `${COINGECKO_IMG}/54455/standard/Pump_fun_logo.png`,
  PENGU:   `${COINGECKO_IMG}/52622/standard/PUDGY_PENGUINS_PENGU_PFP.png`,
  FARTCOIN:`${COINGECKO_IMG}/33597/standard/fart.png`,
  // Base
  ETH:     `${COINGECKO_IMG}/279/standard/ethereum.png`,
  AERO:    `${COINGECKO_IMG}/31745/standard/token.png`,
  DEGEN:   `${COINGECKO_IMG}/34515/standard/android-chrome-512x512.png`,
  BRETT:   `${COINGECKO_IMG}/35529/standard/1000050750.png`,
  CBBTC:   `${COINGECKO_IMG}/40143/standard/cbbtc.webp`,
  VIRTUAL: `${COINGECKO_IMG}/34057/standard/LOGOMARK.png`,
  TOSHI:   `${COINGECKO_IMG}/31415/standard/Toshi_Logo_-_Circular.png`,
  HIGHER:  `${COINGECKO_IMG}/36205/standard/higher.jpeg`,
  KEYCAT:  `${COINGECKO_IMG}/36608/standard/keyboard_cat.jpeg`,
  MOG:     `${COINGECKO_IMG}/33147/standard/Mog_Logo.jpeg`,
  PRIME:   `${COINGECKO_IMG}/29053/standard/PRIME_logo.png`,
};

export function TokenChip({ sym, size = 18 }: { sym: string; size?: number }) {
  const upper = sym.toUpperCase();
  const url = SYMBOL_LOGOS[upper];
  const [errored, setErrored] = useState(false);
  const color = tokenColor(upper);

  // Letter chip — both the no-logo fallback and the rendered-on-error result.
  if (!url || errored) {
    return (
      <span style={{
        width: size, height: size,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        borderRadius: 999,
        background: `linear-gradient(135deg, ${color}, color-mix(in oklab, ${color} 50%, #000))`,
        color: "#0b0d10",
        fontSize: size * 0.42,
        fontWeight: 700,
        fontFamily: "var(--f-mono)",
        border: `1px solid color-mix(in oklab, ${color} 30%, #000)`,
        flex: "0 0 auto",
        letterSpacing: "-.02em",
      }}>
        {upper.slice(0, 1)}
      </span>
    );
  }

  return (
    <img
      src={url}
      alt={upper}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setErrored(true)}
      style={{
        width: size, height: size, borderRadius: 999,
        objectFit: "cover",
        background: "var(--bg-3)",
        border: "1px solid var(--bd-1)",
        flex: "0 0 auto",
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  SegBar                                                                    */
/* -------------------------------------------------------------------------- */
export interface SegOpt<V extends string> {
  v: V;
  l: string;
  c?: number;
  dot?: string;
}
export function SegBar<V extends string>({ value, onChange, options }: {
  value: V; onChange: (v: V) => void; options: SegOpt<V>[];
}) {
  return (
    <div style={{
      display: "inline-flex", padding: 2,
      background: "var(--bg-2)", border: "1px solid var(--bd-2)",
      borderRadius: 4,
    }}>
      {options.map((o) => {
        const active = value === o.v;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            style={{
              height: 24, padding: "0 10px",
              background: active ? "var(--bg-4)" : "transparent",
              color: active ? "var(--tx-0)" : "var(--tx-2)",
              border: "1px solid " + (active ? "var(--bd-3)" : "transparent"),
              borderRadius: 3, cursor: "pointer", fontSize: 11.5,
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
          >
            {o.dot && <span style={{ width: 6, height: 6, borderRadius: 999, background: o.dot, boxShadow: `0 0 6px ${o.dot}` }}/>}
            {o.l}
            {o.c != null && <span className="mono" style={{ fontSize: 10, color: "var(--tx-3)", marginLeft: 2 }}>{o.c}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  ColCell                                                                   */
/* -------------------------------------------------------------------------- */
export function ColCell({ label, main, sub }: { label: ReactNode; main: ReactNode; sub?: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <div style={{ fontSize: 10.5, color: "var(--tx-3)", textTransform: "uppercase", letterSpacing: ".06em" }}>{label}</div>
      <div className="num" style={{ fontSize: 13, color: "var(--tx-0)", fontWeight: 500 }}>{main}</div>
      {sub != null && <div className="num" style={{ fontSize: 11, color: "var(--tx-2)" }}>{sub}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  ActionDot · DriftBar · WeightBar · TaScore · GuardRow                     */
/* -------------------------------------------------------------------------- */
export type ActionKind = "swaps" | "no-action" | "denied" | "error";
export function ActionDot({ a }: { a: ActionKind }) {
  const map: Record<ActionKind, string> = {
    swaps: "var(--ac)",
    "no-action": "var(--tx-3)",
    denied: "var(--warn)",
    error: "var(--danger)",
  };
  return (
    <span style={{
      width: 6, height: 6, borderRadius: 999,
      background: map[a],
      boxShadow: a !== "no-action" ? `0 0 6px ${map[a]}` : "none",
    }}/>
  );
}

export function DriftBar({ pct }: { pct: number }) {
  const w = Math.min(pct, 1.5) / 1.5 * 100;
  const overage = pct > 1;
  return (
    <div style={{
      height: 4, background: "var(--bg-3)", borderRadius: 2,
      overflow: "hidden", marginTop: 4, position: "relative",
    }}>
      <div style={{ width: w + "%", height: "100%", background: overage ? "var(--warn)" : "var(--ac)", transition: "width .3s" }}/>
      <div style={{ position: "absolute", left: "66.6%", top: -1, bottom: -1, width: 1, background: "var(--bd-3)" }}/>
    </div>
  );
}

export function WeightBar({ target, current }: { target: number; current: number }) {
  return (
    <div style={{ position: "relative", height: 6, background: "var(--bg-3)", borderRadius: 1 }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: current + "%", background: "var(--ac)", opacity: .55 }}/>
      <div style={{ position: "absolute", left: target + "%", top: -2, bottom: -2, width: 1, background: "var(--tx-1)" }} title={`target ${target}%`}/>
    </div>
  );
}

export function TaScore({ score }: { score: number }) {
  const color = score > 65 ? "var(--ok)" : score < 45 ? "var(--danger)" : "var(--warn)";
  return (
    <span style={{
      width: 28, height: 16,
      display: "inline-grid", placeItems: "center",
      background: `color-mix(in oklab, ${color} 14%, var(--bg-3))`,
      border: `1px solid color-mix(in oklab, ${color} 30%, var(--bd-2))`,
      color, borderRadius: 3, fontSize: 10.5,
      fontFamily: "var(--f-mono)", fontWeight: 600,
    }}>
      {score}
    </span>
  );
}

export function GuardRow({ name, status, value }: { name: string; status: "ok" | "warn" | "danger"; value: string }) {
  const map: Record<string, string> = { ok: "var(--ok)", warn: "var(--warn)", danger: "var(--danger)" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "var(--tx-1)" }}>
      <Icon name={status === "ok" ? "check" : "alert"} size={12}/>
      <span className="mono" style={{ flex: 1 }}>{name}</span>
      <span className="mono num" style={{ color: map[status] }}>{value}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  AllocationDonut                                                           */
/* -------------------------------------------------------------------------- */
export function AllocationDonut({ slices }: { slices: Array<{ sym: string; weight: number }> }) {
  const total = slices.reduce((s, t) => s + t.weight, 0) || 1;
  let acc = 0;
  const r = 42, c = 50, sw = 10;
  const arcs = slices.map((t) => {
    const start = (acc / total) * 360;
    acc += t.weight;
    const end = (acc / total) * 360;
    return { ...t, start, end };
  });
  const circumference = 2 * Math.PI * r;
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--bg-3)" strokeWidth={sw}/>
        {arcs.map((a, i) => {
          const len = ((a.end - a.start) / 360) * circumference;
          const offset = -((a.start / 360) * circumference) + (circumference * 0.25);
          return (
            <circle
              key={i}
              cx={c} cy={c} r={r} fill="none"
              stroke={tokenColor(a.sym)}
              strokeWidth={sw}
              strokeDasharray={`${len} ${circumference - len}`}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${c} ${c})`}
            />
          );
        })}
        <text x={c} y={c - 2} textAnchor="middle" fontFamily="var(--f-mono)" fontSize="10" fill="var(--tx-3)">target</text>
        <text x={c} y={c + 10} textAnchor="middle" fontFamily="var(--f-mono)" fontSize="11" fill="var(--tx-0)" fontWeight="600">{slices.length} tokens</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, flex: 1 }}>
        {slices.map((t) => (
          <div key={t.sym} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: 1.5, background: tokenColor(t.sym) }}/>
            <span className="mono" style={{ flex: 1, color: "var(--tx-1)" }}>{t.sym}</span>
            <span className="num" style={{ color: "var(--tx-3)" }}>{Math.round(t.weight)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Field (form layout helper)                                                */
/* -------------------------------------------------------------------------- */
export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 10.5, color: "var(--tx-3)", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 500 }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: "var(--tx-3)" }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function inputStyle(h = 32, asDiv = false): CSSProperties {
  return {
    height: h, padding: "0 10px", width: "100%",
    background: "var(--bg-3)", border: "1px solid var(--bd-2)",
    color: "var(--tx-0)", borderRadius: 4, outline: "none", fontSize: 12.5,
    ...(asDiv ? { display: "flex", alignItems: "center", gap: 6 } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/*  fmtPct — short signed percent string (kept here for inline numerics)      */
/* -------------------------------------------------------------------------- */
export function fmtPctSigned(n: number, sign = true): string {
  const s = sign && n > 0 ? "+" : "";
  return s + n.toFixed(2) + "%";
}

/* -------------------------------------------------------------------------- */
/*  Toggle                                                                    */
/* -------------------------------------------------------------------------- */
export function Toggle({ on: defaultOn = false, onChange }: { on?: boolean; onChange?: (v: boolean) => void }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <button
      type="button"
      onClick={() => { setOn(!on); onChange?.(!on); }}
      style={{
        width: 32, height: 18, padding: 0,
        background: on ? "var(--ac)" : "var(--bg-3)",
        border: "1px solid " + (on ? "color-mix(in oklab, var(--ac) 70%, #000)" : "var(--bd-2)"),
        borderRadius: 999, position: "relative", cursor: "pointer",
      }}
    >
      <span style={{
        position: "absolute", top: 1, left: on ? 15 : 1,
        width: 14, height: 14, borderRadius: 999,
        background: on ? "#0b0d10" : "var(--tx-2)",
        transition: "left .15s",
      }}/>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  useMemoSpark — stable per-symbol spark series                             */
/* -------------------------------------------------------------------------- */
export function useSpark(seed: number, off: number) {
  return useMemo(() => spark(seed, off), [seed, off]);
}
