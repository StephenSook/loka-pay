# STEPHEN: tasks

> Pulled from `PLAN.md` (pre-event kit, updated 2026-10-09). If this file and `PLAN.md` disagree, `PLAN.md` wins.
> Status lives in `PLAN.md` only: claim a row there (🟡 + timestamp in Notes), commit `PLAN.md` alone, push.

**Lane:** Frontend + iOS. iOS payment screens, the one Xcode project change, every merge touching `project.pbxproj` / `ChatStore.swift` / `LokaMesh.swift`, the web judge door, design system, video, Devpost and Google Form submission. Only Apple signer and installer. Reviews the agent rows in the iOS, web, CI and tools lanes.

**At 8:30 PM start with:** 1.1 (build), 1.1b (build), 1.1c (review), 1.5 (review). The Sat 3 AM checkpoint is Friday's only goal: one Face ID signature from a physical iPhone, uploaded, verified and redeemed on devnet with an explorer link.

**Sleep window:** Sat 3:30 to 7:30 AM; Sun 1:30 to 4:30 AM (final at the team call). Code is fixes-only after Sun 3 AM.

## Rows you own

### Phase 0: pre-event (now to Fri 3 PM; no feature code, no product design)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 0.2 | Team call: roster, roles, repo owner and name, password vault, Mac owners | **Stephen** + **Khadim** | T1 | n/a | Answers recorded |
| 0.3 | Prize question to organizers (email): do MLH prizes count toward the 3 side-challenge limit, and are there additional prizes | **Stephen** | T1 | n/a | Sent Oct 9; the answer is kept (private) |
| 0.5 | Apple setup: register the bundle id; create the app record (App Store Connect UI; the API refuses); internal group with all four as ASC users; external group "Judges (public)" with test information; 4 UDIDs | **Stephen** signs in, Claude drives | T1 | n/a | Record exists; teammates accepted; external group ready; export compliance NO (standard crypto); agreements and membership show active |
| 0.6 | Vultr VPS (MLH credit) + Docker + Caddy; Tiger Cloud; GoDaddy Registry promo domain + DNS; Vercel project `zerobars-web`; ElevenLabs key check; YouTube channel | **Jordan**, **Pravin**, **Stephen** | T1 | n/a | `https://api.zerobars.us` answers; the domain resolves; Tiger trial expiry recorded; key length > 0; Railway fallback status noted |
| 0.14 | Secrets + MFA ledger, plus every trial and credit with its expiry | **Stephen** + Claude | T1 | 0.6 | One row per service; VERIFIED / PENDING / UNSUPPORTED; no secret values |
| 0.15 | Human-only steps assigned (table below) | **Stephen** | T1 | 0.2 | Every row has an owner and a date |
| 0.16 | Final plan review; optional local tooling trim | **Claude**; Stephen decides | T2 | approval | Review notes kept; trim done or declined in writing |
| 0.17 | Greptile AI pull-request review on Stephen's account (Starter plan, every repo) | **Stephen** signs in, Claude drives | T2 | 0.2 | A review appears on the first PR opened from Stephen's account; credits tracked against the 50 monthly |

### Phase 0B: arrival to hacking (Fri 3:00 to 8:30 PM; no code)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 0B.2 | members.progsu.com account claimed and its check-in form filled (organizers use it at the door) | each member | T1 | n/a | Confirmation before Fri check-in |
| 0B.3 | Opening-ceremony notes; re-cut the demo script and the criteria table against the announced criteria and challenge reveals; keep or swap the third challenge; name ONE headline number in merchant terms, which becomes the first field of `/api/stats`, the last line of the close, slide 3 and the README's first screen | **Khadim** + **Stephen** | T1 | n/a | Re-cut notes by 8:00 PM, with the headline number and its source run named |
| 0B.5 | Create the Devpost project when submissions open (7 PM); all four join | **Stephen** | T1 | 0.11 | All four listed on the project |
| 0B.6 | Side-challenge limit question: do the MLH and sponsor challenges count toward the limit of 3? One short question in the event Q&A channel (**Stephen** approves the exact text first; nothing is posted without his "send"), plus the MLH rep at the fair and at the opening Q&A; every answer screenshotted into private notes | **Stephen** (approves), **Khadim** (asks in person) | T1 | 0.3 | An organizer answer quoted verbatim, or the default (at most 3 side challenges in total) at Sat 7:00 PM; the result is written in `PLAN.md` |

