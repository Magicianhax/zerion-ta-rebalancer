/**
 * Subprocess wrapper around the forked Zerion CLI.
 *
 * The CLI emits JSON to stdout and structured errors to stderr — we shell out
 * with --json --quiet, capture stdout, parse, and surface any error.code field.
 *
 * Uses spawn (not exec) to avoid shell injection. All arguments pass as a fixed
 * argv array, never interpolated into a shell string.
 */

import { spawn } from "node:child_process";
import { config } from "../config.ts";

export interface ZerionError extends Error {
  code: string;
  details?: unknown;
}

export interface RunOptions {
  /** Pass extra env vars (merged with current process env) */
  env?: Record<string, string>;
  /** Stdin payload (e.g., for sign-typed-data piping) */
  stdin?: string;
  /** Override timeout in ms (default 60s) */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Spawn the Zerion CLI with the given argv. Resolves with parsed JSON stdout.
 * Throws a ZerionError carrying the upstream error.code if the CLI fails.
 */
export function runZerion(args: string[], options: RunOptions = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      ZERION_API_KEY: config.zerionApiKey,
      ...options.env,
    };

    const child = spawn(process.execPath, [config.zerionCliPath, ...args, "--json"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      const ms = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      reject(
        makeError(
          "timeout",
          `Zerion CLI timed out after ${ms}ms. The on-chain transaction may still ` +
          `have landed — check the wallet's recent activity on the explorer before retrying.`,
        ),
      );
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(makeError("spawn_failed", `Failed to spawn Zerion CLI: ${err.message}`));
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      if (exitCode === 0) {
        try {
          resolve(stdout.trim() ? JSON.parse(stdout) : null);
        } catch (e: any) {
          reject(makeError("parse_error", `Could not parse CLI stdout: ${e.message}`, { stdout, stderr }));
        }
        return;
      }

      // Try to extract structured error from stderr
      try {
        const parsed = JSON.parse(stderr.trim());
        if (parsed.error) {
          reject(makeError(parsed.error.code ?? "cli_error", parsed.error.message ?? stderr, parsed.error));
          return;
        }
      } catch {
        // fall through to plain-text error
      }
      reject(makeError("cli_error", stderr.trim() || `Zerion CLI exited with code ${exitCode}`));
    });

