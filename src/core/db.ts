/**
 * SQLite layer (better-sqlite3, synchronous, single-process).
 * Schema is created on first run; safe to call initDb() multiple times.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.ts";
import type { Basket, BasketToken, Chain, RebalanceResult } from "../types.ts";

let db: Database.Database | null = null;

const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS baskets (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     chain TEXT NOT NULL CHECK (chain IN ('base','solana')),
     wallet_name TEXT NOT NULL,
     agent_token_name TEXT NOT NULL,
     policy_id TEXT NOT NULL,
     budget_usd REAL NOT NULL,
     quote_token TEXT NOT NULL DEFAULT 'USDC',
     ta_bias REAL NOT NULL DEFAULT 0.5,
     enabled INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS basket_tokens (
     basket_id TEXT NOT NULL REFERENCES baskets(id) ON DELETE CASCADE,
     symbol TEXT NOT NULL,
     initial_weight REAL NOT NULL,
     min_weight REAL,
     max_weight REAL,
     PRIMARY KEY (basket_id, symbol)
   )`,
  `CREATE TABLE IF NOT EXISTS rebalances (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     basket_id TEXT NOT NULL REFERENCES baskets(id) ON DELETE CASCADE,
     started_at TEXT NOT NULL,
     finished_at TEXT,
     guard_outcome TEXT NOT NULL,
     guard_reason TEXT,
     payload TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_rebalances_basket_started
     ON rebalances(basket_id, started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS telegram_pairings (
     pairing_code TEXT PRIMARY KEY,
     chat_id TEXT,
     paired_at TEXT,
     expires_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS conversations (
     chat_id TEXT PRIMARY KEY,
     messages TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS custom_tokens (
     chain TEXT NOT NULL CHECK (chain IN ('base','solana')),
     address TEXT NOT NULL,
     symbol TEXT NOT NULL,
     name TEXT NOT NULL,
     decimals INTEGER NOT NULL,
     pool_address TEXT NOT NULL DEFAULT '',
     logo_url TEXT,
     added_at TEXT NOT NULL,
     PRIMARY KEY (chain, address)
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_tokens_symbol
     ON custom_tokens(chain, symbol)`,
];

export function initDb(): Database.Database {
  if (db) return db;
  mkdirSync(dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  for (const stmt of SCHEMA_STATEMENTS) {
    db.prepare(stmt).run();
  }
  return db;
}

function getDb(): Database.Database {
  if (!db) throw new Error("DB not initialized. Call initDb() first.");
  return db;
}

// ── Baskets ──────────────────────────────────────────────────────────

export function createBasket(b: Basket): void {
  const conn = getDb();
  const tx = conn.transaction(() => {
    conn.prepare(
      `INSERT INTO baskets
       (id, name, chain, wallet_name, agent_token_name, policy_id,
        budget_usd, quote_token, ta_bias, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      b.id, b.name, b.chain, b.walletName, b.agentTokenName, b.policyId,
      b.budgetUsd, b.quoteToken, b.taBias, b.enabled ? 1 : 0, b.createdAt
    );
    const tokenStmt = conn.prepare(
      `INSERT INTO basket_tokens (basket_id, symbol, initial_weight, min_weight, max_weight)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const t of b.tokens) {
      tokenStmt.run(b.id, t.symbol, t.initialWeight, t.minWeight ?? null, t.maxWeight ?? null);
    }
  });
  tx();
}

export function listBaskets(): Basket[] {
  const conn = getDb();
  const rows = conn.prepare(`SELECT * FROM baskets ORDER BY created_at DESC`).all() as any[];
  return rows.map((r) => hydrateBasket(r));
}

export function getBasket(id: string): Basket | null {
  const conn = getDb();
  const row = conn.prepare(`SELECT * FROM baskets WHERE id = ?`).get(id) as any;
  if (!row) return null;
  return hydrateBasket(row);
}

export function setBasketEnabled(id: string, enabled: boolean): void {
  getDb().prepare(`UPDATE baskets SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id);
}

export function deleteBasket(id: string): void {
  getDb().prepare(`DELETE FROM baskets WHERE id = ?`).run(id);
}

function hydrateBasket(row: any): Basket {
  const tokens = getDb()
    .prepare(`SELECT symbol, initial_weight, min_weight, max_weight FROM basket_tokens WHERE basket_id = ?`)
    .all(row.id) as any[];
  return {
    id: row.id,
    name: row.name,
    chain: row.chain as Chain,
    walletName: row.wallet_name,
    agentTokenName: row.agent_token_name,
    policyId: row.policy_id,
    budgetUsd: row.budget_usd,
    quoteToken: row.quote_token,
    taBias: row.ta_bias,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    tokens: tokens.map<BasketToken>((t) => ({
      symbol: t.symbol,
      initialWeight: t.initial_weight,
      minWeight: t.min_weight ?? undefined,
      maxWeight: t.max_weight ?? undefined,
    })),
  };
}

// ── Rebalances ───────────────────────────────────────────────────────

export function recordRebalance(r: RebalanceResult): number {
  const info = getDb().prepare(
    `INSERT INTO rebalances
     (basket_id, started_at, finished_at, guard_outcome, guard_reason, payload)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    r.basketId,
    r.startedAt,
    r.finishedAt,
    r.guardOutcome.allow ? "allow" : "deny",
    r.guardOutcome.allow ? null : r.guardOutcome.reason,
    JSON.stringify(r)
  );
  return Number(info.lastInsertRowid);
}

export function lastRebalanceFor(basketId: string): RebalanceResult | null {
  const row = getDb()
    .prepare(`SELECT payload FROM rebalances WHERE basket_id = ? ORDER BY started_at DESC LIMIT 1`)
    .get(basketId) as { payload: string } | undefined;
  return row ? JSON.parse(row.payload) : null;
}

export function listRebalances(basketId: string, limit = 50): RebalanceResult[] {
  const rows = getDb()
    .prepare(`SELECT payload FROM rebalances WHERE basket_id = ? ORDER BY started_at DESC LIMIT ?`)
    .all(basketId, limit) as Array<{ payload: string }>;
  return rows.map((r) => JSON.parse(r.payload));
}

// ── Settings (key/value) ─────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(key, value);
}

// ── Telegram pairings ────────────────────────────────────────────────

export function createPairing(code: string, ttlMinutes: number): void {
  const expires = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  getDb()
    .prepare(`INSERT INTO telegram_pairings (pairing_code, expires_at) VALUES (?, ?)`)
    .run(code, expires);
}

export function consumePairing(code: string, chatId: string): boolean {
  const row = getDb()
    .prepare(`SELECT chat_id, expires_at FROM telegram_pairings WHERE pairing_code = ?`)
    .get(code) as { chat_id: string | null; expires_at: string } | undefined;
  if (!row) return false;
  if (row.chat_id) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) return false;
  getDb()
    .prepare(`UPDATE telegram_pairings SET chat_id = ?, paired_at = ? WHERE pairing_code = ?`)
    .run(chatId, new Date().toISOString(), code);
  return true;
}

export function getPairedChatIds(): string[] {
  const rows = getDb()
    .prepare(`SELECT chat_id FROM telegram_pairings WHERE chat_id IS NOT NULL`)
    .all() as Array<{ chat_id: string }>;
  return rows.map((r) => r.chat_id);
}

/**
 * Register a chat as a known recipient for push notifications. Called when
 * an authorized user runs /start — reuses the existing telegram_pairings
 * table so we don't introduce a new schema for the same purpose. The
 * pairing_code column gets a synthetic value to satisfy uniqueness.
 */
