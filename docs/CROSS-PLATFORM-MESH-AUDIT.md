# LOKA cross-platform mesh architecture audit

2026-10-02. Scope: repository implementation through 0.6.1 plus the 0.6.2 composer-only changes. This is a source/software audit, not an independent cryptographic assessment or a completed hardware trial. No networking rewrite or GPL code import was performed. Preserve working components; extend only where evidence identifies a gap.

## A. Current architecture and a real message trace

Android is Kotlin/Compose, with application-owned LabViewModel → MeshNode → MeshEngine → injected LokaTransport. LocalTransportProvider combines Classic RFCOMM and BLE GATT peripheral links, dispatching by opaque peer handle. iOS is SwiftUI/ChatStore → LokaMesh → send-frame closure → BleLink, a single Core Bluetooth central connection. Core wire/crypto code is separate from UI on both. Backend/infrastructure directories are documentation stubs, not fallback delivery services.

1. **Send:** `LabViewModel.submit/queueMessage` or `ChatStore.send` checks trusted recipient and size, suppresses concurrent submissions, creates a logical UUID and saves a history row. Text becomes `L1|T`; a voice note becomes bounded `L1|V` fragments. Recorded audio uses a temporary app-private file before encrypted persistence/transmission; it is not encrypted continuously while the microphone writes it.
2. **Encrypt:** each fragment/text is wrapped in a fresh packet UUID using AES-256-GCM and a random key/nonce. RSA-3072 OAEP wraps that key; SHA-256/RSA signs immutable headers plus ciphertext. Android JCA and native Swift/CryptoKit/Security interoperate. The custom Swift OAEP encoding matches Android's SHA-256/MGF1-SHA1 parameters; tests are compatibility evidence, not independent security approval.
3. **Queue:** the engine retains bounded ciphertext. Own packets are snapshotted on Android into an atomic no-backup file; iOS includes them in its encrypted archive. History and queue creation are not one atomic durable transaction. Crash/storage failure mid-submit can leave an incomplete logical send; do not claim exactly-once delivery.
4. **Discover/connect:** discovery is an independent process, not a new route search triggered by every Send. Android lists/discovers Classic peers and advertises a LOKA BLE service. iPhone scans that service, connects to a selected peripheral and subscribes. Explicit Android link approval and reciprocal QR trust remain separate. A public probe gates iPhone writes; it is not identity authentication.
5. **Select/transmit:** Android floods via all connected allowed handles. The manager chooses Classic or BLE for each handle. There is no best-route scoring or recipient-to-link binding. iPhone sends on its one checked link. Packet bytes are radio-independent: length framing on Classic, small fragments/indications/writes on BLE.
6. **Relay:** Android verifies syntax/time/signature, suppresses seen IDs, decrements the hop budget and floods to neighbors other than ingress. It retains ciphertext in memory for later neighbors, within original expiry. iPhone may retain a non-destination packet, but marks it incoming and never retransmits it: a relay-looking class is not an operational iPhone relay.
7. **Receive:** the destination additionally requires a trusted sender, decrypts, parses typed content, and reassembles voice by sender/logical ID with caps and expiry. Duplicate complete logical messages do not create new bubbles.
8. **Save/ACK:** only after saving the complete message, the destination sends encrypted `L1|A` for its logical UUID. The sender accepts it only from the intended authenticated recipient. Relays do not produce delivery ticks. ACKs use the same packet path; origin ACK packets are discarded after attempted transmission. Duplicate data can elicit a fresh, throttled ACK.
9. **Retry/expiry:** maintenance retries at most four eligible packets per turn, at least 15 seconds between attempts; link-up also replays retained data. Original lifetime is five minutes. Delivered cancels matching own pending IDs; expired/unacknowledged means **Not confirmed**, not proof of nondelivery. Relay copies may remain until expiry. No read receipt, path percentage or authenticated hop progress exists.

