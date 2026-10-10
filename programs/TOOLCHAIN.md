# Solana toolchain

Verified on 2026-10-09 in Ubuntu 24.04 on WSL 2, x86_64.
Build in the Linux home filesystem, not on `/mnt/c`.

| Tool | Exact version |
|---|---|
| Rust | 1.99.0, b940084d7 |
| Cargo | 1.99.0, 5f94df478 |
| Solana CLI / Agave | 3.1.10, 7bc9c805 |
| solana-test-validator | 3.1.10, 7bc9c805 |
| Anchor CLI | 1.1.2 |
| AVM | 1.1.2, Anchor repository tag v1.1.2 |
| Node.js | 22.23.3 |
| pnpm | 12.3.4, matching protocol/lib/package.json |
| Surfpool | 1.6.0, version checked only |

The approved [Solana installer](https://solana-install.solana.workers.dev)
was downloaded and read before execution. Its SHA-256 was
`075e7efda0546e18e3efe394b45cb27bdc95a6b0fed13e568e6fc18d75921942`.
It initially installed Solana 4.3.0; AVM selected 3.1.10 when Anchor started.
The final verified Solana pin is 3.1.10. The installer's Node 24 default was
replaced with Node 22 to match PLAN.md D5. Surfpool installed successfully,
but the installer reported failure before its new PATH was loaded.

Gate B pins Anchor 1.1.2 and Solana 3.1.10 in the workspace configuration,
with matching Anchor Rust crates and TypeScript client.
Use `anchor test --validator legacy` for the tested solana-test-validator
backend. The program builds and passes local tests. It is not deployed to devnet.

## Gate B evidence

Verified locally on 2026-10-09 after the upstream merge at `8ddd43a`:

- `anchor build` and `anchor build --ignore-keys` both pass.
- `anchor test --skip-build --validator legacy`: 34 tests pass across
  `redeem.ts`, `withdraw.ts` and `units.ts`.
- `cargo test --locked -p loka_vault`: 3 tests pass, including Rust decoding
  of the committed protocol vectors and u64 boundaries.
- `pnpm typecheck`, `cargo fmt --all --check` and the frozen pnpm install pass.
- `scripts/assert-secp256r1-active.sh` reports the local feature active from
  epoch 0 and stops its validator afterward.
- The reviewed local SBF artifact is 364384 bytes after the vault ATA fix.
  This is a local build measurement,
  not a verified-build or deployed-program claim.
- Test first: the initial integration run failed because the scaffold had no
  `initializeVault` method. The implementation was added after those tests.
- GitHub Actions has not run on this change. No external funding, faucet
  request or devnet deployment was performed. Task 1.4 remains incomplete
  until its approved deployment and public pins are verified.

The subsequent independent review and ATA regression are recorded in `REVIEW.md`.
All 34 TypeScript tests and 3 Rust tests also pass with that fix. The persistent
`ignore-scripts=true` package policy avoids executing optional dependency install
scripts during automatic pnpm installs.

## Task 0.4 evidence

- CLI RPC: `https://api.devnet.solana.com`; commitment: `confirmed`.
- An isolated local validator on port 18899 produced slot 2 and was stopped.
- Feature `srremy31J5Y25FrAApwVb9kZcfXbusYMMsvTK9aWv5q`,
  SIMD-0075 (secp256r1 precompile), reported active locally from epoch 0.
- A read-only devnet query reported the same feature active from epoch 881,
  activation slot 380592000.
- The existing protocol package passed all 13 tests and its TypeScript
  typecheck using Node 22 and pnpm 12.3.4. No lockfile changed.
- The upgrade-authority key was generated outside both checkouts with mode
  0600. Its encrypted team-vault backup remains a human step.
- No faucet request, funding transaction, or deployment was sent during the
  program implementation above. Subsequent VPS and funding evidence follows.
  Task 0.4 remains incomplete pending upgrade-authority funding verification
  and shared public pins.

## Jordan's VPS and funding evidence

Solana 3.1.10 was installed on the VPS on 2026-10-09. Six wallet keypairs were
generated there with seed output suppressed, a mode 0700 directory and mode
0600 files. Only public addresses are recorded here:

| Role | Public address | Verified balance on 2026-10-10 |
|---|---|---|
| Demo fee payer | `29v6qGTtertFu7mMwcsy7TXS9kQcYEiQYiDvXBRaBEzZ` | 2.5 devnet SOL |
| Public fee payer | `Fs3ZVNsqyogFRLwY4eZ3wjrvUHd5UCH13iobYdjY6Zhq` | 2.5 devnet SOL |
| Table demo funding | `8Y8P1qp7oMJUmSSXkYRmDuhPhfypjU5sLMjMWQ5qB8c` | 10 test USDC |
| Public onboarding funding | `3bq6hvC585Mu8L6gJVtnPuDkWr6mJnxXij3qrdBQRuje` | 10 test USDC |
| Send funding | `7fa39mvGnRMPmBsaS12zQUDxCqDVef8C8PdndjqE1LhJ` | 10 test USDC |
| Canary funding | `H9E3fHxLPUqenvQ7Rd1LhrKPvbGCn98z4fqHwZDgzy6v` | 10 test USDC |

USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` on devnet.
Public token-account queries verified all four funding balances. The fee
payers total 5 devnet SOL; the upgrade authority needs at least 5 more to
meet the required combined funding. Its address and balance remain unverified.

Successful finalized transaction evidence:

| Purpose | Signature |
|---|---|
| Jordan to Pravin, 0.01 devnet SOL | `3zHstjdMDszo5U7XTcSn8jyQjeSj69RqaozJrBcauZEpQmpkv7k7dKR4zBYbgUPniNJuzDQkPr2Whq8GzBc49P8F` |
| Jordan personal wallet, 20 test USDC from faucet | `2Ba9xFgJZNYqeiJWkJUDVSC8rPLgx4w3VUrY7CcV8AFtNyzSNy6jgtdcfh6uaUnazkyiqzfWNbgtcR9RqPcz58Ln` |
| Pravin personal wallet, 20 test USDC from faucet | `2TSprEzQjnAbXY1os2qNFmfdWH2Qomj1tNiyHpaFHZTYac2kJJ3EqaXgKqPpavsrqTSfBt8nseh7Pxf1EoGdHtpF` |
| Table demo, 10 test USDC | `4oPSycUskQbzUQ6xDaqLJZkf3kmTEfXcnVWCLSQNcqJvMeqzUd5nwspP2SC6BV4BUYkuXGZWJR2vEehN9AtDP3Bp` |
| Public onboarding, 10 test USDC | `WrVvaptq53HdspkZLoC5H9iHUo5ydBNDGYdeNqjsh75hz3A8S6feVGY5zhyBNv3G5PX55UVzBg7nMRdjd3AEt14` |

The SOL test transfer executed in slot 509404706 on 2026-10-09 at 23:27:04 ET,
with status Ok and a 5,000-lamport fee.

Jordan created an AES256 passphrase-encrypted backup on the VPS. He reported
successful decrypt-and-compare verification (exit code 0) and later successful
decryption and filename listing on his laptop. Only the encrypted archive was
copied off-server, outside the repository, with mode 0600. Local and remote
SHA-256 checksums matched:
`14e5ef1d71f1561762f12cbe91350ebbdf076d7320c51675b2aa7e0742593355`.
The passphrase was entered privately. Storage of the passphrase in OWLS keys
and team-accessible encrypted archive storage remain unverified.

The shared pins file and task 1.0 server identity keys remain outstanding.