export function recordAuthorizedChat(chatId: string, userId: string): void {
  const code = `auto-${userId}-${chatId}`;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO telegram_pairings (pairing_code, chat_id, paired_at, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(pairing_code) DO NOTHING`,
    )
    .run(code, chatId, now, "9999-12-31T23:59:59.999Z");
}

// ── Conversations (Telegram chat history per chat_id) ────────────────

export function loadConversation(chatId: string): unknown[] {
  const row = getDb()
    .prepare(`SELECT messages FROM conversations WHERE chat_id = ?`)
    .get(chatId) as { messages: string } | undefined;
  if (!row) return [];
  try {
    return JSON.parse(row.messages) as unknown[];
  } catch {
    return [];
  }
}

export function saveConversation(chatId: string, messages: unknown[]): void {
  getDb()
    .prepare(
      `INSERT INTO conversations (chat_id, messages, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET
         messages = excluded.messages,
         updated_at = excluded.updated_at`
    )
    .run(chatId, JSON.stringify(messages), new Date().toISOString());
}

export function clearConversation(chatId: string): void {
  getDb().prepare(`DELETE FROM conversations WHERE chat_id = ?`).run(chatId);
}

// ── Custom tokens (user-added via contract address) ──────────────────

export interface CustomTokenRow {
  chain: Chain;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  poolAddress: string;
  logoUrl: string | null;
  addedAt: string;
}

export function addCustomToken(t: Omit<CustomTokenRow, "addedAt">): void {
  getDb()
    .prepare(
      `INSERT INTO custom_tokens
       (chain, address, symbol, name, decimals, pool_address, logo_url, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chain, address) DO UPDATE SET
         symbol = excluded.symbol,
         name = excluded.name,
         decimals = excluded.decimals,
         pool_address = excluded.pool_address,
         logo_url = excluded.logo_url`,
    )
    .run(
      t.chain,
      t.address,
      t.symbol,
      t.name,
      t.decimals,
      t.poolAddress,
      t.logoUrl,
      new Date().toISOString(),
    );
}

export function listCustomTokens(chain: Chain): CustomTokenRow[] {
  const rows = getDb()
    .prepare(
      `SELECT chain, address, symbol, name, decimals, pool_address, logo_url, added_at
       FROM custom_tokens WHERE chain = ? ORDER BY added_at DESC`,
    )
    .all(chain) as any[];
  return rows.map((r) => ({
    chain: r.chain,
    address: r.address,
    symbol: r.symbol,
    name: r.name,
    decimals: r.decimals,
    poolAddress: r.pool_address,
    logoUrl: r.logo_url,
    addedAt: r.added_at,
  }));
}

export function findCustomTokenBySymbol(chain: Chain, symbol: string): CustomTokenRow | null {
  const row = getDb()
    .prepare(
      `SELECT chain, address, symbol, name, decimals, pool_address, logo_url, added_at
       FROM custom_tokens WHERE chain = ? AND UPPER(symbol) = UPPER(?)`,
    )
    .get(chain, symbol) as any;
  if (!row) return null;
  return {
    chain: row.chain,
    address: row.address,
    symbol: row.symbol,
    name: row.name,
    decimals: row.decimals,
    poolAddress: row.pool_address,
    logoUrl: row.logo_url,
    addedAt: row.added_at,
  };
}
