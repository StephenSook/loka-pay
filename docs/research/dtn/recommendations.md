# Recommendations and adoption gates

## Integrated implementation plan — 2026-10-05

Trace capture update 2026-10-05: both native development builds now capture bounded, process-scoped anonymous connected-peer observations in private cache. The [capture and replay guide](encounter-trace.md) explains collection, cold-history replay, privacy limits and outstanding topology/transfer instrumentation. This provides local encounter evidence, not a native multi-phone policy comparison; prediction routing remains disabled.

Prediction experiment update 2026-10-05: [paired synthetic assessment](../../../experiments/dtn-sim/results/prediction-2026-10-05-full/assessment.md) completed 48 cases (100 users, 30 offered minutes, three seeds, four scenarios and four policies). PRoPHET-style routing showed no consistent acceptable improvement over bounded spray; some cases improved delivery but increased traffic or reduced confirmation. Keep native history/prediction in shadow mode. Phase 3 adoption is not passed; captured native baseline, calibrated traces, privacy/poisoning work and energy measurements remain outstanding. Existing native v3 routing is not represented exactly by any of these simulator policies.

Persistence update 2026-10-05: phase-2 encounter records now restore from bounded authenticated encrypted storage on both platforms. Original estimate timestamps survive restart; active sessions requalify, future/expired records are omitted, malformed storage is preserved and never blocks ordinary messaging. Writes occur only when raw records change. The [scoped storage review](../../../security/ENCOUNTER-STORAGE-REVIEW.md) records retention, protection and outstanding privacy gates. This supersedes the memory-only implementation status below. Production prediction, transitive exchange and Internet gateways remain unimplemented.

Implementation update 2026-10-05: the first phase-2 slice adds native Kotlin/Swift `EncounterHistory` and hooks verified connected peer identities into shadow recording. It caps records at 64, requires five seconds of observed connection, counts one event per session, suppresses reconnects within 60 seconds, ages estimates and expires records after 24 hours. A gap over 30 seconds resets session qualification; clock reversal clears history. Estimates use the existing simplified experimental .75 update/.98-per-minute decay, not RFC-compliant PRoPHET. Only aggregate record counts enter development diagnostics. History is memory-only and restarts cold; no transitive summaries, durable encounter store, carrier selection, Internet gateways or new wire behavior are enabled. Phase 2 remains partial until protected persistence, privacy/identity lifecycle and shadow comparisons are implemented. These parameter choices need calibrated trace evidence.

This section is the current execution order; the older research proposal table below remains historical context. Build 0.6.44 includes immediate forwarding to a newly verified destination without waiting for another identity's retry timer. Native tests pass; overall post-update phone latency remains unmeasured, and the installed iPhone build last failed to launch because of a development signing/trust error. Controlled foreground non-friend Bluetooth relay was demonstrated in 0.6.43; screen-off, moving-carrier and force-quit behavior are separate qualification gates.

Implement one routing system inside LOKA with three inputs: current usable paths, bounded encounter predictions, and optional authorized Internet gateway paths. [Gateway requirements](../../INTERNET-GATEWAY-REQUIREMENTS.md) define external delivery and data consent. [PRoPHET research](prophet.md) and [encounter design](encounter-prediction.md) define prediction experiments. Neither gateway forwarding nor production PRoPHET is currently implemented.

```text
Encrypted message / receipt + immutable expiry
                    ↓
       Authorization and resource admission
                    ↓
       Unified route and carrier decision
         ├── usable direct/local relay path
         ├── authorized Internet gateway path
         └── predicted future carrier encounter
                    ↓
       bounded durable transfer scheduler
                    ↓
       local providers OR external adapter
                    ↓
       destination save + authenticated receipt
```

### Decision policy

Filter candidates before ranking: verified identity/capability, sender authority, supported protocol, expiry, remaining carrier/copy allowance, queue capacity, execution availability and data policy. A large predicted score never authorizes an otherwise forbidden transfer. Carrier selection does not require friendship with the carrier; a chat still requires the existing source/destination trust rules.

Keep three quantities separate: observed link throughput/reliability, destination encounter predictability, and verified external destination reachability. A strong Bluetooth signal is not evidence that a phone will meet the recipient. A phone having Internet is not evidence that it has permission or a route to deliver that message.

