# PRAVIN: tasks

> Pulled from `PLAN.md` (pre-event kit, updated 2026-10-09). If this file and `PLAN.md` disagree, `PLAN.md` wins.
> Status lives in `PLAN.md` only: claim a row there (🟡 + timestamp in Notes), commit `PLAN.md` alone, push.

**Lane:** Backend + Solana program. Anchor program, Solana settlement module (transaction builder, RPC), certificates, allowances, remittance + `/send` safety, backlog drain run (3.51), faucet budget. Owns `programs/` and `server/src/{settle,certs,remit}/`.

**At 8:30 PM start with:** 1.4 (build), 1.9 (build), 1.9b (build). The Sat 3 AM checkpoint is Friday's only goal: one Face ID signature from a physical iPhone, uploaded, verified and redeemed on devnet with an explorer link.

**Sleep window:** Sat 12 to 4 PM; Sun 3 to 6 AM (final at the team call). Code is fixes-only after Sun 3 AM.

## Rows you own

### Phase 0: pre-event (now to Fri 3 PM; no feature code, no product design)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 0.4 | Solana CLI + Anchor (pinned); keypairs created where they will be used (D14); ≥10 devnet SOL across the two fee payers and the upgrade authority; faucet USDC into the four wallets (record what arrives); one devnet transfer | **Jordan** + **Pravin** | T1 | 0.6 | Versions recorded in `programs/TOOLCHAIN.md`; transfer signature saved; local validator reports the secp256r1 feature active |
| 0.6 | Vultr VPS (MLH credit) + Docker + Caddy; Tiger Cloud; GoDaddy Registry promo domain + DNS; Vercel project `zerobars-web`; ElevenLabs key check; YouTube channel | **Jordan**, **Pravin**, **Stephen** | T1 | n/a | `https://api.zerobars.us` answers; the domain resolves; Tiger trial expiry recorded; key length > 0; Railway fallback status noted |

### Phase 0B: arrival to hacking (Fri 3:00 to 8:30 PM; no code)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 0B.4 | Sponsor fair, split so nobody is double-booked: **Khadim** 6:45 to 7:30 PM (MLH rep: the side-challenge limit question, 0B.6; Photon rep: the hackathon promo code for the Pro tier; the Zero Data challenge sponsor: its criteria), then joins the re-cut 7:30 to 8:15 PM; **Jordan** or **Pravin** covers the Solana and ElevenLabs reps | **Khadim**, **Jordan** / **Pravin** | T2 | n/a | Notes (names only with consent); the Photon promo code recorded in the secrets ledger (never in chat or the repo) |

### Phase 1: foundation + contracts (Fri 8:30 PM to Sat 3 AM)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 1.4 | Anchor `loka_vault`: open_allowance, redeem_note, withdraw; devnet deploy | **Pravin** | T1 | 0.4, 1.2 | T1 anchor tests green (`redeem.ts`, `withdraw.ts`, the units vector); the equivocation, reclaim, batch, fee and WebAuthn tests gate their own tasks; program id in `config/pins.json`; deploy on the explorer |
| 1.9 | `POST /v1/notes`: decode, verify, build secp256r1 + redeem_note, fee-pay, record | **Jordan** + **Pravin** | T1 | 1.0, 1.2, 1.4 | Integration test redeems a vector note on devnet with an explorer link; a second submit returns the first result. A cheat redeem is sent with preflight skipped, never auto-retried, and lands on devnet as a failed transaction carrying the program's named error, so the refusal has its own explorer link |
| 1.9b | `POST /v1/payers` + `POST /v1/merchants`: register a device key, open its allowance from the table-demo wallet, create the merchant record | **Pravin** | T1 | 1.0, 1.4 | A new key gets an on-chain allowance and a new merchant gets a record; repeat calls are idempotent; team-device registration draws from the table-demo wallet and the demo fee payer (team keys only); public registration from the public-onboarding wallet and the public fee payer; each with its own atomic daily budget |

