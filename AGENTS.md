# Build guide for coding agents and contributors

LOKA Pay adds offline payments to LOKA, an offline Bluetooth mesh messenger. This file says how the repository is laid out, how to build and test each part, and the conventions every change follows. Task ownership and status live in `PLAN.md`.

## Layout

| Path | What it is | Origin |
|---|---|---|
| `ios/` | SwiftUI iPhone app (`ios/LOKA.xcodeproj`, scheme `LOKA`, iOS 17.0+) | LOKA foundation, extended during the event |
| `ios/LokaPay/` | Local Swift package with the payment logic (note bytes, low-S, certificates, note store) and its tests | Event work |
| `android/loka-mesh-lab/` | Kotlin + Jetpack Compose Android app (`app`) and the portable protocol core (`core`) | LOKA foundation |
| `programs/` | Anchor workspace with the `loka_vault` Solana program and its tests | Event work |
| `server/` | Settlement API: TypeScript, Node 22, Fastify, Vitest | Event work |
| `web/` | Next.js judge site (`/judge`, `/live`, `/verify`, `/send`, `/proof`, `/trust`, `/lab`) | Event work |
| `protocol/` | Wire specs (`PAYMENT-V1.md` and LOKA's packet specs) and test vectors | Both |
| `config/pins.json` | Public keys, fingerprints, program id and mint read by every build | Event work |
| `docs/` | Design and runbook docs; `docs/FACTS.json` holds every judge-facing number | Both |
| `experiments/` | Written experiment reports (`EXP-*.md`) | Both |
| `tools/` | Repo tooling: `tools/scrub/` (identifier sweep), `tools/hygiene/` (prose gate), vector generators | Event work and pre-event kit |
| `gameJson/` | LOKA's offline games catalog (clean cards only) and the quiz pack | LOKA foundation, scrubbed |

## Toolchain

- Xcode 26.x (the team builds with 26.6); Swift language mode 5; deployment target iOS 17.0.
- JDK 17 or newer, Android SDK platform 36, the Gradle wrapper in `android/loka-mesh-lab/` (no global Gradle).
- Node 22 and pnpm for `server/` and `web/`.
- Rust stable, the Solana CLI (Agave) and Anchor through `avm`, at the versions pinned in `programs/TOOLCHAIN.md`.
- Python 3 (standard library only) for `tools/`.
- gitleaks for the secret scan.

## Commands

```sh
# iOS: payment package tests, then the app build (unsigned, simulator)
swift test --package-path ios/LokaPay
xcodebuild -project ios/LOKA.xcodeproj -scheme LOKA \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build

# Android: core tests, debug build, lint
cd android/loka-mesh-lab && ./gradlew :core:test :app:assembleDebug :app:lintDebug

# Solana program: tests on a local validator
cd programs && anchor test

# Server
cd server && pnpm install --frozen-lockfile && pnpm test

# Web
cd web && pnpm install --frozen-lockfile && pnpm lint && pnpm build

# Hygiene, as CI runs it
gitleaks detect --source . --no-banner --redact
python3 tools/scrub/scrub_sweep.py . --git-tree HEAD --allow-team "$APPLE_TEAM_ID" \
  --allowlist tools/scrub/allowlist.tsv --fail-on-hits \
  --only home_path,adb_serial,uuid,hex40,dev_team,private_key,aws_access_key,sk_key,jwt,mac_address,phone_e164
python3 tools/hygiene/prose_gate.py --base pre-hacklanta-foundation
```

Commands for parts that do not exist yet are filled in by the task that creates them (see `PLAN.md`). Bluetooth, Secure Enclave and Face ID paths cannot run in CI or the Simulator; their on-device protocol is `docs/DEVICE-TESTS.md`.

## Conventions

- **One logical change per commit.** Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), subject at most 100 characters. Status changes to `PLAN.md` are their own commits: `status: <task#> <emoji> <description>`.
- **Stage named paths only.** Never `git add -A` or `git add .`.
- **Pull requests** into `main`, small enough to review in 20 minutes, with every required check green on the PR head. After a merge, the verdict is the check-runs of the merged SHA, not the PR's.
- **Ownership.** Each path has one owner in `PLAN.md` (Lanes and file ownership). Only Stephen changes `ios/LOKA.xcodeproj`, `ios/Features/ChatStore.swift` and `ios/Network/LokaMesh.swift`. New Swift payment code goes in `ios/LokaPay/`, which needs no project-file change.
- **Contracts.** The shared contracts in `PLAN.md` and `protocol/PAYMENT-V1.md` change only after an announcement in `PLAN.md`; the commit subject starts with `⚠️ CONTRACT`.
- **Imported LOKA files** change only when a task needs it, with the smallest diff that works. Do not reformat or rename them wholesale.
- **Dependencies.** Check every new package for supply-chain risk before adding it, pin it through the lockfile, and commit the lockfile. iOS uses first-party frameworks only.
- **Voice and sound.** Product speech and sound effects call the ElevenLabs API directly via `@elevenlabs/elevenlabs-js`, never through an aggregator such as kie.ai. kie.ai is for landing-page art only.

## Payment code rules

- Every signed structure is a fixed binary layout behind a 16-byte ASCII domain prefix; variable fields are u16 big-endian length-prefixed; nothing signed is joined with a separator. Program id, cluster id and mint are bound in every signed structure.
- Sign the raw canonical bytes with CryptoKit's data API (never the digest overload), send 64-byte low-S signatures and 33-byte compressed public keys.
- Every on-chain amount is in mint base units. Screens convert for display.
- Money-path changes come with tests first (the named tests are listed in `PLAN.md`) and get an adversarial review before merge.
- Every money screen says "sandbox". Nothing in this repository moves real money.

## Writing rules

- No em dashes or en dashes in anything you write: code comments, docs, UI copy, commit messages, PR bodies. Use a colon, a comma, parentheses, a period or a hyphen. CI checks every added line.
- Plain words. No marketing adjectives.
- Every judge-facing number comes from `docs/FACTS.json`, with its source. Never type a number from memory.
- Claims follow the code: if a feature is not wired and tested, the copy does not mention it.

## Secrets and identifiers

- Never commit secrets, `.env` files, signing assets (`.p8`, `.p12`, provisioning profiles), keypair files or raw device logs. `.env.example` lists variable names only and stays in step with the code that reads them.
- Server keys live in the VPS secret environment and the program upgrade authority on its owner's machine, each with an encrypted backup in the team vault. Public halves go in `config/pins.json`.
- Before committing logs or screenshots from phones, run the scrub sweep and remove device serials, MAC addresses, local paths and phone numbers.
- Vercel deploys only to the project `zerobars-web`: check `.vercel/project.json` before every production deploy.
