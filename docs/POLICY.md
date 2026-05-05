# Policy

The agent token issued by `npm run setup` carries a multi-layer policy that
defines exactly what the rebalancer is allowed to do. The agent cannot work
around any of these limits — they're enforced at the wallet signing layer
(in OWS) and re-checked in our application code, in three independent
layers that compose with AND semantics.

## Layer 1: OWS built-in declarative rules

Stored inside the agent token, enforced by the Open Wallet Standard signing
layer (Rust native binding). No bypass without the wallet's master passphrase.

| Rule | Default value | What it stops |
|---|---|---|
| `allowed_chains` | `base` (or `solana`, your choice) | Any tx on a different chain |
| `expires_at` | 30 days from setup | Any tx after that timestamp |

## Layer 2: OWS executable policies

Stored as `.mjs` scripts in the Zerion fork at `cli/policies/`. The dispatcher
(`run-policies.mjs`) loads each one and passes the transaction through. AND
semantics — any deny stops the whole transaction.

| Script | What it does |
|---|---|
| `deny-transfers.mjs` | Refuses raw native transfers (value > 0, empty calldata) — only DEX interactions allowed |
| `deny-approvals.mjs` | Refuses ERC-20 approval calls — Zerion's API uses Permit2 / pre-approved routers, never needs new approvals |
| `allowlist.mjs` *(optional)* | Refuses any tx whose `to` is not in a known list (e.g., DEX router addresses) |
| `spend-cap.mjs` *(custom — our contribution)* | Refuses signing if more than N transactions have been signed by this token in the last 24h |

The setup wizard wires `deny-transfers + deny-approvals + spend-cap` by
default. You can add `allowlist` manually with `--allowlist <addrs>` on
`agent create-policy` if you know your DEX router addresses.

## Layer 3: app-layer guards

These run inside the rebalancer process before any swap is even attempted.
Bypassable if our code is hacked, but cheap and informative when working
correctly.

| Guard | Default value | What it stops |
|---|---|---|
| Cooldown | 45 min between rebalances | Excessive churn from cron storms |
| Max drift per tick | 10% absolute weight shift | One huge reallocation in a single tick |
| Per-token min/max | configurable in basket | Token going to 0% or > N% |
| Slippage cap | 2% | Bad swaps in thin liquidity |
| Dust filter | $1 per swap | Pointless gas burn on tiny rebalances |

## Verifying each layer holds

You can confirm every policy layer works by attempting the action it's
supposed to block. All four of these attempts fail with structured errors:

1. **App-layer cooldown.** Trigger a manual rebalance, then immediately
   trigger another. The second attempt is rejected with a "cooldown" message
   — the basket's last rebalance is too recent.

2. **OWS deny-transfers.** Try a raw token transfer with the agent's wallet:
   `zerion send eth 0.01 --to 0xdeadbeef... --wallet <name>`. The OWS
   dispatcher invokes `deny-transfers.mjs` and the wallet refuses to sign.

3. **OWS chain-lock.** Try a swap on a chain not in the basket. If the basket
   is locked to Solana, run `zerion swap base 1 USDC ETH --wallet <name>`.
   OWS refuses based on `allowed_chains` — the signature never happens.

4. **OWS daily transaction cap.** Trigger more rebalances than the daily cap
   (default 8) within 24 hours. After the cap, `spend-cap.mjs` refuses
   further signs until the rolling 24h window opens up.

Every refusal is structured and logged. The agent cannot do anything outside
the basket's intent — by construction, not by convention.