Evidence: [Android core](../android/loka-mesh-lab/core/src/main/kotlin/org/loka/core/), [LabViewModel](../android/loka-mesh-lab/app/src/main/java/org/loka/meshlab/LabViewModel.kt), [ChatStore](../ios/Features/ChatStore.swift), [LokaMesh](../ios/Core/LokaMesh.swift), [packet](../protocol/packet-v0.md), [chat content](../protocol/CHAT-CONTENT-V1.md).

## B. Implementation matrix

Implemented means source and executable software evidence, never an implied physical pass. Partial identifies a material platform, durability or verification gap.

| Capability | Implemented | Partial | Missing | Evidence | Problems |
| --- | --- | --- | --- | --- | --- |
| BLE discovery | | Yes | | BleTransport/BleLink | Android advertises, iPhone scans; no symmetric roles |
| BLE transport | | Yes | | BLE-LINK-V1; framing tests | GATT small chunks; physical throughput/reliability unmeasured |
| Wi-Fi Aware | | | Yes | No adapter/entitlement | Hardware, pairing and cross-platform gates |
| Wi-Fi Direct | | | Yes | No provider | Apple lacks equivalent generic Android P2P API |
| Local LAN | | | Yes | No socket adapter | Permission/service binding needed |
| Peer authentication | | Yes | | ContactCode, trust checks | QR authenticates manually; radio handle/probe is not bound to identity |
| Encryption | | Yes | | LabCrypto/LokaProtocol, interop suite | Experimental envelope; no forward secrecy/ratchet |
| Message IDs | Yes | | | Packet UUID plus typed logical UUID | No transactional send dedup across process death |
| Duplicate detection | | Yes | | seen map + logical history | Replay state volatile; history retention finite |
| TTL/hop limits | Yes | | | 5-minute lifetime, remaining budget 6 | Hop field mutable/unsigned; malicious resetting possible |
| Multi-hop relay | | Yes | | MeshEngine tests | Android only; physical gate unpassed |
| Flood routing | Yes | | | MeshEngine.receive/tick | No jitter, congestion control or density proof |
| Targeted routing | | | Yes | No route table/discovery | Recipient field is not a route table |
| Store-and-forward | | Yes | | pending/linkUp tests | Relay memory only; five-minute experimental horizon |
| Delivery ACK | Yes | | | ChatContent + app receipt checks | Receipt loss leaves uncertainty; no human read proof |
| Retry | Yes | | | paced exact-packet retries | Backpressure/fairness under sustained media unmeasured |
| Route recovery | | Yes | | surviving-route software test; iPhone reconnect | No autonomous Android alternate-path discovery |
| Persistent queue | | Yes | | own outbox; restart tests | Relay/replay state volatile; submission crash windows |
| Protocol versioning | | Yes | | outer v0, typed L1 | Rejects unknown packet versions; no migration negotiation |
| Capability negotiation | | | Yes | local capabilities only | UI limits describe this build, not remote support |
| Android background | | Yes | | connectedDevice service observed | START_NOT_STICKY; process death loses allowlists; OEM/Doze unproven |
| iOS background | | Yes | | bluetooth-central restoration/reconnect | Suspension/force-quit; private operations require unlock |
| Android ↔ iPhone | | Yes | | actual Java/Swift crypto tests; physical public probe | Physical encrypted receipt/playback still unconfirmed |
| Internet transport | | | Yes | no external adapter | No arbitrary remote delivery |
| Backend fallback | | | Yes | backend README only | No directory/push/fallback server |

Additional contact capabilities: optional local phone-name lookup with permission and exact country-coded number; QR and shareable custom-scheme links implemented. Names/numbers do not establish trust. LOKA Number registration, private directory matching, verified nearby known users, account invitations and family/community membership are missing. Nearby UI hides radio identities; on-air stable key fingerprints remain linkable.

## C. Knit lessons and boundaries

The [pinned Knit source review](KNIT-REVIEW.md) covers commit `ee0ee85b56dfe99c52f3ad476acbcf187a1ac53c`, including CompositeMeshTransport, MeshRouter, ForwardSync, ForwardRepository, BlePresenceTracker and MeshService. Jitter/suppression, bounded custody, missing-ID reconciliation and separate media transfer are useful adaptations; native source alone does not prove LOKA hardware success. Knit uses BLE L2CAP and Wi-Fi Aware, unlike our current GATT path. Its documented direct/group encryption and ratchets must not be transplanted into v0 without protocol migration and independent review.

