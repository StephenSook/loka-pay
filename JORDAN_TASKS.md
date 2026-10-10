# JORDAN: tasks

> Pulled from `PLAN.md` (pre-event kit, updated 2026-10-09). If this file and `PLAN.md` disagree, `PLAN.md` wins.
> Status lives in `PLAN.md` only: claim a row there (🟡 + timestamp in Notes), commit `PLAN.md` alone, push.

**Lane:** Backend. Production keys (1.0), settlement API core (notes, gateway, codec port, events + SSE + stats), voice service, Vonage call, volume measurements (3.50), server privacy hygiene (3.55), VPS deploy. Owns `server/src/{notes,gateway,codec,events,voice,calls,sms,volume}/` and `config/pins.json`. Reviews the agent PRs in `server/src/agent/` (the iMessage agent, 3.47 to 3.49).

**At 8:30 PM start with:** 1.0 (build), 1.9 (build). The Sat 3 AM checkpoint is Friday's only goal: one Face ID signature from a physical iPhone, uploaded, verified and redeemed on devnet with an explorer link.

**Sleep window:** Sat 8 AM to 12 PM; Sun 3 to 6 AM (final at the team call). Code is fixes-only after Sun 3 AM.

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
| 1.0 | RSA-3072 LOKA identity + Ed25519 key on the VPS; `config/pins.json`; `docs/RUNBOOK-KEYS.md` | **Jordan** | T1 | 0.4 | Server and iOS tests read pins from the one file; every private key only where it is used, with a vault backup; gitleaks clean |
| 1.3 | Codec port (upgrade path) | **Jordan** | T2 | 1.2b | Every `:core` vector decodes and re-encodes byte-exact; else sidecar decision Sat 9 AM |
| 1.9 | `POST /v1/notes`: decode, verify, build secp256r1 + redeem_note, fee-pay, record | **Jordan** + **Pravin** | T1 | 1.0, 1.2, 1.4 | Integration test redeems a vector note on devnet with an explorer link; a second submit returns the first result. A cheat redeem is sent with preflight skipped, never auto-retried, and lands on devnet as a failed transaction carrying the program's named error, so the refusal has its own explorer link |

### Phase 2: the loop on real phones (Sat 3 AM to 12 PM)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 2.5 | `/v1/gateway/frames` | **Jordan** | T2 | 1.3, 1.9 | Tampered carry chain rejected; the same note via two gateways redeems once |
| 2.8 | Spend markers to linked peers + server double-spend record | Claude + **Jordan** | T2 | 2.7 | Linked merchant B warns within 10 s |
| 2.10 | Events store + `/api/stats` + SSE `/live` | **Jordan** | T1 | 1.9 | SSE shows a settlement within 2 s of confirmation; an `Origin`-header test asserts `access-control-allow-origin`. Every event row carries a source (`phone_ble`, `relay_upgrade`, `sms_rail`, `lab_simulated`, `canary`) and `/api/stats` breaks each figure out by source; `/api/stats?run=EXP-PAY-001` returns the frozen 3.6 measurement window, the README curl points at it, and the hygiene FACTS test asserts `docs/FACTS.json` equals it |
| 2.17 | Gateway outbox: the server queues allowance certificates and remittance notices; gateway phones pull them and carry them into the mesh | **Jordan** + Claude | T2 | 2.4, 2.6 | An allowance funded on the web arrives on an airplane-mode phone through a gateway |