### Phase 2: the loop on real phones (Sat 3 AM to 12 PM)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 2.6 | `/v1/allowances` + merchant certificates | **Pravin** | T1 | 1.0, 1.4 | Forged-cert tests fail closed; phones verify certs offline |
| 2.18 | Onboarding allowance for new installs and `/lab`: $1 sandbox per key, from the public-onboarding wallet (never the table-demo wallet), with a daily budget | **Pravin** | T2 | 2.6 | A second claim from the same key is refused; the budget-cap test is green; table-demo funds are untouched by public traffic |

### Phase 3: galaxy layer + UI (Sat 12 PM to 8 PM)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 3.3 | Earmarked remittance + `/send` safety + separate wallets | **Pravin** | T2 | 2.6 | Earmark, rate-limit and cap tests green |
| 3.5 | Equivocation proof + bond payout | **Pravin** | T2 | 1.4 | `anchor test`: distinct conflicting notes pay the unpaid payee once, up to the bond; a second claim is refused |
| 3.15 | Solana Pay merchant QR for online wallets + a Solana Action (blink) for `/send` (`actions.json`, CORS) | **Pravin** | T2 | 3.3 | A devnet Solana Pay transfer from a standard wallet lands; the Action renders on `dial.to/?action=solana-action:<url>` (confirm on the explorer; Dialect's status display can lag) |
| 3.16 | `reclaim_expired` | **Pravin** | T2 | 1.4 | `anchor test`: after the proof window, the remitter gets the remainder + bond; merchant balances unchanged |
| 3.23 | Passkey payer on the web: a Face ID or Touch ID passkey signs the note; `redeem_note_webauthn` verifies the assertion through the precompile and checks type, origin and challenge | **Pravin** + Claude | T2 | 3.10, 1.4 | A passkey payment from Safari on an iPhone settles on devnet; `webauthn.ts` refuses a wrong origin, type, challenge or RP-ID hash, a missing UP or UV flag, and a key not registered to the allowance |
| 3.24 | Proof of reserves on `/proof`: vault assets against every liability (allowance remainders, merchant balances, bonds, bounty and operator credits), all read at one slot | **Pravin** + Claude | T2 | 2.10, 3.2 | `reserves.test.ts`: assets equal liabilities after every redeem, fee, withdraw, reclaim and refund in the test ledger; the page reads all accounts at one slot |
| 3.25 | Batch settlement: `redeem_batch`, the largest batch that fits one transaction (about 3 notes, ESTIMATE); measured fee per payment on `/proof` | **Pravin** + **Jordan** | T2 | 1.4, 2.5 | `batch.ts`: the measured maximum batch settles on devnet as one serialized transaction; `/proof` prints the batch size and fee per payment |
| 3.26 | Fee split on-chain: default 0.5%, a 0.3% submission bounty to whoever submits the note and 0.2% to the operator; bounty earnings on `/proof` | **Pravin** | T2 | 1.4 | `fees.ts`: shares exact to the base unit; the bounty goes to the submitting record; merchant screens show the amount minus the fee |
| 3.30 | Merchant refunds: a merchant-signed refund returns funds to the payer | **Pravin** + Claude | T3 | 1.4 | `anchor test`: a refund to the right allowance passes; a replay, an excess refund and a refund by another merchant are each refused; the refund shows on both phones |
| 3.35 | Mainnet proof: one mainnet transaction whose secp256r1 precompile instruction verifies a real Secure Enclave signature over a real note; no program, no custody | **Pravin** + Claude | T2 | 1.5, 1.9 | The mainnet explorer shows the verified transaction; `/proof` links it; the fee is under a cent |
| 3.36 | Full mainnet mode: `loka_vault` on mainnet behind a switch, real cents between teammates' own wallets only | **Pravin** | T3 | Sat 12 PM checkpoint, 3.35 | Stephen funds the rent (about 1.5 to 3 SOL, returned on close); mainnet uses its own program keypair; cross-network replay is refused both ways (`domain.ts`); one team payment settles on mainnet; public-facing paths stay on devnet; every screen shows the team-demo label |
| 3.45 | Verified build + `GET /trust`: at Saturday's code freeze, build `loka_vault` with `solana-verify build` on the x86 VPS from a clean checkout of a tagged commit; deploy that exact `.so` through the keyed devnet RPC; record the program id, commit, executable hash and on-chain program hash in `docs/FACTS.json`; run `solana-verify verify-from-repo -ud ...` and keep its output; upload the IDL first. `GET /trust` reads programData live and returns the current upgrade authority and program hash next to the recorded ones | **Pravin** + Claude | T2 | 1.4, repo public (1.1) | The two hashes match and `/trust` shows the reproduce command; no "verified badge" claim unless the devnet registry says verified |
| 3.46 | 2-of-3 Squads v4 multisig as the upgrade authority, after the final verified deploy: create it with `squads-multisig-cli` on devnet (fallback backup.app.squads.so), keys on three teammates' own devices; prove the vault with one 0.001 SOL proposal approved twice; then `solana program set-upgrade-authority <id> --new-upgrade-authority <VAULT> --skip-new-upgrade-authority-signer-check -ud`; optional rehearsal of one Squads upgrade with the same `.so` | **Pravin** | T2 | 3.45 | `solana program show` reports the vault as authority; `/trust` says "devnet pilot, unaudited, not frozen on purpose"; never transfer authority to the multisig account address (that strands the program) |
| 3.50 | Solana volume numbers: `scripts/measure-redeem.ts` simulates a redeem (replaceRecentBlockhash, base64) and reads compute units and loaded data size, then sends 20 real devnet redeems and reads `meta.fee` and `meta.computeUnitsConsumed`; every redeem then sets SetComputeUnitLimit (measured + 10%) and SetLoadedAccountsDataSizeLimit (next 32 KiB page); `bench/p256-verify.mjs` measures @noble/curves vs node:crypto verifications per second on the VPS (nproc, CPU model, Node version recorded); `GET /api/volume` returns the signatures, fees, compute units, the live SOL price with its timestamp, USD per payment and per 1,000 (ESTIMATE), and the block-capacity formula (ESTIMATE). Normal redeems keep preflight on; only the deliberate cheat skips it. Never present Solana's network throughput as ours | **Jordan** + **Pravin** | T2 | 1.9 | `measurements/redeem.json` lists 20 signatures that resolve on the devnet explorer and every fee equals 5,000 lamports x signatures (including the secp256r1 one) + priority; a fresh redeem shows both ComputeBudget instructions; `/proof` numbers equal the committed files byte for byte; a stranger can recompute one row from the explorer |
| 3.51 | Backlog drain run: sign 256 notes across one allowance's full serial space with a software P-256 key (labelled; 256 Face ID prompts are not the point), queue them in the merchant outbox path, go online once, settle; record wall time, payments per second, median compute units and total fees; rows tagged `source=load_test`, excluded from the headline | **Pravin** + Claude | T2 | 3.25 or 1.9 | 256 settled (or the exact count with every failure reason); RPC 429s counted, not hidden; `/api/stats` excludes `load_test` by default (a test asserts it); the `/proof` card says "devnet" and "load test" |

## Shared rows (everyone)

### Phase 0: pre-event (now to Fri 3 PM; no feature code, no product design)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 0.8 | Device prep: current LOKA on all phones (first launch online); rehearse the existing relay; time one direct BLE hop on our phones; cellular hotspot test | everyone | T1 | 0.5 | Per-phone sheet (iOS ≥17, automatic time, Face ID or passcode); one measured hop time |
| 0.11 | Registration check: hacklanta.dev acceptance + Devpost registration for all four | each member | T1 | n/a | Four acceptance screenshots + four Devpost registrations by Fri noon |

### Phase 0B: arrival to hacking (Fri 3:00 to 8:30 PM; no code)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 0B.1 | All four checked in by 5:00 PM (government ID + student ID + acceptance email; KSU's digital Talon Card in Wallet is accepted as the student ID) | each member | T1 | 0.11 | Four badges |
| 0B.7 | Storm prep: the NWS High Wind Warning for metro Atlanta runs midnight Fri to 8 AM Sun ("Widespread power outages are expected"). VPS in a Vultr region outside Atlanta (0.6); two charged power banks per person; every phone at 100%; each phone's hotspot tested; slides and the TestFlight notes copied to local disk; Solana CLI, Anchor, Rust and pnpm toolchains warmed by building a throwaway scratch project in `/tmp` (tooling only, deleted, never committed); stay inside the venue overnight and follow venue instructions; backup takes of the remittance ring and the SMS rail recorded by Sat 8 PM | everyone, **Stephen** checks | T1 | 0.6 | Checklist ticked in the team chat before 5:30 PM; a scratch `anchor build` runs with networking off |

### Phase 3: galaxy layer + UI (Sat 12 PM to 8 PM)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 3.6 | Real-run measurement session (team + consenting volunteers) | **Khadim** + everyone | T1 | 2.10 | `experiments/EXP-PAY-001.md` + `docs/FACTS.json` with n, median, p95 |
| 3.20 | Upstream issues: file a reproduction for any Solana, Anchor or ElevenLabs SDK defect we hit; cite it in the writeup | whoever hits it | T2 | standing | Issue links in the README |
| 3.34 | ESP32 store-and-forward relay box for a market stall | whoever brings one | T3 | 2.11 | Only if a teammate brings an ESP32; it carries one sealed packet between two phones |

### Phase 4: harden + submit (Sat 8 PM to Sun 9 AM)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 4.4 | Rehearsals: 6 timed Sat 9 PM to 12 AM (in the SCE Ballroom if open) + 3 Sun 7:45 to 8:45 AM (after the final submission; Jordan and Pravin run the first Sunday slot, Claude times it) + a murder board | everyone | T1 | Sat 12 PM checkpoint | Each run timed and logged at ≤3:00; 10 consecutive `/send` runs from one network succeed within the budget (the shared-Wi-Fi case) |

### Phase 5: after submission (Sun 9 AM onward)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 5.2 | Judging: the main desk first, then the 60-second version at the MLH and sponsor tables | everyone | T1 | 4.9 | The judges of every entered challenge saw the demo or were offered it |

## Your human-only steps

| # | Step | Who | By |
|---|---|---|---|
| H1 | Screenshot hacklanta.dev acceptance | each member | Thu 11 PM |
| H2 | Devpost account, registered for Hacklanta | each member | Fri noon |
| H3 | Join the Devpost project (created at 0B.5) | each member | Fri 9 PM |
| H4 | Check in with government ID + student ID + acceptance email; both IDs are required. KSU's digital Talon Card in Wallet counts as the student ID: check that it opens offline before leaving home | each member | Fri 5:00 PM |
| H5 | members.progsu.com: sign in with the Google email you applied with; enter your KSU email for the code and check spam; if no code arrives, press "Verify later"; if the KSU address is rejected, report it privately to the organizers with a screenshot; never post a code in Discord. Organizers use it to find you at check-in. Record your status (done / Verify later / blocked) in the team's private notes | each member | Before leaving for the venue |
| H8 | Per phone: iOS 17+, automatic date and time on (LOKA validates packet timestamps), Face ID or passcode set, Bluetooth on | each member | Fri 3 PM |
| H9 | First launch online after every dev install | each member | Every install |
| H12 | Vultr account (MLH credit) + VPS; Tiger Cloud; Vercel project | Jordan / Pravin / Stephen | Fri 3 PM |
| H16 | Faucet funding and top-ups (USDC, SOL), by public address | Pravin | 0.4 (pre-event), Sat 9 AM, Sat 6 PM |
| H22 | Points: check-in 15, demo at judging 200; points buy swag only, so nobody leaves the build for workshop points | each member | Fri, Sun |
| H27 | Print resumes before leaving home (for the sponsor interviews; with the storm, do not count on printing at the venue) | each member | Fri 3 PM |
| H29 | Who attends the Sat 1:30 to 2:45 PM sponsor interviews (SCW 466/468), in which slot, and who covers their lane; if the Sat 12 PM checkpoint is red, Stephen stays on the baseline and the others go in 20-minute shifts; Pravin's sleep window moves off 1:30 to 2:45 PM if he goes | Khadim (decides at the team call) | Fri 8 PM |

## Rules that bite most often

- Stage named paths only (never `git add -A`); one logical change per commit; never bundle a status change with code.
- No em dashes or en dashes in anything you write; CI checks every added line.
- Every judge-facing number comes from `docs/FACTS.json`; never type one from memory.
- Secrets never in git. Keys stay where they are used.
- Contract change? Announce it in `PLAN.md` Shared Contracts first, then commit with `⚠️ CONTRACT`.
