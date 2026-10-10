# KHADIM: tasks

> Pulled from `PLAN.md` (pre-event kit, updated 2026-10-09). If this file and `PLAN.md` disagree, `PLAN.md` wins.
> Status lives in `PLAN.md` only: claim a row there (🟡 + timestamp in Notes), commit `PLAN.md` alone, push.

**Lane:** Product + business. Real-user interview + consent, pitch, slides, business model, protocol semantics review, Devpost copy, Google Form answers (Stephen submits), storm numbers (3.54), QA on phones, demo choreography, organizer and sponsor conversations, LAN fallback rehearsal. Owns `docs/FACTS.json`. LOKA co-founder.

**At 8:30 PM start with:** 1.2 (review). The Sat 3 AM checkpoint is Friday's only goal: one Face ID signature from a physical iPhone, uploaded, verified and redeemed on devnet with an explorer link.

**Sleep window:** Sat 3:30 to 7:30 AM; Sun 12 to 3 AM (final at the team call). Code is fixes-only after Sun 3 AM.

## Rows you own

### Phase 0: pre-event (now to Fri 3 PM; no feature code, no product design)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 0.2 | Team call: roster, roles, repo owner and name, password vault, Mac owners | **Stephen** + **Khadim** | T1 | n/a | Answers recorded |
| 0.7 | Real-user interview (consent per surface first) | **Khadim** | T1 | n/a | Verbatim notes + consent per surface by Fri noon |
| 0.10 | Business model, license sentence, Q&A answers, and one people count for slide 1: about 5.3 million Senegalese adults with mobile money (ESTIMATE: World Bank 2025 adults aged 15+ x GSMA 2021 mobile-money share of 45%) | **Khadim** | T1 | 0.7 | Q&A answers complete; the count and its two sources are in `docs/FACTS.json` |
| 0.13 | Wolof voice check: 5 Wolof + 5 French `eleven_v4` phrases rated by a native speaker | **Khadim** + Claude | T2 | 0.6 | GO/NO-GO written by Fri noon; clips discarded (regenerated in-window) |

### Phase 0B: arrival to hacking (Fri 3:00 to 8:30 PM; no code)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 0B.3 | Opening-ceremony notes; re-cut the demo script and the criteria table against the announced criteria and challenge reveals; keep or swap the third challenge; name ONE headline number in merchant terms, which becomes the first field of `/api/stats`, the last line of the close, slide 3 and the README's first screen | **Khadim** + **Stephen** | T1 | n/a | Re-cut notes by 8:00 PM, with the headline number and its source run named |
| 0B.4 | Sponsor fair, split so nobody is double-booked: **Khadim** 6:45 to 7:30 PM (MLH rep: the side-challenge limit question, 0B.6; Photon rep: the hackathon promo code for the Pro tier; the Zero Data challenge sponsor: its criteria), then joins the re-cut 7:30 to 8:15 PM; **Jordan** or **Pravin** covers the Solana and ElevenLabs reps | **Khadim**, **Jordan** / **Pravin** | T2 | n/a | Notes (names only with consent); the Photon promo code recorded in the secrets ledger (never in chat or the repo) |
| 0B.6 | Side-challenge limit question: do the MLH and sponsor challenges count toward the limit of 3? One short question in the event Q&A channel (**Stephen** approves the exact text first; nothing is posted without his "send"), plus the MLH rep at the fair and at the opening Q&A; every answer screenshotted into private notes | **Stephen** (approves), **Khadim** (asks in person) | T1 | 0.3 | An organizer answer quoted verbatim, or the default (at most 3 side challenges in total) at Sat 7:00 PM; the result is written in `PLAN.md` |

### Phase 2: the loop on real phones (Sat 3 AM to 12 PM)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 2.16 | LAN fallback: travel router, no uplink, Samsung hub | **Khadim** + Claude | T2 | 2.11 | One rehearsed run logged |
| 2.21 | Judge flips airplane mode: the "No internet" chip reacts within 2 s on both phones; the demo script and the table card invite the judge to switch airplane mode on themselves | **Stephen** + **Khadim** | T1 | 2.15 | Rehearsal (4.4) shows a judge-style tester toggling airplane mode and the chip flipping on both phones before Pay |

### Phase 3: galaxy layer + UI (Sat 12 PM to 8 PM)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 3.6 | Real-run measurement session (team + consenting volunteers) | **Khadim** + everyone | T1 | 2.10 | `experiments/EXP-PAY-001.md` + `docs/FACTS.json` with n, median, p95 |
| 3.7 | Demo video: 2:00 to 3:00, public on YouTube, -14 to -16 LUFS, frames checked | **Stephen** + **Khadim** | T1 | Sat 12 PM checkpoint | ebur128 + ffprobe output logged; link opens logged out; final cut by 9 PM; real captures first; shows the T2 beats that shipped |
| 3.11 | Three slides: problem + user, architecture diagram, disclosure + measured numbers | **Khadim** | T1 | 1.2 | Every number equals `docs/FACTS.json` |
| 3.28 | Money screens in English, French and Wolof | **Khadim** + Claude | T2 | 3.1 | Every money string has three translations; a native speaker checked the Wolof |
| 3.38 | One real merchant near campus tries a sandbox payment on camera and says what an outage costs them | **Khadim** | T2 | Sat 12 PM checkpoint | Written consent before filming; the clip and quote are used verbatim; nothing is staged |
| 3.54 | Storm numbers: Sat 9 to 11 PM, read Georgia Power's outage map (customers out of total served, and the map's own "Last Updated" time) and the FCC's Hurricane Isaias status page; write the figures with source, URL and timestamp into `docs/FACTS.json` and the Devpost text that night; Sunday refresh optional, slides only; the FCC Helene cell-site line is the fallback. Never PowerOutage.us on a public surface (its terms forbid it), never a screenshot of the Georgia Power map, never a claim that LOKA Pay helped anyone in the storm; the Helene line always carries the FCC caveat that cell-site outages do not equal people without service | **Khadim** + Claude | T1 | 0B.7 | A second teammate re-opens each URL within 15 minutes and sees the same figure within refresh drift; a grep of README, Devpost text and slides for "poweroutage" returns 0; every storm figure carries a URL and a timestamp; this weekend's figures are dated Oct 2026 (never a 2020 Isaias number) and the Helene line is dated Oct 2024 |

