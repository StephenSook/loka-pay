# loka_vault (sandbox)

Gate B implements the local T1 vault. Nothing here establishes a devnet deployment.
The reserved program address in `Anchor.toml` is not a deployed-program claim.
Deployment and publishing the program id in `config/pins.json` require Gate D.

## Local build and tests

Use the exact versions in `TOOLCHAIN.md`. On Windows, run inside Ubuntu WSL and
keep this checkout in the Linux home filesystem. From this directory:

```sh
pnpm install --frozen-lockfile --ignore-scripts
bash scripts/prepare-local-wallet.sh
bash scripts/assert-secp256r1-active.sh
anchor build --ignore-keys
cargo test --locked -p loka_vault
pnpm typecheck
anchor test --skip-build --validator legacy
```

`--ignore-keys` keeps the shared public program id when a fresh checkout has a
different generated local program key. The owner's matching reserved key also
allows plain `anchor build`. Neither command deploys a program. Anchor places
the built program in a fresh local validator's genesis for these tests, with the
local test wallet as its local upgrade authority. The integration fixture refuses
RPC endpoints other than HTTP loopback. It never calls a faucet or an external
RPC. Do not substitute the upgrade-authority wallet for the local test wallet.

The public IDL is `idl/loka_vault.json`; regenerate it with `anchor build` and copy
only `target/idl/loka_vault.json`. Never copy or commit `target/deploy/*-keypair.json`.
Account resolution is disabled because the merchant PDA hashes an instruction
argument. Clients must supply the accounts listed in the IDL explicitly.

## Accounts and instructions

All PDAs use this program id. Strings below mean ASCII bytes. A key hash is
SHA-256 of the 33-byte compressed P-256 public key. Only the legacy SPL Token
program is accepted. The configured mint must have six decimals.

| Account | Seeds | Stored state |
|---|---|---|
| Config | `"config"` | Immutable mint, cluster id, bump |
| Vault authority | `"vault", mint` | Bump; signs token transfers |
| Allowance | `"allowance", allowance_id.to_be_bytes()` | Id, funder, payer key, cap, redeemed total, offline limit, expiry, bond, sorted earmarks, 32-byte serial bitmap, bump |
| Merchant | `"merchant", sha256(public_key)` | Immutable key and hash, credited balance, withdrawal counter, bump |
| Vault tokens | Canonical associated token account of vault authority and mint | Actual escrowed sandbox tokens |

Anchor account fields use Borsh; this is distinct from the canonical signed wire
structures, whose integers are big-endian. See `protocol/PAYMENT-V1.md` sections
4.1, 4.7, 7 and 8 for signed bytes and precompile offsets. The IDL lists exact
instruction argument types, account order, discriminators, events and errors.

| Instruction | Authorization and effect |
|---|---|
| `initialize_vault(cluster)` | Current loader upgrade authority signs. Creates immutable config, vault authority and its token account. Cluster 0 is devnet; local tests use 0. |
| `register_merchant(public_key)` | Any rent payer can create the immutable record. Registration gives no spending authority; withdrawals require this P-256 key. |
| `open_allowance(args)` | Token-account owner signs and deposits `cap + bond`. Uses a never-reusable global u64 id. No key rotation or account closing is exposed. |
| `redeem_note(note[141])` | Immediately follows the native P-256 verifier. Consumes one serial, increases redeemed total, credits the signed merchant and emits `NoteRedeemed`. Tokens remain in the vault. |
| `withdraw(message[161])` | Immediately follows native P-256 verification with the merchant key. Debits its balance, increments its counter and transfers only to the signed wallet's canonical token account. |

Any transaction fee payer may submit a signed redeem or withdrawal. The server
has no special redemption privilege and cannot choose another destination.
The transaction may have compute-budget instructions before the precompile.
Each precompile contains exactly one signature, self-contained canonical offsets,
zero padding, and no trailing bytes. Its message and key must match the handler's
message and stored key. Top-level calls only: the instruction reader rejects CPI.

## Security boundaries and tests

`loka_vault/tests/redeem.ts` covers all ten rules in PAYMENT-V1 section 8, including
the README's reused-serial, high-S, wrong-message, wrong-mint and substituted-merchant
cases. It also checks canonical sysvar and precompile references, signed malformed
domains, cap exhaustion, serial boundaries, both expiry constraints, earmarks,
allowance reinitialization, and rollback when a later instruction fails.
The fixture first proves that an unrelated signer cannot initialize the vault.

`withdraw.ts` checks token conservation, the signed destination's canonical account,
the stored signing key, domain binding, counter replay, zero amounts and overdrafts.
Rejected operations compare allowance, merchant and vault-token state before and
after. `units.ts` and Rust tests consume committed protocol vectors, including
u64 boundary cases. Native cryptographic verification is exercised on the local
validator, not replaced by an in-program signature mock.

Checked arithmetic and atomic transactions protect the ledger. The allowance cap
limits what can settle; the offline limit is stored for certificates and enforced
by merchant applications, never by `redeem_note`. Concurrent offline acceptance
can still expose a merchant to an unpaid note.

Global allowance ids must be allocated by registration and retried on collision.
A third party can reserve an id by funding its own allowance, so this is not an
unguessable registration namespace. Public-key prefixes are checked when records
are created; curve membership and signatures are checked by the native verifier
when used. Registration alone proves no possession of a key.

Bond payouts, reclaiming expired allowances, batching, fees, refunds and WebAuthn
are separate tasks and are not implemented. Unspent funds and bonds remain locked
in this T1 version. Upgrade authority can replace the program and change custody
rules; this program is not frozen or audited. Independent adversarial review is
still required before merge. Shared contracts and PLAN.md are unchanged in Gate B.

## Dependency review

Anchor CLI, Rust crates and TypeScript client are pinned to 1.1.2. The Solana sysvar
and SHA-256 dependencies come from Anza's Solana SDK; Anchor SPL supplies the
legacy token interfaces. TypeScript uses the existing protocol package, official
Solana clients, noble P-256 and Vitest. Direct dependencies are exact versions;
Cargo and pnpm lockfiles pin the dependency graphs. Installs disable Node lifecycle
scripts. Anchor SPL's Token-2022 feature is enabled only for IDL generation because
its 1.1.2 IDL module references those types unconditionally; handlers still accept
only the legacy token program. This provenance check is not a security audit.