### Phase 1: foundation + contracts (Fri 8:30 PM to Sat 3 AM)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 1.1 | Public repo: scrubbed import commit (source SHA + tree hash), tag, README disclosure, `PLAN.md` + task files + `AGENTS.md`, branch protection | **Stephen** + Claude | T1 | 0.12 | Tag exists; every inventory item resolved; repo public with README (not blocked on 0.3, see 3.2) |
| 1.1b | `ios/LokaPay/` Swift package added to the app; our bundle id and team | **Stephen** | T1 | 1.1 | Device build installs; `swift test` runs in CI |
| 1.11 | TestFlight build 1: archive, upload with `altool`, internal testers, submit version 1.0 for Beta App Review | **Stephen** (Claude drives App Store Connect) | T1 | 1.1b, 1.1c, 1.12 | Build VALID; teammates installed it; `betaReviewState` WAITING_FOR_REVIEW by Sat 12:30 AM |

### Phase 2: the loop on real phones (Sat 3 AM to 12 PM)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 2.1 | Merchant QR + scanner, Pay screen, Receive screen | **Stephen** | T1 | 1.10, 2.6 | On a device: scan, Face ID, merchant shows "Received" offline; the merchant can preset the amount in the QR, the way a real till works |
| 2.4 | Gateway mode: upload held frames, inject replies (reuses community-sharing consent) | Claude + **Stephen** | T2 | 2.3, 2.5 | A frame from another phone settles through this one |
| 2.7 | Confirmation handling: Paid, receipts, countersignature, payer receipt over BLE | **Stephen** | T1 | 1.9, 2.1 (2.4 for the upgrade) | Merchant shows Paid; payer receives the receipt offline |
| 2.12 | Face ID failure path + error states on every money screen | **Stephen** | T1 | 2.1 | Passcode fallback works; every money screen has an error state |
| 2.21 | Judge flips airplane mode: the "No internet" chip reacts within 2 s on both phones; the demo script and the table card invite the judge to switch airplane mode on themselves | **Stephen** + **Khadim** | T1 | 2.15 | Rehearsal (4.4) shows a judge-style tester toggling airplane mode and the chip flipping on both phones before Pay |

