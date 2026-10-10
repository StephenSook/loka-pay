# Getting and spending devnet SOL

Checked live on 2026-10-10 against Agave 3.1.10 and Anchor 1.1.2. Devnet SOL has no value. Never put a private key in this repository, Discord or chat.

## How much we need

Rent on Solana was cut in 2026: `getMinimumBalanceForRentExemption` returns 5,080 lamports per byte today (it was 6,960). An account costs `(128 + bytes) x 5,080` lamports.

| What | Size | Cost |
|---|---|---|
| `loka_vault` program data (first deploy) | 45 + 364,384 bytes | about 1.85 SOL, locked while the program exists |
| Program upgrade | a second buffer of the same size | about 1.85 SOL extra, refunded when the upgrade lands |
| One allowance (`open_allowance`, paid by the funding wallet) | 670 bytes | 0.00406 SOL |
| Any transaction | per signature | 0.000005 SOL |

A first deploy needs about 1x the program size, not 2x: the CLI drains the upload buffer back to the payer before it funds the program data. An upgrade does need a second copy for a moment. So the upgrade authority should hold about 2 x 1.85 + 0.1 SOL, and each funding wallet about 0.1 SOL (roughly 24 allowance opens).

## Where to get it, fastest first

1. **faucet.solana.com.** Sign in with GitHub, pick 5 SOL, twice per rolling 8 hours: 10 SOL per person. Everyone on the team can claim for their own wallet, then send it where it is needed. The limit is keyed on wallet, GitHub account and IP, so if the venue Wi-Fi trips it, try from a phone hotspot.
2. **devnetfaucet.org.** 20 SOL per claim, one claim per 24 hours, GitHub sign-in. Only works if the GitHub account owns a repository in Electric Capital's list of Solana projects or is vouched for; signing in tells you within a minute.
3. **faucet.quicknode.com/solana/devnet.** One claim per wallet per 12 hours, no account; the amount was not visible without a wallet address.
4. **A teammate.** `solana transfer` (below) moves SOL between our own wallets instantly.

Do not bother with these right now: `solana airdrop` on the public devnet RPC (returning HTTP 429), the proof-of-work faucet `devnet-pow` (its on-chain faucets are drained), Alchemy (no Solana faucet), Chainstack (needs 0.8 mainnet SOL), the Helius faucet (paid plans only).

## Moving SOL between our wallets

```sh
solana transfer <RECIPIENT> 0.1 --from <payer.json> --fee-payer <payer.json> --allow-unfunded-recipient -u devnet
solana balance <ADDRESS> -u devnet
```

`--allow-unfunded-recipient` is required when the recipient has never held SOL. The first transfer to a new address must be at least 0.00065 SOL.

## Never strand SOL in a failed deploy

A failed `solana program deploy` leaves its upload buffer holding the rent.

```sh
solana program show --buffers --buffer-authority <AUTHORITY> -u devnet   # what is stranded
solana program close <BUFFER> -u devnet                                  # get it back
```

To resume instead, recover the buffer from the 12-word seed the CLI printed (`solana-keygen recover -o buffer.json`) and rerun the deploy with `--buffer buffer.json`. Anchor 1.1.2 keeps its buffer keypair in `target/deploy/` and resumes on its own when you rerun the same command. Starting over without closing the old buffer needs a second full copy of the rent at once.

## Deploying reliably

```sh
solana program deploy target/deploy/loka_vault.so \
  --program-id target/deploy/loka_vault-keypair.json \
  --upgrade-authority <authority.json> --fee-payer <authority.json> \
  --use-rpc --with-compute-unit-price 10000 \
  -u "https://devnet.helius-rpc.com/?api-key=<KEY>"
```

`--use-rpc` sends the chunk writes through the RPC instead of straight to block producers, which venue networks and WSL tend to drop. A free Helius or QuickNode key works for devnet RPC. Leave out `--max-len` to pay the minimum.

## Test without spending devnet SOL

`anchor test` on `localnet` starts surfpool, which gives the default wallet 10,000 SOL at startup. To read real devnet accounts locally, add to `Anchor.toml`:

```toml
[surfpool]
online = true
datasource_rpc_url = "https://api.devnet.solana.com"
```

If the provider cluster is devnet, `anchor test` upgrades the program on every run. Deploy once, then use `anchor test --skip-deploy --provider.cluster devnet`.

## Not verified

The faucet.solana.com lifetime cap per GitHub account (it exists, the number is not public), whether it counts a shared venue IP across different GitHub accounts, devnetfaucet.org eligibility for our accounts, and the QuickNode amount.
