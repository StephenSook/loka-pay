# LOKA PAY: Plan & Coordination

> Living status doc for Stephen, Jordan, Pravin and Khadim. Updated on every task change and pushed to `main`.
> Single source of truth for who is working on what.
> **Atomic commits. Never bundle a status change with code.**

**Project:** LOKA Pay, offline payments on LOKA's Bluetooth mesh. A phone in airplane mode pays another phone; the payment hops through nearby phones that cannot read or change it, and settles on Solana's public test network (devnet, sandbox tokens) the moment any phone finds signal.

**Team:**
- **Stephen:** frontend + iOS. iOS payment screens, the one Xcode project change, every merge touching `project.pbxproj` / `ChatStore.swift` / `LokaMesh.swift`, the web judge door, design system, video, Devpost and Google Form submission. Only Apple signer and installer.
- **Jordan:** backend. Production keys (1.0), settlement API core (notes, gateway, codec port, events + SSE + stats), voice service, Vonage call, volume measurements (3.50), server privacy hygiene (3.55), VPS deploy. Reviews the iMessage agent (3.47 to 3.49).
- **Pravin:** backend. Anchor program, Solana settlement module (transaction builder, RPC), certificates, allowances, remittance + `/send` safety, backlog drain run (3.51), faucet budget.
- **Khadim:** product + business. Real-user interview + consent, pitch, slides, business model, protocol semantics review, Devpost copy, Google Form answers (Stephen submits), storm numbers (3.54), QA on phones, demo choreography, organizer and sponsor conversations, LAN fallback rehearsal. LOKA co-founder.
- **Claude agents:** extra engineers. Swift package + integration PRs, the iMessage agent worker (Jordan reviews), CI, tests, vectors, web scaffolding, scrub audit, adversarial reviews, monitoring. Every agent PR is reviewed by the human who owns that lane.

**Hackathon:** Hacklanta '26 (Hacklanta II), PROGSU at Georgia State, Fri Oct 9 to Sun Oct 11 2026. Main track: **Fintech**. Side challenges (max 3): the entry list is fixed by Sat 7 PM (0B.6, 4.0) and lists only challenges whose required technology is wired end to end.

**Deadline:** **Sun Oct 11, 9:00 AM ET, hard** (Devpost). **Target final submit: 7:30 AM.** Complete early submission by **Sat 8:00 PM**. The separate Google Form goes in the moment Discord posts it. Judging Sun 9:30 to 11:30 AM, in person: all four at the desk.

**Hacking window:** Fri 8:30 PM to Sun 9:00 AM (36.5 h).

**Repo:** `github.com/<owner>/<name>` (TODO: set at the team call, 0.2), public. Foundation tag `pre-hacklanta-foundation`; pre-event kit tag `pre-hacklanta-kit`.

**Master spec:** a private build plan kept outside this repo (listed in the README disclosure). The payment protocol spec is `protocol/PAYMENT-V1.md`, written in-window (1.2). If this file drifts from either, fix this file.

**Legend:** ✅ done · 🟡 in progress · ⬜ not started · ⛔ blocked · ✂️ cut

**Tiers:** T1 = the judged baseline and its proof · T2 = the galaxy layer · T3 = stretch. Tiers are build order; nothing is deleted. **Drop times** are when an unfinished row stops being SHOWN to judges; it stays in the repo labelled work in progress and is never claimed: **T3 drops Sat 8 PM, T2 drops Sun 3 AM.** Phase windows bind T1 rows; T2 and T3 rows continue past their phase until their drop time.

**Stale lock TTL: 4 hours.** A 🟡 task without a fresh timestamp in Notes is claimable.

**Coordination is manual.** Edit this file by hand, commit only `PLAN.md`, push. Commit message: `status: <task#> <emoji> <description>`.

---

## Context: why this exists

- **The problem.** When the card network, the bank or the cell signal goes down, small merchants fall back to cash or to accepting payments they cannot check. Mobile money over USSD still needs a live cellular connection at the moment of payment. Sized figures (outages, remittances, mobile-money reach) live in `docs/FACTS.json` with their sources and are re-verified before any surface uses them.
- **Our answer.** A capped, prefunded allowance is locked in an on-chain vault before anyone goes offline. The payer's phone signs a payment note with a hardware key (iPhone Secure Enclave) that only signs for its owner. The note crosses to the merchant over Bluetooth with both phones in airplane mode. Whoever finds signal first settles it on Solana devnet, where the secp256r1 precompile verifies the phone's P-256 signature on-chain.
- **Double spend is bounded, not prevented (D9).** The payer can never settle more than the cap. A merchant who accepts offline carries a limited, attributable risk, capped by the offline limit. A reused serial fails on-chain.
- **What existed before the event:** LOKA v0.6.66, the founders' offline mesh messenger, imported as one disclosed commit. **What we build during the event:** the payment protocol, the Solana program, the settlement server, the website, the payment screens and the CI.

---

## Judged criteria and the surfaces that answer them

| Official question (Hacker Guide, verbatim) | Judge-facing surface | Owner |
|---|---|---|
| "Does the project address the track's prompt?" | Track sentence on slide 1; a payment moving end to end; the merchant statement ("tools that make finances easier to manage") | Khadim |
| "How polished is the prototype or demo?" | Lullabuy/ATLAS-style money screens; 3-for-3 baseline runs; `/judge` with no login; CI badges | Stephen |
| "How effective is the team's presentation?" | The rehearsed demo script (4.4); prepared Q&A answers; backup video | Khadim + Stephen |
| "Is there a clear, compelling use case?" | A real user's own words (with consent); sized beneficiaries from `docs/FACTS.json`; the outage evidence | Khadim |

