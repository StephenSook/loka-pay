# EXP-011 — quality, durable routes and adaptive voice in LOKA

2026-10-02. Status: planned, not executed. Implements the gates in the [integrated master specification](../docs/LOCAL-CALLING-MASTER-SPEC.md). Use existing native apps and transport seams, with experiment fixtures under `/experiments` and native adapters behind experimental flags. No separate user-facing application.

## Common controls

Reuse [EXP-010](EXP-010-cross-platform-audit.md) topologies, offline controls and lifecycle variants, and [RESULT-TEMPLATE](RESULT-TEMPLATE.md). Record build, exact devices/OS, permissions, radio roles, topology, distances, clock uncertainty, manual actions and charging/debugger conditions. Preserve local radios while removing Internet uplinks. An isolated router-based LAN is a labeled control, not phone-only mesh proof.

Compare unchanged baseline with one candidate change under the same workload. Alternate run order and run at least three repeats per condition. Report counts, median/p95, uncertainty and failures. Establish workload-specific latency, loss, recovery and power budgets after baseline measurement and before candidate runs; do not choose thresholds retrospectively. Log application metadata only, never private messages, keys or address books. Software results cannot establish physical capability.

## A — destination quality

Hypothesis: fresh destination observations predict usable workloads better than adjacent RSSI.

Start with telemetry and deterministic clock-driven fixtures for stale observations, asymmetric links, delayed ACKs, loss, queue pressure, reconnects and reordered events. Separate radio state, link state, recipient receipts and media playout measurements. Invalidate observations on route-generation changes and expiry. Missing RSSI must remain unknown. RTT is not one-way delay.

Reuse EXP-010's 30 texts and ten short voice notes per direction/condition. Record destination success, ACK RTT, queue age, bytes, retries and churn. Add bounded authenticated probes only through reviewed capability/version changes. Compare predicted capability with subsequent observed delivery on held-out runs, including false-good and false-unavailable rates.

Gate: deterministic freshness/lifecycle checks pass and prediction improves over the RSSI-only control within predeclared probe/power budgets. Keep scoring in diagnostics until calibrated; streaming quality labels additionally require D.

## B — durable custody and reconciliation

Hypothesis from DTN/Knit: bounded durable relay custody improves delivery across restart and brief contacts.

Compare the volatile relay baseline with a ciphertext repository. Restart before write, after durable commit and during forwarding; restart endpoints separately. Test full disk, per-origin/global byte and item quotas, duplicates, malformed records, expiry, clock changes, key unavailability and cleanup in isolated fixtures. Relays must not need destination plaintext. Any custody receipt is distinct from recipient delivery and requires protocol/security review.

Compare missing-ID reconciliation with bounded replay under short contacts. Measure unique delivery, recovery delay, payload/control bytes, storage peak, evictions and power.

Gate: no expired resurrection or duplicate conversation items, bounded resources, correct receipt semantics, and improved restart/partition delivery within agreed budgets. Security review precedes integration.

## C — backup paths and handoff

Hypothesis from AirRAID/Knit: fresh alternate paths reduce interruption enough to justify maintenance cost.

Extend [EXP-005](EXP-005-alternate-route.md): A–B–C and A–D–C, with A–C excluded. Compare current flooding and candidate policy. Test D preconnected and D initially undiscovered separately. Remove B, weaken links, flap availability and restore B. Start with Android controls, then supported mixed topologies from EXP-010.

Distinguish changing radio to the same neighbor from replacing a relay path. Prove simultaneous links before make-before-break. Measure discovery/setup, destination interruption, duplicates, switching frequency, queue growth, control traffic and power. Count manual reconnection separately.

Gate: automatic destination recovery within predeclared budgets; preserved identity/deduplication; bounded switching and replication; explicit failure without a route. Reject stale/unauthenticated candidates. iPhone relay tests remain blocked until peer-tagged multi-link forwarding exists and passes tests.

## D — direct encrypted voice

Hypothesis: a proven local transport can sustain a negotiated bidirectional audio profile.

Prerequisites: direct-delivery baseline, reviewed authenticated capability/session/encryption design, and verified public API/device support through EXP-006. Evaluate codecs including Opus with native audio, echo handling, interruptions, speaker/headset routes, microphone permissions and teardown. Bound buffers; drop expired live frames instead of placing them in durable chat queues.

Run three five-minute sessions per direction/device condition with consenting testers and non-sensitive speech. Record setup success/time, RTT, one-way audio delay with measurement uncertainty, jitter, loss, late drops, goodput, buffer depth, audible gaps and power/temperature. Include asymmetric loss, congestion, route failure, permission denial, unsupported versions, screen lock/background and OS interruption. Network RTT and microphone-to-speaker delay are separate measurements.

Gate: intelligible two-way encrypted audio within the predeclared conversational delay/loss/power budgets; correct teardown and honest failure states. Foreground/direct success cannot enable multi-hop/background claims.

## E — adaptive voice and explicit fallback

Hypothesis from Fluid Voice and route experiments: bounded adaptation plus explicit delayed voice preserves useful communication during mobility.

Compare fixed and adaptive audio settings. Pascal calls Mary in the existing conversation; walk out of range, remove the primary relay, try a verified alternate route, then remove all timely routes. Measure false-green time, audible gaps, adaptation/switching frequency, recovery, task completion and power. Repeat deterioration/recovery to expose oscillation.

Show Reconnecting and then Voice unavailable when budgets fail. Offer negotiated PTT only when usable, otherwise existing voice messages/text. Never silently record a failed call; the user explicitly starts recording. Test PTT simultaneous presses, turn timeout, cancellation, disconnect mid-segment, expiry and duplicates. Clearly distinguish live from queued audio.

A 60-second voice-note experiment requires negotiated bounded media transfer; current 12-second / 32-KiB limits remain until that passes. Gate: fewer gaps or better task completion than fixed audio within resource budgets, with no false delivered states, silent recording or indefinite retries. Both platforms present equivalent states; each unsupported lifecycle/topology gets a separate decision.

## Promotion record

For each A–E result record: source idea, equivalent existing code, candidate files/version, raw baseline/candidate metadata, budgets fixed before comparison, observed benefit/regression, security review where required, and keep/adapt/reject/defer decision. Update master specification, validation and capability documentation together. Rollback disables the candidate while preserving existing interoperability and queued user data. All physical results remain unmeasured in this plan.