### Phase 4: harden + submit (Sat 8 PM to Sun 9 AM)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 4.3 | Devpost writeup final (every section, including What we learned); 6 to 8 captioned gallery stills from real captures plus the architecture diagram; the README's first screen as a judge document (what it is, live links, TestFlight status, disclosure, the curl for `/api/stats`) | **Khadim** + **Stephen** | T1 | 4.2 | A logged-out reload shows every field and caption; the README's curl returns live numbers |
| 4.5 | Final submission by 7:30 AM; Google Form the moment it posts; freeze hook at 9:00 AM. **Stephen** submits both Devpost and the Form (the guide asks for one member); **Khadim** prepares the Form answers from the entry list and checks the saved confirmation | **Stephen** (submits), **Khadim** (prepares, checks) | T1 | 4.3, 4.6 | Logged-out gallery + form confirmation saved; hook proven red once |
| 4.8 | Share the Devpost link with our own networks, plus a 15-second vertical cut of the real demo, only if a public-vote prize exists; no vote trading | **Khadim** | T2 | 4.0 | Posts logged |
| 4.9 | A 60-second version of the demo for sponsor and MLH tables, one per side challenge on the entry list; the Solana version carries one volume line from `docs/FACTS.json` (3.50, 3.51), the iMessage version shows the iMessage receipt (3.48) | **Khadim** + **Stephen** | T1 | 4.4 | Timed at 60 s or less in rehearsal; no number spoken that is not in `docs/FACTS.json` |

### Phase 5: after submission (Sun 9 AM onward)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 5.6 | DEV Writing Challenge post: the project story on DEV after winners are posted; every number from `docs/FACTS.json`, no organizers or judges named, no team strategy, links the frozen repo, passes the em-dash and AI-tone sweep; published only with Stephen's OK | **Khadim** drafts, **Stephen** publishes | T2 | winners posted | Post live and linked from the README (a README edit only if the freeze rules allow it, otherwise linked from Devpost comments) |

## Rows you review (agent PRs in your lane)

### Phase 1: foundation + contracts (Fri 8:30 PM to Sat 3 AM)

| # | Component | Owner | Tier | Deps | Accept |
|---|---|---|---|---|---|
| 1.2 | `protocol/PAYMENT-V1.md` + vectors, drafted in the same hour as 1.1 | Claude, **Khadim** reviews | T1 | none (merged after 1.1) | Spec merged; `protocol/vectors/*.json` committed |

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
| H10 | Written consent per surface: the interviewee's quotes, teammates on camera, volunteers in 3.6 | Khadim | Before first use |
| H17 | Repo owner and name; password vault choice + MFA | Stephen + Khadim | Team call |
| H22 | Points: check-in 15, demo at judging 200; points buy swag only, so nobody leaves the build for workshop points | each member | Fri, Sun |
| H23 | Google Form: Stephen submits it (one member submits both Devpost and the Form); Khadim prepares the answers from the entry list and checks the saved confirmation | Stephen, Khadim | The moment it posts |
| H26 | Confirm the LICENSE copyright line with the LOKA founders (Q9) | Khadim | Before the repo goes public |
| H27 | Print resumes before leaving home (for the sponsor interviews; with the storm, do not count on printing at the venue) | each member | Fri 3 PM |
| H28 | Photon project at app.photon.codes with the hackathon promo code (Pro, 100 users) if one exists; the project id and secret go straight into the VPS secret environment | Khadim (asks at the fair), Jordan (stores) | Fri 9 PM |
| H29 | Who attends the Sat 1:30 to 2:45 PM sponsor interviews (SCW 466/468), in which slot, and who covers their lane; if the Sat 12 PM checkpoint is red, Stephen stays on the baseline and the others go in 20-minute shifts; Pravin's sleep window moves off 1:30 to 2:45 PM if he goes | Khadim (decides at the team call) | Fri 8 PM |

## Rules that bite most often

- Stage named paths only (never `git add -A`); one logical change per commit; never bundle a status change with code.
- No em dashes or en dashes in anything you write; CI checks every added line.
- Every judge-facing number comes from `docs/FACTS.json`; never type one from memory.
- Secrets never in git. Keys stay where they are used.
- Contract change? Announce it in `PLAN.md` Shared Contracts first, then commit with `⚠️ CONTRACT`.
