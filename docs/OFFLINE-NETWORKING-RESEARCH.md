# Offline networking research and implementation gates

Reviewed 2026-10-02. This is an initial primary-source assessment and experiment plan, not an approved production architecture or measured performance report. The [supplied brief](OFFLINE-NETWORKING-RESEARCH-BRIEF.md) is preserved verbatim. It supplements the [radio engineering note](WIFI-RADIO-VS-INTERNET.md), [architecture](ARCHITECTURE.md), and [source audit](LOCAL-NETWORKING-AUDIT.md).

## Evidence and decision

- **Documented:** platform APIs and restrictions explicitly described by the linked platform/standards sources. A documented capability does not establish LOKA reliability or interoperability.
- **Experimental:** existing JVM/emulator tests and successful Android installation/UI checks are recorded in [validation](VALIDATION.md). No physical three-phone relay, automatic alternate-route recovery, screen-off relay or battery gate has passed. The iPhone application is an interface preview with no networking engine.
- **Proposed:** keep the current Android RFCOMM baseline for the smallest physical proof; investigate BLE and local Wi-Fi behind the existing transport contract. Prefer no new product features until networking gates pass.
- **Unresolved:** useful range, throughput, latency, energy, simultaneous peers, background survival and Android–iOS interoperability require physical measurements. Do not replace missing numbers with radio marketing limits.

The objective is finding a viable route to a LOKA identity without Internet, cellular service, a traditional router or a delivery server. A phone acting as a Wi-Fi Direct group owner is allowed; an external router is not required. Offline does not mean radios disabled. Local messages must never silently use Go/Cloud as a substitute for a failed local experiment.

## Technology matrix

**NM** means not measured for LOKA. Qualitative workload descriptions are proposals, not performance guarantees. Every radio's practical range, payload bandwidth, latency and battery cost are NM on our hardware. Sources are linked beside the applicable technologies; range labels identify the intended investigation rather than a numeric promise.