Additional findings: its [changelog](https://github.com/getknit/knit/blob/ee0ee85b56dfe99c52f3ad476acbcf187a1ac53c/CHANGELOG.md) reports reconnect/discoverability and secure-storage recovery fixes. These justify failure-injection and radio-coexistence tests, not assumptions of perfect background operation. Its [roadmap](https://github.com/getknit/knit/blob/ee0ee85b56dfe99c52f3ad476acbcf187a1ac53c/.agents/memory/roadmap.md) distinguishes implemented policies from pending device trials. The public [voice/video-call feature request #24](https://github.com/getknit/knit/issues/24) was open at review time. Issue status can lag code; no live-call stack was established in this scoped review.

Knit documents Wi-Fi Direct bulk transfer separately from mesh attachments. Its [spool design](https://github.com/getknit/knit/blob/ee0ee85b56dfe99c52f3ad476acbcf187a1ac53c/.agents/memory/decisions/019-the-internet-plane-is-a-scoped-custody-spool-protocol.md) separates external conversation-scoped custody from the radio-shaped transport seam. This supports keeping LOKA Go/Gateway separate. Do not interpret that historical design milestone as the current completion status of every spool feature.

Knit identifies its app as GPL-3.0-or-later; COPYING supplies GPLv3. Source copying/linking/distribution requires applicable license compliance and an explicit reuse decision. No GPL implementation was imported. Licensing compatibility is not certified by this audit; a proposed integration needs qualified review. We can retain independently implemented architecture informed by the documented lessons.

## D. Android platform findings

BLE scanning, advertising, central/peripheral GATT and supported L2CAP APIs are candidates, subject to controller roles and permissions. Android's [BLE background guide](https://developer.android.com/develop/connectivity/bluetooth/ble/background) distinguishes a live process from wake mechanisms and recommends a connected-device foreground service or companion-device mechanisms for ongoing links. A foreground service does not establish OEM survival. Our service lacks companion association, boot recovery and durable allowlists; auto-granting radio-address trust would be unsafe.

[Wi-Fi Aware](https://developer.android.com/develop/connectivity/wifi/wifi-aware) supports direct discovery/data paths without an access point on compatible Android 8+ devices. Check hardware feature, runtime availability and resource counts; radio coexistence can invalidate sessions. [Wi-Fi Direct](https://developer.android.com/develop/connectivity/wifi/wifip2p) establishes local groups; group ownership and multiple concurrent links need testing. Neither API creates our application mesh automatically. Local sockets can require the permission named INTERNET without using the Internet.

[Doze/App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby) and foreground-service launch restrictions require explicit tests for idle, battery saver and screen lock, across OEMs. No current measurement establishes % battery/hour, sustained CPU, temperature or reliable screen-off delivery. Do not request blanket battery exemptions before measuring failures.

[Nearby Connections](https://developers.google.com/nearby/connections/overview) documents offline Android/iOS communication. It is a potential adapter experiment with SDK/dependency/strategy constraints, not native API parity or a mesh implementation. Adding it is not currently justified over the existing validated wire seam.

## E. Apple platform findings

Current [Wi-Fi Aware](https://developer.apple.com/documentation/wifiaware) documentation lists iPhone 12 and later plus selected iPads, secure paired connections and multiple simultaneous peers. The iOS 26 framework works without Internet/access point; pairing uses system APIs and data uses Network.framework. It allows connections while the app has foreground/background runtime, not perpetual execution. Do not assume the connected iPhone SE qualifies from its chip or launch date; verify exact model/runtime availability on device before selecting this path.

[Core Bluetooth](https://developer.apple.com/documentation/corebluetooth) supports background/restoration mechanisms. iOS 26 documents additional privileges associated with an already-started Live Activity and instantiated manager; that is a separate user-visible experiment, not permission to bypass force-quit. Existing locked Keychain accessibility is intentional and should not be weakened as a reconnect workaround.

[Apple's Wi-Fi API overview](https://developer.apple.com/documentation/technotes/tn3111-ios-wifi-api-overview) distinguishes standard LAN sockets, Wi-Fi Aware and Apple peer-to-peer Wi-Fi. Network.framework plus Bonjour can discover/transport over a suitable LAN; Bonjour does not create a phone-only link. Apple peer-to-peer Wi-Fi is Apple-only, not Android Wi-Fi Direct. [Migration guidance](https://developer.apple.com/documentation/technotes/tn3213-moving-from-multipeer-connectivity-to-network-framework) points to Network.framework and DeviceDiscoveryUI for appropriate pairing/discovery. DeviceDiscoveryUI is not itself a transport or routing engine. Local-network permissions, service declarations and actual background runtime remain necessary.

## F. Cross-platform findings

| Transport/topology | Classification | Current LOKA result |
| --- | --- | --- |
| Android Classic ↔ Android Classic | Platform supported; implemented | Software tests; physical direct/relay gates pending |
| Android BLE peripheral ↔ iPhone central | Common GATT contract; implemented | Public probe reception observed; real destination delivery not recorded |
| iPhone ↔ iPhone direct | Technically possible via additional native roles/transports | Unsupported by current two-central-only app topology |
| iPhone → Android → iPhone | Existing roles permit a candidate topology | Android multi-peer BLE forwarding needs physical proof |
| Android → iPhone → Android | Requires iPhone multiple links/forwarding | Unsupported by current engine/link model |
| Local LAN TCP/UDP | Standard interoperable IP | Neither app has a LAN adapter; LAN access needed |
| Wi-Fi Aware Android/iOS | Shared standard; platform support subject to models/OS/pairing | No LOKA adapter; exact pairing/service/security interoperability must be proven |
| Android Wi-Fi Direct ↔ Apple's peer-to-peer Wi-Fi | Different APIs/wire behavior | No established direct interoperability |
| Google Nearby Android/iOS | Documented SDK support | Separate optional experiment; not implemented |
| BLE → Classic on Android relay | Existing packet seam supports mixed local links | Preserve same packet; physical mixed-link test pending |
| BLE → NAN → Internet example | Architecturally extensible | NAN/external policy missing; not currently executable |

## G. Architecture gaps and security risks

Keep the Android transport abstraction and v0 interoperability. Extend Swift's single-link closure into peer-tagged send/receive events before expecting iPhone relay; the current incoming flag cannot represent multiple ingress/egress links. Keep capabilities typed and measured, separate from UI claims.

Critical reliability gaps: partial-send persistence, stale/out-of-order outbox snapshots under concurrency, lost ACK cleanup, volatile relay/replay state, no prioritized media/backpressure policy, manual authorization after restart, no automatic Android route discovery, and no physical background acceptance results. These are source-identified concerns requiring tests, not claimed reproduced failures in every case.

Cryptographic limits: no forward secrecy, session ratchet, device/account key rotation, remote revocation, group messaging, authenticated radio-to-identity handshake or protected hop provenance. Relays see routing metadata and public identity; payload confidentiality relies on destination keys remaining secret. Static-key compromise exposes recorded historical traffic. Existing tests verify wrong-key/tag/signature rejection; no independent production audit has passed. Friend removal is local trust revocation, not global revocation. See [threat model](../security/threat-model.md) and existing internal reviews.

## H/K. Recommendations and implementation plan

| Priority / class | Reason and evidence | Affected modules | Benefit | Complexity / risk | Required test |
| --- | --- | --- | --- | --- | --- |
| P0 KEEP | Wire has tested cross-language encryption/IDs/expiry | Packet, LokaProtocol, transport seams | Preserve compatibility | Low / regressions if touched | Existing Java/Swift vectors |
| P0 HARDEN | No measured physical encrypted/background pass | diagnostics, EXP-008/010 | Feasibility decision from evidence | Medium / misleading success if shortcuts exist | A–G matrix, bounded privacy-safe logs |
| P0 HARDEN | History, fragments and pending IDs persist in separate steps | LabViewModel, ChatStore, HistoryStore, MessageArchive | Recoverable sends without duplicate UI | High / data loss or duplicate delivery | Kill at each write; disk-full; reopen/replay/receipt races |
| P0 EXPERIMENT FIRST | iPhone is not a relay; direct iPhone pairing missing | BleLink, LokaMesh, LocalPacketTransport | Determine viable iPhone roles | High / background and concurrency limits | B/F/G topology; two simultaneous links before implementation claim |
| P0 KEEP | Trust and radio approval separate | contact stores, QR, allowlist | Preserve explicit authorization | Low / unsafe auto-trust | Unknown-key, changed-key and revoked-contact rejection |
| P1 HARDEN | Crypto is experimental; mutable hops/replay limits | protocol/security/native crypto | Reviewed production security | High / wire migration | Independent review, migration/downgrade/adversarial tests |
| P1 ADAPT | Own queue exists, relay durability missing; Knit custody lesson | MeshEngine + new relay repository | Survive brief contacts/restart | High / storage abuse and metadata | Per-sender/global quotas, expiry, crash/replay, custody ACK distinction |
| P1 ADAPT | Version constants are not negotiation | protocol + both engines | Explicit common features/migrations | High / spoofing/downgrade | Authenticated handshake, mixed-version/downgrade fixtures |
| P1 EXPERIMENT FIRST | GATT voice bandwidth not measured | new L2CAP/Aware/LAN adapters | Higher-throughput local transfer | High / hardware/platform mismatch | Matching services/pairing, byte-exact ciphertext, no uplink |
| P1 HARDEN | Provider failures/liveness not aggregated | LocalTransportProvider, service, BleLink | Truthful recovery/status | Medium / restart loops, battery | One radio fails; Off respected; lock/Doze/process death |
| P2 ADAPT | Flood duplicates scale poorly; Knit jitter insight | MeshEngine scheduler | Lower congestion | Medium / partitioning by over-suppression | Line/diamond/dense graphs with packet loss and fixed random seeds |
| P2 ADAPT | Voice chunks currently flood like text | content/media repository, transfer adapter | Bounded resumable media | High / new protocol and storage attack surface | 12/30/60s media, byte caps, cancellation, quotas, loss, old versions |
| P2 EXPERIMENT FIRST | RSSI is not whole-route quality | route measurements/capabilities | Evidence-based media admission | Medium / misleading quality score | Timestamped RSSI, throughput, RTT/loss/jitter; compare real playback |
| P3 EXPERIMENT FIRST | No measured demand for route scoring/Go/calls | routing, Go/Gateway, audio | Future routing/live audio | High / premature complexity | Baseline gates first; direct streaming and consent/security design |

No REPLACE recommendation is justified for the existing packet/Android transport architecture. The iPhone link cardinality needs an adaptation, not a wholesale application rewrite. Do not adopt Knit's protocol or relaxed routing lifetime rules silently.

## I/J. Experiments, measurement and product limits

[EXP-010](../experiments/EXP-010-cross-platform-audit.md) defines all seven requested topologies, background/movement/battery variants and a measurement schema. None is marked passed merely because it compiles. The available single Samsung and single iPhone cannot prove three/four-node routes or iPhone-to-iPhone delivery. Automatic alternate-route discovery must be separated from survival on an already-connected alternate path.

Density, controller limits, battery/OEM behavior, suspension and lock are independent gates. Before a 60-second limit: current 16 kb/s audio implies roughly 120,000 payload bytes plus container/encryption/framing overhead, versus the 32 KiB/32-fragment v1 cap. Increasing only the recorder timer would violate the receiver/queue/history contract. Keep 12 seconds for this build; evaluate a negotiated, resumable media path before raising it to at most 60 seconds. Voice bytes are encrypted in transit and saved history; temporary capture is app-private and cleaned up. Live calls need a separate reviewed streaming design.

0.6.2 changes only composer appearance/status affordances: pending neutral, delivered green, unconfirmed amber label, readable text/icons and spinner. It does not alter packet, routing, recorder limits or cryptography.
