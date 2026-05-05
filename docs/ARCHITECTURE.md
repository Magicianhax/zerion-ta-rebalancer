# Architecture

A single Node process. SQLite for state. Hono serves both the API and the
React SPA. Cron and Telegram bot run in the same event loop.

## Process layout

```
┌─ src/index.ts (entrypoint) ──────────────────────────────────────────┐
│                                                                      │
│   initDb()                                                           │
│      │                                                               │
│      ├─→ startServer()    → Hono on :3000                            │
│      │       ├─ GET /api/baskets, POST /api/baskets/:id/rebalance    │
│      │       ├─ GET /api/events/stream  (SSE)                        │
│      │       └─ GET *  (serves web/dist with SPA fallback)           │
│      │                                                               │
│      ├─→ startCron()      → node-cron, schedule from .env            │
│      │       └─ for each enabled basket: rebalance(basketId)         │
│      │                                                               │
│      └─→ startBot()       → grammy (only if TELEGRAM_BOT_TOKEN set)  │
│              ├─ /start <code> → consumePairing()                     │
│              └─ on(rebalance:done) → push to all paired chats        │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Data flow — one rebalance tick

```
              ┌─ rebalance(basketId) ─────────────────────────────┐
              │                                                   │
              │  1. positions(walletName) ──→ Zerion CLI          │
              │     │                          (subprocess --json)│
              │     └→ summarizePositions → currentWeights        │
              │                                                   │
              │  2. for each token: scoreToken                    │
              │     └→ fetchOhlcv (GeckoTerminal)                 │
              │     └→ RSI · MACD · EMA · ATR · volume → score    │
              │                                                   │
              │  3. scoresToWeights (softmax)                     │
              │     └→ blendWeights(initial, ta, taBias)          │
              │     └→ targetWeights                              │
              │                                                   │
              │  4. buildSwapPlan (USDC quote, dust filter)       │
              │                                                   │
              │  5. evaluateGuards                                │
              │     ├ cooldown                                    │
              │     ├ max drift                                   │
              │     └ per-token min/max                           │
              │                                                   │
              │  6. for each step in plan:                        │
              │     swap() → Zerion CLI → OWS policy check        │
              │       ├ chain-lock                                │
              │       ├ allowlist                                 │
              │       ├ deny-transfers                            │
              │       ├ deny-approvals                            │
              │       └ spend-cap (daily-tx-limit)                │
              │     → on-chain tx hash                            │
              │                                                   │
              │  7. recordRebalance + emit("rebalance:done")      │
              │                                                   │
              └───────────────────────────────────────────────────┘
```

## The fork relationship

The forked Zerion CLI lives in a sibling repo. The rebalancer shells out to
`node $ZERION_CLI_PATH ...` — never imports its modules. This keeps your fork
close to upstream (rebase-friendly) and your product as a clean external
consumer.

## Why three policy layers

The agent must not be able to bypass safety limits, even if the rebalancer
code itself is buggy or compromised. Three independent layers means a
failure in one doesn't compromise the others:

| Layer | Where it runs | What stops it being bypassed |
|---|---|---|
| App-layer guards (`policy.ts`) | Backend code, before Zerion is called | Cheap filter; can be bypassed if app is hacked |
| OWS executable policy (`spend-cap.mjs`, allowlist) | OWS dispatcher subprocess at signing time | Runs in OWS, not in our code — bypass requires breaking OWS |
| OWS built-in rules (chain, expiry) | OWS native binding (Rust) at signing time | Cryptographic; no bypass without the wallet's master key |

Even if our backend code is compromised and submits arbitrary transactions,
OWS still refuses anything that violates the policy.