| Situation | Candidate decision |
| --- | --- |
| Recipient reachable on a usable local path | Prefer suitable local delivery; select transport using observed queue/transfer behavior |
| Local path absent or stalled; authorized remote path exists | Consider Internet gateway only within sender and volunteer policy/budgets |
| No complete current path | Rank eligible carriers using bounded encounter estimates, confidence and resource cost |
| Predictions cold, stale or contradictory | Fall back to a bounded no-prediction carrier policy; do not invent certainty |
| No eligible carrier/path | Retain ciphertext until a real opportunity or immutable expiry |

Avoid a universal signal score or uncalibrated weighted sum. Start with these explicit policy tiers, stall thresholds and switching hysteresis tested against the current baseline. Treat a predicted future gateway encounter as a prediction, not a currently usable remote route. Receipt return may follow different carriers from the payload.

### Phases, deliverables and gates

| Phase | Deliverable inside existing LOKA | Completion evidence |
| --- | --- | --- |
| 0 — Restore measurable baseline | Resolve iPhone launch; capture create/store/first-write/destination-save/receipt timestamps, queue load and transport for current builds; replay the actual packet backlog | Bidirectional direct and non-friend relay measurements; distinguish payload latency from receipt latency; preserve redacted results under `/experiments` |
| 1 — Reduce local congestion | Fair receipt/data scheduling, duplicate inventory and reviewed delivery cancellation; investigate negotiated larger BLE chunks; measure usable Wi-Fi fallback | Kotlin/Swift parity, old-peer fallback, queue/restart/ambiguous-write tests, fewer transmitted bytes with no lost receipts or media starvation; physical comparison |
| 2 — Record bounded encounters | A local `EncounterStore` and shadow `CarrierPredictor`, without changing who receives packets | Authenticated meaningful sessions counted once across radio aliases; expiry/restart/rotation tests; no scan-callback inflation or cloud contact-graph upload |
| 3 — Experiment with carrier predictions | PRoPHET-style aging/transitivity in `/experiments`, then gated native selection if evidence supports it | Held-out campus traces beat no-prediction baseline within byte, energy, latency and delivery constraints; cold-start and poisoned-advertisement cases pass |
| 4 — Specify and build optional gateways | Reviewed remote authority; directory/device enrollment; opaque mailboxes; opt-in budgets; Android prototype followed by Swift parity | Offline A → consenting B → remote recipient; then remote gateway → offline recipient; verified return receipt to offline source; local delivery works with server blocked |
| 5 — Combine gateway-aware prediction | Compare predicted destination encounters against opportunities to reach an authorized gateway; unified carrier/transport decisions | Mixed-campus simulations and phones show useful improvement over local-only and gateway-without-prediction baselines; no preference for unavailable/unauthorized Internet |
| 6 — Qualify and roll out | Versioned negotiation, compatibility fallback, feature flags, redacted diagnostics and staged campus pilot | Background/screen-off/low-power tests by platform; consent/budget deletion and revocation checks; pilot connection approval; no indefinite force-quit delivery promise |

Phases 2–3 do not need a backend. Phase 4 security/backend work can proceed independently after phase 0 establishes observability; integrating external routes must not conceal unresolved local failures. Phase 5 depends on both prediction and gateway authorization gates. Phase 1 cancellation and any replication changes require their own security/protocol review, rather than a local flag that bypasses existing v3 grants.

### PRoPHET integration contract

