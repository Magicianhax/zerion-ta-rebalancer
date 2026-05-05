# 4-minute demo script

Aim for a screen-recorded run-through that shows each judging axis. Total
time: ~4 minutes. Practice once before recording.

## Setup before recording (off-camera)

- Have the forked Zerion CLI installed and working in your shell
- Have a funded wallet (small amount, $5-10 USDC on Base is fine)
- Have an agent token with the setup wizard's default policy attached
- Web dashboard running at `localhost:3000`
- Optional: Telegram bot paired
- Pre-populate one basket with $5-10 budget, 2-3 tokens (e.g. on Solana: SOL 50%, BONK 30%, JUP 20%; or on Base: ETH 60%, AERO 40%)
- Make sure the wallet holds quote token (USDC) on the basket's chain so swap plans aren't blocked by lack of funds

## 0:00 — Intro (15s)

> "Zerion TA Rebalancer. Self-hosted, hourly auto-rebalancer. The agent
> can't hold god-mode privileges — it's bounded by three layers of policy
> we'll see in action."

## 0:15 — Setup story (40s)

Show the terminal: `npm run setup`. Walk through:

> "The wizard creates a wallet, attaches a policy with chain-lock,
> deny-transfers, deny-approvals, and a daily transaction cap, then mints
> an agent token bound to all of that. The token is now an API key with
> spending power — but only the kind of spending the policy allows."

Show `~/.zerion/config.json` — the agent token and policy id.

## 0:55 — Web dashboard (40s)

Open `localhost:3000`, log in with the password.

> "The basket I prepared earlier holds SOL, BONK, and JUP on Solana,
> currently sitting at the initial weights I set."

Hover the basket card → show current vs target weights.

## 1:35 — Manual rebalance (60s)

Click "Rebalance now". Talk through the live event:

> "This pulls 4-hour OHLCV from GeckoTerminal, computes RSI, MACD, EMA,
> volatility, volume — combines into a composite score per token, and
> proposes new weights. The proposal blends with my initial weights at
> 50/50 by default."

Show the dashboard updating with the new weights, the swap that fired,
and the on-chain tx hash. Click the tx hash → opens Solscan (or Basescan
for Base baskets).

> "This is a real on-chain transaction routed through the Zerion API."

## 2:35 — Show the policy holding (40s)

In a separate terminal, try to bypass:

```
zerion send SOL 0.01 --to 2Nsnn... --wallet rebalancer
```

Show the structured error:

> "Even with the agent token, OWS refuses to sign — because
> `deny-transfers` runs at the wallet layer, not in my code."

Try a different chain:

```
zerion swap base 1 USDC ETH --wallet rebalancer
```

> "Refused — the policy locked this token to Solana only."

## 3:15 — Telegram (30s)

Switch to Telegram, show the rebalance push notification with the tx hash.
Send `/status` → bot replies with basket state.

> "Same backend, two interfaces."

## 3:45 — Wrap (15s)

> "Hourly cron runs by default. Anyone can fork this repo and self-host —
> single command, single Node process. The Zerion fork carries one new
> custom policy script we contributed back: a daily transaction cap. Code
> is open source under MIT."

End on the GitHub URL of the repo.
