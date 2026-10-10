# Cross-platform compatibility and isolated prototype

Status: capability gates passed on one Samsung and one iPhone; **native cross-platform pairing/data transfer not yet proven**.

## Existing mismatch

Android `AwareTransport` publishes/subscribes `loka-aware-v0` and negotiates an application PSK. iOS `LocalAwareLink` uses `_loka-v0._tcp` and Apple paired-device APIs. Shared “Aware” terminology does not bridge those service/security differences. BLE, shared LAN and Aware are separate paths; seeing a delivered chat on a different path would not pass this experiment.

## Prototype built for this investigation

[Source and runbook](../../../experiments/wifi-aware-probe/README.md). Distinct package/bundle `org.loka.awareprobe`, distinct service `_loka-probe._tcp`; no import of production identities, contacts, database, UI or networking adapters.

Android publishes with native NAN pairing configuration, TXT metadata and a fresh six-digit PIN. User approves the specific pairing request. It requests a peer-scoped Aware network after pair success, exposes a bounded synthetic TCP responder and validates the native peer IPv6 address. iOS uses DeviceDiscoveryUI, selects an endpoint and requires `currentPath.wifiAware` to exist. A native pairing callback is not yet a successful data transfer.

The transport benchmark uses LAP1, bounded 16 KiB chunks, SHA-256 content checks and application acknowledgments. It offers 30 small transactions and a decimal 1 KB–100 MB sweep in both directions. It measures raw synthetic application transfers, **not LOKA E2EE goodput**, pure RF throughput or one-way latency. It is intentionally not a chat app or production replacement.

## Gates and limitations

1. Capability: physical reports obtained; maximum resource counts are not concurrency measurements.
2. Discovery: Android published successfully in eight observed starts. No peer bootstrap or iPhone endpoint-selection event was captured; picker visibility needs operator confirmation.
3. Native pairing: pending PIN and system interaction. Never substitute opportunistic empty-PIN pairing.
4. Native network: paired security context, GTK/management protections and firmware compatibility require observation. No PSK workaround is silently enabled.
5. Synthetic transfer: hash verification and native path evidence, offline conditions separately attested.
6. E2EE: next isolated stage must send unchanged packet-v0 test vectors with ephemeral test identities, verify destination signature/decryption and relay non-decryption. Current raw probe does not pass this gate.
7. Reconnection: same paired identities, explicit reconnect runs; no measured automatic reconnection claim yet.

Failure at any gate stops later claims. The probe currently covers Android-publisher/iPhone-subscriber roles with bidirectional data. Reverse publication, Android↔Android and iPhone↔iPhone require additional probe roles and hardware. It does not implement BLE-assisted upgrades, relaying, media or background keepalive.

## Proposed identity-preserving upgrade

**EXPERIMENT**, not production behavior: authenticate the existing LOKA identity on the candidate path using the existing challenge-response; negotiate a versioned capability intersection with freshness and downgrade protection under security review; only then allow that path to carry existing ciphertext. Keep old packet IDs, contact authorization and receipt state. Retain the old path until the new path proves delivery, with bounded overlap/deduplication. Pairing may require a first-use OS prompt; a transport upgrade should not ask for a second LOKA friendship approval.

Capability evidence must distinguish supported hardware, user permission, current radio availability, free resources, native pairing, authenticated LOKA identity and measured route health. “Both have Wi-Fi” is not a usable intersection.

## API-level discovery investigation — 2026-10-03

The operator again reports **No devices found** in the iPhone system picker. Research now distinguishes the application API contract from the information actually passed toward Android's radio implementation. No production networking change or further speculative deployment was made in this research step.

### Verified checks