### Phase 3: galaxy layer + UI (Sat 12 PM to 8 PM)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 3.0 | Midpoint audit, Sat ~3 PM: count commits since 8:30 PM per judged question and per in-flight T2 item; each T2 item names the demo-script moment or prepared Q&A answer it feeds; items feeding neither move behind 3.7 and 4.4. Re-ranks only, deletes nothing | Claude + **Stephen** | T1 | Sat 12 PM checkpoint | The table exists by 3:30 PM and the T2 order in `PLAN.md` reflects it |
| 3.1 | iOS money screens in the Lullabuy/ATLAS system; de-gamify (Play tab becomes Wallet, dirty/drinking filters and card art removed); offline corner | **Stephen** | T1 | 2.7 | `ui-self-heal` stills at 390 pt pass the token audit; screenshots in `docs/screens/`; VoiceOver labels and Dynamic Type on every money screen; a haptic and a tone on Received and Paid |
| 3.2 | Web judge door: `/judge`, `/live`, `/verify` (T1); `/`, `/send`, `/proof`, `/trust` (T2) | Claude + **Stephen** | T1/T2 | 2.19 | Playwright passes on production with no login; Lighthouse 90+ on `/judge` and `/live`; `/live?kiosk=1` renders big-type |
| 3.7 | Demo video: 2:00 to 3:00, public on YouTube, -14 to -16 LUFS, frames checked | **Stephen** + **Khadim** | T1 | Sat 12 PM checkpoint | ebur128 + ffprobe output logged; link opens logged out; final cut by 9 PM; real captures first; shows the T2 beats that shipped |
| 3.14 | Live Activity in the Dynamic Island (Pending, Received, Paid, local updates) + a Lock Screen allowance widget | **Stephen** + Claude | T2 | 2.7 | Flips to Paid with the phone offline until settle; the widget shows the allowance left |
| 3.47 | iMessage agent worker + registration: Photon's `spectrum-ts` cloud iMessage provider as its own ESM Node 22 process on the VPS (systemd; never `imessage-local`); `POST /imsg/register {phone E.164}` creates a shared user (`POST /projects/{id}/users`, Basic auth) and returns the assigned number plus Photon's public redirect deep link with a prefilled message; `/send` gets "Text the agent" (iPhone) and a QR of the same link (desktop); if no inbound arrives within 90 s, `/send` shows the web + reverse-OTP path (a mismatched handle never reaches the agent, so the fallback lives on the web side); register only 1 or 2 team phones so Free-tier slots stay open for judges, unless the promo code gives Pro | Claude (**Jordan** reviews), **Stephen** (the `/send` button, about 1 h) | T2 | 1.9b, 0B.4 promo code | Echo within 5 s from a teammate's iPhone; a phone registered after the worker started still gets its first reply without a restart (else restart after each registration, and record it); the worker returns after `systemctl restart` with no manual step; on the Samsung the web path completes end to end. **Gate Sat 10:00 AM:** if echo + registration is not working, the agent is removed and every claim about it is cut |
| 3.53 | Zero-bars meter + offline clock (tightens 2.15 and 3.41): four empty signal bars labelled "Zero bars: no Wi-Fi, no cellular, Bluetooth on" plus a ticking "Holding offline 0:42" on the merchant's Receive screen, freezing into "Settled N s after signal; held offline M"; the receipt stamp says "Received with zero bars (phone-reported)"; the same bars fill in the Dynamic Island compact view on Paid; radio state is never added to the signed ACK | **Stephen** (UI), Claude (state) | T2 | 2.15, 3.41 | On a device the bars empty and the clock ticks within 2 s of airplane mode; the frozen figure equals the 3.41 value from `/api/stats` to the second; VoiceOver reads "Zero bars, no internet" |
| 3.55 | Privacy hygiene (required for an honest `/privacy`): custom Fastify serializers with no IP, headers or bodies; no Caddy access log; rate-limit keys HMAC'd with a per-boot secret; phone numbers memory-only (D15); Vercel Web Analytics and Speed Insights off and `NEXT_TELEMETRY_DISABLED=1`; CI guard that fails on analytics or error-tracking packages (`@vercel/analytics`, sentry, posthog, gtag, mixpanel) using `git ls-files --cached --others --exclude-standard` with a file-count floor; CI test querying `information_schema.columns` for personal-data column names and `inet`/`cidr` types; log-capture test with a planted IP, X-Forwarded-For, user agent and phone number; `/privacy` "What we store" table (field, where it lives, why) linking the tests; wording "no sign-up, no login, no profile", never "no data" | **Jordan** (server), Claude (CI guards), **Stephen** (web) | T2 | 1.9, 1.12 | Schema test proven red once by a scratch migration adding `payer_phone text`, green on main, with at least 1 table and 5 columns scanned; log-capture test want-0 for every planted string AND want-1 for the route pattern; the analytics guard proven red once by a planted package; `curl -sI https://zerobars.us` shows no `set-cookie` |

### Phase 4: harden + submit (Sat 8 PM to Sun 9 AM)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 4.0 | Early full Devpost submission: every field, backup video, repo, demo link, disclosure, track + the side challenges from the one entry list (written by Sat 7 PM, after 0B.6), AI tools named | **Stephen** | T1 | backup #1, 0B.6 | Public gallery shows it logged out; the Devpost challenge opt-ins, the "track and challenges" line and the Google Form list the same entries; no surface lists more than 3 side challenges unless a written organizer answer (0B.6) allows it |
| 4.2 | Scrub re-audit + gitleaks full history + claims audit + Built With + `.env.example` parity; FACTS equality check wired in CI | **Stephen** + Claude | T1 | all | Zero unbacked claims; the hygiene job's FACTS step runs with no "not wired" warning |
| 4.3 | Devpost writeup final (every section, including What we learned); 6 to 8 captioned gallery stills from real captures plus the architecture diagram; the README's first screen as a judge document (what it is, live links, TestFlight status, disclosure, the curl for `/api/stats`) | **Khadim** + **Stephen** | T1 | 4.2 | A logged-out reload shows every field and caption; the README's curl returns live numbers |
| 4.5 | Final submission by 7:30 AM; Google Form the moment it posts; freeze hook at 9:00 AM. **Stephen** submits both Devpost and the Form (the guide asks for one member); **Khadim** prepares the Form answers from the entry list and checks the saved confirmation | **Stephen** (submits), **Khadim** (prepares, checks) | T1 | 4.3, 4.6 | Logged-out gallery + form confirmation saved; hook proven red once |
| 4.7 | TestFlight public link: attach the newest build, enable the link, check it unauthenticated, put the QR on the table card, README and Devpost | **Stephen** signs in, Claude drives | T2 | 1.11 approved | The payment build itself is available to the external group; a logged-out fetch returns 200 "Join the ... beta"; a fresh install from the link completes a payment; the QR decodes to that URL |
| 4.9 | A 60-second version of the demo for sponsor and MLH tables, one per side challenge on the entry list; the Solana version carries one volume line from `docs/FACTS.json` (3.50, 3.51), the iMessage version shows the iMessage receipt (3.48) | **Khadim** + **Stephen** | T1 | 4.4 | Timed at 60 s or less in rehearsal; no number spoken that is not in `docs/FACTS.json` |

