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
- No faucet request, funding transaction, or deployment was sent. Funding,
  the required devnet transfer, and the VPS keys remain outstanding, so task
  0.4 is not complete.
