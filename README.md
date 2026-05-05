# Zerion TA Rebalancer

> Self-hostable, TA-driven crypto portfolio rebalancer. Runs every hour, rebalances autonomously, and chats with you in plain English over Telegram or the web. Built on top of [Zerion CLI](https://github.com/zeriontech/zerion-ai) with policy-bounded agent tokens — the bot literally cannot transact outside the rules you set.

![Status: alpha](https://img.shields.io/badge/status-alpha-orange) ![License: MIT](https://img.shields.io/badge/license-MIT-blue)

## What it does

1. You define a basket: pick tokens (Solana or Base), set a budget in USDC, set initial weights.
2. The setup wizard creates an encrypted wallet, mints a scoped agent token, and attaches a tight policy: chain-lock + deny-transfers + deny-approvals + daily transaction cap.
3. You fund the wallet (small amount of USDC + native gas).
4. Every hour, the rebalancer:
   - Pulls 4-hour OHLCV for each token from GeckoTerminal
   - Computes RSI, MACD, EMA, ATR, volume trend → composite score per token
   - Proposes new weights (blended with your initial bias)
   - Runs guard checks (cooldown, max drift, slippage)
   - Routes approved swaps through Zerion API
5. The web dashboard shows live wallet balance and weight charts. The Telegram bot pushes notifications and answers chat queries with a Claude agent.

## Why it's safe — three layers of policy

The agent can be compromised, buggy, or misconfigured, and your funds still hold:

| Layer | Enforced by | Stops |
|---|---|---|
| **OWS built-in** | Cryptographic, at signing | Wrong chain, wrong token, transfers, approvals, post-expiry signing |
| **OWS executable** (`spend-cap.mjs`) | Script run by the OWS dispatcher | Daily transaction cap exceeded |
| **App-layer guards** | Backend code | Excessive drift, churn, slippage, dust swaps |

If layers 1 and 2 are bypassed, the wallet still doesn't sign anything outside the policy — those checks live in OWS, not in our code.

## Two ways to authenticate the agent

The reasoning agent uses the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) — same SDK that powers Claude Code. It supports two auth modes:

| Mode | Best for | How |
|---|---|---|
| **Claude Code subscription** | Personal self-hosted use | Run `claude login` once. The SDK reads `~/.claude/.credentials.json` and bills against your existing Pro/Team/Max plan. |
| **Anthropic API key** | VPS / shared deployments | Set `ANTHROPIC_API_KEY=sk-ant-...` in `.env`. Direct per-token billing. |

If neither is set, the agent stays disabled — cron runs deterministic rebalances (TA only, no reasoning text), and Telegram tells the user chat is off. You still get the auto-rebalancer working.

## Quickstart — laptop

> **Windows users:** the underlying [Zerion CLI](https://github.com/zeriontech/zerion-ai) has no Windows native binding. Run inside WSL2 (Ubuntu) — see [docs/WSL.md](./docs/WSL.md).

### 1. Prerequisites

- **Node.js 20+** — `nvm install 22` is easiest
- **Git** — for cloning
- **A Zerion API key** — free at [dashboard.zerion.io](https://dashboard.zerion.io)
- **Either:**
  - Claude Code installed and logged in (`npm install -g @anthropic-ai/claude-code` → `claude login`), OR
  - An Anthropic API key from [console.anthropic.com](https://console.anthropic.com)
- **Optional:** Telegram bot token from [@BotFather](https://t.me/BotFather)

### 2. Clone and configure

```bash
git clone https://github.com/<you>/zerion-ta-rebalancer.git
cd zerion-ta-rebalancer

# Also clone the forked Zerion CLI into a sibling directory:
git clone https://github.com/<you>/zerion-ai.git ../zerion-ai
cd ../zerion-ai && npm install --legacy-peer-deps && cd ../zerion-ta-rebalancer

cp .env.example .env
```

Edit `.env`:

```bash
# Required
ZERION_API_KEY=zk_your_key_here
ADMIN_PASSWORD=at-least-eight-chars

# Anthropic auth — pick ONE (or skip both for deterministic mode)
# Option A: Claude Code subscription (free if you have a plan, requires `claude login`)
ANTHROPIC_API_KEY=
# Option B: API key (per-token billing)
# ANTHROPIC_API_KEY=sk-ant-api03-...

# Optional: Telegram
TELEGRAM_BOT_TOKEN=

# Defaults usually fine
ZERION_CLI_PATH=../zerion-ai/cli/zerion.js
DEFAULT_CHAIN=solana
ANTHROPIC_MODEL=claude-sonnet-4-6
```

### 3. Install and build

```bash
npm install --legacy-peer-deps
npm run build      # builds web SPA
```

### 4. Run the setup wizard

```bash
npm run setup
```

Walks you through:

1. **Wallet** — name it, set a passphrase. **Pick a strong passphrase, write it down.** OWS encrypts the wallet at rest with this; there is no recovery without it.
2. **Policy** — chain (`solana` or `base`), daily tx cap (8-20 is sane), expiry (30 days default).
3. **Agent token** — re-enter the passphrase once to mint the scoped credential.
4. **Recovery phrase** — say yes when offered. Write the 12-word mnemonic on paper. **This is the only true backup.**
5. **Funding** — note the deposit address shown.

The wizard automatically syncs your `ZERION_API_KEY` into Zerion CLI's own config, so you can run `zerion ...` commands directly afterward.

### 5. Fund the wallet

```bash
node ../zerion-ai/cli/zerion.js wallet fund --wallet <your-wallet-name>
```

Send a small amount of USDC + native gas to the address shown:
- **Solana:** USDC + ~0.05 SOL for fees
- **Base:** USDC + ~$0.50 worth of ETH for fees

Demo-sized funding ($5-10) is enough to verify everything works.

### 6. Boot

```bash
npm start
```

Output:

```
Zerion TA Rebalancer ready
  → Web dashboard: http://localhost:3000
  → Cron schedule: 0 * * * *
  → Telegram bot:  running
```

### 7. Use it

**Web dashboard** at `http://localhost:3000`:
- Log in with `ADMIN_PASSWORD`
- Click **New basket**, walk through the 3 steps (chain → tokens & weights → wallet/policy/token)
- Each card shows live wallet balance polled every 30s
- Click **Rebalance now** to fire the first allocation

**Telegram bot:**
- Open chat with your bot, run `/start`
- Generate a pairing code in the dashboard's Settings panel, send `/start <code>` to bind your chat
- Useful commands:
  - `/status` — basket overview
  - `/balance` — live wallet balance per basket
  - `/pause <basket>` / `/resume <basket>`
  - `/reset` — clear chat history
  - **Plain text** — talks to the Claude agent, can ask anything ("how is my basket doing?", "why did you sell SOL yesterday?")

## Quickstart — VPS

Same as laptop, with two additions:

```bash
# Reverse proxy with HTTPS via Caddy
your.domain.com {
  reverse_proxy localhost:3000
}
```

Or with Docker:

```bash
docker build -t zerion-rebalancer .
docker run -d \
  --name rebalancer \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -v $HOME/.zerion:/root/.zerion \
  --env-file .env \
  zerion-rebalancer
```

Mount `~/.zerion` so the encrypted wallet survives container restarts.

## Configuration reference

Full list in [.env.example](./.env.example). The key knobs:

| Variable | Default | What |
|---|---|---|
| `ZERION_API_KEY` | required | Get one at [dashboard.zerion.io](https://dashboard.zerion.io) |
| `ADMIN_PASSWORD` | required | Bearer token for the web UI (8+ chars) |
| `ANTHROPIC_API_KEY` | empty | Set to use direct API; leave empty to use Claude Code subscription |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | `claude-opus-4-7` for max intelligence, `claude-haiku-4-5` for cheap chat |
| `TELEGRAM_BOT_TOKEN` | empty | Disables bot if empty |
| `REBALANCE_CRON` | `0 * * * *` | Top of every hour |
| `MAX_DRIFT_PERCENT` | 10 | App-layer churn guard (skipped on first allocation) |
| `REBALANCE_COOLDOWN_MINUTES` | 45 | Between rebalances on the same basket |
| `DEFAULT_SLIPPAGE` | 2 | % tolerance on swaps |
| `DEFAULT_CHAIN` | `solana` | Default for new baskets |

## Architecture

Single Node process serving everything: REST API, SSE stream, Vite-built React SPA, hourly cron, Telegram bot, Claude agent. SQLite for state.

```
┌─ src/index.ts ──────────────────────────────────────────┐
│   ├─ startServer()  → Hono on :3000                     │
│   ├─ startCron()    → hourly tick → agent.runHourlyTick │
│   └─ startBot()     → grammy + agent.handleChatMessage  │
├─────────────────────────────────────────────────────────┤
│   src/agent/    Claude Agent SDK (query + MCP tools)    │
│   src/core/     ta, ohlcv, rebalancer, zerion wrapper   │
│   src/api/      Hono routes + SSE                       │
│   web/          Vite + React + Tailwind dashboard       │
│   scripts/      setup wizard                            │
└─────────────────────────────────────────────────────────┘
```

Full architecture diagram: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)

Policy story: [docs/POLICY.md](./docs/POLICY.md)

Wallet recovery: [docs/RECOVERY.md](./docs/RECOVERY.md)

Demo script: [docs/DEMO.md](./docs/DEMO.md)

## Troubleshooting

| Symptom | Fix |
|---|---|
| `vite: not found` on `npm run build` | `npm run install:web` first, or use the combined `npm run build` |
| `claude: command not found` | `npm install -g @anthropic-ai/claude-code` then `claude login` |
| `Cannot find module '@open-wallet-standard/core-linux-x64-gnu'` | Reinstall after switching to WSL: `rm -rf node_modules && npm install --legacy-peer-deps` |
| `missing_api_key` from a direct `zerion ...` command | Restart `npm start` once — it auto-syncs `ZERION_API_KEY` into Zerion's config |
| Wallet balance shows $0 in UI/bot but you funded it | Wait 30-60 seconds — Zerion's indexer takes a moment for fresh deposits. If still empty, paste output of `node ../zerion-ai/cli/zerion.js positions --wallet <name> --pretty` |
| Drift guard rejected first rebalance | Should be auto-skipped on first allocation. If you hit it, restart and try again |
| Passphrase prompt looks corrupted in WSL terminal | Use Windows Terminal or PowerShell+WSL instead of VS Code's integrated terminal |

## Development

```bash
npm install --legacy-peer-deps
cd web && npm install --legacy-peer-deps && cd ..

# Backend with auto-reload
npm run dev

# Web frontend with HMR (separate terminal)
npm run dev:web    # serves at :5173, proxies API to :3000

# Typecheck only
npx tsc --noEmit
```

## License

MIT — see [LICENSE](./LICENSE).

## Credits

- [Zerion CLI](https://github.com/zeriontech/zerion-ai) — wallet + execution layer
- [Open Wallet Standard](https://github.com/open-wallet-standard/core) — wallet encryption + policy enforcement
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) — reasoning agent
- [GeckoTerminal](https://www.geckoterminal.com) — OHLCV data
- [Hono](https://hono.dev), [grammy](https://grammy.dev), [Vite](https://vitejs.dev), [Tailwind](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com) — stack
