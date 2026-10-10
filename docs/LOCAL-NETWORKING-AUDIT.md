# Local networking engineering-note audit

Update 2026-10-04, iOS **0.6.41 (49)**: shared-LAN discovery now opens up to four independent local Wi-Fi sessions rather than leaving the iPhone attached only to the first Android server. Sessions have independent handles, 32-frame queues, 15-second setup deadlines and five-second reconnect pacing. Failed links remove only their own profile/route; every peer still requires the existing identity handshake. A physical controlled Samsung → non-friend Samsung → iPhone synthetic chat reached the destination with two hops and returned receipts to a sender bubble marked Delivered. See [recorded evidence and limits](../experiments/results/2026-10-04-multi-wifi-nonfriend/result.json). This does not establish BLE-only, range, background, Wi-Fi Direct or cross-platform Wi-Fi Aware success.

Update 2026-10-04, 0.6.39 (47): a listed direct destination no longer suppresses the existing bounded carrier authorization indefinitely. Pending envelopes become eligible for their one successor after 15 seconds from creation, even if the direct transport still reports ready. Direct routes remain usable; grants are not reassigned and copy limits/expiry/signatures remain unchanged. This addresses a reproduced stale-ready-link failure, not a confirmed diagnosis of every reported physical failure.

Update 2026-10-04: build **0.6.38 (46)** adds [bounded carrier-to-carrier v3](../protocol/PACKET-V3-CARRIER-CHAIN.md) on Android and iOS. New messages between known v3 endpoints can be retained and handed onward through up to three carriers, with durable signed grants and encrypted return receipts. Existing backlog-aware local transport selection applies at every hop. Kotlin/Swift native chain tests pass; this does **not** establish physical range, background reliability or measured fastest routing. The historical findings below predate this update.

Reviewed October 2, 2026 against [the supplied engineering note](WIFI-RADIO-VS-INTERNET.md). This records source-level alignment and remaining work; it does not certify a physical mesh.

## Current implementation

| Requirement | Evidence and status |
| --- | --- |
| Local delivery has no backend or Internet prerequisite | `MeshNode` and `MeshEngine` send through the injected `LokaTransport`. The selected adapter opens paired Bluetooth RFCOMM sockets. There is no backend delivery client or Internet-validation gate in this path. |
| Messaging/routing does not depend on a radio API | The core uses opaque peer handles and the transport contract. Android radio APIs and permissions live in provider/adapter code. |
| Relays do not need plaintext | The relay branch retains/forwards encrypted packets; destination processing requires trusted identity and decryption. Existing tests cover A–B–C relaying and recipient isolation. The experimental envelope still requires production security review. |
| Bluetooth and Wi-Fi can serve complementary roles | Required direction, not an implemented feature. The current composition selects one Bluetooth Classic provider. Concurrent providers, discovery-to-data-link handoff, and local Wi-Fi adapters remain open work. |
| Wi-Fi presence is not destination reachability | No Wi-Fi/Internet flag is used to approve local delivery. Current UI reports lab/listener and adjacent-link state, not a proven route to every recipient. Delivery confirmation and route resolution are still missing. |
| Local and external communication remain distinct | Cloud, Go, and Gateway have separate documented responsibilities. No external transport is implemented in the local lab. |
| First proof is offline and physical | EXP-001–003 specify physical phones, unavailable Internet, mobile data off, and controlled A–B–C links. The physical results remain unrun; emulator/JVM evidence does not satisfy this gate. |

## Wi-Fi sockets and Android permissions

Android's [Wi-Fi Direct documentation](https://developer.android.com/develop/connectivity/wifi/wifi-direct) explicitly distinguishes local communication from Internet access: local sockets can require the permission named `INTERNET`. The [Wi-Fi Aware guide](https://developer.android.com/develop/connectivity/wifi/wifi-aware) likewise describes local peer connections and network-specific sockets.

The current Bluetooth APK does not declare `INTERNET`; that is a property of this build, not a permanent requirement for LOKA Local. Future Wi-Fi adapters may add socket and nearby-device permissions appropriate to their target API. Validate their actual peer/network path and offline behavior. A permission name does not establish that packets traverse an ISP or server.

Keep three states separate: radio enabled/supported, local link/route to a specific destination, and external Internet availability. Android's [network-state guidance](https://developer.android.com/develop/connectivity/network-ops/reading-network-state) distinguishes network transport from Internet capability/validation. Internet validation must never be a prerequisite for an otherwise viable local route.

## Multi-radio work before claiming support

1. Introduce a local transport manager behind `LokaTransport` to coordinate providers. Distinguish handles by provider and peer, so identical radio-local handles cannot collide.
2. Keep discovery/presence/control and payload-link roles explicit. BLE discovery plus Wi-Fi payload delivery is a hypothesis to test; a selected Wi-Fi API may also provide discovery itself.
3. Keep endpoint identity/trust distinct from discovered radio handles. Any new authenticated handoff or cryptographic binding requires the explicit security review already required by AGENTS.md.
4. Measure whether a relay can sustain the required links concurrently. A two-phone Wi-Fi transfer does not prove A–B–C, and an application-level flood is not evidence of OS-managed mesh support.
5. Isolate provider failures and report unavailable capabilities accurately. Future external routes must be selected by a separate local-first policy rather than silently entering the local manager.

