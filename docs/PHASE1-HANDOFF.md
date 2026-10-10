# Task 1.4 commands for Pravin

The program base is already in local commit `9790d54`. The edits below are the
review fix, its evidence, contract announcements, and name scrubs. Server work
is stopped. The untracked `server/` draft is excluded from every commit below.
No command in this document has been executed by the assistant.

## Windows: rename and commit

Run in `C:\Users\pkireri\hacklanta\loka-pay`. Check the index is empty first.
For `git add -p`, accept only the Shared Contracts announcement and its two new
rows, declining the attribution-only hunks. Inspect the staged diff before committing.

```powershell
git diff --cached --name-only
git branch -m feat/loka-vault
git add -p -- PLAN.md
git diff --cached -- PLAN.md
git commit -m "⚠️ CONTRACT: specify withdrawal verification and note expiry"

git add -- programs docs/PHASE1-HANDOFF.md
git commit -m "fix: tolerate a precreated vault token account"

git add -- PLAN.md
git commit -m "docs: generalize reviewer attribution in plan"

git add -- README.md STEPHEN_TASKS.md docs/archive/security-reviews ios/LokaPay/Tests/LokaPayTests/ReviewFixTests.swift
git commit -m "docs: generalize reviewer attribution in tracked files"
```

The `programs` path contains source, tests and public metadata only; ignored build
output and keypairs are not staged. Do not force-add ignored files. Do not stage
`server/` or the unrelated untracked build directories.

At the last fetch, the branch was five commits ahead of origin/main and none
behind. If a future fetch makes it behind, preserve these edits first, then run
`git rebase origin/main` yourself. No push is included here.

The five local commit messages contain no disallowed attribution. Shared merge
bodies `251fa5c` and `33fba4b` still do. Rewording them rewrites shared ancestry and
conflicts with PLAN.md D13 unless the team accepts your exception. If you choose
that separate rewrite, after preserving edits run:

```powershell
git rebase -i --rebase-merges 251fa5c^1
```

Change `merge -C` to `merge -c` for those two merges and replace the attribution
with `AI assistant`. Do not force-push main. This does not erase old objects from
other branches, tags, remotes, clones or reflogs.

## Ubuntu WSL: synchronize the reviewed code

Run after the Windows commits. The local build edits are preserved in a stash;
leave it as a backup, since those same edits arrive in the reviewed commit.
Ignored build output and external keys remain in place. Do not pop this duplicate
stash onto the updated checkout.

```sh
set -e
cd "$HOME/loka-pay"
git branch -m feat/loka-vault
git stash push --include-untracked -m "program build edits before reviewed sync" -- programs
git pull --ff-only windows feat/loka-vault
cd programs
. "$HOME/.cargo/env"
. "$HOME/.nvm/nvm.sh"
nvm use 22
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
```

## 1. Existing program keypair and authority

Both keys already exist outside the repo. Do not generate a replacement program
key for this deployment. Restore the encrypted backup if either is missing.
Back up both in the encrypted team vault before continuing.

```sh
authority="$HOME/.config/loka-pay/upgrade-authority-keypair.json"
program_key="$HOME/.config/loka-pay/program-devnet-keypair.json"
test -f "$authority"
test -f "$program_key"
authority_address=$(solana-keygen pubkey "$authority")
program_address=$(solana-keygen pubkey "$program_key")
test "$program_address" = HSgcxix3LGjdCQ7FGexBosdvzmHz7ZfHdkpyXYYteBGG
mkdir -p target/deploy
if test ! -e target/deploy/loka_vault-keypair.json; then
  ln -s "$program_key" target/deploy/loka_vault-keypair.json
fi
test "$(solana-keygen pubkey target/deploy/loka_vault-keypair.json)" = "$program_address"
printf 'Authority: %s\nProgram: %s\n' "$authority_address" "$program_address"
```

## 2. Sync ids, rebuild, and test

The keypair, Rust declaration, Anchor configuration and generated IDL must agree.
If the final diff check fails, review and commit those differences before deploying.

```sh
anchor keys sync
pnpm install --frozen-lockfile --ignore-scripts
anchor build
cmp idl/loka_vault.json target/idl/loka_vault.json
pnpm typecheck
cargo fmt --all --check
cargo test --locked -p loka_vault
bash scripts/assert-secp256r1-active.sh
anchor test --skip-build --validator legacy
git diff --exit-code -- Anchor.toml loka_vault/src/lib.rs idl/loka_vault.json
sha256sum target/deploy/loka_vault.so
```

The reviewed build hash is recorded in `programs/REVIEW.md`. A different build
hash needs investigation; do not silently treat it as the reviewed artifact.

## 3. Measure rent and fund devnet SOL

These queries cover ProgramData, temporary upload buffer and program account.
Their sum is a conservative peak estimate before buffer rent is returned. Leave
additional SOL for transaction fees. The deploy explicitly sets maximum length
from the artifact; a larger future upgrade may need extension and more rent.

```sh
program_bytes=$(stat -c '%s' target/deploy/loka_vault.so)
solana rent "$((program_bytes + 45))" --url devnet
solana rent "$((program_bytes + 37))" --url devnet
solana rent 36 --url devnet
solana balance "$authority_address" --url devnet
solana airdrop 2 "$authority_address" --url devnet
solana balance "$authority_address" --url devnet
```

A two-SOL request may not cover the whole peak. Repeat only as needed, or use
https://faucet.solana.com with the printed authority address. Faucet limits are
external. Do not run the deploy until the measured peak plus fees is covered.

## 4. Deploy, then verify

```sh
solana program deploy target/deploy/loka_vault.so \
  --program-id "$program_key" --upgrade-authority "$authority" \
  --keypair "$authority" --fee-payer "$authority" \
  --max-len "$program_bytes" --url devnet --use-rpc
solana program show "$program_address" --url devnet
mkdir -p "$HOME/.cache/loka-setup"
solana program dump "$program_address" "$HOME/.cache/loka-setup/deployed-loka_vault.so" --url devnet
cmp target/deploy/loka_vault.so "$HOME/.cache/loka-setup/deployed-loka_vault.so"
printf 'https://explorer.solana.com/address/%s?cluster=devnet\n' "$program_address"
```

Confirm `program show` reports the expected program and upgrade-authority public
addresses. The dump comparison verifies these deployed bytes against your local
artifact. This is not a registry verified-build claim. The address is only reserved
until the user-run deployment succeeds.

## Jordan's public pins

Jordan owns `config/pins.json`. After deployment, hand him this proposed public
fragment for his schema. The mint below is the planned devnet USDC mint, not a
claim that the vault has been initialized. Initialization and server work wait
for Pravin's next authorization.

```json
{
  "programId": "HSgcxix3LGjdCQ7FGexBosdvzmHz7ZfHdkpyXYYteBGG",
  "clusterId": 0,
  "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
}
```

PDA seeds are ASCII `config`; ASCII `vault` plus mint bytes; ASCII `allowance`
plus the eight-byte big-endian allowance id; ASCII `merchant` plus SHA-256 of
its compressed P-256 key. The exact ABI is `programs/idl/loka_vault.json`.
Task 1.4 remains incomplete until deployment and Jordan's committed pins are verified.