- The probe's iOS `DevicePicker(.wifiAware(.connecting(to: .userSpecifiedDevices, from: service)))` matches [Apple's peer-to-peer sample](https://developer.apple.com/documentation/wifiaware/building-peer-to-peer-apps). `userSpecifiedDevices` includes devices selected **or paired** through this picker; it is not a filter that excludes every new Android device.
- `_loka-probe._tcp` matches across both probe apps, and Apple service/Subscribe entitlement declarations are present. Android reports successful publication; that is not a packet capture or proof of iOS visibility.
- Missing an explicit cipher-suite setter is not by itself a defect: [Android's pairing builder](https://developer.android.com/reference/android/net/wifi/aware/AwarePairingConfig.Builder) documents PASN-128 as the default. The probe explicitly enables setup/cache/verification and PIN-display bootstrapping.

### Concrete mismatch candidate: discovery metadata field

Our three DNS TXT-style records total **68 bytes** (one-byte length prefixes included). Apple's [Accessory Design Guidelines](https://developer.apple.com/accessories/Accessory-Design-Guidelines.pdf), chapter 56.4, specify pairing device information in the Service Descriptor Extension Attribute (SDEA), together with required security attributes.

The public Android 16 [AIDL adapter's `createNanPublishRequest`](https://android.googlesource.com/platform/packages/modules/Wifi/+/refs/heads/android16-release/service/java/com/android/server/wifi/hal/WifiNanIfaceAidlImpl.java) copies SSI of at most 255 bytes into `serviceSpecificInfo`, leaving `extendedServiceSpecificInfo` empty. Only longer input takes the extended branch. The [HAL contract](https://android.googlesource.com/platform/hardware/interfaces/+/refs/heads/android16-release/wifi/aidl/android/hardware/wifi/NanDiscoveryCommonConfig.aidl) identifies these as SDA and SDEA respectively; it also describes the extended field's Generic service protocol treatment. Our public `setServiceSpecificInfo` call does not explicitly select SDEA.

**Inference, not a confirmed Samsung root cause:** a short metadata payload may therefore reach the wrong discovery attribute for Apple's picker, even though the service publishes successfully. Samsung may modify AOSP or its vendor HAL. We have not captured its over-the-air frames, confirmed picker rejection reasons, or established the exact firmware behavior. A public source discrepancy alone does not prove that adding padding fixes anything. Do not pad metadata, weaken security, use private APIs or declare a firmware limitation as fact.

[Source provenance hashes](raw/api-source-review.json) identify the reviewed source snapshots. No peer identities or PINs were collected.

### Next discriminating tests

1. Add an isolated **iPhone publisher / Android subscriber** discovery-only control. Observe Android service-discovery callbacks before adding PIN or datapath code. That avoids relying on Android publication metadata for the first visible peer and separates radio discovery from Apple's picker filtering.
2. Run Android publisher/subscriber control on a second supported Android; one phone cannot validate remote discovery of its own advertisement.
3. If Android sees the iPhone while the iPhone cannot see Android, compare vendor-authorized radio diagnostics against Apple's required SDEA, NIRA, pairing and group-protection fields. Escalate a minimal reproducible issue to the appropriate vendor if confirmed; no issue has been submitted on the user's behalf.
4. Only after discovery works proceed to native PIN pairing, then a verified Aware datapath, then unchanged LOKA E2EE.

Apple DTS directs developers with this class of failure to the interoperability requirements and device/platform vendors. This is useful guidance, not a diagnosis of these phones. [Apple engineer response](https://developer.apple.com/forums/thread/790195)

## External comparison reviewed 2026-10-04

Conclusion: similar failures are reported outside LOKA, but the exact cause on our
Samsung API-36/iPhone pair remains unproven. We did not find a reproducible public
stock-Android-to-iPhone Aware example with source, named phone/OS versions and
successful payload-transfer evidence that we can adopt as a verified fix. This is
a bounded search finding, not proof that no such implementation exists.

| Primary source | Reported result | What it establishes for LOKA |
| --- | --- | --- |
| [Apple developer thread](https://developer.apple.com/forums/thread/790195), June–September 2025 reports | Galaxy S23 Ultra discovery trouble; Galaxy S25 pairing trouble despite a positive pairing capability flag. Another developer reports Android pairing-success callbacks with iPhone 13/iOS 26 beta, but no working data path or saved Apple pairing. | Independent developer reports of similar stages failing. These older, self-reported results do not certify current phones. Apple DTS recommends checking the accessory requirements with platform/hardware vendors. |
| [Espressif's iPhone tutorial](https://developer.espressif.com/blog/2026/08/wifi-aware-esp-to-iphone/), 2026-08-25 | Published PIN-pairing and UDP-transfer example between ESP hardware and iPhone using AccessorySetupKit. | Non-Apple Aware interoperability is achievable. It is not a stock Android app example. |
| [Espressif component](https://github.com/espressif/esp-wifi-apps/blob/master/components/wifi_aware/README.md) | Separate iOS/Android compatibility configurations; documented dependency on driver support for extended SSI, NAN pairing and protected group frames. iOS-compatible security requires ESP-IDF 6.1 in its matrix. | Their solution includes firmware/driver control unavailable to LOKA through ordinary Android app APIs; copying UI code alone would not reproduce it. |
| [react-native-wifi-aware](https://github.com/dcavalcante/react-native-wifi-aware), README checked 2026-10-04 | Android data paths physically verified on two Androids; Apple runtime validation pending; Android–Apple interoperability and file transfer not implemented. | A candidate reference for Android and capability handling, not a demonstrated cross-platform fix. |
| [Google Quick Share/AirDrop implementation](https://blog.google/security/android-quick-share-support-for-airdrop-security/) | Google documents direct peer-to-peer, bidirectional file transfer starting with Pixel 10 and a dedicated interoperability layer. [Current supported-device help](https://support.google.com/pixelphone/answer/9286773?hl=en) also lists Pixel 9 and later except 9a, and selected other vendors. | Consumer file sharing works across platforms. These sources do not establish that ordinary third-party Aware APIs implement the same connection path, or provide a reusable socket/mesh API. Do not identify its underlying radio protocol from this evidence alone. |

The API discrepancy remains concrete: Android documents
`initiateBootstrappingRequest(peer, method, byte[] message)` from API 37, with
message bytes carried as SDEA service information; our API-36 probe can only use
the older two-argument call. [Android API](https://developer.android.com/reference/android/net/wifi/aware/DiscoverySession).
Together with Apple's chapter 56.3 requirements, this supports a metadata
hypothesis. It does not show what this Samsung's firmware actually transmitted,
why the iPhone ignored/rejected it, or that API 37 would fix all pairing/data-path
requirements. Do not recommend a phone purchase or OS upgrade as a proven remedy.

### Recommended next work

1. Retain the current minimal reproduction and [guided physical results](06-direct-device-results.md).
   A packet capture or appropriately scoped vendor diagnostics must establish the
   bootstrap attributes actually sent and the receiver's rejection reason. No
   report has been sent to a vendor on the user's behalf.
2. When the existing iPad is available, use Apple's own peer-to-peer sample on
   iPhone/iPad as a control for the Apple setup. A successful Apple pair would
   narrow the fault; it would not prove Android compatibility.
3. Use the Espressif source/requirements as a field-by-field reference. Keep the
   stock-Android public API limits explicit. A future API-37 comparison is useful
   only with physical pairing AND payload evidence.
4. For a practical cross-platform Wi-Fi candidate on current phones, test an
   Android local-only hotspot with iPhone joining the network, then carry the same
   LOKA encrypted packets over local sockets. Android explicitly documents that
   this hotspot requires no Internet. It is an alternative local topology, not an
   Aware fix or a background-execution exemption; user joining/system approval,
   lifecycle, discovery and route handoff still need testing.
   [Android local-only hotspot](https://developer.android.com/develop/connectivity/wifi/localonlyhotspot),
   [Apple hotspot configuration](https://developer.apple.com/documentation/networkextension/nehotspotconfigurationmanager).

This research update changes no app executable and claims no new successful phone transfer.