### Phase 3: galaxy layer + UI (Sat 12 PM to 8 PM)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 3.4 | Phrase bank: server half (Jordan) + on-device assembly (Claude) | **Jordan** + Claude | T2 | 0.13 GO, 2.7 | A phrase plays at zero bars on a device. A stranger can check it: `GET https://api.zerobars.us/v1/voice/sample?lang=wo\|fr` serves the cached phrase files only (judge traffic never spends ElevenLabs credits) with the model id and generation date in headers; `/judge` has a play button labelled "generated by ElevenLabs eleven_v4"; the README prints the curl |
| 3.9 | Remitter phone call when their money is spent (Vonage + ElevenLabs voice), the judge-ring beat | **Jordan** + Claude | T2 | 3.3 | One real call logged, placed through the Vonage Voice API. The number is checked by reverse-OTP (the judge texts "LOKA <code>" to our number; inbound messages need no 10DLC registration) and held in server memory only (15-minute TTL) until its one call ends; it is never written to Tiger, logs or disk, and afterwards the call legs are deleted (Vonage Delete Leg) with Legs Persistence Time at its minimum in the Vonage dashboard (D15, 3.55); one call per remittance (idempotent); one budget with per-number attempt limits and an in-memory burst guard (never a per-IP limit that a shared venue Wi-Fi would trip). The ring is opt-in and labelled. Our server never sends SMS (unregistered US long-code SMS is blocked, and 10DLC registration takes 3 to 5 weeks). The Vonage account is funded at hour 0 (H14; trial accounts call only the owner's number and cannot buy a number); a startup self-check reads the account balance; a Saturday dry run to a non-team phone checks for "Spam Likely" labelling. Without the paid account the call goes to a team phone and the judge-ring beat is not shown |
| 3.18 | ElevenLabs sound effects for payment tones (Received, Paid, Failed) alongside the voice | **Jordan** | T2 | 3.4 | Tones generated by the ElevenLabs sound-effects API, cached, play offline |
| 3.25 | Batch settlement: `redeem_batch`, the largest batch that fits one transaction (about 3 notes, ESTIMATE); measured fee per payment on `/proof` | **Pravin** + **Jordan** | T2 | 1.4, 2.5 | `batch.ts`: the measured maximum batch settles on devnet as one serialized transaction; `/proof` prints the batch size and fee per payment |
| 3.31 | Card funding for `/send` through Stripe test mode (payment success opens a sandbox allowance) | **Jordan** | T3 | 3.3 | A Stripe test card funds a real devnet allowance through the webhook |
| 3.39 | The remitter call becomes an ElevenLabs conversational agent that answers "where was it spent?" from the signed receipt | **Jordan** + Claude | T3 | 3.9 | One real two-way call logged; answers come only from the receipt |
| 3.41 | "Paid while offline for N s" per payment on `/live` and the receipt card, from signed timestamps | Claude + **Jordan** | T2 | 2.10, 2.7 | The figure recomputes from the ACK received-at and the confirmation slot time returned by `/api/stats`; a test feeds two known timestamps and asserts the printed seconds |
| 3.43 | SMS settlement rail, server: a Fastify route for Vonage inbound SMS that answers 200 first and processes async; reassembles parts by concat-ref/total/part, with a same-sender 60 s window fallback when concat fields are missing; payload "L1:" + unpadded base64url note + signature, with the payer key replaced by a key id so it fits 2 segments (306 GSM-7 characters); feeds the existing settlement path; dedupes by note id (Vonage re-sends for 24 h without a 200) | **Jordan** + Claude | T2 | 1.9, H14 (funded Vonage) | A recorded inbound 2-part message settles once on devnet; a replayed webhook and a later BLE upload of the same note settle nothing more; `/api/stats` tags it `sms_rail` |
| 3.50 | Solana volume numbers: `scripts/measure-redeem.ts` simulates a redeem (replaceRecentBlockhash, base64) and reads compute units and loaded data size, then sends 20 real devnet redeems and reads `meta.fee` and `meta.computeUnitsConsumed`; every redeem then sets SetComputeUnitLimit (measured + 10%) and SetLoadedAccountsDataSizeLimit (next 32 KiB page); `bench/p256-verify.mjs` measures @noble/curves vs node:crypto verifications per second on the VPS (nproc, CPU model, Node version recorded); `GET /api/volume` returns the signatures, fees, compute units, the live SOL price with its timestamp, USD per payment and per 1,000 (ESTIMATE), and the block-capacity formula (ESTIMATE). Normal redeems keep preflight on; only the deliberate cheat skips it. Never present Solana's network throughput as ours | **Jordan** + **Pravin** | T2 | 1.9 | `measurements/redeem.json` lists 20 signatures that resolve on the devnet explorer and every fee equals 5,000 lamports x signatures (including the secp256r1 one) + priority; a fresh redeem shows both ComputeBudget instructions; `/proof` numbers equal the committed files byte for byte; a stranger can recompute one row from the explorer |
| 3.55 | Privacy hygiene (required for an honest `/privacy`): custom Fastify serializers with no IP, headers or bodies; no Caddy access log; rate-limit keys HMAC'd with a per-boot secret; phone numbers memory-only (D15); Vercel Web Analytics and Speed Insights off and `NEXT_TELEMETRY_DISABLED=1`; CI guard that fails on analytics or error-tracking packages (`@vercel/analytics`, sentry, posthog, gtag, mixpanel) using `git ls-files --cached --others --exclude-standard` with a file-count floor; CI test querying `information_schema.columns` for personal-data column names and `inet`/`cidr` types; log-capture test with a planted IP, X-Forwarded-For, user agent and phone number; `/privacy` "What we store" table (field, where it lives, why) linking the tests; wording "no sign-up, no login, no profile", never "no data" | **Jordan** (server), Claude (CI guards), **Stephen** (web) | T2 | 1.9, 1.12 | Schema test proven red once by a scratch migration adding `payer_phone text`, green on main, with at least 1 table and 5 columns scanned; log-capture test want-0 for every planted string AND want-1 for the route pattern; the analytics guard proven red once by a planted package; `curl -sI https://zerobars.us` shows no `set-cookie` |
| 3.58 | Live wiring panel: `GET /api/wiring` returns, per integration, the last real success time, its evidence (slot, commit SHA, model id, balance-check time) and a stale window; no personal data | **Jordan** (endpoint), Claude (UI) | T2 | 2.10, 3.47 | Stopping the iMessage worker turns its row grey within its window; a fresh devnet redeem updates the Solana row within 5 s; a test asserts every row's evidence comes from a stored event |

## Rows you review (agent PRs in your lane)

### Phase 3: galaxy layer + UI (Sat 12 PM to 8 PM)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 3.47 | iMessage agent worker + registration: Photon's `spectrum-ts` cloud iMessage provider as its own ESM Node 22 process on the VPS (systemd; never `imessage-local`); `POST /imsg/register {phone E.164}` creates a shared user (`POST /projects/{id}/users`, Basic auth) and returns the assigned number plus Photon's public redirect deep link with a prefilled message; `/send` gets "Text the agent" (iPhone) and a QR of the same link (desktop); if no inbound arrives within 90 s, `/send` shows the web + reverse-OTP path (a mismatched handle never reaches the agent, so the fallback lives on the web side); register only 1 or 2 team phones so Free-tier slots stay open for judges, unless the promo code gives Pro | Claude (agent drafts, **Jordan** reviews), **Stephen** (the `/send` button, about 1 h) | T2 | 1.9b, 0B.4 promo code | Echo within 5 s from a teammate's iPhone; a phone registered after the worker started still gets its first reply without a restart (else restart after each registration, and record it); the worker returns after `systemctl restart` with no manual step; on the Samsung the web path completes end to end. **Gate Sat 10:00 AM:** if echo + registration is not working, the agent is removed and every claim about it is cut |
| 3.48 | iMessage remittance loop: parse the inbound text, reply with an explicit confirm, and on YES open the earmarked allowance through the existing endpoint, idempotent on `message.id` (deliveries are at-least-once); when that allowance settles, send a text receipt with the `/verify` and explorer links, then `voice()` with a pre-transcoded `.m4a` phrase from the ElevenLabs bank (voice notes need m4a/AAC; `ffmpeg-static` only if needed); the first outbound message carries no link or media (Photon deliverability rule); STOP and UNSUBSCRIBE are honoured (Photon's messaging terms); `/privacy` says Photon keeps the registered number in its user table | Claude (agent drafts, **Jordan** reviews) | T2 | 3.47, 3.3 | "send $1 to Khadim for lunch" then YES creates exactly one allowance; YES twice still creates one; after an airplane-mode spend settles, the judge-style iPhone shows the text receipt and a voice-note bubble within 60 s of confirmation; STOP gets a confirmation and no further messages. **Gate Sat 4:00 PM:** if the full loop is not working, the agent is removed and every claim about it is cut |
| 3.49 | Agent language layer: `gemini-3.8-flash` with a structured-output schema {amount_usd, recipient_label, purpose, expires_days} (thinking "low"; "minimal" errors on this model); deterministic validation (amount within the sandbox cap, recipient in the known list) and nothing moves until YES; key server-side only; confirm the key's Cloud project has active billing so paid-tier terms apply (unpaid-tier prompts can be used for training) | Claude (agent drafts, **Jordan** reviews) | T2 | 3.48 | 10 held-out English and French utterances written by Khadim parse correctly in at least 9; an over-cap or unknown recipient is refused with a reason; a grep of the web bundle for the key prefix returns 0 |

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
| H14 | Vonage account funded at hour 0 (Visa, Mastercard or PayPal, no prepaid cards; finish identity verification if asked) + one US local number with SMS and Voice, for 3.9 and 3.43; low-balance alert on | Jordan | Fri 8:30 PM |
| H22 | Points: check-in 15, demo at judging 200; points buy swag only, so nobody leaves the build for workshop points | each member | Fri, Sun |
| H27 | Print resumes before leaving home (for the sponsor interviews; with the storm, do not count on printing at the venue) | each member | Fri 3 PM |
| H28 | Photon project at app.photon.codes with the hackathon promo code (Pro, 100 users) if one exists; the project id and secret go straight into the VPS secret environment | Khadim (asks at the fair), Jordan (stores) | Fri 9 PM |

## Rules that bite most often

- Stage named paths only (never `git add -A`); one logical change per commit; never bundle a status change with code.
- No em dashes or en dashes in anything you write; CI checks every added line.
- Every judge-facing number comes from `docs/FACTS.json`; never type one from memory.
- Secrets never in git. Keys stay where they are used.
- Contract change? Announce it in `PLAN.md` Shared Contracts first, then commit with `⚠️ CONTRACT`.