### Phase 5: after submission (Sun 9 AM onward)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 5.1 | Freeze: the repo and live site are frozen at 9:00 AM while the probes keep running through the winners post | **Stephen** + Claude | T1 | 4.5 | The freeze hook refuses a commit; probe workflows show `state: active` until Sun 7 PM |
| 5.4 | If we place: a post that leads with the result | **Stephen** + Claude | T2 | winners posted | Posted only with Stephen's OK |
| 5.5 | Prize claim: for each prize won, record how it is claimed and the earliest deadline, and calendar it; check email daily, spam folder included, for messages from the organizers, MLH and Devpost until every claim is confirmed; the event watcher (0.9) keeps running past closing for this purpose only | **Stephen** + Claude | T1 | winners posted | Every won prize shows claimed or a dated next step |
| 5.6 | DEV Writing Challenge post: the project story on DEV after winners are posted; every number from `docs/FACTS.json`, no organizers or judges named, no team strategy, links the frozen repo, passes the em-dash and AI-tone sweep; published only with Stephen's OK | **Khadim** drafts, **Stephen** publishes | T2 | winners posted | Post live and linked from the README (a README edit only if the freeze rules allow it, otherwise linked from Devpost comments) |

## Rows you review (agent PRs in your lane)

### Phase 1: foundation + contracts (Fri 8:30 PM to Sat 3 AM)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 1.1c | Relax the fixed card and game counts for the clean catalog (iOS loader + envelope test, Android loader, catalog test) | Claude, **Stephen** reviews | T1 | 1.1 | Both apps load the clean catalog; `tests/check-game-catalog.py` passes; every per-card and per-game guard unchanged |
| 1.5 | iOS keys + note codec in LokaPay (Secure Enclave, `.userPresence`, low-S) | Claude, **Stephen** reviews | T1 | 1.1b, 1.2 | Vector + low-S tests green; on a phone, an enclave signature verifies against the vector verifier; the key restores after relaunch and the serial counter survives a forced quit |
| 1.8 | Web scaffold with the design tokens; Vercel preview | Claude, **Stephen** reviews | T1 | 1.1 | Preview renders; Playwright smoke green |
| 1.10 | iOS onboarding + direct pay: register the enclave key (`POST /v1/payers` opens an on-chain allowance), then sign and upload one note (offline certificates come in 2.6) | Claude, **Stephen** reviews | T1 | 1.5, 1.9, 1.9b | The Sat 3 AM checkpoint below |

### Phase 3: galaxy layer + UI (Sat 12 PM to 8 PM)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 3.44 | SMS hand-off, iOS: on the merchant phone, `MFMessageComposeViewController` with our Vonage number as recipient and the payload as body; button "Tap Send to settle by SMS"; "sent" means handed to Messages, never "settled"; Paid arrives later over BLE, data or a Vonage voice call. Blocking hour-1 device test: Cellular Data off, Wi-Fi off, Wi-Fi Calling off (not airplane mode); send 2- and 3-part payloads from each teammate's carrier at GSU and confirm they arrive as SMS parts, not a failed MMS | Claude, **Stephen** reviews | T2 | 3.43, 2.7 | The device test log shows arrival on the webhook per carrier; the pitch states the three tiers and never claims airplane mode or satellite for this path |
| 3.52 | `/verify` upgrade: "Play the attacker" (the judge edits the amount or merchant of a real demo note; the browser check fails with "Signature no longer matches: the payer's phone never signed this"; "Send it to Solana anyway" uses a separate small attacker fee payer and returns a failed devnet transaction or the verbatim RPC rejection) + "Transaction X-ray" (the 141 signed bytes next to the 141 bytes read back from the devnet transaction by the judge's browser, banded by field, with "141 of 141 bytes match", compute units, fee, and the program's named error on the refused cheat) | Claude, **Stephen** reviews the visual | T2 | 3.2, 1.9 | Playwright on production: editing the amount shows the failure within 1 s and undo restores the match; "Send anyway" yields a non-null `meta.err` signature or the RPC rejection, whichever happens is recorded in `docs/FACTS.json` and the page wording matches; one changed byte in the fetched data names the byte position |

