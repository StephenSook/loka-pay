# LOKA integrated research, connection quality and calling specification

2026-10-02. Updated against the supplied “Current limitations and required next steps” requirements. Status: Phase 1 open; implementation specification and experiment plan, not a claim of supported mesh or working calls. This combines the research and calling projects inside the existing native LOKA apps. It supplements AGENTS.md and the product architecture; it creates no separate application, identity system, backend or messaging protocol.

## One project and one evidence pipeline

```text
Existing Android / iOS LOKA
  → research: Knit, NASA DTN, MIT AirRAID, MIT Fluid Voice,
              NIST D2D, Apple APIs, Android APIs
  → compare with current code and public platform capabilities
  → bounded experiments in /experiments using existing app adapters
  → measure against the current implementation
  → integrate only demonstrated improvements into LOKA
       authenticated reconnection → physical relay → route recovery
               → durable forwarding / store-and-carry → platform experiments
               → negotiated transports → quality / efficiency → adaptive voice
```

The [cross-platform audit](CROSS-PLATFORM-MESH-AUDIT.md) is the implementation baseline; [validation](VALIDATION.md) is the evidence record. Earlier design documents describe aspirations where they conflict with that dated baseline. A paper, source implementation, simulator result and physical-phone result are distinct evidence classes.

For every proposed change, record: source/revision and idea; equivalent LOKA behavior; missing capability; public API and device restrictions; smallest experiment; baseline and candidate results; security/license impact; keep/adapt/reject/defer decision; integration files and rollback. An inconclusive result stays experimental. No parallel messenger or replacement architecture is justified by a research citation alone.

## Research feeds specific implementation decisions

Sources checked 2026-10-02. The final column is a LOKA proposal, not a finding claimed by the source.