See [EXP-006](../experiments/EXP-006-local-wifi-feasibility.md) for the planned hardware investigation. No Wi-Fi provider, automatic handoff, concurrent-radio manager, or satellite support is claimed by this audit.

## Offline experiment controls

Record radio state independently from upstream connectivity. Disable mobile data and remove Internet-bearing Wi-Fi/WAN, VPN, Ethernet, USB tethering, or hotspot uplinks as applicable. Keep Bluetooth and/or Wi-Fi enabled for the local links being tested. If airplane mode is used, re-enable and record the required radios; airplane mode alone is not a sufficient description of the setup.

Record how Internet was made unavailable, which interfaces/neighbors carry each hop, and how the A–C shortcut was excluded. Confirm plaintext only at the destination, ciphertext forwarding at B, and a reply through B. A failed Internet probe or a “queued” message event by itself does not prove offline end-to-end delivery. An isolated LAN test may be useful as a control but does not demonstrate phone-only peer-to-peer relaying.


## Expanded offline research requirements

The [supplied research brief](OFFLINE-NETWORKING-RESEARCH-BRIEF.md) and [primary-source assessment](OFFLINE-NETWORKING-RESEARCH.md) now extend this audit with the technology matrix, current Android/iOS restrictions, DTN/routing comparisons, security and voice research, and [ten-device EXP-007](../experiments/EXP-007-ten-device-network.md). No transport implementation or physical result was added.

Key unresolved gates: automatic authenticated discovery/reconnection, simultaneous relay links, bounded durable forwarding/replay storage, authenticated end-to-end receipts, compatible iOS transport, and realistic screen-off/Doze/vendor battery behavior. Apple Wi-Fi Aware and newer Core Bluetooth capabilities require exact device/API/pairing tests; Android 17 local-network permissions must be reassessed when upgrading from the current target SDK 36. Common standard names or advertised radio limits are not interoperability or performance evidence.


## Experimental Classic/BLE link update

Android now starts Classic plus a BLE GATT peripheral behind a minimal local manager; iPhone implements a foreground central and public two-way diagnostic. Earlier single-provider statements describe the pre-BLE baseline. Wi-Fi, authenticated handoff and physical coexistence remain unproven. Existing message encryption/identity/history were preserved; the initial iPhone encryption proposal was blocked by automatic approval review at that stage. A subsequent authorized non-sensitive test implementation now passes bidirectional Android-core/Swift encryption and Android relay software checks; physical delivery still requires observation. See [BLE contract](../protocol/BLE-LINK-V1.md) and [validation](VALIDATION.md).

### Version 0.6.0 follow-up

Both native apps now implement typed encrypted text/short voice, authenticated recipient-save receipts, bounded retries and own outgoing ciphertext persistence. Android has a connected-device foreground service; iPhone has best-effort Bluetooth restoration and previously selected peer recovery. Relay queues remain volatile. Locked iPhone private operations wait for unlock. The user reports unreliable background/reopen behavior; Samsung service liveness was observed and iPhone recovery gaps were addressed in build 8, but physical recovery and delivery remain unconfirmed. See [validation](VALIDATION.md) and [EXP-009](../experiments/EXP-009-voice-notifications.md).

## 0.6.20 supplemental local Wi-Fi experiment

The earlier rows are historical. Shared-Wi-Fi duplex messaging now has Android's Bonjour/TCP server and iPhone's Wi-Fi-only browser/client, alongside Bluetooth. No Internet service is required, but both endpoints must already share an accessible LAN. This is not Wi-Fi Aware or proof of router-free mesh. See [the precise implementation scope](../protocol/LOCAL-WIFI-V0.md) and [physical test contract](../experiments/EXP-015-local-wifi.md). Best-route scoring and authenticated cross-radio handoff remain unimplemented.

## 0.6.24 Android Aware experiment

Android now has a native Wi-Fi Aware discovery/data-path adapter behind `LokaTransport`, with optional permission gating and Bluetooth/shared-LAN coexistence. The connected Samsung reports hardware support; software tests/build/lint pass. No two-phone Aware delivery result is claimed. Wi-Fi Direct and iPhone Aware pairing remain unimplemented. See [EXP-016](../experiments/EXP-016-android-wifi-aware.md) and [security review](../security/WIFI-AWARE-REVIEW.md). The shared Wi-Fi automatic-admission omission was fixed and regression-tested; it previously prevented real app acceptance despite the isolated socket test passing.


## October 3, 2026: iOS Wi-Fi Aware starter transport (0.6.30)

Implemented a separate opt-in iOS 26 native paired Aware route with publisher/listener and subscriber/browser roles, DeviceDiscoveryUI pairing, bounded existing LWF0 framing, exact existing encrypted packet/LP1 payloads, route fallback, retry pacing and cancellation. Local messaging Off prevents starting it. Native transport pairing does not add a trusted LOKA friend. Normal builds leave the experiment disabled; the entitled variant builds with the explicit command in ios/README.md.