## Agent rows in your review lanes (Claude builds, you review and merge)

### Phase 0: pre-event (now to Fri 3 PM; no feature code, no product design)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 0.1 | Local workspace (private notes, submissions and video folders outside this repo); brief and research saved | **Claude** | T1 | n/a | Workspace holds the brief and research notes; none of it is pushed |
| 0.9 | Event monitoring: full sweep of Discord Q&A and announcements, then a finite watcher that retires after closing | **Claude** | T1 | approval | Sweep report states 0 unread; watcher condition run once by hand |
| 0.12 | Read-only scrub scans of the original LOKA repo | **Claude** | T1 | n/a | gitleaks + trufflehog results recorded; every path to remove listed |

### Phase 1: foundation + contracts (Fri 8:30 PM to Sat 3 AM)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 1.2b | Vector generator (`tools/vectors/`) + LOKA codec vectors from a Gradle task | **Claude** | T1 | 1.2 | CI regenerates vectors with no diff |
| 1.6 | Peer-to-peer Wi-Fi spike | **Claude** | T3 | 1.1b | GO rule (D6) or killed at midnight; `experiments/EXP-P2P-001.md` |
| 1.7 | Six CI workflows, required on main | **Claude** | T1 | 1.1 | First PR shows all six checks green |
| 1.12 | `/privacy` page (TestFlight needs a privacy URL) | **Claude** | T1 | 1.8 | `https://zerobars.us/privacy` answers 200 |

### Phase 2: the loop on real phones (Sat 3 AM to 12 PM)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 2.2 | Payment-only permission scope | **Claude** | T1 | 1.5, 1.1c | Unit test: a non-contact can send `L1\|P` only; chat stays blocked |
| 2.3 | Note store, re-wrap, re-injection | **Claude** | T2 | 2.2 | Store survives relaunch; unsettled notes re-injected after packet expiry |
| 2.9 | BLE tuning (iOS) + the upgrade decision (by Sat 8 PM) | **Claude** | T2 | 2.4 | `experiments/EXP-PAY-001.md` has both upgrade variants measured; decision written |
| 2.11 | Golden-packet test on the Samsung | **Claude** | T2 | 2.3 | An unmodified Android build carries one payment packet (recorded) |
| 2.13 | "Try to cheat" control: signs a second note bound to the settled payment's payer, allowance and serial, clearly labelled; the judge presses it | **Claude** | T1 | 2.1 | The judge can press it; that payment's payer authenticates; the refusal shows "Failed (already spent)" and an explorer link to the failed devnet transaction with the program's named error; if any layer refuses before the chain, the screen names which layer |
| 2.14 | "Demo route" setting replaces the DEBUG launch args, with a banner | **Claude** | T2 | 1.1b | Works in a TestFlight build; banner visible |
| 2.15 | "No internet" chip (NWPathMonitor) on money screens | **Claude** | T1 | 2.1 | Chip flips within 2 s of airplane mode |
| 2.19 | Minimal deployed `/live`: SSE feed + explorer links (the full judge door is 3.2) | **Claude** | T1 | 2.10, 1.8 | Production `/live` shows a settlement within 5 s of confirmation |
| 2.20 | Merchant offline-limit ledger: durably reserve each accepted note against the allowance's offline limit; refuse past it | **Claude** | T1 | 1.5, 2.6 | Unit test plus a relaunch test: cumulative unsettled value never exceeds the limit |