| Research input | What the reviewed source supports | Existing equivalent / gap | LOKA experiment and decision |
| --- | --- | --- | --- |
| [Knit, pinned source review](KNIT-REVIEW.md) | Composite transports, bounded forwarding/reconciliation and separate media transfer provide implementation examples | Android combines Classic/BLE; relay queue is volatile; no Wi-Fi adapter or missing-ID reconciliation | EXP-011 B/C: adapt quotas, reconciliation and link observations if delivery/recovery improves without unacceptable overhead. No code import; review GPL obligations before any reuse |
| [NASA DTN overview](https://www.nasa.gov/reference/delay-disruption-tolerant-networking-overview/) | Delay/disruption-tolerant delivery across intermittent contacts | LOKA persists its own outgoing packets, but not durable relay custody | EXP-011 B: bounded ciphertext custody and restart-safe expiry. Retained-by-relay must never mean recipient-delivered. No requirement to adopt a space protocol stack |
| [MIT AirRAID, Peter S. Kruskall, 2010 thesis abstract](https://dspace.mit.edu/entities/publication/104fdafc-c15d-475f-8a3c-48a1d64637c7) | Proposes discovery improvements and redundant backup paths for mobile ad-hoc networking | Surviving-route flooding tests exist; autonomous alternate-route discovery does not | EXP-005 plus EXP-011 C: measure independent backup paths and recovery cost. Abstract reviewed; detailed algorithms still require full-paper review. Do not assume public phone APIs expose Bluetooth discovery/hopping controls |
| [MIT Fluid Voice project overview](https://www.media.mit.edu/projects/fluid-voice/overview/) | Real-time group participation with recorded, opportunistically delivered audio for disconnected participants | Short encrypted voice notes exist; no live stream, PTT or explicit transition between modes | EXP-011 D/E: user-controlled live-to-delayed voice transition. This is an interaction concept, not evidence of a modern codec, mesh handoff implementation or current mobile API compatibility |
| [NIST D2D research](https://www.nist.gov/programs-projects/network-modeling-public-safety-communications/device-device-d2d-communications) | Public-safety direct communication research in cellular D2D/sidelink contexts | No cellular sidelink adapter in LOKA | Borrow experiment discipline and reliability scenarios. Defer phone implementation unless an applicable public API and hardware capability are demonstrated; simulations do not establish ordinary iOS/Android access |
| [Apple Wi-Fi API overview](https://developer.apple.com/documentation/technotes/tn3111-ios-wifi-api-overview), [Wi-Fi Aware](https://developer.apple.com/documentation/wifiaware) | Platform-specific local connectivity options; exact hardware, OS and runtime eligibility must be checked | iOS currently has one BLE central link and no functional forwarding | EXP-006/010: prove compatible direct links, then simultaneous links and forwarding. Do not equate Apple peer-to-peer Wi-Fi with Android Wi-Fi Direct |
| [Android Wi-Fi Aware](https://developer.android.com/develop/connectivity/wifi/wifi-aware), [BLE background guidance](https://developer.android.com/develop/connectivity/bluetooth/ble/background) | Local peer connections depend on hardware/current availability; background behavior has lifecycle constraints | Android Classic/BLE providers and foreground service exist; Wi-Fi absent | EXP-006/004/010: test coexistence, link limits and lifecycle on actual phones. An OS capability is not proof of end-to-end mesh reliability |

## Current starting point

Preserve the existing Android `MeshNode` / `MeshEngine` / `LokaTransport` boundary and native UI. Adapt iOS `ChatStore` / `LokaMesh` / `BleLink` toward peer-tagged transport events before attempting multi-link forwarding. A common wire contract and test vectors remain shared; native radio implementations remain platform-specific.

Both apps have encrypted text, short voice notes, recipient-save receipts and bounded retry of their own pending packets. Android has relay logic; its physical multi-hop proof is pending. The current LOKA iOS implementation holds one selected BLE peripheral and does not forward third-party packets to a second peer. This is an implementation fact, not an iPhone connection limit or an endpoint-only platform classification. Useful simultaneous iPhone peers, relay behavior and background duration remain unproven and must be implemented and measured. Neither has a Network Quality Engine, destination route selection, negotiated streaming capability or live calling. An adjacent RSSI reading does not establish destination reachability or call quality.

Current voice notes remain 12 seconds / 32 KiB. The desired 60-second ceiling is a later media-transfer requirement, blocked on bounded transfer/negotiation tests; do not simply enlarge packet limits. Preserve v0 interoperability until a reviewed migration is specified. Existing experimental encryption is not a production security certification.

## Required components inside LOKA

| Component | Contract and behavior | Existing integration point |
| --- | --- | --- |
| Network Quality Engine | Consume timestamped observations; produce destination-specific confidence, freshness and supported workload. Distinguish link measurements from end-to-end measurements | Events from Android providers / MeshEngine and iOS transport / LokaMesh; expose presentation state to LabViewModel / ChatStore |
| Route Engine | Maintain bounded candidate routes, identity bindings, expiry and failure history. Choose by workload and evidence; reject loops, expired candidates and unsupported capabilities | Extend routing behind existing message submission; never ask the UI to choose radios |
| Store-and-forward | Durable ciphertext custody with byte/item/per-origin quotas, absolute expiry, deduplication, crash-safe updates and cleanup; bound reconciliation and control traffic | Add relay repository beneath MeshEngine and eventual iOS forwarding. Own history is not relay storage |
| Route handoff | Authenticate candidate endpoint, negotiate common capability, preserve logical message/session identity, deduplicate overlaps; make-before-break only when simultaneous links are proven | Local transport coordinator and route state machine |
| Backup routes | Prefer demonstrably independent paths, budget discovery/keepalive energy, invalidate stale paths and rate-limit switching | Route Engine; extend EXP-005 rather than inventing a second routing project |
| Adaptive voice | Reviewed call/session signaling and encryption, native audio, codec evaluation, jitter buffer, deadline-aware frames, bounded adaptation and congestion response | New media/session modules behind existing conversation action; do not stream by flooding durable chat packets |
| Push-to-talk | Explicit press/release audio capture, turn state, bounded segments and visible live versus queued delivery. Fall back to existing voice messages when no timely route exists | Same conversation and encrypted media pipeline; new negotiated feature, not a renamed voice-note button |

Quality observations should include direction, route generation, measurement age/count, receipt RTT, jitter, loss/timeouts, payload goodput, queue age/depth, reconnects, stability and power cost where measured. Missing values remain unknown. RTT is not one-way delay; a message-save ACK is not a media playout measurement. Bind samples to the actual route so a changed connection does not inherit an old green rating. Use monotonic local clocks and record clock uncertainty for cross-device timing.

First run quality scoring in diagnostics/shadow mode. Thresholds, smoothing, hysteresis, probe budgets and expiry must be versioned and calibrated from EXP-011, with deterministic clock-driven tests. Do not publish arbitrary “Excellent” thresholds or a global percentage. Call admission requires a fresh bidirectional destination assessment, authenticated common media capabilities and an available audio/session implementation. Strong RSSI alone cannot enable Call.

Durable messaging tolerates delay; live frames have short deadlines and must be dropped when too late. Bulk media and relay reconciliation must not starve control or live audio. A backup route cannot repair already missed audio deadlines. Repeated route changes must be bounded to avoid instability and battery drain.

## Shared user experience and state transitions

Pascal opens Mary's existing conversation and taps Call. LOKA checks eligible local routes and Mary accepts. Only after the real session is established may it say “Local call” and show measured quality:

| State | Meaning and user experience |
| --- | --- |
| Checking | Progress indicator while obtaining fresh destination evidence; cancel available |
| Excellent / Good | Green icon plus text; validated bidirectional voice budget met; no guarantee of future range |
| Weakening | Amber icon plus text; adapt codec/buffering within measured bounds and try an eligible alternate route |
| Reconnecting | Show interruption honestly; retain hang-up; bound retries and handoff time |
| Voice unavailable | “Connection is too weak for a call.” Offer Push-to-talk only if supported and usable; otherwise Send voice message / Send text |
| Queued voice | Clearly show Waiting / Unconfirmed / Delivered using existing recipient receipt semantics |
| Unknown / Off | Never reuse stale green. Distinguish insufficient measurement from explicit user Off |

Do not automatically record, retain or transmit a conversation as a voice message after a call fails. Ask the user to choose delayed voice; require explicit recording action and visible capture state. Both apps use equivalent wording, accessibility labels and icon/text cues, not color alone. Keep connection status near conversation controls and details in Settings; no required Network tab or routine radio-selection workflow.

Reconnect only within granted access and supported OS runtime; respect explicit Off. Background, locked, force-quit and cold-start cases are separate tests. Local notifications can announce locally received events, but do not manufacture a background route or wake guarantee. No cloud push or Internet fallback is part of the local-call proof. External Go/Gateway routes remain separately governed and labeled.

## Required implementation order — controlling sequence

This 18-phase sequence supersedes the earlier five-gate ordering and any conflicting older roadmap order. Work stays inside LOKA; do not implement all capabilities simultaneously. Phase 1 is the immediate task. Existing direct cross-platform regression tests continue throughout, but do not satisfy later physical topology gates. Existing experimental voice notes do not establish readiness for calling.

| Phase | Required work and acceptance evidence | Current status |
| --- | --- | --- |
| 1 — Identity, trust, reconnection | Persist cryptographic trust independently of radio handles; rediscover and cryptographically authenticate known peers; 100 normal disconnect/reconnect cycles with zero unnecessary approvals. Cover lifecycle, movement, radios, restart and transport change. | Open: message authentication exists; public BLE check is not peer authentication; 100-cycle gate unrun |
| 2 — Android multi-hop | Three physical Androids A → B → C; Internet/cellular off, A–C excluded, B forwards ciphertext without plaintext, C authenticates/decrypts and ACKs. Record discovery/setup, latency, hops, duplicates, retries, failures and battery. | Forwarding code/software evidence only; physical gate pending |
| 3 — Automatic recovery | Add D; remove B from A–B–C and automatically discover/use A–D–C. Measure recovery with D already connected and initially undiscovered separately. | Physical gate pending |
| 4 — Durable relay storage | B stores ciphertext while C is absent; restart B; later discover C, forward, decrypt and ACK. Enforce byte/item/origin quotas, expiry, deduplication and crash safety. | Relay persistence absent; sender outbox persistence is not this capability |
| 5 — Store-and-carry | A hands to B in location 1; B moves and later meets C in location 2. Prove no continuous end-to-end path ever existed. | Unimplemented/unmeasured |
| 6 — iPhone direct | Two physical iPhones; implement needed transport roles and test foreground, background, locked, movement and reconnect for 5 minutes, 30 minutes and 1 hour. | Current central-only LOKA adapter is insufficient for this same-platform test; platform capability unknown |
| 7 — iPhone multi-hop | Three physical iPhones, no Internet/cellular, A–C excluded. Test all foreground, relay background, relay locked, all locked, extended duration, movement and recovery independently. | Peer-tagged multi-link forwarding not implemented; no platform verdict |
| 8 — Mixed platforms | Prove Android ↔ iPhone, Android → Android → iPhone, iPhone → Android → iPhone, then Android → iPhone → Android. | Direct software/limited link-setup evidence; required physical delivery/lifecycle gates incomplete |
| 9 — Capability negotiation | Authenticated exchange of protocol versions, transports and features; select common capabilities and reject incompatible/downgraded claims. | Absent; requires reviewed versioning/security design |
| 10 — Multiple local transports | Implement/test eligible Wi-Fi Aware and Internet-independent LAN adapters; evaluate Wi-Fi Direct/high-bandwidth alternatives and BLE discovery/control/small-message roles. Measure eligibility, setup, throughput, range, power and background behavior. | Classic/BLE adapters only; Wi-Fi/LAN absent |
| 11 — BLE to Wi-Fi upgrade | Discover, authenticate, negotiate, establish eligible local Wi-Fi and preserve identity/conversation without reapproving the person. | Absent |
| 12 — Mixed-transport multi-hop | Same encrypted packet crosses different local transports; prove each hop and lifecycle on physical devices before production integration. | Unproven |
| 13 — Network Quality Engine | Measure latency, jitter, loss, throughput, retries, hops, route lifetime/changes, disconnects, transport and battery. Calibrate labels only after enough data. | Absent; isolated RSSI is not route quality |
| 14 — Efficient forwarding | Compare flooding, controlled flooding, targeted routing and limited replication/spray-and-wait using delivery %, transmissions/delivery, latency, battery, duplicates, storage and congestion. | Bounded flooding baseline; comparisons unrun |
| 15 — Background reliability | Full network on both platforms across foreground/background, lock, suspension, battery saver and movement; attribute failures precisely. Earlier phases still test their own lifecycle behavior. | Unproven; known LOKA locked-iPhone private-operation deferral |
| 16 — Scale | 3, 5, 10, 20+ devices; measure benefit versus congestion, broadcast storms and duplicate forwarding. | Unrun |
| 17 — Security attacks | Fake identity, replay/duplicates, tampering, withholding relay, packet/connection flooding, fake routes, revocation, key change and Sybil identities. Earlier security reviews/tests remain prerequisites, not deferred to this phase. | Partial software rejection tests; physical/system attack suite pending |
| 18 — Voice | Reliable text → store-and-forward → recovery → quality → voice notes → PTT → direct local call → cross-platform call → multi-hop/adaptive experiments. | Short experimental notes exist; PTT/live calls absent |

One Android and one iPhone suffice for direct interoperability testing, not same-platform relay or independent backup-route proof. Phase 2 needs three Androids; phase 3 four; phase 6 two iPhones; phase 7 three. Record unavailable hardware as a test prerequisite, never as an OS limitation.

Existing EXP-003/004/005/006/010/011 remain test procedures supporting this sequence. EXP-011 A–E are experiment identifiers, not permission to bypass these gates. Protocol/capability/security changes require explicit review and shared compatibility vectors before integration.

## Phase 1 implementation audit and acceptance protocol

Source audit of build 0.6.6 (14), 2026-10-02:

- QR/contact public-key trust persists separately from temporary transport handles. Destination processing verifies signed encrypted packets and only accepts trusted senders. Removing a radio connection does not itself remove a friend.
- Android `LocalLinkPolicy` automatically admits compatible unblocked BLE handles in consumer mode. This grants an untrusted ciphertext route, not identity trust. Manual engineering topology mode and Classic pairing are separate mechanisms.
- iOS `BleLink` rediscovers a current service candidate; its remembered peripheral UUID is only a hint. The six-byte public probe authenticates nobody. A fake advertiser answering that probe must never be described as a verified friend.
- **Missing:** a reviewed fresh peer-authentication exchange that binds the current session to a persisted cryptographic device identity, handles revocation/key change and prevents replay. Authenticated message receipts prove destination delivery but do not authenticate every immediate radio neighbor.
- Therefore automatic admission, a successful public probe, passing packet-signature tests and the absence of an Accept popup do not close Phase 1. Keep current untrusted transit semantics explicit until a reviewed authenticated-neighbor design is implemented; do not silently add a bespoke handshake or rewrite v0.
- iOS currently chooses WhenUnlocked private-key/history protection and defers private operations while locked. Record this as the current LOKA security/storage design, not evidence that iOS universally cannot receive, authenticate or relay in the background. A different protection policy needs a security decision and tests.

Next implementation decisions, in order: specify the authenticated reconnect threat model and interoperable reviewed session protocol; define persisted device identity/revocation state independently of radio identifiers; implement through transport-independent peer/session events; add shared Android/Swift vectors for replay, changed handles, changed keys and revoked peers; then execute the physical cycle gate. Do not mistake automatic link admission for completing those decisions.

Use [EXP-012](../experiments/EXP-012-authenticated-reconnection.md) for the 100-cycle protocol and ledger. A cycle passes only with fresh peer-authentication evidence, automatic recovery, a fresh encrypted message plus destination-save ACK, unchanged intended trust and no unnecessary approval. A real security-state change may require reverification and must be recorded separately. Connection to an unknown ciphertext relay does not import contact trust.

## Evidence, failure attribution and coverage rules

Mark capabilities **planned**, **implemented / software-tested**, **physical test failed**, or **physically supported for the recorded configuration**. Supported requires the matching physical acceptance test, exact models/OS/builds/roles, topology, offline controls, duration, measurements and evidence links. A successful configuration says nothing about untested lifecycle/device combinations.

Keep decisions, measured summaries and failures in this master specification, with raw metadata-only results in experiments and links to VALIDATION. Separate LOKA bug, documented OS restriction, device-specific behavior and transport limitation; use **unclassified** until evidence establishes cause. Do not log private content or secret keys. Notification arrival, relay custody, transport acceptance and authenticated destination delivery are distinct events. Only the last establishes Delivered.

Coverage has no fixed promised distance. Measure transport, hardware, obstacles/interference, peer density, lifecycle and relay availability. NASA-inspired DTN supports delayed contacts (A→B, later B→C, later C→D); it does not extend radio propagation. More coverage needs reachable intermediaries, carry opportunities or another supported transport. Keep byte/item limits, expiry, hop budget, duplicate controls and cleanup in every experiment. The current five-minute wire lifetime cannot be silently extended for a long store-and-carry trial: document whether the test fits it or requires a reviewed migration.

BLE, Wi-Fi Aware and LAN remain local adapters. Internet connectivity is a separate optional Go/Gateway route, never an implicit final step or dependency of the local transport manager. No backend health check or Internet validation may gate local delivery.

### Current physical evidence and open results

- Build 0.6.5: Samsung accepted the public BLE probe and acknowledged its reply without a new per-link approval in one observed run. This establishes link setup only, not authenticated-neighbor reconnection or a completed messaging cycle.
- Build 0.6.6: Android/iPhone builds and software receipt-recovery checks passed; both physical apps were installed. This is deployment evidence, not a passed physical delivery/background gate. See [VALIDATION](VALIDATION.md).
- Phase 1 qualifying cycles: **0 / 100 recorded**. Android/iPhone relay, independent route recovery, carry, concurrency, battery and range results: **not measured under these acceptance criteria**.

## Completion criteria

The eventual Pascal/Mary scenario is demonstrated inside the existing LOKA apps with Internet unavailable, recorded per-hop local transport evidence, verified destination identities, intelligible two-way audio, honest quality transitions, measured route recovery and explicit fallback when real-time audio fails. A result reports its exact devices, topology, build and lifecycle limitations. All untested combinations remain unsupported or experimental.

The immediate work is Phase 1 authenticated reconnection and its physical acceptance evidence. This specification update records requirements and source findings; it does not change runtime behavior or establish new hardware results. The user chooses the person; LOKA chooses the network.

## Phase 1 implementation increment — Android 0.6.7 (15)

Implemented the radio-off/on recovery repair identified during the Phase 1 audit. Previously Classic transport stopped and unregistered its radio receiver, and LabViewModel stopped the foreground service on transport loss. An enabled session could therefore miss the radio returning until the activity resumed. The service now owns the radio-state receiver, pauses all local adapters during loss, and resumes on actual STATE_ON without a new service launch or user approval. Explicit local Off remains authoritative. Its notification distinguishes Bluetooth off, listening and paused states. No iOS code change was needed for this Android-specific defect; iOS already observes central-manager power state, whose physical behavior remains unproven.

Evidence: Android core tests, APK assembly, instrumentation assembly and lint passed. Emulator-only TransportCompositionTest passed, including simulated adapter loss, retained trust/approval and enabled preference, restart with queued ciphertext replay, explicit Off rejecting a late resume, existing archive restoration and receipt recovery. This uses an injected transport; it does not test actual radio broadcasts or hardware reconnection. Physical Android was absent from adb during installation checks; APK prepared, physical install pending. No new qualifying EXP-012 physical cycle is claimed.

[Reconnect design review](../security/RECONNECT-DESIGN-REVIEW.md) records the separate authenticated-session gap and a standards-based TLS candidate. Current Android Keystore identities permit PKCS#1 v1.5 signatures, whereas TLS 1.3 RSA authentication uses PSS; existing identities cannot be silently replaced to resolve this. Session protocol/key binding and interoperability require further implementation and review. Phase 1 remains open.

## Phase 2 preparation — 2026-10-02

User explicitly requested Phase 2; Phase 1 remains open and is not retrospectively passed. Expanded EXP-003 into a three-physical-Android procedure with actual A–C reachability exclusion, 1/2/1 simultaneous link counts, 30 fresh texts per direction, authenticated return receipts, relay-off/no-shortcut controls, expiry and partition trials, privacy-safe evidence and battery measurements. Allowlist-only isolation is labeled a preliminary topology control, not physical range proof. Relay-restart diagnosis disconnects the sender first so source replay cannot masquerade as durable relay storage.

Added a production MeshNode/transport integration regression: A and C trust each other, B has zero trusted contacts; typed encrypted text and destination ACK cross B; B cannot decrypt either; a relay-generated false receipt is rejected; loss of B→A writes leaves delivery unconfirmed until retry succeeds; repeated packets create one logical fixture delivery; reverse traffic works; disabling B prevents fresh delivery; no A–C edge exists. Android core suite: 37 tests, 0 failures, 0 errors. This is injected-transport software evidence, not physical relay proof or full application-history testing.

Hardware check found one physical Samsung SM_S948U1 and emulator-5560. Installed the previously validated 0.6.7 (15) APK on Samsung without wiping data. Two additional physical Android phones are required to execute Phase 2. No three-phone trial, range/battery measurement or Phase 2 acceptance result is recorded. The iPhone and emulator do not count toward this hardware gate.

## Automatic Android BLE implementation — 0.6.8 (16)

User requested the next automatic-connection increment. Added BleClientTransport behind the existing LocalTransportProvider alongside the Android GATT peripheral and Classic adapter. Updated Androids publish an ephemeral eight-byte discovery token in scan-response service data; unsigned ordering elects one initiator. Compatible nearby Androids can attempt the existing subscription/public-probe/packet path without Classic pairing or a friend relationship at the relay. Manual experiment topology and blocked-link policy still apply. GATT session identity checks, bounded candidates/queues, setup/write deadlines, candidate cooldown and bounded scan-error recovery are implemented. Explicit stop invalidates scheduled recovery. No packet/crypto/contact-trust change; tokens are not identity proofs. See protocol/BLE-LINK-V1.md and security/LOCAL-LINK-ADMISSION-REVIEW.md.

Validation: 39 JVM core tests passed, including unsigned role-election symmetry and malformed/self-token rejection; Android APK, lint and instrumentation build passed; emulator-only TransportCompositionTest passed; actual Android-core/Swift packet interoperability, framing, contact QR and encrypted archive checks passed. These do not emulate the new native GATT callback lifecycle or prove Android central/peripheral concurrency. Physical first Samsung updated and verified at 0.6.8 (16), launched, and logged advertising. Second Android remains USB-unauthorized and could not be updated. Automatic Android↔Android route establishment, bidirectional delivery/ACK, reconnection, relay and battery results are pending. Both Androids must run 0.6.8 for token-based automatic discovery; existing iPhone packet compatibility is preserved.

This increment adds an automatically discovered transport path, not a measured best-route engine, Wi-Fi adapter, authenticated-neighbor session or completed Phase 1/2 gate. Up to four outgoing and four incoming BLE sessions are code caps only; useful concurrency requires physical tests. Existing bounded flooding may use multiple connected transports and does not rank them. Physical 100-cycle count remains unchanged.

## 2026-10-02 — two-Android automatic BLE setup observed

After the computer ADB service was restarted and the user accepted USB debugging on the second Samsung, installed 0.6.8 (16) there in place and verified its version. Both Android apps were opened normally. Scoped LokaBle diagnostics show the new Samsung (SM_S926U) reporting `BLE automatic outgoing route ready` at device-log time 21:59:06.633; the first Samsung (SM_S948U1) records valid subscription, allowed=true, accepted six-byte probe and reply indication acknowledgement/packet route ready around 21:59:06.749–.787. Device clocks are not calibrated; these are stage observations, not latency measurements.

No Classic pairing or LOKA per-link approval was requested by the operator for this setup. This is physical automatic Android BLE link-setup evidence only. No fresh application-message/recipient receipt, relay, reconnect-cycle, range, background or battery result was observed. USB authorization is computer debugging permission and is separate from peer connection approval. Both Androids now have 0.6.8; iPhone remains on its compatible 0.6.6 build.
