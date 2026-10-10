# LOKA Pay

**Phones in airplane mode pay each other. The payment crosses nearby phones that cannot read or change it, and settles on Solana's public test network the moment any one of them finds signal.**

Sandbox tokens only: devnet USDC has no value. Moving real dollars would require a licensed partner. We do not have one yet.

<!-- TODO(4.3): final first screen. Every number on this page comes from docs/FACTS.json. Delete each TODO line once its link answers. -->

## Try it (no login anywhere)

| What | Where | Status |
|---|---|---|
| Judge guide: a 3-minute itinerary | https://zerobars.us/judge | TODO(3.2): live after deploy |
| Live ledger with explorer links | https://zerobars.us/live | TODO(2.19) |
| Verify a signed receipt | https://zerobars.us/verify | TODO(3.2) |
| Web lab: pay with your own passkey | https://zerobars.us/lab | TODO(3.10, 3.23), T2 |
| Proof page: claims table, reserves, measured numbers | https://zerobars.us/proof | TODO(3.24), T2 |
| Settlement API | https://api.zerobars.us | TODO(0.6) |
| iPhone app (TestFlight) | TODO(4.7): public link + QR | In Apple beta review (TODO: update to the real state) |
| Android relay APK (relay only, clean catalog) | GitHub Releases | TODO(3.8), T2 |
| Demo video (2 to 3 minutes, public) | TODO(3.7): YouTube link | TODO |

Check the headline numbers yourself; this endpoint recomputes them on every request:

```sh
curl -s https://api.zerobars.us/api/stats
```

<!-- TODO(2.10): paste one real response here and name each field. -->

## What happens in the demo

1. A judge picks an amount and pays with both phones in airplane mode. The payer confirms with Face ID: the key only signs for its owner.
2. The merchant phone shows "Received, pending (sandbox)" with no internet, then turns cellular on and settles. "Paid (sandbox)" appears with a Solana explorer link the judge can open.
3. The judge presses "Try to cheat": the same allowance and serial are signed again for a second merchant, and the chain refuses it ("Failed (already spent)").

<!-- TODO(4.3): add only the T2 beats that shipped (money into airplane mode, passkey payment, Android hardware key, proof of reserves). -->

## How it works

- **The allowance** is locked in an on-chain vault before anyone goes offline, so the payer can never settle more than its cap.
- **The note** is a fixed 141-byte structure signed by a P-256 key in the iPhone's Secure Enclave, behind Face ID or the device passcode. Spec: `protocol/PAYMENT-V1.md` (TODO(1.2)).
- **Settlement:** Solana's secp256r1 precompile verifies the phone's signature on-chain, so neither a relaying phone nor our server can forge or redirect a payment. The program checks the serial, cap, expiry and earmark, then credits the merchant.
- **Offline risk is bounded and visible:** a merchant who accepts offline carries a limited, attributable risk, capped by the allowance's offline limit. A reused serial fails on-chain.
- **Architecture diagram:** TODO(3.11).

Trust assumptions and the threat model, in plain words: https://zerobars.us/trust (TODO(3.2)).

## Built before Hacklanta (disclosure)

Hacklanta asks for a disclosure of anything created before the event. Here is all of it.

1. **The LOKA foundation.** LOKA v0.6.66 is an offline, end-to-end encrypted Bluetooth mesh messenger for iPhone and Android, built Oct 2 to Oct 6 2026 by the LOKA founders (our teammate Khadim is one of them), Apache-2.0. It was imported at the start of hacking as exactly one commit, tagged `pre-hacklanta-foundation`. What the public copy removed or replaced (raw device logs, device identifiers, the founders' Apple team id, adult party-card decks) is listed by category in `docs/IMPORT-SCRUB.md`. LOKA's own README is `LOKA-README.md`.
2. **The pre-event kit**, committed unchanged right after the import and tagged `pre-hacklanta-kit`: this README skeleton, `PLAN.md`, the four task files, `AGENTS.md`, `CLAUDE.md`, `.gitignore`, `.env.example` (names only), the keys of `docs/FACTS.json` (no values, except one sourced public figure: the FCC's Hurricane Helene cell-site outage percentage), six CI workflow drafts, `tools/hygiene/prose_gate.py`, and the scrub tool in `tools/scrub/`.
3. **Planning documents kept outside this repo:** two short payments idea docs written by Khadim, a private build plan with team notes, and a voice-quality check of ElevenLabs Wolof whose clips were discarded.

Everything else was designed, built and integrated during hacking (Fri Oct 9 8:30 PM to Sun Oct 11 9:00 AM ET). Check it yourself:

```sh
git log --oneline pre-hacklanta-kit..HEAD                    # every commit made during hacking
git diff --stat pre-hacklanta-kit HEAD                       # everything built during hacking
git diff --stat pre-hacklanta-foundation pre-hacklanta-kit   # the pre-event kit
```

<!-- TODO(4.3): paste the final diff --stat summary line and the commit count from docs/FACTS.json. -->

**Built during the event:** the payment protocol, the Solana program, the settlement server, the website, the iOS payment screens, the CI. <!-- TODO(4.3): list only what shipped. -->

## AI tools we used

Claude Code, Codex and Grok helped write and review code. <!-- TODO(4.3): add Greptile if it reviewed our pull requests. --> Their output was checked by the protocol spec and test vectors, tests in CI, adversarial reviews of every money path, and live runs on our own phones.

## Build and run

Toolchain and commands for every part are in `AGENTS.md`.

| Part | Folder | Quick check |
|---|---|---|
| iPhone app (LOKA + payment screens) | `ios/` | TODO(1.1b): `swift test --package-path ios/LokaPay`, then open `ios/LOKA.xcodeproj` |
| Android relay | `android/loka-mesh-lab/` | `./gradlew :core:test :app:assembleDebug` |
| Solana program | `programs/` | TODO(1.4): `anchor test` |
| Settlement server | `server/` | TODO(1.9): `pnpm test` |
| Website | `web/` | `pnpm install --frozen-lockfile && pnpm build` (more in `web/README.md`) |

## Tests named in the demo

- `server/test/replay.test.ts`: the same note through two gateways redeems once. TODO(2.5)
- `programs/loka_vault/tests/redeem.ts`: a reused serial, a high-S signature, a wrong message, the wrong mint and a substituted merchant record are each refused. TODO(1.4)

## Team

Stephen (frontend + iOS), Jordan (backend), Pravin (backend + Solana program), Khadim (product + business; LOKA co-founder). Hacklanta '26, Fintech track.

## License

Apache-2.0, see `LICENSE`. The LOKA foundation is by the LOKA founders.
