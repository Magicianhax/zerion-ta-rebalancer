# Policy story

The agent token issued by `npm run setup` carries a multi-layer policy. This
is the safety story for the hackathon's "no god-mode agents" criterion.

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

## Demo scenario for judges

The rebalancer can demonstrate each layer:

1. **Show layer 3 working**: try to rebalance immediately after a previous
   rebalance — guard rejects with "cooldown", logged in the dashboard.

2. **Show layer 2 working**: try to send a raw ETH transfer using the
   bot's agent token (e.g., via direct CLI: `zerion send eth 0.01 --to <addr>`).
   The OWS dispatcher invokes `deny-transfers.mjs` and OWS refuses to sign.

3. **Show layer 1 working**: try to swap on a chain not in the basket
   (e.g., the basket is Base, try a swap on Arbitrum). OWS refuses
   based on `allowed_chains`.

4. **Show layer 2 anti-churn**: artificially trigger many manual rebalances.
   After the daily cap (default 8), `spend-cap.mjs` refuses further signs
   for the next 24h.

The agent token cannot do anything outside the basket's intent — by
construction, not by convention.