**Secondary (the rules' general considerations):**
- **Originality:** the `/proof` prior-art table and the angles we did not find elsewhere (claimed as "not found in our search", never "first").
- **Technical execution:** explorer links, `protocol/PAYMENT-V1.md`, the architecture diagram (3.11), the named tests.
- **Completeness:** `/live`, `/verify` and `/send` deployed; the TestFlight public link once Apple approves the payment build (until then the README says "in Apple beta review"); `/lab`, which any judge can run with their own passkey; the LOKA relay APK (relay only, clean catalog) on GitHub Releases; build instructions.
- **Sponsor tech:** a "Solana moment" label on every on-chain event, "voice by ElevenLabs", the GoDaddy Registry domain.

**Every judge-facing number is a placeholder until a real run produces it.** It is written once to `docs/FACTS.json`, and the README, `/judge`, slides, video and Devpost read from that file. A test enforces it (4.2). **Never type a number from memory.**

---

## Status Dashboard

Phase 0 statuses are as of Thu Oct 8, late night. Update them in the first status commits after hacking starts.

### Phase 0: pre-event (now to Fri 3 PM; no feature code, no product design)

| # | Component | File(s) | Owner | Tier | Status | Deps | Accept | Notes |
|---|---|---|---|---|---|---|---|---|
| 0.1 | Local workspace (private notes, submissions and video folders outside this repo); brief and research saved | local | **Claude** | T1 | ✅ | n/a | Workspace holds the brief and research notes; none of it is pushed | Thu Oct 8 |
| 0.2 | Team call: roster, roles, repo owner and name, password vault, Mac owners | private notes | **Stephen** + **Khadim** | T1 | ⬜ | n/a | Answers recorded | |
| 0.3 | Prize question to organizers (email): do MLH prizes count toward the 3 side-challenge limit, and are there additional prizes | email | **Stephen** | T1 | ✅ | n/a | Sent Oct 9; the answer is kept (private) | Re-check at the opening ceremony (0B.3) |
| 0.4 | Solana CLI + Anchor (pinned); keypairs created where they will be used (D14); ≥10 devnet SOL across the two fee payers and the upgrade authority; faucet USDC into the four wallets (record what arrives); one devnet transfer | local, VPS | **Jordan** + **Pravin** | T1 | ⬜ | 0.6 | Versions recorded in `programs/TOOLCHAIN.md`; transfer signature saved; local validator reports the secp256r1 feature active | |
| 0.5 | Apple setup: register the bundle id; create the app record (App Store Connect UI; the API refuses); internal group with all four as ASC users; external group "Judges (public)" with test information; 4 UDIDs | App Store Connect | **Stephen** signs in, Claude drives | T1 | ⬜ | n/a | Record exists; teammates accepted; external group ready; export compliance NO (standard crypto); agreements and membership show active | |
| 0.6 | Vultr VPS (MLH credit) + Docker + Caddy; Tiger Cloud; GoDaddy Registry promo domain + DNS; Vercel project `zerobars-web`; ElevenLabs key check; YouTube channel | accounts | **Jordan**, **Pravin**, **Stephen** | T1 | ⬜ | n/a | `https://api.zerobars.us` answers; the domain resolves; Tiger trial expiry recorded; key length > 0; Railway fallback status noted | Domain per Q4 |
| 0.7 | Real-user interview (consent per surface first) | private notes | **Khadim** | T1 | ⬜ | n/a | Verbatim notes + consent per surface by Fri noon | |
| 0.8 | Device prep: current LOKA on all phones (first launch online); rehearse the existing relay; time one direct BLE hop on our phones; cellular hotspot test | n/a | everyone | T1 | ⬜ | 0.5 | Per-phone sheet (iOS ≥17, automatic time, Face ID or passcode); one measured hop time | |
| 0.9 | Event monitoring: full sweep of Discord Q&A and announcements, then a finite watcher that retires after closing | local session | **Claude** | T1 | ⬜ | approval | Sweep report states 0 unread; watcher condition run once by hand | Read-only sweep done Thu Oct 8 ~10:40 PM; watcher not yet verified |
| 0.10 | Business model, license sentence, Q&A answers, and one people count for slide 1: about 5.3 million Senegalese adults with mobile money (ESTIMATE: World Bank 2025 adults aged 15+ x GSMA 2021 mobile-money share of 45%) | private notes, `docs/FACTS.json` | **Khadim** | T1 | ⬜ | 0.7 | Q&A answers complete; the count and its two sources are in `docs/FACTS.json` | |
| 0.11 | Registration check: hacklanta.dev acceptance + Devpost registration for all four | n/a | each member | T1 | ⬜ | n/a | Four acceptance screenshots + four Devpost registrations by Fri noon | |
| 0.12 | Read-only scrub scans of the original LOKA repo | private notes | **Claude** | T1 | ✅ | n/a | gitleaks + trufflehog results recorded; every path to remove listed | Thu Oct 8 ~11:50 PM; categories in `docs/IMPORT-SCRUB.md` |
| 0.13 | Wolof voice check: 5 Wolof + 5 French `eleven_v4` phrases rated by a native speaker | private notes | **Khadim** + Claude | T2 | ⬜ | 0.6 | GO/NO-GO written by Fri noon; clips discarded (regenerated in-window) | |
| 0.14 | Secrets + MFA ledger, plus every trial and credit with its expiry | private ledger | **Stephen** + Claude | T1 | ⬜ | 0.6 | One row per service; VERIFIED / PENDING / UNSUPPORTED; no secret values | |
| 0.15 | Human-only steps assigned (table below) | `PLAN.md` | **Stephen** | T1 | ⬜ | 0.2 | Every row has an owner and a date | |
| 0.16 | Final plan review; optional local tooling trim | n/a | **Claude**; Stephen decides | T2 | ⬜ | approval | Review notes kept; trim done or declined in writing | |
| 0.17 | Greptile AI pull-request review on Stephen's account (Starter plan, every repo) | Greptile, GitHub | **Stephen** signs in, Claude drives | T2 | ⬜ | 0.2 | A review appears on the first PR opened from Stephen's account; credits tracked against the 50 monthly | Teammates' PRs get Codex and the review agents |

### Phase 0B: arrival to hacking (Fri 3:00 to 8:30 PM; no code)

| # | Component | File(s) | Owner | Tier | Status | Deps | Accept | Notes |
|---|---|---|---|---|---|---|---|---|
| 0B.1 | All four checked in by 5:00 PM (government ID + student ID + acceptance email; KSU's digital Talon Card in Wallet is accepted as the student ID) | n/a | each member | T1 | ⬜ | 0.11 | Four badges | Late check-in goes through the help desk |
| 0B.2 | Every member's members.progsu.com account claimed and its check-in form filled (organizers use it at the door) | n/a | each member | T1 | ⬜ | n/a | Four confirmations before Fri check-in | Required for check-in |
| 0B.3 | Opening-ceremony notes; re-cut the demo script and the criteria table against the announced criteria and challenge reveals; keep or swap the third challenge; name ONE headline number in merchant terms, which becomes the first field of `/api/stats`, the last line of the close, slide 3 and the README's first screen | private notes | **Khadim** + **Stephen** | T1 | ⬜ | n/a | Re-cut notes by 8:00 PM, with the headline number and its source run named | |
| 0B.4 | Sponsor fair, split so nobody is double-booked: **Khadim** 6:45 to 7:30 PM (MLH rep: the side-challenge limit question, 0B.6; Photon rep: the hackathon promo code for the Pro tier; the Zero Data challenge sponsor: its criteria), then joins the re-cut 7:30 to 8:15 PM; **Jordan** or **Pravin** covers the Solana and ElevenLabs reps | private notes | **Khadim**, **Jordan** / **Pravin** | T2 | ⬜ | n/a | Notes (names only with consent); the Photon promo code recorded in the secrets ledger (never in chat or the repo) | |
| 0B.5 | Create the Devpost project when submissions open (7 PM); all four join | Devpost | **Stephen** | T1 | ⬜ | 0.11 | All four listed on the project | |
| 0B.6 | Side-challenge limit question: do the MLH and sponsor challenges count toward the limit of 3? One short question in the event Q&A channel (**Stephen** approves the exact text first; nothing is posted without his "send"), plus the MLH rep at the fair and at the opening Q&A; every answer screenshotted into private notes | private notes | **Stephen** (approves), **Khadim** (asks in person) | T1 | 🟡 | 0.3 | An organizer answer quoted verbatim, or the default (at most 3 side challenges in total) at Sat 7:00 PM; the result is written in `PLAN.md` | Posted in the event Q&A channel Fri Oct 9 1:43 PM; awaiting an organizer answer |
| 0B.7 | Storm prep: the NWS High Wind Warning for metro Atlanta runs midnight Fri to 8 AM Sun ("Widespread power outages are expected"). VPS in a Vultr region outside Atlanta (0.6); two charged power banks per person; every phone at 100%; each phone's hotspot tested; slides and the TestFlight notes copied to local disk; Solana CLI, Anchor, Rust and pnpm toolchains warmed by building a throwaway scratch project in `/tmp` (tooling only, deleted, never committed); stay inside the venue overnight and follow venue instructions | n/a | everyone, **Stephen** checks | T1 | ⬜ | 0.6 | Checklist ticked in the team chat before 5:30 PM; a scratch `anchor build` runs with networking off | Backup takes of the remittance ring and the SMS rail are recorded by Sat 8 PM, since carrier voice and SMS may degrade |

### Phase 1: foundation + contracts (Fri 8:30 PM to Sat 3 AM)

| # | Component | File(s) | Owner | Tier | Status | Deps | Accept | Notes |
|---|---|---|---|---|---|---|---|---|
| 1.0 | RSA-3072 LOKA identity + Ed25519 key on the VPS; `config/pins.json`; `docs/RUNBOOK-KEYS.md` | `config/`, `docs/` | **Jordan** | T1 | ⬜ | 0.4 | Server and iOS tests read pins from the one file; every private key only where it is used, with a vault backup; gitleaks clean | |
| 1.1 | Public repo: scrubbed import commit (source SHA + tree hash), tag, README disclosure, `PLAN.md` + task files + `AGENTS.md`, branch protection | root | **Stephen** + Claude | T1 | ✅ | 0.12 | Tag exists; every inventory item resolved; repo public with README (not blocked on 0.3, see 3.2) | `kickoff/import-and-scrub.sh` makes the import and kit commits; the push is manual; Done Fri 8:47 PM: commits f681863 + 259d53f + dcc721e (LICENSE), sweep 0 hits, gitleaks clean, PUBLIC; branch protection moves to 1.7 |
| 1.1b | `ios/LokaPay/` Swift package added to the app; our bundle id and team | `ios/` | **Stephen** | T1 | 🟡 | 1.1 | Device build installs; `swift test` runs in CI | Team id and bundle id were already replaced in the import commit; 🟡 Fri 9:10 PM done by Claude with Stephen OK, PR #3: package linked, app builds in CI (sim + device), release checks green |
| 1.1c | Relax the fixed card and game counts for the clean catalog (iOS loader + envelope test, Android loader, catalog test) | `ios/Features/PartyCatalog.swift`, `ios/Tests/PartyEnvelopeChecks.swift`, `android/loka-mesh-lab/app/src/main/java/org/loka/meshlab/PartyCatalog.kt`, `tests/check-game-catalog.py` | Claude, **Stephen** reviews | T1 | 🟡 | 1.1 | Both apps load the clean catalog; `tests/check-game-catalog.py` passes; every per-card and per-game guard unchanged | Event work named in the disclosure. Until it lands, party cards are off and iOS skips installing the application hooks that 2.2 mirrors; 🟡 Fri 8:55 PM Claude agent, PR branch fix/clean-catalog-counts (also hides the drinking and dirty controls) |
| 1.2 | `protocol/PAYMENT-V1.md` + vectors, drafted in the same hour as 1.1 | `protocol/` | Claude, **Khadim** reviews | T1 | ✅ | none (merged after 1.1) | Spec merged; `protocol/vectors/*.json` committed | 🟡 Fri 8:55 PM Claude, branch docs/payment-v1-spec; ✅ Fri 9:27 PM merged #1 (3 Codex rounds, last clean); JS codec `@lokapay/protocol` merged #5 |
| 1.2b | Vector generator (`tools/vectors/`) + LOKA codec vectors from a Gradle task | `tools/`, `android/` | **Claude** | T1 | 🟡 | 1.2 | CI regenerates vectors with no diff | 🟡 generator + freshness check merged #1; LOKA `:core` codec vectors from Gradle still open (needed by 1.3 only) |
| 1.3 | Codec port (upgrade path) | `server/src/codec/` | **Jordan** | T2 | ⬜ | 1.2b | Every `:core` vector decodes and re-encodes byte-exact; else sidecar decision Sat 9 AM | |
| 1.4 | Anchor `loka_vault`: open_allowance, redeem_note, withdraw; devnet deploy | `programs/` | **Pravin** | T1 | ⬜ | 0.4, 1.2 | T1 anchor tests green (`redeem.ts`, `withdraw.ts`, the units vector); the equivocation, reclaim, batch, fee and WebAuthn tests gate their own tasks; program id in `config/pins.json`; deploy on the explorer | |
| 1.5 | iOS keys + note codec in LokaPay (Secure Enclave, `.userPresence`, low-S) | `ios/LokaPay/` | Claude, **Stephen** reviews | T1 | 🟡 | 1.1b, 1.2 | Vector + low-S tests green; on a phone, an enclave signature verifies against the vector verifier; the key restores after relaunch and the serial counter survives a forced quit | 🟡 PR #3: codec, low-S, Secure Enclave signer, serial store, receipt and conflict bindings, 22 tests; device test after merge |
| 1.6 | Peer-to-peer Wi-Fi spike | spike branch | **Claude** | T3 | ⬜ | 1.1b | GO rule (D6) or killed at midnight; `experiments/EXP-P2P-001.md` | |
| 1.7 | Six CI workflows, required on main | `.github/workflows/` | **Claude** | T1 | ⬜ | 1.1 | First PR shows all six checks green | Drafts arrive with the kit; make each a required check once its folder exists and its job is green |
| 1.8 | Web scaffold with the design tokens; Vercel preview | `web/` | Claude, **Stephen** reviews | T1 | 🟡 | 1.1 | Preview renders; Playwright smoke green | 🟡 Fri 8:55 PM Claude agent, PR branch feat/web-scaffold |
| 1.9 | `POST /v1/notes`: decode, verify, build secp256r1 + redeem_note, fee-pay, record | `server/src/notes/`, `server/src/settle/` | **Jordan** + **Pravin** | T1 | ⬜ | 1.0, 1.2, 1.4 | Integration test redeems a vector note on devnet with an explorer link; a second submit returns the first result. A cheat redeem is sent with preflight skipped, never auto-retried, and lands on devnet as a failed transaction carrying the program's named error, so the refusal has its own explorer link | |
| 1.9b | `POST /v1/payers` + `POST /v1/merchants`: register a device key, open its allowance from the table-demo wallet, create the merchant record | `server/src/certs/`, `server/src/remit/` | **Pravin** | T1 | ⬜ | 1.0, 1.4 | A new key gets an on-chain allowance and a new merchant gets a record; repeat calls are idempotent; team-device registration draws from the table-demo wallet and the demo fee payer (team keys only); public registration from the public-onboarding wallet and the public fee payer; each with its own atomic daily budget | |
| 1.10 | iOS onboarding + direct pay: register the enclave key (`POST /v1/payers` opens an on-chain allowance), then sign and upload one note (offline certificates come in 2.6) | `ios/LokaPay/`, `ios/Features/` | Claude, **Stephen** reviews | T1 | ⬜ | 1.5, 1.9, 1.9b | The Sat 3 AM checkpoint below | |
| 1.11 | TestFlight build 1: archive, upload with `altool`, internal testers, submit version 1.0 for Beta App Review | `ios/` | **Stephen** (Claude drives App Store Connect) | T1 | ⬜ | 1.1b, 1.1c, 1.12 | Build VALID; teammates installed it; `betaReviewState` WAITING_FOR_REVIEW by Sat 12:30 AM | 1.1c first, so a reviewer never meets a refused card catalog |
| 1.12 | `/privacy` page (TestFlight needs a privacy URL) | `web/` | **Claude** | T1 | 🟡 | 1.8 | `https://zerobars.us/privacy` answers 200 | 🟡 Fri 8:55 PM Claude agent, same PR as 1.8 |

**CHECKPOINT Sat 3 AM (Friday's ONLY goal):** one Face ID signature from a physical iPhone, uploaded directly, verified, and redeemed on devnet with an explorer link. Everything else in Phase 1 is parallel work that must not delay it.

**Miss branch:** the backend owners keep going while Stephen and Khadim sleep per the roster. At Sat 6 AM: if the on-chain P-256 verify is still red, take the D2 fallback (claim reworded). If enclave signing is still red, use a software key in the Keychain and drop the Secure Enclave claim.

### Phase 2: the loop on real phones (Sat 3 AM to 12 PM)

| # | Component | File(s) | Owner | Tier | Status | Deps | Accept | Notes |
|---|---|---|---|---|---|---|---|---|
| 2.1 | Merchant QR + scanner, Pay screen, Receive screen | `ios/Features/Pay/` | **Stephen** | T1 | ⬜ | 1.10, 2.6 | On a device: scan, Face ID, merchant shows "Received" offline; the merchant can preset the amount in the QR, the way a real till works | |
| 2.2 | Payment-only permission scope | `ios/LokaPay/` + ChatStore glue (Stephen merges) | **Claude** | T1 | ⬜ | 1.5, 1.1c | Unit test: a non-contact can send `L1\|P` only; chat stays blocked | |
| 2.3 | Note store, re-wrap, re-injection | `ios/LokaPay/` | **Claude** | T2 | ⬜ | 2.2 | Store survives relaunch; unsettled notes re-injected after packet expiry | |
| 2.4 | Gateway mode: upload held frames, inject replies (reuses community-sharing consent) | `ios/LokaPay/`, `ios/Network/` | Claude + **Stephen** | T2 | ⬜ | 2.3, 2.5 | A frame from another phone settles through this one | |
| 2.5 | `/v1/gateway/frames` | `server/src/gateway/` | **Jordan** | T2 | ⬜ | 1.3, 1.9 | Tampered carry chain rejected; the same note via two gateways redeems once | |
| 2.6 | `/v1/allowances` + merchant certificates | `server/src/certs/`, `programs/` | **Pravin** | T1 | ⬜ | 1.0, 1.4 | Forged-cert tests fail closed; phones verify certs offline | |
| 2.7 | Confirmation handling: Paid, receipts, countersignature, payer receipt over BLE | `ios/LokaPay/`, `ios/Features/` | **Stephen** | T1 | ⬜ | 1.9, 2.1 (2.4 for the upgrade) | Merchant shows Paid; payer receives the receipt offline | |
| 2.8 | Spend markers to linked peers + server double-spend record | `ios/LokaPay/`, `server/src/notes/` | Claude + **Jordan** | T2 | ⬜ | 2.7 | Linked merchant B warns within 10 s | |
| 2.9 | BLE tuning (iOS) + the upgrade decision (by Sat 8 PM) | `ios/Network/`, `LokaMesh.swift` (Stephen merges) | **Claude** | T2 | ⬜ | 2.4 | `experiments/EXP-PAY-001.md` has both upgrade variants measured; decision written | |
| 2.10 | Events store + `/api/stats` + SSE `/live` | `server/src/events/` | **Jordan** | T1 | ⬜ | 1.9 | SSE shows a settlement within 2 s of confirmation; an `Origin`-header test asserts `access-control-allow-origin`. Every event row carries a source (`phone_ble`, `relay_upgrade`, `sms_rail`, `lab_simulated`, `canary`) and `/api/stats` breaks each figure out by source; `/api/stats?run=EXP-PAY-001` returns the frozen 3.6 measurement window, the README curl points at it, and the hygiene FACTS test asserts `docs/FACTS.json` equals it | |
| 2.11 | Golden-packet test on the Samsung | `android/` | **Claude** | T2 | ⬜ | 2.3 | An unmodified Android build carries one payment packet (recorded) | Android reviewer: Q10 |
| 2.12 | Face ID failure path + error states on every money screen | `ios/Features/` | **Stephen** | T1 | ⬜ | 2.1 | Passcode fallback works; every money screen has an error state | |
| 2.13 | "Try to cheat" control: signs a second note bound to the settled payment's payer, allowance and serial, clearly labelled; the judge presses it | `ios/Features/` | **Claude** | T1 | ⬜ | 2.1 | The judge can press it; that payment's payer authenticates; the refusal shows "Failed (already spent)" and an explorer link to the failed devnet transaction with the program's named error; if any layer refuses before the chain, the screen names which layer | |
| 2.14 | "Demo route" setting replaces the DEBUG launch args, with a banner | `ios/Features/` (Stephen merges ChatStore) | **Claude** | T2 | ⬜ | 1.1b | Works in a TestFlight build; banner visible | |
| 2.15 | "No internet" chip (NWPathMonitor) on money screens | `ios/LokaPay/` | **Claude** | T1 | ⬜ | 2.1 | Chip flips within 2 s of airplane mode | |
| 2.16 | LAN fallback: travel router, no uplink, Samsung hub | n/a | **Khadim** + Claude | T2 | ⬜ | 2.11 | One rehearsed run logged | |
| 2.17 | Gateway outbox: the server queues allowance certificates and remittance notices; gateway phones pull them and carry them into the mesh | `server/src/gateway/`, `ios/LokaPay/` | **Jordan** + Claude | T2 | ⬜ | 2.4, 2.6 | An allowance funded on the web arrives on an airplane-mode phone through a gateway | |
| 2.18 | Onboarding allowance for new installs and `/lab`: $1 sandbox per key, from the public-onboarding wallet (never the table-demo wallet), with a daily budget | `server/src/certs/` | **Pravin** | T2 | ⬜ | 2.6 | A second claim from the same key is refused; the budget-cap test is green; table-demo funds are untouched by public traffic | |
| 2.19 | Minimal deployed `/live`: SSE feed + explorer links (the full judge door is 3.2) | `web/` | **Claude** | T1 | ⬜ | 2.10, 1.8 | Production `/live` shows a settlement within 5 s of confirmation | |
| 2.20 | Merchant offline-limit ledger: durably reserve each accepted note against the allowance's offline limit; refuse past it | `ios/LokaPay/` | **Claude** | T1 | 🟡 | 1.5, 2.6 | Unit test plus a relaunch test: cumulative unsettled value never exceeds the limit | 🟡 PR #6 (stacked on #3): OfflineLedger, 26 tests |
| 2.21 | Judge flips airplane mode: the "No internet" chip reacts within 2 s on both phones; the demo script and the table card invite the judge to switch airplane mode on themselves | `ios/LokaPay/`, demo script (outside the repo) | **Stephen** + **Khadim** | T1 | ⬜ | 2.15 | Rehearsal (4.4) shows a judge-style tester toggling airplane mode and the chip flipping on both phones before Pay | |

**CHECKPOINT Sat 12 PM:** the demo baseline (device roles below) works three times in a row on our phones. Record backup video #1 before any Phase 3 work starts.

**Miss branch:** everyone works on the baseline until it passes. Only 3.11 continues, and 3.1 continues only through agent PRs on screens no red baseline task uses; Stephen stays on the red baseline item until the checkpoint passes (he owns 2.1, 2.7 and 2.12 and is the only iOS developer). Backup #1 is recorded at the first clean run.

### Phase 3: galaxy layer + UI (Sat 12 PM to 8 PM)

**T2 build order, most judge-visible first:** (1) the judge door (2.19, 3.2); (2) money into airplane mode with the judge's phone ringing (2.17, 3.3, 3.9) and the real merchant on camera (3.38); (3) the TestFlight link (4.7); (4) the web lab and passkeys (3.10, 3.23); (5) the Android hardware key (3.13); (6) proof of reserves and the mainnet proof (3.24, 3.35); (7) the acceptance check (3.27); (8) batch settlement and the fee split (3.25, 3.26); (9) the Dynamic Island (3.14); (10) languages (3.28); (11) Solana Pay and blinks (3.15); (12) equivocation and reclaim (3.5, 3.16); (13) the budget view (3.17); (14) sounds (3.18); (15) settle it yourself (3.29).

| # | Component | File(s) | Owner | Tier | Status | Deps | Accept | Notes |
|---|---|---|---|---|---|---|---|---|
| 3.0 | Midpoint audit, Sat ~3 PM: count commits since 8:30 PM per judged question and per in-flight T2 item; each T2 item names the demo-script moment or prepared Q&A answer it feeds; items feeding neither move behind 3.7 and 4.4. Re-ranks only, deletes nothing | private notes, `PLAN.md` | Claude + **Stephen** | T1 | ⬜ | Sat 12 PM checkpoint | The table exists by 3:30 PM and the T2 order in `PLAN.md` reflects it | |
| 3.1 | iOS money screens in the Lullabuy/ATLAS system; de-gamify (Play tab becomes Wallet, dirty/drinking filters and card art removed); offline corner | `ios/` | **Stephen** | T1 | ⬜ | 2.7 | `ui-self-heal` stills at 390 pt pass the token audit; screenshots in `docs/screens/`; VoiceOver labels and Dynamic Type on every money screen; a haptic and a tone on Received and Paid | |
| 3.2 | Web judge door: `/judge`, `/live`, `/verify` (T1); `/`, `/send`, `/proof`, `/trust` (T2) | `web/` | Claude + **Stephen** | T1/T2 | ⬜ | 2.19 | Playwright passes on production with no login; Lighthouse 90+ on `/judge` and `/live`; `/live?kiosk=1` renders big-type | |
| 3.3 | Earmarked remittance + `/send` safety + separate wallets | `web/`, `server/src/remit/`, `programs/` | **Pravin** | T2 | ⬜ | 2.6 | Earmark, rate-limit and cap tests green | |
| 3.4 | Phrase bank: server half (Jordan) + on-device assembly (Claude) | `server/src/voice/`, `ios/LokaPay/` | **Jordan** + Claude | T2 | ⬜ | 0.13 GO, 2.7 | A phrase plays at zero bars on a device. A stranger can check it: `GET https://api.zerobars.us/v1/voice/sample?lang=wo\|fr` serves the cached phrase files only (judge traffic never spends ElevenLabs credits) with the model id and generation date in headers; `/judge` has a play button labelled "generated by ElevenLabs eleven_v4"; the README prints the curl | |
| 3.5 | Equivocation proof + bond payout | `programs/` | **Pravin** | T2 | ⬜ | 1.4 | `anchor test`: distinct conflicting notes pay the unpaid payee once, up to the bond; a second claim is refused | |
| 3.6 | Real-run measurement session (team + consenting volunteers) | `docs/`, `experiments/` | **Khadim** + everyone | T1 | ⬜ | 2.10 | `experiments/EXP-PAY-001.md` + `docs/FACTS.json` with n, median, p95 | |
| 3.7 | Demo video: 2:00 to 3:00, public on YouTube, -14 to -16 LUFS, frames checked | outside the repo | **Stephen** + **Khadim** | T1 | ⬜ | Sat 12 PM checkpoint | ebur128 + ffprobe output logged; link opens logged out; final cut by 9 PM; real captures first; shows the T2 beats that shipped | |
| 3.8 | Samsung relay test + LOKA relay APK (clean catalog) on GitHub Releases | `android/` | **Claude** | T2 | ⬜ | 2.11 | APK installs on the Samsung; release page public | Android reviewer: Q10 |
| 3.9 | Remitter phone call when their money is spent (Vonage + ElevenLabs voice), the judge-ring beat | `server/src/calls/` | **Jordan** + Claude | T2 | ⬜ | 3.3 | One real call logged, placed through the Vonage Voice API. The number is checked by reverse-OTP (the judge texts "LOKA <code>" to our number; inbound messages need no 10DLC registration) and held in server memory only (15-minute TTL) until its one call ends; it is never written to Tiger, logs or disk, and afterwards the call legs are deleted (Vonage Delete Leg) with Legs Persistence Time at its minimum in the Vonage dashboard (D15, 3.55); one call per remittance (idempotent); one budget with per-number attempt limits and an in-memory burst guard (never a per-IP limit that a shared venue Wi-Fi would trip). The ring is opt-in and labelled. Our server never sends SMS (unregistered US long-code SMS is blocked, and 10DLC registration takes 3 to 5 weeks). The Vonage account is funded at hour 0 (H14; trial accounts call only the owner's number and cannot buy a number); a startup self-check reads the account balance; a Saturday dry run to a non-team phone checks for "Spam Likely" labelling. Without the paid account the call goes to a team phone and the judge-ring beat is not shown | |
| 3.10 | `/lab`, a web lab any judge can run from the deployed link: two simulated phones with labelled simulated hops; real P-256 signatures (a non-extractable WebCrypto key, or a passkey via 3.23); real devnet settlement; a real refused cheat | `web/` | **Claude** | T2 | ⬜ | 3.2, 1.9b | A logged-out visitor completes a payment and a refused cheat on production; every simulated element is labelled; registrations draw from the public-onboarding wallet | |
| 3.11 | Three slides: problem + user, architecture diagram, disclosure + measured numbers | outside the repo | **Khadim** | T1 | ⬜ | 1.2 | Every number equals `docs/FACTS.json` | |
| 3.12 | Merchant statement in Wallet (signed receipts, export) | `ios/` | **Claude** | T2 | ⬜ | 2.7 | Export opens; signatures verify on `/verify` | |
| 3.13 | Android pays with its own hardware key: Android Keystore P-256 (StrongBox when present) behind BiometricPrompt, DER to 64-byte low-S, payment screens | `android/` | **Claude** | T2 | ⬜ | 2.6, 2.11 | A Samsung-signed note redeems on devnet through the same precompile; KeyInfo reports a hardware security level (TEE or StrongBox); signing refuses without per-use biometric authentication; the Samsung pays an iPhone over BLE | Android reviewer: Q10 |
| 3.14 | Live Activity in the Dynamic Island (Pending, Received, Paid, local updates) + a Lock Screen allowance widget | `ios/` (widget extension; Stephen owns the target) | **Stephen** + Claude | T2 | ⬜ | 2.7 | Flips to Paid with the phone offline until settle; the widget shows the allowance left | |
| 3.15 | Solana Pay merchant QR for online wallets + a Solana Action (blink) for `/send` (`actions.json`, CORS) | `web/`, `server/src/remit/` | **Pravin** | T2 | ⬜ | 3.3 | A devnet Solana Pay transfer from a standard wallet lands; the Action renders on `dial.to/?action=solana-action:<url>` (confirm on the explorer; Dialect's status display can lag) | |
| 3.16 | `reclaim_expired` | `programs/` | **Pravin** | T2 | ⬜ | 1.4 | `anchor test`: after the proof window, the remitter gets the remainder + bond; merchant balances unchanged | |
| 3.17 | Family budget view on `/send`: where the money went, by earmark, from signed receipts | `web/` | **Claude** | T2 | ⬜ | 3.3, 2.10 | Every figure recomputes from `/api/stats` | |
| 3.18 | ElevenLabs sound effects for payment tones (Received, Paid, Failed) alongside the voice | `server/src/voice/`, `ios/` | **Jordan** | T2 | ⬜ | 3.4 | Tones generated by the ElevenLabs sound-effects API, cached, play offline | |
| 3.19 | Background relay measurement (iOS background Bluetooth modes) | `ios/` | **Claude** | T3 | ⬜ | 2.9 | Measured or not claimed; result in `experiments/` | |
| 3.20 | Upstream issues: file a reproduction for any Solana, Anchor or ElevenLabs SDK defect we hit; cite it in the writeup | n/a | whoever hits it | T2 | ⬜ | standing | Issue links in the README | |
| 3.21 | UWB point-to-pay experiment (Nearby Interaction) | `ios/` | **Claude** | T3 | ⬜ | 2.1 | Airplane mode turns UWB off, so it runs only with cellular data and Wi-Fi switched off, shown by the "No internet" chip, and is never called airplane mode | |
| 3.22 | Siri shortcut "Pay with LOKA" (App Intents, on-device; Face ID still required) | `ios/` | **Claude** | T3 | ⬜ | 2.1 | Works with airplane mode on, or it is not shown | |
| 3.23 | Passkey payer on the web: a Face ID or Touch ID passkey signs the note; `redeem_note_webauthn` verifies the assertion through the precompile and checks type, origin and challenge | `web/`, `programs/`, `server/src/certs/` | **Pravin** + Claude | T2 | ⬜ | 3.10, 1.4 | A passkey payment from Safari on an iPhone settles on devnet; `webauthn.ts` refuses a wrong origin, type, challenge or RP-ID hash, a missing UP or UV flag, and a key not registered to the allowance | The precompile message holds only SHA-256(clientDataJSON), so `redeem_note_webauthn` carries the full clientDataJSON as instruction data, hashes it on-chain (`sol_sha256`), compares that to the last 32 bytes of the precompile message, then base64url-decodes the challenge and compares it to the note id |
| 3.24 | Proof of reserves on `/proof`: vault assets against every liability (allowance remainders, merchant balances, bonds, bounty and operator credits), all read at one slot | `server/src/settle/`, `web/` | **Pravin** + Claude | T2 | ⬜ | 2.10, 3.2 | `reserves.test.ts`: assets equal liabilities after every redeem, fee, withdraw, reclaim and refund in the test ledger; the page reads all accounts at one slot | |
| 3.25 | Batch settlement: `redeem_batch`, the largest batch that fits one transaction (about 3 notes, ESTIMATE); measured fee per payment on `/proof` | `programs/`, `server/src/settle/` | **Pravin** + **Jordan** | T2 | ⬜ | 1.4, 2.5 | `batch.ts`: the measured maximum batch settles on devnet as one serialized transaction; `/proof` prints the batch size and fee per payment | Q6 |
| 3.26 | Fee split on-chain: default 0.5%, a 0.3% submission bounty to whoever submits the note and 0.2% to the operator; bounty earnings on `/proof` | `programs/`, `web/` | **Pravin** | T2 | ⬜ | 1.4 | `fees.ts`: shares exact to the base unit; the bounty goes to the submitting record; merchant screens show the amount minus the fee | |
| 3.27 | Acceptance check chip on the Receive screen ("Within local limit", "Near limit", "Conflicting spend seen") plus the offline-risk line | `ios/LokaPay/`, `ios/Features/` | **Claude** | T2 | ⬜ | 2.6, 2.8, 2.20 | Each state reproduces on a device from its inputs; word and icon, never color alone; the risk line is always visible | |
| 3.28 | Money screens in English, French and Wolof | `ios/`, `web/` | **Khadim** + Claude | T2 | ⬜ | 3.1 | Every money string has three translations; a native speaker checked the Wolof | |
| 3.29 | Settle it yourself on `/verify`: submit a note's redeem with any devnet wallet as fee payer | `web/` | **Claude** | T2 | ⬜ | 3.2, 1.4 | A note settles from a browser wallet while our server is stopped, and the merchant app shows Paid from a direct chain read | |
| 3.30 | Merchant refunds: a merchant-signed refund returns funds to the payer | `programs/`, `ios/` | **Pravin** + Claude | T3 | ⬜ | 1.4 | `anchor test`: a refund to the right allowance passes; a replay, an excess refund and a refund by another merchant are each refused; the refund shows on both phones | |
| 3.31 | Card funding for `/send` through Stripe test mode (payment success opens a sandbox allowance) | `server/src/remit/`, `web/` | **Jordan** | T3 | ⬜ | 3.3 | A Stripe test card funds a real devnet allowance through the webhook | |
| 3.32 | Receipts as Apple Wallet passes (`passkit-generator`, a Pass Type ID from Stephen's account) | `server/`, `ios/` | **Claude** | T3 | ⬜ | 2.7 | A settled payment adds a valid pass to Wallet | |
| 3.33 | Tap an NFC sticker to pick the merchant (Core NFC) | `ios/` | **Claude** | T3 | ⬜ | 2.1 | Only if stickers are on hand and a device test shows NFC reads with airplane mode on (Q11) | |
| 3.34 | ESP32 store-and-forward relay box for a market stall | `hardware/` | whoever brings one | T3 | ⬜ | 2.11 | Only if a teammate brings an ESP32; it carries one sealed packet between two phones | |
| 3.35 | Mainnet proof: one mainnet transaction whose secp256r1 precompile instruction verifies a real Secure Enclave signature over a real note; no program, no custody | `server/src/settle/`, `web/` | **Pravin** + Claude | T2 | ⬜ | 1.5, 1.9 | The mainnet explorer shows the verified transaction; `/proof` links it; the fee is under a cent | |
| 3.36 | Full mainnet mode: `loka_vault` on mainnet behind a switch, real cents between teammates' own wallets only | `programs/`, `server/`, `ios/` | **Pravin** | T3 | ⬜ | Sat 12 PM checkpoint, 3.35 | Stephen funds the rent (about 1.5 to 3 SOL, returned on close); mainnet uses its own program keypair; cross-network replay is refused both ways (`domain.ts`); one team payment settles on mainnet; public-facing paths stay on devnet; every screen shows the team-demo label | |
| 3.37 | Paper receipt: a Bluetooth thermal printer prints the signed receipt with a QR that verifies on `/verify` | `ios/` | **Claude** | T3 | ⬜ | 2.7 | Only if we get a printer by Friday; one printed receipt verifies on a judge's phone | |
| 3.38 | One real merchant near campus tries a sandbox payment on camera and says what an outage costs them | `docs/` | **Khadim** | T2 | ⬜ | Sat 12 PM checkpoint | Written consent before filming; the clip and quote are used verbatim; nothing is staged | |
| 3.39 | The remitter call becomes an ElevenLabs conversational agent that answers "where was it spent?" from the signed receipt | `server/src/calls/` | **Jordan** + Claude | T3 | ⬜ | 3.9 | One real two-way call logged; answers come only from the receipt | |
| 3.40 | Speak to pay in French with Apple's on-device model (Foundation Models); Face ID still signs | `ios/` | **Claude** | T3 | ⬜ | 2.1 | Only on a phone that supports Apple Intelligence; works with airplane mode on, or it is not shown | |
| 3.41 | "Paid while offline for N s" per payment on `/live` and the receipt card, from signed timestamps | `server/src/events/`, `web/` | Claude + **Jordan** | T2 | ⬜ | 2.10, 2.7 | The figure recomputes from the ACK received-at and the confirmation slot time returned by `/api/stats`; a test feeds two known timestamps and asserts the printed seconds | |
| 3.42 | Local currency (XOF, NGN) next to the sandbox dollars on `/send`, the family budget view and the receipt, from open.er-api.com with the source and update time printed; display only, settlement stays in USDC | `web/`, `ios/LokaPay/` | **Claude** | T2 | ⬜ | 3.3 | The rate is fetched server-side once a day and cached; the attribution link renders; if the fetch fails the screen shows dollars only (never a stale or invented rate) | |
| 3.43 | SMS settlement rail, server: a Fastify route for Vonage inbound SMS that answers 200 first and processes async; reassembles parts by concat-ref/total/part, with a same-sender 60 s window fallback when concat fields are missing; payload "L1:" + unpadded base64url note + signature, with the payer key replaced by a key id so it fits 2 segments (306 GSM-7 characters); feeds the existing settlement path; dedupes by note id (Vonage re-sends for 24 h without a 200) | `server/src/sms/` | **Jordan** + Claude | T2 | ⬜ | 1.9, H14 (funded Vonage) | A recorded inbound 2-part message settles once on devnet; a replayed webhook and a later BLE upload of the same note settle nothing more; `/api/stats` tags it `sms_rail` | Tier 2 of three: no signal = Bluetooth mesh; signal but no data = SMS; online = direct upload. Inbound only, so no 10DLC registration |
| 3.44 | SMS hand-off, iOS: on the merchant phone, `MFMessageComposeViewController` with our Vonage number as recipient and the payload as body; button "Tap Send to settle by SMS"; "sent" means handed to Messages, never "settled"; Paid arrives later over BLE, data or a Vonage voice call. Blocking hour-1 device test: Cellular Data off, Wi-Fi off, Wi-Fi Calling off (not airplane mode); send 2- and 3-part payloads from each teammate's carrier at GSU and confirm they arrive as SMS parts, not a failed MMS | `ios/LokaPay/`, `ios/Features/` | Claude, **Stephen** reviews | T2 | ⬜ | 3.43, 2.7 | The device test log shows arrival on the webhook per carrier; the pitch states the three tiers and never claims airplane mode or satellite for this path | |
| 3.45 | Verified build + `GET /trust`: at Saturday's code freeze, build `loka_vault` with `solana-verify build` on the x86 VPS from a clean checkout of a tagged commit; deploy that exact `.so` through the keyed devnet RPC; record the program id, commit, executable hash and on-chain program hash in `docs/FACTS.json`; run `solana-verify verify-from-repo -ud ...` and keep its output; upload the IDL first. `GET /trust` reads programData live and returns the current upgrade authority and program hash next to the recorded ones | `programs/`, `server/src/trust/`, `web/` | **Pravin** + Claude | T2 | ⬜ | 1.4, repo public (1.1) | The two hashes match and `/trust` shows the reproduce command; no "verified badge" claim unless the devnet registry says verified | |
| 3.46 | 2-of-3 Squads v4 multisig as the upgrade authority, after the final verified deploy: create it with `squads-multisig-cli` on devnet (fallback backup.app.squads.so), keys on three teammates' own devices; prove the vault with one 0.001 SOL proposal approved twice; then `solana program set-upgrade-authority <id> --new-upgrade-authority <VAULT> --skip-new-upgrade-authority-signer-check -ud`; optional rehearsal of one Squads upgrade with the same `.so` | `programs/`, `docs/RUNBOOK-KEYS.md` | **Pravin** | T2 | ⬜ | 3.45 | `solana program show` reports the vault as authority; `/trust` says "devnet pilot, unaudited, not frozen on purpose"; never transfer authority to the multisig account address (that strands the program) | No freeze: `--final` is irreversible and strands fixes |
| 3.47 | iMessage agent worker + registration: Photon's `spectrum-ts` cloud iMessage provider as its own ESM Node 22 process on the VPS (systemd; never `imessage-local`); `POST /imsg/register {phone E.164}` creates a shared user (`POST /projects/{id}/users`, Basic auth) and returns the assigned number plus Photon's public redirect deep link with a prefilled message; `/send` gets "Text the agent" (iPhone) and a QR of the same link (desktop); if no inbound arrives within 90 s, `/send` shows the web + reverse-OTP path (a mismatched handle never reaches the agent, so the fallback lives on the web side); register only 1 or 2 team phones so Free-tier slots stay open for judges, unless the promo code gives Pro | `server/src/agent/`, `web/` | Claude (**Jordan** reviews), **Stephen** (the `/send` button, about 1 h) | T2 | ⬜ | 1.9b, 0B.4 promo code | Echo within 5 s from a teammate's iPhone; a phone registered after the worker started still gets its first reply without a restart (else restart after each registration, and record it); the worker returns after `systemctl restart` with no manual step; on the Samsung the web path completes end to end | **Gate Sat 10:00 AM:** if echo + registration is not working, the agent is removed and every claim about it is cut |
| 3.48 | iMessage remittance loop: parse the inbound text, reply with an explicit confirm, and on YES open the earmarked allowance through the existing endpoint, idempotent on `message.id` (deliveries are at-least-once); when that allowance settles, send a text receipt with the `/verify` and explorer links, then `voice()` with a pre-transcoded `.m4a` phrase from the ElevenLabs bank (voice notes need m4a/AAC; `ffmpeg-static` only if needed); the first outbound message carries no link or media (Photon deliverability rule); STOP and UNSUBSCRIBE are honoured (Photon's messaging terms); `/privacy` says Photon keeps the registered number in its user table | `server/src/agent/` | Claude, **Jordan** reviews | T2 | ⬜ | 3.47, 3.3 | "send $1 to Khadim for lunch" then YES creates exactly one allowance; YES twice still creates one; after an airplane-mode spend settles, the judge-style iPhone shows the text receipt and a voice-note bubble within 60 s of confirmation; STOP gets a confirmation and no further messages | **Gate Sat 4:00 PM:** if the full loop is not working, the agent is removed and every claim about it is cut |
| 3.49 | Agent language layer: `gemini-3.8-flash` with a structured-output schema {amount_usd, recipient_label, purpose, expires_days} (thinking "low"; "minimal" errors on this model); deterministic validation (amount within the sandbox cap, recipient in the known list) and nothing moves until YES; key server-side only; confirm the key's Cloud project has active billing so paid-tier terms apply (unpaid-tier prompts can be used for training) | `server/src/agent/` | **Claude** | T2 | ⬜ | 3.48 | 10 held-out English and French utterances written by Khadim parse correctly in at least 9; an over-cap or unknown recipient is refused with a reason; a grep of the web bundle for the key prefix returns 0 | Language from the model, money rules in code |
| 3.50 | Solana volume numbers: `scripts/measure-redeem.ts` simulates a redeem (replaceRecentBlockhash, base64) and reads compute units and loaded data size, then sends 20 real devnet redeems and reads `meta.fee` and `meta.computeUnitsConsumed`; every redeem then sets SetComputeUnitLimit (measured + 10%) and SetLoadedAccountsDataSizeLimit (next 32 KiB page); `bench/p256-verify.mjs` measures @noble/curves vs node:crypto verifications per second on the VPS (nproc, CPU model, Node version recorded); `GET /api/volume` returns the signatures, fees, compute units, the live SOL price with its timestamp, USD per payment and per 1,000 (ESTIMATE), and the block-capacity formula (ESTIMATE). Normal redeems keep preflight on; only the deliberate cheat skips it | `scripts/`, `bench/`, `server/src/volume/`, `measurements/` | **Jordan** + **Pravin** | T2 | ⬜ | 1.9 | `measurements/redeem.json` lists 20 signatures that resolve on the devnet explorer and every fee equals 5,000 lamports x signatures (including the secp256r1 one) + priority; a fresh redeem shows both ComputeBudget instructions; `/proof` numbers equal the committed files byte for byte; a stranger can recompute one row from the explorer | Expect 10,000 lamports per redeem (5,000 per signature; the precompile adds 0 runtime compute units). Never present Solana's network throughput as ours |
| 3.51 | Backlog drain run: sign 256 notes across one allowance's full serial space with a software P-256 key (labelled; 256 Face ID prompts are not the point), queue them in the merchant outbox path, go online once, settle; record wall time, payments per second, median compute units and total fees; rows tagged `source=load_test`, excluded from the headline | `scripts/`, `experiments/EXP-DRAIN-001.md` | **Pravin** + Claude | T2 | ⬜ | 3.25 or 1.9 | 256 settled (or the exact count with every failure reason); RPC 429s counted, not hidden; `/api/stats` excludes `load_test` by default (a test asserts it); the `/proof` card says "devnet" and "load test" | |
| 3.52 | `/verify` upgrade: "Play the attacker" (the judge edits the amount or merchant of a real demo note; the browser check fails with "Signature no longer matches: the payer's phone never signed this"; "Send it to Solana anyway" uses a separate small attacker fee payer and returns a failed devnet transaction or the verbatim RPC rejection) + "Transaction X-ray" (the 141 signed bytes next to the 141 bytes read back from the devnet transaction by the judge's browser, banded by field, with "141 of 141 bytes match", compute units, fee, and the program's named error on the refused cheat) | `web/` | Claude, **Stephen** reviews the visual | T2 | ⬜ | 3.2, 1.9 | Playwright on production: editing the amount shows the failure within 1 s and undo restores the match; "Send anyway" yields a non-null `meta.err` signature or the RPC rejection, whichever happens is recorded in `docs/FACTS.json` and the page wording matches; one changed byte in the fetched data names the byte position | |
| 3.53 | Zero-bars meter + offline clock (tightens 2.15 and 3.41): four empty signal bars labelled "Zero bars: no Wi-Fi, no cellular, Bluetooth on" plus a ticking "Holding offline 0:42" on the merchant's Receive screen, freezing into "Settled N s after upload; held offline M" (PAYMENT-V1 section 4.3 names the clocks); the receipt stamp says "Received with zero bars (phone-reported)"; the same bars fill in the Dynamic Island compact view on Paid; radio state is never added to the signed ACK | `ios/LokaPay/`, `ios/Features/` | **Stephen** (UI), Claude (state) | T2 | ⬜ | 2.15, 3.41 | On a device the bars empty and the clock ticks within 2 s of airplane mode; the frozen figure equals the 3.41 value from `/api/stats` to the second; VoiceOver reads "Zero bars, no internet" | |
| 3.54 | Storm numbers: Sat 9 to 11 PM, read Georgia Power's outage map (customers out of total served, and the map's own "Last Updated" time) and the FCC's Hurricane Isaias status page; write the figures with source, URL and timestamp into `docs/FACTS.json` and the Devpost text that night; Sunday refresh optional, slides only; the FCC Helene cell-site line is the fallback | `docs/FACTS.json`, Devpost text (outside the repo) | **Khadim** + Claude | T1 | ⬜ | 0B.7 | A second teammate re-opens each URL within 15 minutes and sees the same figure within refresh drift; a grep of README, Devpost text and slides for "poweroutage" returns 0; every storm figure carries a URL and a timestamp; this weekend's figures are dated Oct 2026 (never a 2020 Isaias number) and the Helene line is dated Oct 2024 | Never PowerOutage.us on a public surface (its terms forbid it), never a screenshot of the Georgia Power map, never a claim that LOKA Pay helped anyone in the storm. The Helene line always carries the FCC caveat: cell-site outages do not equal people without service |
| 3.55 | Privacy hygiene (required for an honest `/privacy`): custom Fastify serializers with no IP, headers or bodies; no Caddy access log; rate-limit keys HMAC'd with a per-boot secret; phone numbers memory-only (D15); Vercel Web Analytics and Speed Insights off and `NEXT_TELEMETRY_DISABLED=1`; CI guard that fails on analytics or error-tracking packages (`@vercel/analytics`, sentry, posthog, gtag, mixpanel) using `git ls-files --cached --others --exclude-standard` with a file-count floor; CI test querying `information_schema.columns` for personal-data column names and `inet`/`cidr` types; log-capture test with a planted IP, X-Forwarded-For, user agent and phone number; `/privacy` "What we store" table (field, where it lives, why) linking the tests; wording "no sign-up, no login, no profile", never "no data" | `server/`, `web/`, `.github/workflows/hygiene.yml` | **Jordan** (server), Claude (CI guards), **Stephen** (web) | T2 | ⬜ | 1.9, 1.12 | Schema test proven red once by a scratch migration adding `payer_phone text`, green on main, with at least 1 table and 5 columns scanned; log-capture test want-0 for every planted string AND want-1 for the route pattern; the analytics guard proven red once by a planted package; `curl -sI https://zerobars.us` shows no `set-cookie` | D16 |
| 3.56 | Passkey E2E in CI: Playwright Chromium with a CDP virtual authenticator (`WebAuthn.enable`, `addVirtualAuthenticator` with ctap2, internal transport, resident key, user verification) creates a passkey and runs 20 lab payments against a preview build with its own rpId and database (never production, so CI never inflates the headline); negative controls: `setResponseOverrideBits({isBogusSignature:true})` and a tampered clientDataJSON challenge | `web/e2e/passkey.spec.ts`, `.github/workflows/web.yml` | **Claude** | T2 | ⬜ | 3.10, 3.23 | Job green with 20 devnet signatures and 20 `credentialAsserted` events; both negative cases refused; removing the low-S normalizer makes at least one positive payment fail (proves high-S is exercised); verdict read from the job's check-run, not the watcher's exit code | |
| 3.57 | Offline verify on the judge's phone: a Serwist service worker precaches `/verify` and its scripts; in-page camera QR scanning with a JS decoder (Safari has no BarcodeDetector); the receipt payload travels in the URL fragment; signatures are checked locally with WebCrypto ECDSA P-256 and the pinned Ed25519 confirmation key; the page says "checked on this phone, no internet used" only when the browser reports offline | `web/` | **Claude** | T2 | ⬜ | 3.2, 2.7 | On an iPhone in Safari: load `/verify` online once, switch to airplane mode, reload, scan a real receipt QR and it verifies; a tampered receipt fails; the service worker shows as registered; no receipt data appears in request logs (fragment only) | Stephen reviews |
| 3.58 | Live wiring panel: `GET /api/wiring` returns, per integration, the last real success time and its evidence (slot, commit SHA, model id, balance-check time) and a stale window; `/judge` and `/proof` render it, grey with "no event in N min" when stale; no personal data in any row | `server/src/events/`, `web/` | **Jordan** (endpoint), **Claude** (UI) | T2 | ⬜ | 2.10, 3.47 | Stopping the iMessage worker turns its row grey within its window; a fresh devnet redeem updates the Solana row within 5 s; a test asserts every row's evidence comes from a stored event, not a constant | |
| 3.60 | "Built this weekend" panel on `/proof`: reads `GET /repos/StephenSook/loka-pay/compare/pre-hacklanta-kit...main` at request time (cached 5 minutes, unauthenticated API, so no token in the web app): commit count, distinct authors, files changed, lines added, first and latest commit times, link to the compare view; labelled "since hacking started, Fri 8:08 PM" | `web/` | **Claude** | T2 | ⬜ | 3.2 | Playwright on production: the numbers equal the GitHub compare API read by the test at the same time; if the API is rate-limited, the panel says so and shows the link only (never a stale or invented count) | Answers the organizers' one-commit worry with live data |
| 3.61 | CI as evidence: `program.yml` and `server.yml` write each devnet transaction their tests produce (a settled redeem, the refused cheat with its named error) to `$GITHUB_STEP_SUMMARY` as explorer links; the README links the latest green run on main | `.github/workflows/`, `server/test/`, `programs/tests/` | **Claude** | T2 | ⬜ | 1.9 | The latest main run's summary lists at least one settled and one refused devnet signature, each resolving on the explorer | |

### Phase 4: harden + submit (Sat 8 PM to Sun 9 AM)

| # | Component | File(s) | Owner | Tier | Status | Deps | Accept | Notes |
|---|---|---|---|---|---|---|---|---|
| 4.0 | Early full Devpost submission: every field, backup video, repo, demo link, disclosure, track + the side challenges from the one entry list (written by Sat 7 PM, after 0B.6), AI tools named | Devpost, entry list (private notes) | **Stephen** | T1 | ⬜ | backup #1, 0B.6 | Public gallery shows it logged out; the Devpost challenge opt-ins, the "track and challenges" line and the Google Form list the same entries; no surface lists more than 3 side challenges unless a written organizer answer (0B.6) allows it | By Sat 8:00 PM |
| 4.1 | Adversarial review of every money-path diff until a clean round (Codex, Grok, Claude review agents) | n/a | **Claude** | T1 | ⬜ | each diff | The last round returns no finding | |
| 4.2 | Scrub re-audit + gitleaks full history + claims audit + Built With + `.env.example` parity; FACTS equality check wired in CI | `docs/claims-audit.md` | **Stephen** + Claude | T1 | ⬜ | all | Zero unbacked claims; the hygiene job's FACTS step runs with no "not wired" warning | |
| 4.3 | Devpost writeup final (every section, including What we learned); 6 to 8 captioned gallery stills from real captures plus the architecture diagram; the README's first screen as a judge document (what it is, live links, TestFlight status, disclosure, the curl for `/api/stats`) | Devpost, `README.md` | **Khadim** + **Stephen** | T1 | ⬜ | 4.2 | A logged-out reload shows every field and caption; the README's curl returns live numbers | |
| 4.4 | Rehearsals: 6 timed Sat 9 PM to 12 AM (in the SCE Ballroom if open) + 3 Sun 7:45 to 8:45 AM (after the final submission; Jordan and Pravin run the first Sunday slot, Claude times it) + a murder board | n/a | everyone | T1 | ⬜ | Sat 12 PM checkpoint | Each run timed and logged at ≤3:00; 10 consecutive `/send` runs from one network succeed within the budget (the shared-Wi-Fi case) | |
| 4.5 | Final submission by 7:30 AM; Google Form the moment it posts; freeze hook at 9:00 AM. **Stephen** submits both Devpost and the Form (the guide asks for one member); **Khadim** prepares the Form answers from the entry list and checks the saved confirmation | n/a | **Stephen** (submits), **Khadim** (prepares, checks) | T1 | ⬜ | 4.3, 4.6 | Logged-out gallery + form confirmation saved; hook proven red once | |
| 4.6 | Main CI green on the merged SHA (count floor) + live probes | n/a | **Claude** | T1 | ⬜ | merges | The latest result of each of the six CI jobs on the submitted SHA is success; scheduled probes are excluded from this verdict and tracked separately | |
| 4.7 | TestFlight public link: attach the newest build, enable the link, check it unauthenticated, put the QR on the table card, README and Devpost | App Store Connect, `README.md` | **Stephen** signs in, Claude drives | T2 | ⬜ | 1.11 approved | The payment build itself is available to the external group; a logged-out fetch returns 200 "Join the ... beta"; a fresh install from the link completes a payment; the QR decodes to that URL | |
| 4.8 | Share the Devpost link with our own networks, plus a 15-second vertical cut of the real demo, only if a public-vote prize exists; no vote trading | n/a | **Khadim** | T2 | ⬜ | 4.0 | Posts logged | Public voting Sat 8 PM to Sun 11 AM |
| 4.9 | A 60-second version of the demo for sponsor and MLH tables, one per side challenge on the entry list; the Solana version carries one volume line from `docs/FACTS.json` (3.50, 3.51), the iMessage version shows the iMessage receipt (3.48) | n/a | **Khadim** + **Stephen** | T1 | ⬜ | 4.4 | Timed at 60 s or less in rehearsal; no number spoken that is not in `docs/FACTS.json` | |

### Phase 5: after submission (Sun 9 AM onward)

| # | Component | File(s) | Owner | Tier | Status | Deps | Accept | Notes |
|---|---|---|---|---|---|---|---|---|
| 5.1 | Freeze: the repo and live site are frozen at 9:00 AM while the probes keep running through the winners post | n/a | **Stephen** + Claude | T1 | ⬜ | 4.5 | The freeze hook refuses a commit; probe workflows show `state: active` until Sun 7 PM | |
| 5.2 | Judging: the main desk first, then the 60-second version at the MLH and sponsor tables | n/a | everyone | T1 | ⬜ | 4.9 | The judges of every entered challenge saw the demo or were offered it | |
| 5.3 | Post-event retro and review-tool comparison (Greptile vs Codex) | private notes | **Claude** | T1 | ⬜ | winners posted | Retro written; review comparison recorded | Within 48 h |
| 5.4 | If we place: a post that leads with the result | n/a | **Stephen** + Claude | T2 | ⬜ | winners posted | Posted only with Stephen's OK | |
| 5.5 | Prize claim: for each prize won, record how it is claimed and the earliest deadline, and calendar it; check email daily, spam folder included, for messages from the organizers, MLH and Devpost until every claim is confirmed; the event watcher (0.9) keeps running past closing for this purpose only | private notes | **Stephen** + Claude | T1 | ⬜ | winners posted | Every won prize shows claimed or a dated next step | A prize can arrive as an emailed virtual card |
| 5.6 | DEV Writing Challenge post: the project story on DEV after winners are posted; every number from `docs/FACTS.json`, no organizers or judges named, no team strategy, links the frozen repo, passes the em-dash and AI-tone sweep; published only with Stephen's OK | DEV | **Khadim** drafts, **Stephen** publishes | T2 | ⬜ | winners posted | Post live and linked from the README (a README edit only if the freeze rules allow it, otherwise linked from Devpost comments) | |

### Human-only steps (accounts, sign-ins, physical steps: agents cannot do these)

| # | Step | Who | By | Status |
|---|---|---|---|---|
| H1 | Screenshot hacklanta.dev acceptance | each member | Thu 11 PM | ⬜ |
| H2 | Devpost account, registered for Hacklanta | each member | Fri noon | ⬜ |
| H3 | Join the Devpost project (created at 0B.5) | each member | Fri 9 PM | ⬜ |
| H4 | Check in with government ID + student ID + acceptance email; both IDs are required. KSU's digital Talon Card in Wallet counts as the student ID: check that it opens offline before leaving home | each member | Fri 5:00 PM | ⬜ |
| H5 | members.progsu.com: sign in with the Google email you applied with; enter your KSU email for the code and check spam; if no code arrives, press "Verify later"; if the KSU address is rejected, report it privately to the organizers with a screenshot; never post a code in Discord. Organizers use it to find you at check-in. Record your status (done / Verify later / blocked) in the team's private notes | each member | Before leaving for the venue | ⬜ |
| H6 | Add teammates as App Store Connect users; register 4 iPhone UDIDs | Stephen | Fri noon | ⬜ |
| H7 | Answer export compliance (`ITSAppUsesNonExemptEncryption`, standard crypto) | Stephen | First TestFlight upload | ⬜ |
| H8 | Per phone: iOS 17+, automatic date and time on (LOKA validates packet timestamps), Face ID or passcode set, Bluetooth on | each member | Fri 3 PM | ⬜ |
| H9 | First launch online after every dev install | each member | Every install | ⬜ |
| H10 | Written consent per surface: the interviewee's quotes, teammates on camera, volunteers in 3.6 | Khadim | Before first use | ⬜ |
| H11 | Register the domain on the MLH GoDaddy Registry promo; DNS root to Vercel, `api` to Vultr | Stephen | Fri 3 PM | ⬜ |
| H12 | Vultr account (MLH credit) + VPS; Tiger Cloud; Vercel project | Jordan / Pravin / Stephen | Fri 3 PM | ⬜ |
| H13 | Put the ElevenLabs key into the VPS secret environment (teammates never handle it) | Stephen | Fri 9 PM | ⬜ |
| H14 | Vonage account funded at hour 0 (Visa, Mastercard or PayPal, no prepaid cards; finish identity verification if asked) + one US local number with SMS and Voice, for 3.9 and 3.43; low-balance alert on | Jordan | Fri 8:30 PM | ⬜ |
| H15 | YouTube channel for the public video | Stephen | Sat 6 PM | ⬜ |
| H16 | Faucet funding and top-ups (USDC, SOL), by public address | Pravin | 0.4 (pre-event), Sat 9 AM, Sat 6 PM | ⬜ |
| H17 | Repo owner and name; password vault choice + MFA | Stephen + Khadim | Team call | ⬜ |
| H18 | Sign in to App Store Connect in Chrome so Claude can create the app record and fill TestFlight test info (the API refuses app creation) | Stephen | Fri noon | ⬜ |
| H19 | Sign in to Greptile and approve its GitHub App install (0.17) | Stephen (Claude drives) | Fri noon | ⬜ |
| H20 | Submit build 1 for Beta App Review | Stephen (Claude drives) | Fri ~11:30 PM | ⬜ |
| H21 | Enable the TestFlight public link after approval | Stephen (Claude drives) | On approval | ⬜ |
| H22 | Points: check-in 15, demo at judging 200; points buy swag only, so nobody leaves the build for workshop points | each member | Fri, Sun | ⬜ |
| H23 | Google Form: Stephen submits it (one member submits both Devpost and the Form); Khadim prepares the answers from the entry list and checks the saved confirmation | Stephen, Khadim | The moment it posts | ⬜ |
| H24 | Devpost early submit and final submit | Stephen | Sat 8 PM; Sun 7:30 AM | ⬜ |
| H25 | Set the repo variable `APPLE_TEAM_ID` (our team id, not a secret) so the hygiene scrub guard can tell our team id from a foreign one | Stephen | Right after the first push | ⬜ |
| H26 | Confirm the LICENSE copyright line with the LOKA founders (Q9) | Khadim | Before the repo goes public | ⬜ |
| H27 | Print resumes before leaving home (for the sponsor interviews; with the storm, do not count on printing at the venue) | each member | Fri 3 PM | ⬜ |
| H28 | Photon project at app.photon.codes with the hackathon promo code (Pro, 100 users) if one exists; the project id and secret go straight into the VPS secret environment | Khadim (asks at the fair), Jordan (stores) | Fri 9 PM | ⬜ |
| H29 | Who attends the Sat 1:30 to 2:45 PM sponsor interviews (SCW 466/468), in which slot, and who covers their lane; if the Sat 12 PM checkpoint is red, Stephen stays on the baseline and the others go in 20-minute shifts; Pravin's sleep window moves off 1:30 to 2:45 PM if he goes | Khadim (decides at the team call) | Fri 8 PM | ⬜ |

---

## Lanes and file ownership

One owner per module; cross-module changes go by PR, reviewed by that owner. If you need a change in someone else's territory, write it in Open Questions and ping. Do not edit.

| Path | Owner | Notes |
|---|---|---|
| `ios/LOKA.xcodeproj/`, `ios/Features/ChatStore.swift`, `ios/Network/LokaMesh.swift`, every iOS target change | **Stephen** | Only Stephen merges changes here (D7) |
| `ios/Features/` (payment screens), `web/` | **Stephen** | Agents open PRs; Stephen reviews within 20 minutes |
| `ios/LokaPay/` (Swift package) | Claude agents, **Stephen** reviews | Agents add files here without touching the Xcode project |
| `server/src/notes/`, `server/src/gateway/`, `server/src/codec/`, `server/src/events/`, `server/src/voice/`, `server/src/calls/`, `server/src/sms/`, `server/src/volume/` | **Jordan** | `volume/` serves `GET /api/volume` (3.50) |
| `server/src/agent/` | Claude agents, **Jordan** reviews | The iMessage agent worker, a separate ESM process on the VPS (3.47 to 3.49) |
| `server/src/settle/`, `server/src/certs/`, `server/src/remit/`, `server/src/trust/`, `programs/` | **Pravin** | |
| `protocol/PAYMENT-V1.md`, `protocol/vectors/` | Claude, **Khadim** reviews semantics | |
| `config/pins.json`, `docs/RUNBOOK-KEYS.md` | **Jordan** | Public halves and fingerprints only |
| `docs/FACTS.json`, `experiments/EXP-PAY-*.md` | **Khadim** | Numbers come only from real runs (3.6) |
| `.github/workflows/`, `tools/` | Claude agents, **Stephen** reviews | |
| `android/` | Claude agents | Reviewer: Q10 |
| Imported LOKA files not named above | nobody by default | Change only when a task needs it, and keep the diff small (the disclosure diff must stay honest) |

**Load rules.**
- **Installs.** Stephen is the only Apple signer. Internal TestFlight (no review) puts each uploaded build on all four phones in minutes. Upload slots: Fri 11:30 PM; Sat 3 AM, 9 AM, 12 PM, 4 PM, 8 PM; Sun 6 AM. Cable installs only for debug builds.
- **Reviews.** Claude's Swift PRs stay small; Stephen reviews within 20 minutes or the agent moves to its next task.
- **Machines.** Stephen's Mac has 8 GB: Xcode plus at most two agent worktrees at once. Backend agents run on Jordan's and Pravin's machines.
- **Coverage.** Code is fixes-only after Sun 3 AM. The critical path always has an awake owner.

| Window | Asleep |
|---|---|
| Sat 3:30 to 7:30 AM | Stephen, Khadim |
| Sat 8 AM to 12 PM | Jordan |
| Sat 12 to 4 PM | Pravin |
| Sun 12 to 3 AM | Khadim |
| Sun 1:30 to 4:30 AM | Stephen |
| Sun 3 to 6 AM | Jordan, Pravin |

---

## Open pull requests (read before touching these files)

| PR | What | State | Merge rule |
|---|---|---|---|
| n/a | | | Merge only with all required checks green on the PR head and the owner's review; money paths also need a clean adversarial round (4.1) |

---

## Shared Contracts

> Drift is integration bugs. Announce a contract change here BEFORE committing it, and prefix the commit with `⚠️ CONTRACT`.
> Definitions below come from the plan. Once code exists, re-read each one from the code and `protocol/PAYMENT-V1.md` and fix this table.

| Contract | Owner | Consumers | Definition |
|---|---|---|---|
| Payment content family | Claude (1.2), Khadim reviews | iOS, Android, server | `L1\|P\|1\|<kind>\|<base64url payload>` inside the existing encrypted LOKA packet; the text wrapper is never signed. Kinds: `N` note, `Y` merchant ack, `S` settlement confirmation, `M` spend marker, `X` countersigned receipt, `A` allowance certificate, `C` merchant certificate |
| Signing rule | Claude (1.2) | everyone | Every signed structure is a fixed binary layout behind a 16-byte ASCII domain prefix; variable fields are u16 big-endian length-prefixed; nothing signed is separator-joined; program id, cluster id and mint are bound in every signed structure |
| `NOTE_V1` (141 bytes) | Claude (1.2) | iOS, Android, server, program, web | prefix 16 (`LOKA-PAY-NOTE-V1`) · program id 32 · cluster id 1 (0 devnet, 1 mainnet) · mint 32 · allowance id 8 (u64 BE) · payee key hash 32 (sha256 of the merchant's compressed P-256 key) · amount 8 (u64 BE, mint base units; devnet USDC has 6 decimals) · currency 3 (`USD`) · serial 1 (u8, 0 to 255) · expiry 8 (i64 BE, unix seconds). Note id = sha256(NOTE_V1). Wire: NOTE_V1 + 64-byte low-S signature + 33-byte compressed payer key = 238 bytes |
| Other signed structures | Claude (1.2) | everyone | ACK (merchant P-256 over note id + received-at); CONF (server Ed25519 over note id + tx signature + slot + status); ALLOW (server Ed25519 over allowance id + payer key hash + cap + offline limit + expiry + earmark-list hash + bond, with program id and cluster id); MERCH (server Ed25519 over merchant key hash + length-prefixed display name, with program id and cluster id); WITHDRAW (merchant P-256 over program id + cluster id + mint + merchant key hash + destination + amount + withdraw counter); REFUND T3 (merchant P-256 over program id + cluster id + mint + original note id + allowance id + amount + refund counter) |
| Serial bound | Pravin | iOS, program | Serial 0 to 255 per allowance with a 256-bit used-bitmap on chain; the phone durably reserves the next serial before signing; open a new allowance when exhausted |
| Signing details (iOS) | Claude (1.5) | program, server | Sign the RAW canonical bytes with the data API (never the digest overload); `rawRepresentation` 64-byte r\|\|s; flip high-S to n - s as exactly 32 big-endian bytes (assume CryptoKit does not normalize to low-S); send the compressed 33-byte key |
| `config/pins.json` | Jordan | iOS, Android, server, web | Public halves and fingerprints only (LOKA identity of the settlement node, Ed25519 certificate key, program id, mint, fee payer addresses). Read by every build from this one file |
| Settlement API | Jordan + Pravin | iOS, web, judges | `POST /v1/notes` (direct upload, idempotent by note id) · `POST /v1/gateway/frames` (T2) · `POST /v1/payers` · `POST /v1/merchants` · `/v1/allowances` · `GET /api/stats` (unauthenticated, recomputes every headline number; `?run=EXP-PAY-001` returns the frozen measurement run; `canary`, `ci` and `load_test` rows are excluded by default) · SSE `/live` · `GET /api/health` · `GET /v1/voice/sample?lang=wo\|fr` (cached files only, T2) · `GET /trust` (live upgrade authority and program hash, T2) · `GET /api/volume` (measured compute units, fees, verify ops/sec, live SOL price with its timestamp, T2) · `POST /imsg/register` (iMessage agent registration, T2) · `POST /webhooks/inbound-sms` (Vonage inbound only: the SMS settlement rail and reverse-OTP; answers 200 first; GET answers 405 so a number never lands in a URL; the server never sends SMS). CORS allowlist: our web origin and our preview domains |
| Server module map | Jordan + Pravin | everyone | `server/src/notes/` (Jordan), `gateway/` + `codec/` (Jordan), `events/` (Jordan), `voice/` + `calls/` (Jordan), `sms/` (Jordan), `volume/` (Jordan), `settle/` (Pravin), `certs/` (Pravin), `remit/` (Pravin), `trust/` (Pravin), `agent/` (Claude, Jordan reviews) |
| iOS layout | Stephen | Claude agents | Payment logic in the local Swift package `ios/LokaPay/` (note bytes, low-S, certificates, note store, tests via `swift test`); app-target glue stays small |
| Units | Pravin | everyone | Every on-chain amount (note, cap, offline limit, bond, balances, transfers) is in mint base units; screens convert for display; `protocol/vectors/units.json` keeps Swift, TypeScript and Rust in agreement |
| Device roles | Khadim | everyone | Baseline: Khadim's iPhone = payer; Stephen's iPhone = merchant A + gateway (cellular on at step 3); Jordan's iPhone = merchant B (cheat target); Pravin's iPhone = hotspot for the `/live` laptop; Samsung (Wi-Fi only) = zero-code relay proof; once 3.13 passes, it also pays merchant A over Bluetooth with its own hardware key (a 10-second beat). Upgrade (only if gated in): variant (a) Samsung relay into Pravin's iPhone gateway; variant (b) Pravin's iPhone relay into Jordan's iPhone gateway |
| `docs/FACTS.json` | Khadim | README, `/judge`, slides, video, Devpost, tests | Every judge-facing number with its source and status; values only from real runs; equality enforced by a test (4.2) |

---

## Decisions (locked)

> Reference by D# in commits and code comments. Do not re-litigate without escalation. D1 to D15 locked 2026-10-08 in the approved plan; D5, D10 and D15 revised and D16 added 2026-10-09.

**D1: Sandbox only.** Solana devnet and devnet USDC (mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`); every money screen says "sandbox"; no real money, which would need a licensed partner. Fallback if the faucet fails: a self-minted SPL test token, disclosed. Mainnet appears only as the T2 proof (3.35: one precompile verification, no program, no custody) and the T3 team-only mode (3.36) after devnet T1 is green.

**D2: The phone signs, the chain verifies.** Payer and merchant keys are Secure Enclave P-256 keys with `.privateKeyUsage` + `.userPresence`, so every signature needs the owner's Face ID or passcode. `redeem_note` reads the secp256r1 precompile instruction through the instructions sysvar and checks the precompile program id, that the instruction index points at the precompile itself, that the message equals the canonical note, the allowance and merchant PDAs, and the note's program id. **Fallback:** if on-chain P-256 redeem is not green at the Sat 3 AM checkpoint, decided Sat 6 AM: the server verifies P-256 off-chain and `redeem_note` accepts only the server's Ed25519 attestation; the claim is reworded and `/trust` says so.

**D3: The judged baseline is one pre-connected Bluetooth hop.** Payer to merchant, with the merchant as gateway on cellular, never venue Wi-Fi. The multi-hop relay is shown live only after 5 consecutive runs on our phones, each direction ≤20 s, decided by Sat 8 PM; otherwise `/live` shows a recorded, timestamped run.

**D4: Custody.** One program-owned vault PDA holds the token account. Payers and merchants are records keyed by sha256 of their P-256 key, and the program signs every transfer. Merchants withdraw with a P-256-signed WITHDRAW, paid only to the signed wallet's associated token account. Durable nonces are not used.

**D5: Stack.** Settlement API: TypeScript on Node 22 with Fastify and Vitest, on a Vultr VPS (Docker + Caddy, `api.zerobars.us`) in a region outside Atlanta, recorded in `docs/RUNBOOK-KEYS.md` (the NWS High Wind Warning covers metro Atlanta through 8 AM Sunday), Railway as fallback host. The iMessage agent is a separate ESM Node 22 process on the same VPS (systemd), Photon's Spectrum cloud provider only (never `imessage-local`), with `SPECTRUM_PROJECT_ID` and `SPECTRUM_PROJECT_SECRET` in the VPS secret environment only. Web: Next.js on the dedicated Vercel project `zerobars-web`. Database: Tiger Cloud (Postgres, hypertables + continuous aggregates). Program: Anchor, toolchain pinned in `programs/TOOLCHAIN.md`. iOS: first-party frameworks only. Android: `androidx.biometric` + the platform Keystore. Each new package is checked for supply-chain risk before it is added.

**D6: Peer-to-peer Wi-Fi is an optimization.** A 90-minute spike on Friday. GO = 10 of 10 iPhone-to-iPhone round trips with both phones in airplane mode (Wi-Fi radio on, no network joined), p95 under 2 s. Otherwise it is killed at midnight.

**D7: iOS payment logic lives in `ios/LokaPay/`.** Agents add files there without touching `project.pbxproj`. Stephen owns the one project change that adds the package and every edit to `ChatStore.swift` and `LokaMesh.swift`.

**D8: Contract first.** The Shared Contracts above are written into `protocol/PAYMENT-V1.md` with vectors in the first hour (1.2) and every implementation tests against the vectors.

**D9: Double spend is bounded, not prevented.** The payer can never settle more than the cap. A reused serial fails on-chain, and the same note through two gateways settles once. A merchant who accepts offline carries a limited, attributable risk, capped cumulatively by the offline limit. Spend markers warn nearby merchants. The T2 bond repays a victim up to the bond. No copy ever says "prevents double spending" or "losses can never exceed the cap".

**D10: Claim only what passed its Accept test (wired-or-cut).** Never claim: first offline or mesh payments; crowd-relayed settlement, on-chain voucher escrow or gossip warnings as new; "prevents double spending"; real money; background or long-range mesh; any LOKA messaging feature as weekend work; Solana's network throughput as ours (volume figures come only from our own runs in `docs/FACTS.json`); "no data" (say "no sign-up, no login, no profile"); that LOKA Pay helped anyone in the storm. Say "not found in our search", never "first".

**D11: TestFlight.** Build 1 goes to Beta App Review Fri ~11:30 PM as version 1.0, and every later build stays 1.0. The payment build goes to review as soon as it exists. The app is described truthfully as an offline payment prototype on sandbox test tokens with no monetary value, no purchases and no exchange. The internal path and the in-person demo never depend on approval.

**D12: Real people only.** No invented names in any judge-facing copy. Real users, teammates on camera and volunteers appear only with written consent per surface.

**D13: A visible build history.** The import is exactly one commit (`pre-hacklanta-foundation`), the pre-event kit is one commit (`pre-hacklanta-kit`), and everything after is frequent atomic commits. Never re-date, squash or rewrite the history.

**D14: Keys and secrets.** Every private key is generated where it is used: on the VPS (two Solana fee payers, demo and public; four funding wallets: table demo, public onboarding, `/send`, canary; the RSA-3072 LOKA identity; the Ed25519 certificate and confirmation key) or on Pravin's machine (the program upgrade authority). Each has an encrypted backup in the team vault. Public halves go in `config/pins.json`. Funding needs only public addresses.

**D15: Public paths have their own budgets, and no limit tracks people.** `/send`: a $1 cap per send, its own wallet with an atomic daily budget, and one live remittance per recipient allowance. Judges on a shared venue Wi-Fi may share one public IP, so any per-IP limit is only an in-memory burst guard sized for a judging line (at least 10 sends per hour), keyed by HMAC-SHA256 with a per-boot random secret so not even memory holds a raw IP, and never persisted. The canary has its own wallet; canary rows carry `source=canary` and CI traffic carries `source=ci`, and both are excluded from `/api/stats` (the passkey E2E runs against a preview with its own database, never production). Phone numbers for calls are checked by reverse-OTP first (the person texts a code shown on the page to our number; the server never sends SMS), then held in server memory only, with a 15-minute TTL, until their one call ends; they are never written to Tiger, logs or disk. One Vonage budget, at most 3 attempts per number.

**D16: Privacy and logging.** Production request logs carry the method, the route pattern and the status code only (custom Fastify serializers: never `req.url`, bodies or headers); the Caddyfile has no `log` directive; `trustProxy` is `127.0.0.1`; the Docker log driver and retention are recorded in `docs/`. No analytics or error-tracking packages, Vercel Web Analytics and Speed Insights off, `NEXT_TELEMETRY_DISABLED=1`. The database holds pseudonymous key hashes, amounts, timestamps and transaction signatures, and a CI test fails if a personal-data column appears (3.55). The public ledger is pseudonymous: the precompile needs the payer's public key on-chain, and we hold nothing that links it to a person. If the iMessage agent ships, Photon keeps each registered number in its own user table, and `/privacy` says so. Public wording: "no sign-up, no login, no profile", never "no data".

---

## Open Questions

- [ ] **Q2 (Stephen):** which challenges count toward the 3 side-challenge limit? Asked by email and in the event Q&A channel (0B.6); with no written answer by Sat 7 PM, the entry list keeps at most 3 side challenges in total.
- [ ] **Q3 (Khadim + Stephen, 0B.3):** the challenges revealed at the opening ceremony (Mercedes, Replit, Equifax and others): keep or swap the third entry.
- [ ] **Q4 (Stephen, 0.6):** the eligible TLD list on the GoDaddy Registry promo page; register `zerobars.us` if eligible (backups `everyhop.us`, `paybyhop.us`).
- [ ] **Q5 (Pravin, 0.4):** the devnet USDC faucet amount and cooldown (sources disagree). Measure the first request and keep the figure out of judge copy.
- [ ] **Q6 (Pravin, 3.25):** the largest `redeem_batch` that fits one devnet transaction (about 3 notes, ESTIMATE). Claim 8 only if the larger-transaction upgrade is live on devnet.
- [ ] **Q7 (Stephen, 1.11):** TestFlight external review timing for this build, and how guideline 3.1.5(i) applies to an Individual account on TestFlight (NOT VERIFIED).
- [ ] **Q8 (Claude, 2.9):** the four-iPhone Bluetooth relay timing (LOKA's device record has no four-iPhone path).
- [ ] **Q9 (Khadim, before the repo is public):** the LICENSE copyright line is still the Apache template placeholder. Which holder text do the LOKA founders want?
- [ ] **Q10 (team, by 1.7):** who reviews Android PRs (2.11, 3.8, 3.13)? No lane owns Android today.
- [ ] **Q11 (Claude, 3.33):** does Core NFC read a sticker with airplane mode on (NOT VERIFIED)?
- [ ] **Q12 (Jordan + Pravin, 0.14):** Vultr credit and Tiger trial expiry dates recorded in the ledger.

---

## Coordination Protocol

1. **Before starting a task:** set status to 🟡, add a timestamp in Notes, commit `PLAN.md` only, push. That is your lock.
2. **After finishing:** flip to ✅, commit `PLAN.md`, push.
3. **If blocked:** set to ⛔, add a one-line note, ping the owner of the blocker.
4. **Before starting ANY task:** `git pull` and re-read `PLAN.md`. If someone has 🟡 on overlapping files, coordinate.
5. **Hotfixes:** commit the fix, update `PLAN.md` after. Do not let process block a real emergency.
6. **`PLAN.md` commits are atomic.** Never bundle a status change with code.
7. **Commit messages.** Status: `status: <task#> <emoji> <description>`. Code: Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`), subject ≤100 characters. Contract changes: `⚠️ CONTRACT: <field>, <reason>`.
8. **Handoffs:** add `→ <Name>` in the Notes column.
9. **Stale locks, TTL 4 hours.** No commit within 4 hours means the lock is stale; anyone can claim it by replacing the owner and bumping the timestamp. Ping first.
10. **No em dashes or en dashes anywhere**, including this file, commit messages, PR bodies, product copy and the video script. Use a colon, a comma, parentheses, a period or a hyphen. CI checks every added line.

---

## CI rules

1. **Every gate runs bare.** No pipe on any exit path.
2. **A skipped test is a false green.** Under CI a guard fails, never skips.
3. **A merge is verified on the merged SHA.** Read the per-SHA check-runs of the six CI jobs: at least six runs (count floor) and the latest result of each is success. Scheduled probes attach to the same SHA and are tracked separately.
4. **Never trust a `--watch` exit code.** Read the check-runs after it returns.
5. **Verify what a commit contains,** not that it succeeded: `git show HEAD:<path>` for the change you care about.
6. **Stage named paths only.** Never `git add -A`.

---

## Hard Rules

1. No feature code and no product design before Fri 8:30 PM. Everything prepared before then is listed in the README disclosure.
2. The LOKA foundation is disclosed: one import commit, tagged; nothing re-dated, nothing hidden.
3. No real money. Devnet and test rails only, and "sandbox" on every money screen.
4. Secrets never in git: keys live where they are used, with a vault backup; MFA on every account that controls code, deploys, billing or API keys.
5. Every number in the README, `/judge`, slides, video or Devpost comes from `docs/FACTS.json`.
6. Claim only what passed its Accept test (D10).
7. Only Stephen merges changes to `project.pbxproj`, `ChatStore.swift` and `LokaMesh.swift`.
8. Gateways use cellular, never venue Wi-Fi, in every demo run.
9. No invented people in any judge-facing copy (D12).
10. No em dashes or en dashes in anything we write.
11. No IP address, phone number, email or name is written to the database, logs or disk. A phone number for the remitter call lives in server memory only until its one call ends (D15, D16).

_Last updated: 2026-10-09 14:00 ET by Claude (pre-event kit: tasks 0B.6, 0B.7, 3.47 to 3.56 and 5.6 added; D15 revised, D16 added). Start with your `<NAME>_TASKS.md`._