| Technology | Internet required | Range | Bandwidth | Latency | Battery | Background support | Android | iOS | Extra hardware | LOKA use |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [Classic RFCOMM](https://developer.android.com/develop/connectivity/bluetooth/connect-bluetooth-devices) | No | NM | NM; stream baseline | NM | NM | Lifecycle work and hardware tests required | Current adapter; physical relay unproven | No counterpart implemented; Core Bluetooth support is not proof of matching RFCOMM service | No on supported Android phones | First physical text relay |
| [BLE advertising/scanning](https://developer.android.com/develop/connectivity/bluetooth/ble/background) | No | NM | Small discovery/control data; NM | NM | NM; scan duty cycle matters | Restricted/event driven | APIs available; permissions and process state matter | Core Bluetooth; background differences below | No on compatible phones | Anonymous LOKA service discovery, not contact authorization |
| [Extended/periodic advertising](https://developer.android.com/reference/android/bluetooth/BluetoothAdapter) | No | NM | Controller-dependent advertising limits; NM | NM | NM | Not a general background execution grant | Query extended/periodic support separately | No equivalent general-purpose API established by this review | No if controller/API support exists | Optional optimization after compatibility proof |
| [BLE GATT](https://developer.android.com/develop/connectivity/bluetooth/ble/transfer-ble-data) | No | NM | NM; bounded chunked text/control candidate | NM | NM | Platform restrictions apply | Client/server APIs | Core Bluetooth central/peripheral APIs | No on compatible phones | First candidate for Android–iOS direct text, then concurrent relay |
| [BLE L2CAP CoC](https://developer.android.com/reference/android/bluetooth/BluetoothDevice#createL2capChannel(int)) | No | NM | NM; stream candidate | NM | NM | Same lifecycle constraints; test independently | LE channel API added API 29 | [Publish L2CAP API](https://developer.apple.com/documentation/corebluetooth/cbperipheralmanager/publishl2capchannel(withencryption:)) | No on compatible devices | Evaluate after GATT, including PSM discovery/security interoperability |
| [Wi-Fi Aware / NAN](https://developer.android.com/develop/connectivity/wifi/wifi-aware) | No; no AP | NM | NM; high-bandwidth candidate | NM | NM | Availability/runtime and resource limits apply | API 26+, optional hardware; runtime check | iOS 26 framework, supported models, entitlement/pairing; see below | No on supported phones | Preferred Wi-Fi investigation, not selected universal transport |
| [Wi-Fi Direct](https://developer.android.com/develop/connectivity/wifi/wifi-direct) | No; no external AP | NM | NM; media candidate | NM, including group setup | NM; owner cost must be measured | App/OS restrictions apply | P2P groups and owner APIs | No matching Android-style public API established here; Apple alternatives are separate | No on supported Android phones | Android fallback investigation; multi-group relaying unproven |
| BLE + local Wi-Fi | No | NM per link | NM; handoff overhead included | NM | NM; may exceed either alone | All provider restrictions apply | Proposed manager; no implementation | Proposed; common APIs do not prove common pairing | No if both supported | Compare Wi-Fi-only discovery with hybrid discovery/data |
| [UWB](https://developer.android.com/develop/connectivity/uwb) | No for local ranging | NM ranging envelope | Not a normal message transport | NM ranging | NM | Capability/session dependent | Optional ranging APIs/hardware | [Nearby Interaction](https://developer.apple.com/documentation/nearbyinteraction); compatible hardware | Required radio if absent | Supporting proximity/verification research only |
| QR / [NFC](https://developer.apple.com/documentation/corenfc) | No | QR camera view / NFC close interaction; NM | Identity payload, not route transport | User interaction; NM | NM | Explicit interaction; no general relay role | QR implemented; NFC unimplemented | QR/NFC identity flow unimplemented | Camera; supported NFC if used | Out-of-band identity comparison; QR is not proximity or human-identity proof |
| [Wi-Fi HaLow](https://www.morsemicro.com/products/development-resources/halowlink-1) | No for local nodes | NM; long-range node investigation | NM; product-specific PHY ceiling is not app throughput | NM | NM | Dedicated-node firmware; phone lifecycle still applies | No native handset support established | No native handset support established | Yes, HaLow nodes and phone-facing bridge | Future hardware/backhaul, not first phone experiment |
| [LoRa / LoRaWAN](https://lora-alliance.org/lorawan-for-developers/) | LoRa local link need not; deployment dependent for LoRaWAN | NM; long-range node investigation | Low-rate workload proposal; NM | NM; airtime/region constraints | NM | Dedicated hardware/firmware | No native phone radio established | No native phone radio established | Yes, nodes/bridge | Future short text/emergency signaling; not normal audio/video |
| [Thread / Matter](https://openthread.io/) | Local Thread need not | NM per hop | NM; constrained node workload | NM | NM; router/end-device roles differ | Dedicated-node role dependent | Generic app router support not established | Generic app router support not established | Compatible Thread radios/nodes | Study low-power mesh concepts; Matter is not LOKA messaging |

Do not infer a fixed maximum peer count from an API being present. Record controller limits, role combinations, remaining Wi-Fi Aware resources, successful simultaneous sessions and practical saturation. Fragmentation, radio interference, queue load, retransmissions and encryption overhead all affect useful payload bandwidth.

## Platform findings

### Android local Wi-Fi

Wi-Fi Aware can discover/connect without an access point. Check `FEATURE_WIFI_AWARE`, current `isAvailable()` and availability events; concurrent Wi-Fi Direct/tethering can affect availability. Android 12+ exposes remaining Aware resources. These facts justify testing NAN; they do not guarantee relay concurrency. [Android Aware guide](https://developer.android.com/develop/connectivity/wifi/wifi-aware)

Wi-Fi Direct forms groups with an owner. Connection-request success is not established link success; observe connection state separately. Standard local sockets can require `INTERNET` permission despite no Internet delivery. Android 13+ nearby Wi-Fi permission handling differs from earlier versions. A group owner is not automatically an arbitrary multi-hop router, and repeated connections may involve system interaction. [Android Direct guide](https://developer.android.com/develop/connectivity/wifi/wifi-direct)

### iOS local Wi-Fi and cross-platform scope

Apple introduced Wi-Fi Aware in iOS 26. Its documentation lists iPhone 12 and later and specific iPad generations, describes simultaneous peer links, and allows connections while an app has foreground or background runtime. Obtain the capability entitlement and declare services. The connected iPhone SE must have its exact support checked; OS version or chip age alone is insufficient. This is **not** permission for perpetual unattended relaying. [Apple Wi-Fi Aware](https://developer.apple.com/documentation/WiFiAware), [Wi-Fi API overview](https://developer.apple.com/documentation/technotes/tn3111-ios-wifi-api-overview)

Apple's device-to-device flow uses system-mediated pairing/access before connection. A completely silent first connection cannot be promised. Android/iOS discovery naming, pairing/security parameters, service publication and data-path establishment must match and be tested end to end. Common NAN branding is insufficient. Link encryption does not replace endpoint E2EE. [Apple connection guide](https://developer.apple.com/documentation/wifiaware/connecting-paired-devices), [required entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.wifi-aware)

Core Bluetooth now documents LE and BR/EDR support, so “iOS has no Classic Bluetooth” would be inaccurate. It still does not establish compatibility with our Android RFCOMM service. Research the specific supported profile/channel contract. GATT is the first proposed common API baseline, with CoC a subsequent candidate. Apple's L2CAP API requires the application to arrange PSM discovery. [Core Bluetooth](https://developer.apple.com/documentation/corebluetooth), [L2CAP publication](https://developer.apple.com/documentation/corebluetooth/cbperipheralmanager/publishl2capchannel(withencryption:))

### Background operation by Android version

| OS / target | Documented constraint | Required LOKA investigation |
| --- | --- | --- |
| Android 6+ | Doze/App Standby defer CPU/network work and scans | Forced and natural Doze; distinguish disconnected radios from suspended process [Doze guide](https://developer.android.com/training/monitoring-device-state/doze-standby) |
| Android 12+ target | Foreground-service starts from background restricted; exemptions are specific | Start a user-requested session while visible, handle rejection and process death [FGS restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start) |
| Android 13+ target | Nearby Wi-Fi runtime permission for applicable APIs | Denial/revocation and discovery/connection behavior; not permission-name inference |
| Android 14+ target | Appropriate FGS type and type-specific permission required | Assess `connectedDevice` for local links; no FGS currently exists [FGS types](https://developer.android.com/develop/background-work/services/fgs/service-types) |
| Android 15+ target | Additional FGS launch/time restrictions apply by service type | Audit chosen type, avoid treating `dataSync` as perpetual relay [Android 15 changes](https://developer.android.com/about/versions/15/behavior-changes-15) |
| Android 16 | Local-network permission protections introduced as opt-in | Exercise denial and network-specific socket paths [local permissions](https://developer.android.com/privacy-and-security/local-network-permission) |
| Android 17 / target 37+ | Local-network runtime permission enforcement; target-dependent behavior | Reassess socket APIs on target upgrade; current app targets 36 [Android 17 changes](https://developer.android.com/about/versions/17/behavior-changes-17) |

BLE scanning can use a `PendingIntent`; process lifetime and background-start constraints still apply. A callback or companion-device facility is not proof that arbitrary anonymous mesh relaying remains alive. Manufacturer-specific survival has not been established; test stock Pixel and multiple vendor devices independently, recording battery optimization settings and failures. A foreground service is a candidate, not a guaranteed exemption from every power restriction. [BLE background guidance](https://developer.android.com/develop/connectivity/bluetooth/ble/background)

### iOS background findings

The archived Core Bluetooth guide documents central/peripheral background modes, altered scan/advertise behavior and constrained wakeups. In particular, peripheral background service UUID advertising uses an overflow area described as discoverable by explicitly scanning iOS devices. This is a cross-platform discovery risk. Archived rules must be tested against current OS behavior. [Apple background guide](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html)

Current Core Bluetooth documentation describes additional iOS 26 background privileges when a Live Activity starts before backgrounding with an instantiated manager. That is a candidate for a visible, user-controlled local session, not evidence of indefinite relay after termination. Test normal suspension, lock, low-power mode, OS termination, force quit and reboot separately. Apple Wi-Fi Aware background connections likewise require actual app runtime. [Current Core Bluetooth](https://developer.apple.com/documentation/corebluetooth)

## Proposed Android-first architecture

Keep application → messaging/E2EE → routing/queues → local transport manager → native providers. Go/Gateway remain separately governed external routes. Preserve opaque provider-scoped handles; authenticate bindings from a radio neighbor to a device identity. Consumer screens show contact and truthful delivery state rather than arbitrary Bluetooth names or technical hop controls.

1. Run the existing RFCOMM two-phone and three-phone experiments before replacing the measurable baseline.
2. Add capability diagnostics and a bounded BLE discovery/GATT experiment behind `LokaTransport`; require evidence of two simultaneous relay links, not just direct transfer.
3. Investigate Wi-Fi Aware first for local Wi-Fi; use Direct as an Android-specific fallback experiment where Aware is absent. Neither is yet the production winner.
4. Introduce the manager only with a second provider. Measure Wi-Fi discovery alone against BLE discovery + Wi-Fi data; avoid requiring two active radios unnecessarily.
5. Add authenticated discovery/handoff, route repair, delivery receipts and durable forwarding under protocol/security review. Do not retrofit new signed fields into v0 without a version and shared byte vectors.

Automatic reconnection among previously authorized identities is a goal. Initial OS permission/pairing prompts and trustworthy contact verification cannot be assumed away. Unsupported radios, exhausted resources and failed links must yield honest unavailability/queue states.

## DTN and opportunistic routing

Borrow packet lifetime, bounded retention, duplicate suppression, storage pressure handling and delivery-status concepts from Bundle Protocol v7. Do not claim BPv7 compatibility without implementing its contract. BPv7 omits earlier custody-transfer machinery; application receipts and any custody promise need separate semantics. Receipt of ciphertext at a relay is not recipient delivery. BPSec is a separate bundle security framework, not a substitute for a reviewed conversation session protocol. [RFC 9171](https://www.rfc-editor.org/rfc/rfc9171.html), [RFC 9172](https://www.rfc-editor.org/rfc/rfc9172.html)

| Approach | Proposed tradeoff for LOKA | Evidence / disposition |
| --- | --- | --- |
| Epidemic replication | Many copies can improve opportunities but consume radio/storage and expose encounter metadata; no universal latency guarantee | Comparison baseline only; resource issues discussed in [Spray and Wait paper](https://courses.cs.duke.edu/cps296.1/fall05/papers/paper-SpyPso.pdf) |
| Spray and Wait | Bound replica budget; lower traffic/storage candidate, but waiting for a destination can delay delivery | Proposed first disconnected-routing comparison; paper results are not phone measurements |
| PRoPHET | Encounter history and aging estimate future delivery; requires history/control exchange and privacy analysis | [Experimental RFC 6693](https://www.rfc-editor.org/rfc/rfc6693/); postpone until encounter traces exist |
| Encounter/contact-history utility | Test whether anonymized short-lived history improves forwarding versus bounded copies | Proposed, unmeasured; cold starts and poisoned observations need handling |
| Social-aware utility | Social graphs may aid predictability but disclose relationships and restrict open participation | Defer; no phone-book/social-graph collection for routing by default |
| Battery/congestion utility | Fewer costly forwards may trade delivery opportunities for survival | Proposed local policy; measure fairness and adversarial metric claims |

Start with the current bounded flooding only as a small lab baseline. Then compare a bounded-copy policy against that baseline using replayable traces and physical movement. Do not change routing based on assumed superiority. Proposed persistent queues need total/per-peer byte quotas, authenticated expiration policy, retry budgets/backoff, fair scheduling, eviction reasons, encrypted local storage, restart-safe deduplication and atomic receipt handling. Hop limit, wall-clock lifetime and replica budget are different controls. Test clock skew and malicious resets; relays cannot be trusted to honor claimed budgets. Current queues and replay caches are memory-only, with a five-minute v0 lifetime and six-intermediary forwarding budget (up to seven links); chat history persistence does not make forwarding durable.

For connected routes, first establish authenticated next-hop reachability and automatic repair. Compare hop count plus measured RTT/loss/stability before a complex weighted score. RSSI is link-specific and must not be compared blindly across radios. Link observations, packet authentication and bounded control announcements must resist poisoned routes. Removing B must trigger an actual discovered A–D–C path, not a manual repair or a surviving preconnected flood mislabeled as discovery.

## Security and offline verification

The [threat model](../security/threat-model.md) identifies the current lab's static-key envelope, metadata leakage and missing forward secrecy/ratchets/revocation. Research reviewed session implementations using Signal's Double Ratchet and suitable authenticated initial key agreement; evaluate maintained libraries, license, storage/rollback safety and offline prekey provisioning. PQXDH's published-server model requires an explicit offline provisioning design; copying cryptographic components alone is not a complete offline protocol. [Double Ratchet](https://signal.org/docs/specifications/doubleratchet/), [PQXDH](https://signal.org/docs/specifications/pqxdh/)

Group messaging should evaluate MLS separately, including membership, key updates and delayed commit delivery during partitions. No group implementation is proposed in this change. [MLS RFC 9420](https://www.rfc-editor.org/rfc/rfc9420/)

QR/NFC carry a versioned device-identity binding and support out-of-band comparison; a copied QR can be replayed and does not authenticate a person's name or proximity. Relays never need recipient plaintext. Review replay across restart, flooding/Sybil attacks, forged receipts, withheld packets, device loss, key rotation, offline revocation freshness, group state and link-to-identity binding. Ordinary local delivery must not require an online key-directory lookup. Offline revocation necessarily has freshness limits to document. No cryptography is changed or approved by this research.

## Local voice feasibility

Opus supports configurable frame durations and rates suitable for speech; codec support is not a call-quality guarantee. Proposed initial test points are 16/24 kb/s mono speech with 20 ms frames: respectively 40/60 payload bytes per frame before headers/encryption. At 50 frames/s, overhead and retransmissions can dominate small payloads. These are experiment settings, not claimed minimum bandwidth or product defaults. [Opus RFC 6716](https://www.rfc-editor.org/rfc/rfc6716.html)

After text/background gates, measure one-, two- and three-link encrypted audio paths: capture/encode delay, queue delay, per-hop transit, jitter buffer, decode/playout, loss/concealment and route breaks. Audio has deadlines; expired audio should not enter delayed text forwarding. Compare BLE versus Wi-Fi with bounded queues, real capture permissions and user-started call lifecycle. Establish a predeclared acceptable quality/latency target from direct-call measurements; determine useful hop count experimentally. No current local calls or maximum practical hop count are claimed.

## Dedicated nodes and exclusions

HaLow evaluation hardware and dual-radio bridges exist; the [Morse Micro reference product](https://www.morsemicro.com/products/development-resources/halowlink-1) illustrates a HaLow/2.4 GHz bridge. Its availability and stated capabilities are vendor documentation, not LOKA field results. Test local configuration, throughput/range at legal regional power, antenna placement, power draw and phone-facing connection. Do not assume ordinary phones contain HaLow radios; dedicated hardware remains deferred.

LoRa is a radio technology; LoRaWAN defines a network architecture, commonly gateways plus a network server. A local LoRa node link is not automatically LoRaWAN mesh. Future designs must specify local versus server-mediated forwarding and regional airtime/payload limits before making offline claims. Reject photos/video/normal live audio as initial LoRa workloads; consider short emergency text/control only. [LoRaWAN specification](https://resources.lora-alliance.org/home/lorawan-specification-v1-0-3), [standards and regional parameters](https://lora-alliance.org/lorawan-for-developers/)

Thread separates forwarding routers from end devices and uses border routers to connect other networks. Those concepts are useful for fixed nodes, but a Matter-capable phone must not be assumed to expose a generic app-controlled Thread router. UWB remains a ranging aid, not message payload transport. [Thread roles](https://openthread.io/guides/thread-primer/node-roles-and-types), [UWB guidance](https://developer.android.com/develop/connectivity/uwb)

Reject as initial choices: indefinite broadcast replication, a single-radio product assumption, mandatory cloud discovery/delivery, generic iOS RFCOMM compatibility claims, automatic silent pairing promises, router-only demonstrations labeled phone mesh, and dedicated hardware before Android physical gates. Apple-only discovery frameworks may be useful comparison controls but cannot alone meet cross-platform interoperability.

## Experiments and unanswered questions

Smallest next test: two Android phones in [EXP-001](../experiments/EXP-001-direct-discovery.md) and [EXP-002](../experiments/EXP-002-direct-message.md), then the required [EXP-003](../experiments/EXP-003-three-node-relay.md). Exclude A–C shortcuts, remove upstream connectivity, confirm ciphertext at B and plaintext at C, and repeat bidirectionally. Then [background EXP-004](../experiments/EXP-004-background-relay.md), [automatic recovery EXP-005](../experiments/EXP-005-alternate-route.md), [Wi-Fi/coexistence EXP-006](../experiments/EXP-006-local-wifi-feasibility.md), and [ten-device EXP-007](../experiments/EXP-007-ten-device-network.md). Procedures remain unrun.

Only hardware can answer useful peer counts, simultaneous central/peripheral and Wi-Fi data paths, discovery latency under load, handoff reliability, path recovery, vendor power management, BLE overflow interoperability, force-quit recovery, thermal throttling and sustainable voice hop count. Collect median/p95 delays plus failure rates rather than reporting only successful samples. Preserve unsupported/failed outcomes. Until these gates pass, LOKA is an experimental local messaging lab and interface preview, not a demonstrated reliable smartphone mesh.


Implementation update: an experimental Android BLE peripheral and iPhone central/link-probe now exist. The earlier candidate matrix is a research snapshot; physical BLE interoperability and encrypted iPhone chat still have no successful result. See [BLE contract](../protocol/BLE-LINK-V1.md) and [security blockage](../security/IOS-V0-COMPATIBILITY-REVIEW.md).