    if (options.stdin) {
      child.stdin.write(options.stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

function makeError(code: string, message: string, details?: unknown): ZerionError {
  const err = new Error(message) as ZerionError;
  err.code = code;
  err.details = details;
  return err;
}

// ── High-level helpers ────────────────────────────────────────────────

export interface WalletInfo {
  name: string;
  evmAddress: string;
  solAddress: string | null;
  chains: string[];
  createdAt: string;
}

/**
 * Long-lived cache for read-only metadata commands. These change rarely
 * (only after explicit user action: setup wizard, creating a basket, etc.)
 * so we cache for 5 minutes by default. The huge win here is dashboard
 * load — every page render fanned out 3-5 subprocess spawns and each
 * subprocess spends ~30s on /mnt/d resolving ESM imports.
 */
interface MetaCacheEntry {
  promise: Promise<any>;
  expiresAt: number;
}
const META_CACHE = new Map<string, MetaCacheEntry>();
const META_TTL_MS = 5 * 60_000;

export function invalidateMetaCache(): void {
  META_CACHE.clear();
}

function cachedZerion(key: string, args: string[], ttlMs = META_TTL_MS): Promise<any> {
  const now = Date.now();
  const cached = META_CACHE.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;
  const promise = runZerion(args);
  META_CACHE.set(key, { promise, expiresAt: now + ttlMs });
  promise.catch(() => META_CACHE.delete(key));
  return promise;
}

export async function walletList(): Promise<WalletInfo[]> {
  const out = await cachedZerion("wallet:list", ["wallet", "list"]);
  return out?.wallets ?? [];
}

export async function portfolio(walletName: string): Promise<any> {
  return runZerion(["portfolio", "--wallet", walletName]);
}

export interface PositionsOptions {
  mode?: "all" | "simple" | "defi";
  /** Chain filter (basket.chain) — REQUIRED for Solana wallets, since
   *  zerion CLI defaults `--wallet` lookups to the EVM address. Passing
   *  `chain: 'solana'` makes it use the Solana address from the same wallet. */
  chain?: string;
}

/**
 * Short-lived positions cache.
 * Reasoning: each `positions` call spawns a Node subprocess (~1s cold start)
 * + makes a Zerion API roundtrip (~1-2s). When the dashboard renders, the
 * stats strip, basket cards, and wallet view all want the same data within a
 * few-hundred-millisecond window. A 10s TTL collapses those bursts into one
 * subprocess and dedupes concurrent in-flight calls. After a swap fires, the
 * caller invalidates explicitly via `invalidatePositionsCache(walletName)`.
 */
interface CacheEntry {
  promise: Promise<any>;
  expiresAt: number;
}
const POSITIONS_CACHE = new Map<string, CacheEntry>();
const POSITIONS_TTL_MS = 10_000;

function positionsCacheKey(walletName: string, opts: PositionsOptions): string {
  return `${walletName}|${opts.mode ?? "simple"}|${opts.chain ?? "default"}`;
}

export function invalidatePositionsCache(walletName?: string): void {
  if (!walletName) {
    POSITIONS_CACHE.clear();
    return;
  }
  for (const key of POSITIONS_CACHE.keys()) {
    if (key.startsWith(`${walletName}|`)) POSITIONS_CACHE.delete(key);
  }
}

export async function positions(
  walletName: string,
  options: PositionsOptions | "all" | "simple" | "defi" = {},
): Promise<any> {
  const opts: PositionsOptions =
    typeof options === "string" ? { mode: options } : options;

  const key = positionsCacheKey(walletName, opts);
  const now = Date.now();
  const cached = POSITIONS_CACHE.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const args = ["positions", "--wallet", walletName, "--positions", opts.mode ?? "simple"];
  if (opts.chain) args.push("--chain", opts.chain);

  const promise = runZerion(args);
  POSITIONS_CACHE.set(key, { promise, expiresAt: now + POSITIONS_TTL_MS });

  // Drop the entry from the cache if the call rejects, so callers can retry
  // immediately instead of being stuck with a failed cached promise.
  promise.catch(() => POSITIONS_CACHE.delete(key));

  return promise;
}

export async function listPolicies(): Promise<any[]> {
  const out = await cachedZerion("agent:list-policies", ["agent", "list-policies"]);
  return out?.policies ?? [];
}

/**
 * Full detail for a single policy — includes config (scripts, daily_tx_limit,
 * allowed_addresses) which list-policies omits. Used by the dashboard to
 * render the actual policy rules per basket.
 */
export async function showPolicy(id: string): Promise<any | null> {
  const out = await cachedZerion(`agent:show-policy:${id}`, ["agent", "show-policy", "--id", id]);
  return out?.policy ?? null;
}

export async function listAgentTokens(): Promise<any[]> {
  const out = await cachedZerion("agent:list-tokens", ["agent", "list-tokens"]);
  return out?.tokens ?? [];
}

export interface SwapArgs {
  walletName: string;
  chain: string;
  amount: number;
  fromToken: string;
  toToken: string;
  slippage?: number;
}

/**
 * Swap timeout — must accommodate the slow Node ESM startup on /mnt/d
 * (~30s for OWS module resolution), Zerion API quote (~2-5s), Solana sign
 * + broadcast (~5-15s), and the on-chain confirmation poll (up to ~30s).
 * Total realistic worst case is ~80s; budgeting 3 minutes leaves headroom.
 *
 * If the timeout fires, the swap may have still landed on-chain — we just
 * lost the response. The caller should treat this as 'unknown' and check
 * the wallet's tx history before retrying with the same amount.
 */
const SWAP_TIMEOUT_MS = 180_000;

export async function swap(args: SwapArgs): Promise<any> {
  const cliArgs = [
    "swap",
    args.chain,
    String(args.amount),
    args.fromToken,
    args.toToken,
    "--wallet", args.walletName,
  ];
  if (args.slippage != null) cliArgs.push("--slippage", String(args.slippage));
  return runZerion(cliArgs, { timeoutMs: SWAP_TIMEOUT_MS });
}

export interface SolanaSwapArgs {
  walletName: string;
  amount: number;
  fromToken: string;
  toToken: string;
  slippage?: number;
}

export async function swapSolana(args: SolanaSwapArgs): Promise<any> {
  const cliArgs = [
    "swap",
    "solana",
    String(args.amount),
    args.fromToken,
    args.toToken,
    "--wallet", args.walletName,
  ];
  if (args.slippage != null) cliArgs.push("--slippage", String(args.slippage));
  return runZerion(cliArgs, { timeoutMs: SWAP_TIMEOUT_MS });
}

/**
 * Search for tokens by symbol/name. Used by the basket builder UI to validate
 * that a user-supplied symbol resolves to something tradeable on the chain.
 */
export async function searchToken(query: string): Promise<any> {
  return runZerion(["search", query]);
}

export async function listSwapTokens(chain?: string): Promise<any> {
  const args = ["swap", "tokens"];
  if (chain) args.push(chain);
  return runZerion(args);
}
