# How this public copy of LOKA was made

This repository starts from LOKA v0.6.66, an offline, end-to-end encrypted Bluetooth mesh messenger for iPhone and Android. The LOKA founders built it between Oct 2 and Oct 6 2026, before Hacklanta II. It was imported at the start of hacking (Fri Oct 9 2026, 8:30 PM ET) as exactly one commit, tagged `pre-hacklanta-foundation`.

- Source commit: `3377240a6f55d5ef43faa942c2ac114d3a9caca6` (the founders' private repository)
- Source tree: `96d43306b15e2562eaa95456c4e56f0bbdfa2e68`
- The copy was made with `git archive` of that commit and checked to be identical to the source tree before any change.

Nothing was rewritten or re-dated. The only changes in the import commit are the privacy and content scrub below. Everything after the tag was built during the event; the README shows the commands that prove it.

## What the scrub changed, by category

| Category | What we did | Why |
|---|---|---|
| Run folders under `experiments/results/` | Removed 348 files: raw logs, party-card screenshots and per-run notes | The raw logs hold device identifiers, key fingerprints, local file paths and timestamps; the screenshots and per-run notes document party-card UI tests, including the removed decks, and two notes carry device serials. The written experiment reports in `experiments/` are unchanged. |
| Simulator outputs under `experiments/dtn-sim/results/` | Removed the 9 raw output files (every file there except the three written summaries) | Raw generated output. The written summaries and the simulator code are unchanged. |
| Other raw logs under any `experiments/` results folder | Removed 0 file(s) (`.log`, `.txt`, `.json`, `.jsonl`, `.xml`, `.har`, `.trace`, and compressed files) | Raw generated output of the same kind. |
| Raw research dumps (`docs/research/wifi-aware/raw/`, `docs/research/dtn/source-snapshot.json`) | Removed (14 files) | Raw device event logs, capability dumps and file-hash snapshots. The written research notes are unchanged. |
| Card art for the removed decks (`UX/cardGameGraphic/`) | Removed (4 files) | Design source art for the dirty and drinking decks. |
| Internal security reviews from the LOKA build (`security/*-REVIEW.md`) | Moved to `docs/archive/security-reviews/` (23 files, unchanged) | They are internal design reviews written during the build. The ones that name a reviewer name the AI coding agent, and none is an independent security audit. |
| Original instruction file for coding agents (`AGENTS.md`) | Moved to `docs/archive/LOKA-AGENTS-original.md`, unchanged | It steered coding agents toward LOKA's own roadmap. A neutral build guide replaces it. |
| Device-serial-shaped tokens in docs | Replaced with `[adb-serial-redacted]` (11 places) | Device identifiers. |
| Device identifiers in docs (UUID or 40-hex shaped) | Replaced with `[device-id-redacted]` (6 places) | Device identifiers. Values of the same shape that are protocol constants (Bluetooth service UUIDs), test fixtures or public citations are kept, each allowlisted by exact value. |
| Apple team id and app bundle id | Replaced with ours (6 team settings, 5 bundle id places) | So we can sign and ship TestFlight builds under our own Apple account. |
| Party-card catalog (`gameJson/games.json`) | Reduced to clean cards: 77 of 294 cards, 5 of 8 games | Cards tagged dirty or drinking, and the games named for drinking or explicit content, are not part of a payments project. Kept cards keep their ids and text. |

The scrub was checked with a pattern sweep (home-directory paths, device serial shapes, UUID and 40-hex identifiers, foreign Apple team ids, key and token shapes, phone numbers, MAC addresses, emails) and gitleaks. The sweep matches by pattern, never by literal value. Its few reviewed exceptions (a font license contact, fictional 555 test numbers, protocol test vectors) are listed in `tools/scrub/allowlist.tsv`, which ships with the pre-event kit. Each exception allows one exact value (recorded as its SHA-256 hash, never the value) in named files, so a new value in the same file still fails the sweep.

## Follow-up work during the event

The party-card loaders in both apps and two tests still expect the original card and game counts. Relaxing those count checks is event work and appears in the history after the tag.