Software evidence: signed enabled iOS build succeeds; regression script passes, including independent Aware/BLE/LAN route state checks. Actual connected iPhone SE3 (iOS 26.3, 23D5103d) reports Aware capability true. Enabled build installed/launched with existing app data preserved. The capability-only report contains no keys, chats or address book data.

Outstanding gate: native paired radio delivery has not been demonstrated. Android's existing `loka-aware-v0` PSK service is not compatible with this `_loka-v0._tcp` paired service merely because both use Aware. Implement and capability-check Android NAN bootstrapping/pairing, matching service/datapath parameters, then test pairing, bidirectional encrypted delivery, link recovery, background and range. This is not generic iOS Wi-Fi Direct, route scoring, or proven multi-hop Aware interoperability.

The reverse controlled iPhone → same non-friend Samsung carrier → Samsung friend text also reached its destination with two hops. Two-hop return receipts were stored at the iPhone and its acknowledged outgoing packet left the queue. Repeated copies were logged as duplicates at the destination. Temporary test exclusions were cleared afterward; see the same result record.

## 2026-10-04 — 0.6.42 Bluetooth-only relay attempt

The physical non-friend Samsung → Samsung → iPhone Bluetooth test **did not pass**. Packet `cfe8b8d2` reached and was durably retained by the carrier, but no destination storage or delivery receipt was observed before normal Wi-Fi was restored. Android accepted previously rejected valid subscriptions after service-slot admission was moved to the native CCCD request; repeated connection callbacks preserve working sessions. Both platforms reduce established capability refresh to 120 seconds and stop periodic completed-consent chatter, retaining unknown-capability negotiation, pending requests and reconnect replay. Core tests (80), native interoperability and both signed/debug builds pass. Additional iPhone central connection/recovery and payload queue progress remain unproven. See [physical failure evidence](../experiments/results/2026-10-04-bluetooth-nonfriend/result.json) for radio-state qualifications and trace timestamps. Any later Wi-Fi delivery is not Bluetooth proof.

## 2026-10-04 — 0.6.43 Bluetooth relay retry

The controlled foreground Bluetooth retry passed payload delivery in both directions through a Samsung that is not the iPhone's friend. Android now initiates a bounded connection to a tokenless advertisement matching the LOKA service; existing Android token election, malformed-token rejection, profile verification and message trust remain in place. The reverse iPhone → carrier → Samsung exchange blocked every non-BLE packet path and returned its authenticated receipt via the same carrier, with two hops in each direction. Forward text took roughly 24 seconds, reverse text 69 seconds and its delivery receipt about 125 seconds round trip under existing queued traffic. This establishes a foreground local Bluetooth route, not background, range, high throughput or fast receipts. Wi-Fi radio stayed on at the iPhone; the carrier had Wi-Fi disabled, and reverse transport isolation was enforced in the development test build. See [packet-level proof and qualifications](../experiments/results/2026-10-04-bluetooth-nonfriend-retry/result.json). The previous failed experiment remains recorded.

## 2026-10-04: latency diagnosis and immediate new-destination handoff (0.6.44)

Connected-device redacted snapshots showed Bluetooth-only verified routes, 34 pending packets on the iPhone, and 59 pending packets / 142,293 bytes on the Samsung carrier. Destination events repeatedly logged already-seen packets. These counts describe retained packets, not unique unread messages. BLE currently uses 19 payload bytes per acknowledged GATT chunk, so even strong signal does not establish high throughput. No live latency improvement is claimed from this inspection.

Android and Swift schedulers now allow the first accepted send to a newly verified, authorized destination/carrier identity without waiting for another target’s packet retry timer. Previously a relay attempt could delay an available direct destination by the remaining 15–120 second retry backoff. The existing retry pacing applies to identities already tried; aliases of the same identity do not count as a new target. Authorization, expiry, queue limits and encryption are unchanged. Regression checks cover a relay accepting a packet, the existing destination handle becoming identity-verified one second later, immediate forwarding, and no immediate duplicate on the next tick. This improves one scheduling case; larger negotiated BLE chunks and suppression of retained delivered relay traffic remain separate work.

Validation: 82 Android core tests passed, signed Android/iOS builds passed, and `tests/check-ios-messaging.sh` passed including Kotlin–Swift carry, receipt, duplicate and expiry checks. Version 0.6.44 (52) installed on both connected Samsungs and the iPhone; app data preserved. The unavailable iPad was not updated. Physical post-update latency remains unmeasured.

Deployment limitation: both Samsungs launched successfully. The iPhone install succeeded, but two `devicectl` launch attempts failed with FBSOpenApplicationErrorDomain 3 (code signature / entitlements / profile trust). The embedded profile and signed app both declare matching team, application identifier and Wi-Fi Aware entitlements; this does not establish device trust. Do not report the iPhone update as running or the latency change as physically verified.