### Phase 3: galaxy layer + UI (Sat 12 PM to 8 PM)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 3.8 | Samsung relay test + LOKA relay APK (clean catalog) on GitHub Releases | **Claude** | T2 | 2.11 | APK installs on the Samsung; release page public |
| 3.10 | `/lab`, a web lab any judge can run from the deployed link: two simulated phones with labelled simulated hops; real P-256 signatures (a non-extractable WebCrypto key, or a passkey via 3.23); real devnet settlement; a real refused cheat | **Claude** | T2 | 3.2, 1.9b | A logged-out visitor completes a payment and a refused cheat on production; every simulated element is labelled; registrations draw from the public-onboarding wallet |
| 3.12 | Merchant statement in Wallet (signed receipts, export) | **Claude** | T2 | 2.7 | Export opens; signatures verify on `/verify` |
| 3.13 | Android pays with its own hardware key: Android Keystore P-256 (StrongBox when present) behind BiometricPrompt, DER to 64-byte low-S, payment screens | **Claude** | T2 | 2.6, 2.11 | A Samsung-signed note redeems on devnet through the same precompile; KeyInfo reports a hardware security level (TEE or StrongBox); signing refuses without per-use biometric authentication; the Samsung pays an iPhone over BLE |
| 3.17 | Family budget view on `/send`: where the money went, by earmark, from signed receipts | **Claude** | T2 | 3.3, 2.10 | Every figure recomputes from `/api/stats` |
| 3.19 | Background relay measurement (iOS background Bluetooth modes) | **Claude** | T3 | 2.9 | Measured or not claimed; result in `experiments/` |
| 3.21 | UWB point-to-pay experiment (Nearby Interaction) | **Claude** | T3 | 2.1 | Airplane mode turns UWB off, so it runs only with cellular data and Wi-Fi switched off, shown by the "No internet" chip, and is never called airplane mode |
| 3.22 | Siri shortcut "Pay with LOKA" (App Intents, on-device; Face ID still required) | **Claude** | T3 | 2.1 | Works with airplane mode on, or it is not shown |
| 3.27 | Acceptance check chip on the Receive screen ("Within local limit", "Near limit", "Conflicting spend seen") plus the offline-risk line | **Claude** | T2 | 2.6, 2.8, 2.20 | Each state reproduces on a device from its inputs; word and icon, never color alone; the risk line is always visible |
| 3.29 | Settle it yourself on `/verify`: submit a note's redeem with any devnet wallet as fee payer | **Claude** | T2 | 3.2, 1.4 | A note settles from a browser wallet while our server is stopped, and the merchant app shows Paid from a direct chain read |
| 3.32 | Receipts as Apple Wallet passes (`passkit-generator`, a Pass Type ID from Stephen's account) | **Claude** | T3 | 2.7 | A settled payment adds a valid pass to Wallet |
| 3.33 | Tap an NFC sticker to pick the merchant (Core NFC) | **Claude** | T3 | 2.1 | Only if stickers are on hand and a device test shows NFC reads with airplane mode on (Q11) |
| 3.37 | Paper receipt: a Bluetooth thermal printer prints the signed receipt with a QR that verifies on `/verify` | **Claude** | T3 | 2.7 | Only if we get a printer by Friday; one printed receipt verifies on a judge's phone |
| 3.40 | Speak to pay in French with Apple's on-device model (Foundation Models); Face ID still signs | **Claude** | T3 | 2.1 | Only on a phone that supports Apple Intelligence; works with airplane mode on, or it is not shown |
| 3.42 | Local currency (XOF, NGN) next to the sandbox dollars on `/send`, the family budget view and the receipt, from open.er-api.com with the source and update time printed; display only, settlement stays in USDC | **Claude** | T2 | 3.3 | The rate is fetched server-side once a day and cached; the attribution link renders; if the fetch fails the screen shows dollars only (never a stale or invented rate) |
| 3.56 | Passkey E2E in CI: Playwright Chromium with a CDP virtual authenticator (`WebAuthn.enable`, `addVirtualAuthenticator` with ctap2, internal transport, resident key, user verification) creates a passkey and runs 20 lab payments against a preview build with its own rpId and database (never production, so CI never inflates the headline); negative controls: `setResponseOverrideBits({isBogusSignature:true})` and a tampered clientDataJSON challenge | **Claude** | T2 | 3.10, 3.23 | Job green with 20 devnet signatures and 20 `credentialAsserted` events; both negative cases refused; removing the low-S normalizer makes at least one positive payment fail (proves high-S is exercised); verdict read from the job's check-run, not the watcher's exit code |
| 3.57 | Offline verify on the judge's phone: service worker precaches `/verify`; in-page camera QR scan; receipt payload in the URL fragment; signatures checked locally with WebCrypto; "checked on this phone, no internet used" only when the browser reports offline | **Claude** | T2 | 3.2, 2.7 | On an iPhone in Safari: load `/verify` once, airplane mode on, reload, scan a real receipt QR and it verifies; a tampered receipt fails |

### Phase 4: harden + submit (Sat 8 PM to Sun 9 AM)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 4.1 | Adversarial review of every money-path diff until a clean round (Codex, Grok, Claude review agents) | **Claude** | T1 | each diff | The last round returns no finding |
| 4.6 | Main CI green on the merged SHA (count floor) + live probes | **Claude** | T1 | merges | The latest result of each of the six CI jobs on the submitted SHA is success; scheduled probes are excluded from this verdict and tracked separately |

### Phase 5: after submission (Sun 9 AM onward)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 5.3 | Post-event retro and review-tool comparison (Greptile vs Codex) | **Claude** | T1 | winners posted | Retro written; review comparison recorded |

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
| H6 | Add teammates as App Store Connect users; register 4 iPhone UDIDs | Stephen | Fri noon |
| H7 | Answer export compliance (`ITSAppUsesNonExemptEncryption`, standard crypto) | Stephen | First TestFlight upload |
| H8 | Per phone: iOS 17+, automatic date and time on (LOKA validates packet timestamps), Face ID or passcode set, Bluetooth on | each member | Fri 3 PM |
| H9 | First launch online after every dev install | each member | Every install |
| H11 | Register the domain on the MLH GoDaddy Registry promo; DNS root to Vercel, `api` to Vultr | Stephen | Fri 3 PM |
| H12 | Vultr account (MLH credit) + VPS; Tiger Cloud; Vercel project | Jordan / Pravin / Stephen | Fri 3 PM |
| H13 | Put the ElevenLabs key into the VPS secret environment (teammates never handle it) | Stephen | Fri 9 PM |
| H15 | YouTube channel for the public video | Stephen | Sat 6 PM |
| H17 | Repo owner and name; password vault choice + MFA | Stephen + Khadim | Team call |
| H18 | Sign in to App Store Connect in Chrome so Claude can create the app record and fill TestFlight test info (the API refuses app creation) | Stephen | Fri noon |
| H19 | Sign in to Greptile and approve its GitHub App install (0.17) | Stephen (Claude drives) | Fri noon |
| H20 | Submit build 1 for Beta App Review | Stephen (Claude drives) | Fri ~11:30 PM |
| H21 | Enable the TestFlight public link after approval | Stephen (Claude drives) | On approval |
| H22 | Points: check-in 15, demo at judging 200; points buy swag only, so nobody leaves the build for workshop points | each member | Fri, Sun |
| H23 | Google Form: Stephen submits it (one member submits both Devpost and the Form); Khadim prepares the answers from the entry list and checks the saved confirmation | Stephen, Khadim | The moment it posts |
| H24 | Devpost early submit and final submit | Stephen | Sat 8 PM; Sun 7:30 AM |
| H25 | Set the repo variable `APPLE_TEAM_ID` (our team id, not a secret) so the hygiene scrub guard can tell our team id from a foreign one | Stephen | Right after the first push |
| H27 | Print resumes before leaving home (for the sponsor interviews; with the storm, do not count on printing at the venue) | each member | Fri 3 PM |
| H29 | Who attends the Sat 1:30 to 2:45 PM sponsor interviews (SCW 466/468), in which slot, and who covers their lane; if the Sat 12 PM checkpoint is red, Stephen stays on the baseline and the others go in 20-minute shifts; Pravin's sleep window moves off 1:30 to 2:45 PM if he goes | Khadim (decides at the team call) | Fri 8 PM |

## Rules that bite most often

- Stage named paths only (never `git add -A`); one logical change per commit; never bundle a status change with code.
- No em dashes or en dashes in anything you write; CI checks every added line.
- Every judge-facing number comes from `docs/FACTS.json`; never type one from memory.
- Secrets never in git. Keys stay where they are used.
- Contract change? Announce it in `PLAN.md` Shared Contracts first, then commit with `⚠️ CONTRACT`.
