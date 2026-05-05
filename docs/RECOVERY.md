# Wallet recovery

Your wallet is held by [Open Wallet Standard](https://github.com/open-wallet-standard/core)
(OWS), not by us. This doc covers the three recovery paths.

## Back up first — before anything bad happens

```bash
zerion wallet backup --wallet <name>
```

Prompts for your passphrase, prints a 12 or 24-word BIP-39 mnemonic to
stderr. Write it down on paper. Store offline (safe, lockbox, not iCloud,
not a screenshot, not a password manager you don't trust). Do this once,
**right after** `npm run setup`.

The setup wizard offers to do this for you on step 4.

## Path 1 — restore from mnemonic (canonical)

You have your 12/24-word phrase. Most resilient option.

**On any machine** with Zerion CLI installed:

```bash
zerion wallet import --name rebalancer --mnemonic
```

Paste the mnemonic when prompted, set a new passphrase, done. Same EVM and
Solana addresses you had before — OWS uses standard BIP-44 derivation paths.

This same mnemonic works in MetaMask, Phantom, Rabby, Trust Wallet, etc.
Zerion isn't required to access your funds.

## Path 2 — restore from encrypted wallet file + passphrase

You have a copy of `~/.zerion/` and remember your passphrase.

```bash
# On the new machine
mkdir -p ~/.zerion
cp -r /backup/.zerion/* ~/.zerion/

# Verify it works
zerion wallet list
zerion portfolio --wallet <name>
```

Path of `~/.zerion/`:

| Platform | Path |
|---|---|
| Linux (WSL) | `/home/<user>/.zerion/` |
| macOS | `/Users/<user>/.zerion/` |
| WSL viewed from Windows | `\\wsl.localhost\Ubuntu\home\<user>\.zerion\` |

What's in there:

```
~/.zerion/
├── config.json            ← agent tokens, default wallet, defaults
├── wallets/
│   └── <name>.json        ← encrypted keystore (useless without passphrase)
├── policies/
│   └── policy-*.json      ← your scoped policies
└── spend-cap-state.json   ← daily-tx-limit ledger
```

The wallet file alone is useless. The wallet file + passphrase = full
control. Treat `~/.zerion/` like you'd treat a `.env` file — never commit
it, never back it up to a cloud you don't trust.

## Path 3 — pair with the Zerion mobile app

```bash
zerion wallet sync --wallet <name>
```

A QR code appears in the terminal. Open the Zerion app on your phone, scan
it. The wallet now exists on the phone too, encrypted by the app's own
keystore.

If you lose the laptop, you can recover via the mobile app's
"export private key" feature.

## What you cannot recover from

| Situation | Outcome |
|---|---|
| Mnemonic only | Full recovery |
| Encrypted file + passphrase | Full recovery |
| Encrypted file, no passphrase, no mnemonic | **Funds lost.** |
| Passphrase only, no file, no mnemonic | **Funds lost.** |
| Mobile pairing intact | Full recovery via app |

OWS encryption is real encryption — there is no Zerion-side reset, no
support team that can restore your wallet. The mnemonic is the master
secret. Back it up.

## After restoring — the agent token

The agent token is *not* part of the wallet — it's a separate scoped
credential. After restoring the wallet, you also need to:

1. Re-create or restore the policy: `zerion agent create-policy ...`
2. Re-mint an agent token: `zerion agent create-token --name <bot> --wallet <name> --policy <id>`

OR copy `~/.zerion/config.json` from your backup, which holds the existing
agent token alongside the wallet.

## TL;DR

Run `zerion wallet backup --wallet <name>` after `npm run setup`. Write the
mnemonic on paper. Done. Everything else is convenience.