[RFC 6693](https://www.rfc-editor.org/rfc/rfc6693.html) describes encounter history, aging and transitivity for intermittently connected networks. The existing simulation is simplified and must remain labeled PRoPHET-style rather than RFC-compliant. Gateway reachability and Internet budgets are LOKA extensions, not claims of RFC functionality.

- `EncounterStore`: locally protected bounded records for authenticated peer binding, meaningful encounter time, duration, useful bytes and completed/failed transfers. Start with a 64-entry experimental bound; compare 16/64/256. Define elapsed-time decay, record expiry and identity rotation before adopting parameters.
- `CarrierPredictor`: destination-oriented estimate and confidence, separate from observed radio quality. Repeated advertisements, several transports to one phone, and reconnect loops must not produce independent encounters. Decay estimates when no new meaningful encounter occurs.
- Transitive prediction: local-only shadow estimates can start without peer table exchange. Actual transitive exchange requires a negotiated schema, bounded authenticated summaries, identity/privacy review and poisoning tests. Do not publish entire friend/contact lists or destination tables in nearby advertisements.
- `GatewayDirectory` / `GatewayPolicy`: current destination-authorized remote lease, service reachability, sharing consent and remaining budgets. Keep historical access to a gateway separate from current authorization to use it.
- `RouteDecision`: chosen next-hop identity/provider, reason, confidence, expected cost and next retry opportunity. Emit redacted diagnostics; ordinary users choose a person, not PRoPHET or a radio.
- `TransferJournal`: preserve durable admission, stable IDs, expiry, copy allowance and receipt obligation across route changes and restart. Receiving a packet does not grant unlimited redistribution.

The current v3 chain permits a bounded designated next carrier; it does not implement binary spray to many carriers. First use prediction to select that legal next carrier. Only introduce multiple simultaneous replicas through a separately reviewed, durable copy-budget protocol. Do not replace established carrier grants or TTL validation merely to match a predictor's preference.

### Combined experiments and adoption thresholds

Compare the same traffic/contact traces and random seeds across: current native routing replay, bounded no-prediction carry, bounded spray experimental baseline, PRoPHET-style local routing, gateway routing without prediction, and the combined policy. Toggle one mechanism at a time before the combined test. Calibrate on past traces and evaluate on held-out traces; never use future encounters to choose a carrier.

Required cases: regular campus movement; isolated partitions; all Internet absent; one gateway with no destination route; remote recipient online; offline recipient behind another gateway; gateway departures; exhausted data/storage; failed and malicious carriers; rapid identity churn; force-quit separately from supported background; ACK loss and duplicate paths. Include 100 users sending one text/minute for 30 minutes plus a synchronized burst, using the gateway specification's quotas. Model old/new clients and a receipt that returns after the source loses Internet.

Report delivery before expiry, p50/p95 payload and receipt latency, goodput, bytes per delivered message, duplicate ratio, energy, queue fairness, prediction control overhead and privacy exposure. Proposed initial prediction adoption target: at least 10% relative reduction in p95 delivery latency OR 5 percentage points higher delivery-before-expiry, with no more than 10% additional bytes/energy and no material receipt/fairness regression. Define “material” numerically before each experiment; use repeated runs and uncertainty intervals. These are proposed engineering targets, not achieved results. A failed target keeps prediction in shadow mode.

libp2p remains an optional phase-4/5 external-adapter experiment, evaluated against the simple remote delivery baseline. Its live circuit relay is not a durable mailbox or replacement for local store-carry-forward. See the gateway specification's [source and decision section](../../INTERNET-GATEWAY-REQUIREMENTS.md#libp2p-decision-and-sources).

### Immediate next work

Start phase 0: restore the iPhone launch and record a small, controlled latency/backlog baseline. Then implement phase 1's most expensive measured bottleneck and phase 2's local shadow encounter recorder. Keep Internet gateway and prediction additions feature-gated until their individual security, native and physical gates pass. This plan update changes documentation only; it does not activate those features on phones.

Update 2026-10-04: build **0.6.38 (46)** adds [bounded carrier-to-carrier v3](../../../protocol/PACKET-V3-CARRIER-CHAIN.md) on Android and iOS. New messages between known v3 endpoints can be retained and handed onward through up to three carriers, with durable signed grants and encrypted return receipts. Existing backlog-aware local transport selection applies at every hop. Kotlin/Swift native chain tests pass; this does **not** establish physical range, background reliability or measured fastest routing. The historical findings below predate this update.

Update 2026-10-03: the user requested automatic routing in ordinary chats instead of
a manual carry experiment. Build 0.6.33 implements [automatic single-carrier v2](../../../protocol/PACKET-V2-AUTOMATIC-CARRY.md)
with delayed source authorization, encrypted persistence and capability-gated writes.
The original research/gates below are retained as context. Native evidence is recorded
in the physical-status document; physical/background qualification remains outstanding.


**No combination can yet be called the best on real Android/iPhone devices.**
The current evidence supports a staged candidate: durable encrypted storage with
immutable sender expiry, bounded replication, destination/control-aware fair
scheduling, compact reconciliation and a transport-independent admission/drain API.
Encounter prediction and adaptive budgets come later if they beat bounded baselines
on calibrated traces and phones. Background execution remains platform-dependent.

## Smallest next production-oriented changes

| Order | Proposal / disposition | Source rationale | Experiment / measurement | Adoption gate |
|---|---|---|---|---|
| 1 | Add redacted packet lifecycle counters; ADAPT | [NASA separation](nasa-dtn.md) | [Audit](current-architecture.md) shows no complete per-hop/ACK diagnostic chain; phone latency currently unmeasured | Trace an actual A→B→C failure without plaintext/identity leakage |
| 2 | Durable bounded foreign-ciphertext journal; ADAPT | [NASA](nasa-dtn.md), [IETF](ietf-bundle-protocol.md) | [Carry ablation](simulation-results.md): volatile carrier loses its only onward copy on restart | Android/Swift crash injection, byte quotas, file-protection/security review, no false custody promise |
| 3 | Versioned sender-authorized carry lifetime; ADAPT | [Lifetime research](ttl-lifetime.md) | Same ablation: 300-second policy cannot deliver at 600 seconds or later | Cross-platform vectors, old-peer behavior, clock/replay limits; no silent v0 extension |
| 4 | Bounded fair ACK/destination scheduling; EXPERIMENT | [RAPID](rapid.md) | [Single-variable paired comparison](simulation-results.md), including negative cases | Native callback/queue tests plus no media starvation under phone load |
| 5 | Inventory before redundant payload transfer; EXPERIMENT | [Epidemic](epidemic-routing.md) | Matrix reports control bytes and duplicate transmission ratio | Encoded overhead + privacy review + false-positive reconciliation tests |
| 6 | Binary spray budget before adaptive routing; EXPERIMENT | [Spray-and-Wait](spray-and-wait.md) | Token-conservation tests and finite-copy matrix | Budget sensitivity, durable transfer transactions, simultaneous-radio and malicious-peer tests |
| 7 | Bounded local prediction; FUTURE experiment | [PRoPHET](prophet.md), [MIT](mit-opportunistic-networking.md) | Only simplified 64-entry synthetic baseline so far | Held-out real contact traces, overhead and metadata benefit/cost justification |

Orders 2 and 3 are complementary; neither alone establishes long carry. They must
remain behind an experimental feature/version gate until compatible native tests
and the first physical relay test pass. Do not deploy a permanent 24-hour default
on the strength of a constructed 24-hour simulated encounter.

The [native prototype plan](native-prototype-plan.md) defines admission, restart,
replica transaction and receipt-persistence cases for that next experiment.

Longer lifetimes must remain restricted to isolated testing until byte quotas and
network copy budgets are enforced. In the model, controlled flooding reached 9964
stored copies of one packet, while four-token spray stayed at four. A hop limit
alone does not bound fanout. Extending today's TTL without controlling replication
would amplify resource exposure; these numbers are model evidence, not phone counts.

## Decisions not supported

- REJECT indefinite flooding, lifetime renewal at every hop and transport-write-as-delivery.
- REJECT treating Wi-Fi Aware availability as proof of Android/Apple pairing or mesh routing.
- REJECT a universal “best signal” radio rule: measure useful throughput, stability,
  queue drain and energy with fallback hysteresis. [Android](google-nearby-aware.md), [Apple](apple-wifi-aware.md).
- REJECT promising continuous offline iPhone relay after force-quit or removal of
  locked-data protections without review.
- FUTURE relay-readable authenticated tombstones and cancellation. These need a
  reviewed privacy/authentication design; current encrypted destination ACKs remain authoritative.
- FUTURE Moments/video distribution, full RAPID and privacy-preserving prediction;
  they do not precede proving basic physical relay and restart-safe carriage.

## What this research change delivers

Audit and source assessments, an isolated reproducible six-baseline contact model,
one scheduling variation, lifetime/restart counterexamples, admission stress and
recorded raw outputs. It changes no phone executable, protocol or cryptography.
It does **not** finish all requested research: realistic mobility calibration,
full failure/load sweeps, adaptive/eviction/inventory experiments, native persistent
prototype, security review and [physical qualification](physical-test-results.md)
remain necessary. The simulator's [explicit limitations](../../../experiments/dtn-sim/README.md)
are part of the evidence, not optional footnotes.

An exact current-LOKA baseline also remains pending: the structural `loka_v0` model
does not replay native fragmentation, retries or radio callbacks. Capture and replay
those events before treating simulated differences as app-level performance gains.
