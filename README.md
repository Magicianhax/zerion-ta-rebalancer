# Zerion TA Rebalancer

> Self-hostable, TA-driven crypto portfolio rebalancer. Runs every hour. Web dashboard + Telegram bot. Built on top of [Zerion CLI](https://github.com/zeriontech/zerion-ai) with policy-bounded agent tokens — the bot literally cannot transact outside the rules you set.

## What it does

1. You define a basket: pick tokens (Base or Solana), set a budget in USDC, set initial weights.
2. Setup wizard creates a Zerion wallet, mints an agent token scoped to your basket, attaches a policy with chain-lock + token allowlist + spend cap.
3. You fund the wallet. The bot makes the initial swaps to match your weights.
4. Every hour, the rebalancer:
   - Pulls OHLCV for each token from GeckoTerminal
   - Computes RSI, MACD, EMA, ATR, volume trend
   - Combines into a composite score per token
   - Proposes new weights (blended with your initial bias)
   - Runs guard checks (max drift, cooldown, min/max %, slippage)
   - Executes swaps via Zerion CLI — all routed through the Zerion API
5. Web dashboard shows live updates. Telegram bot pushes notifications with tx hashes.

## Why it's safe

The bot can be compromised, and your funds still hold. Three layers of policy:

| Layer | Enforced by | What it stops |
|---|---|---|
| OWS agent-token policy | Wallet signing layer (cryptographic) | Wrong chain, wrong token, transfers, approvals, post-expiry signing |
| Custom spend-cap policy | OWS executable script (`spend-cap.mjs`) | Daily over-spend per token |
| App-layer guards | Backend code | Excessive drift, churn, slippage |

If the rebalancer code is hacked or buggy, policies 1 and 2 still hold — they live in the wallet, not the app.

## Quickstart — laptop

```bash
git clone https://github.com/<you>/zerion-ta-rebalancer.git
cd zerion-ta-rebalancer
cp .env.example .env
# edit .env: ZERION_API_KEY, ADMIN_PASSWORD
npm install
npm run setup    # interactive: creates wallet, mints token, attaches policy
npm run build    # build the web dashboard
npm start        # opens http://localhost:3000
```

> **Windows users:** the underlying [Zerion CLI](https://github.com/zeriontech/zerion-ai) currently has no Windows native binding. Run inside WSL2 (Ubuntu) — it works fine there.

## Quickstart — VPS

Same as above, plus put a reverse proxy in front for HTTPS. Caddyfile:

```
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

## Architecture

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Configuration

See [.env.example](./.env.example) for all variables. The most important:

| Variable | What |
|---|---|
| `ZERION_API_KEY` | Required. Get one at [dashboard.zerion.io](https://dashboard.zerion.io) |
| `ADMIN_PASSWORD` | Required. Used as bearer token for the web UI |
| `TELEGRAM_BOT_TOKEN` | Optional. From [@BotFather](https://t.me/BotFather). If empty, bot is disabled |
| `REBALANCE_CRON` | Default `0 * * * *` (top of every hour) |
| `MAX_DRIFT_PERCENT` | Default 10. App-layer guard against churn |

## Policy story

See [docs/POLICY.md](./docs/POLICY.md).

## License

MIT — see [LICENSE](./LICENSE).
