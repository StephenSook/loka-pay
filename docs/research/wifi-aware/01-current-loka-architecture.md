# Current LOKA architecture audit

Audit date: 2026-10-03. Evidence: source inspection, not a physical delivery certification. Production networking was not edited during this investigation. [Source hashes](raw/source-snapshot.json) identify the audited files; this workspace has untracked files, so a Git revision alone is insufficient. Earlier network audits describe historical versions and must not be read as current implementation status.

## Actual data flow

```text
Android chat / media → packet-v0 E2EE → MeshEngine bounded flooding
  → LocalTransportProvider → Classic / BLE peripheral / BLE central / shared LAN / Android Aware

iOS chat / media → same packet-v0 E2EE → LokaMesh
  → ChatStore.sendLocal → every ready BLE / LAN / Apple Aware path
```

Neither path uses a backend, cloud health check or Internet validation as a prerequisite. Cloud backup, Go and Gateway are separate concerns. Local socket use of Android INTERNET permission does not imply Internet delivery.

## Source inventory and findings

Paths are relative to the repository root.

| Area | Implementation | Finding |
| --- | --- | --- |
| Android transport manager | `android/loka-mesh-lab/app/src/main/java/org/loka/meshlab/LocalTransportProvider.kt` | Starts independent providers; routes opaque handles by prefix. Its capabilities property returns the Classic provider's capabilities, not an aggregate or negotiated intersection. |
| Android routing | `android/loka-mesh-lab/core/src/main/kotlin/org/loka/core/MeshEngine.kt` | Bounded flooding, excluding ingress; no destination route table or measured transport score. Immediate sends plus retry of up to four eligible packets after a 15-second interval. 128 pending, 2048 seen entries. |
| iOS routing | `ios/Core/LokaMesh.swift`, `ios/Features/ChatStore.swift` | One aggregate linked flag. Sends own ciphertext through all ready adapters. Received foreign packets are retained but deliberately not forwarded/retried. Thus an iPhone is not an operational multi-link relay today. |
| Android Aware | `AwareTransport.kt` | Service `loka-aware-v0`; discovery messages exchange a PSK; two-link application cap. Native NAN pairing APIs are not used. Network-scoped socket and peer IPv6 validation exist. |
| Apple Aware | `ios/Network/LocalAwareLink.swift` | Entitled opt-in build, `_loka-v0._tcp`, DeviceDiscoveryUI pairing, typed Network listener/browser, native Aware-path check. One connection per adapter. Native pairing is independent of LOKA friendship. |
| LAN | Android `LocalWifiTransport.kt`, iOS `LocalWifiLink.swift` | Bonjour/TCP shared local network; does not itself establish a phone-only Wi-Fi Direct group. iOS is the client. |
| Wi-Fi Direct | Current provider composition | No `WifiP2pManager` adapter found. “Phone-to-phone Wi-Fi” UI or Android Aware does not establish Wi-Fi Direct implementation. |
| BLE | `BleTransport.kt`, `BleClientTransport.kt`, `ios/Network/BleLink.swift` | Android central/peripheral links; iOS selected central, restoration and reconnect logic. Radio availability is not destination reachability. |
| Background | Android `LocalNotifications.kt`, manifest; iOS `BleLink.swift`, `ChatStore.swift` | Android connectedDevice foreground service with START_STICKY. iOS Bluetooth background/restoration support and protected locked inbox; neither proves uninterrupted Aware runtime after suspension/force quit. |
| Identity and trust | `NearbyPeople.kt`, `ios/Core/ContactConsent.swift` | LP1 challenge/response authenticates a same-link profile binding; LC1 consent manages friends separately. Names are self-asserted. This is not a general transport capability handshake. |
| Quality engine | Source search and typing responsiveness | No production route/media quality engine. Recent profile RTT used for typing eligibility is not a bandwidth estimate. |
| DTN | Mesh queues versus `experiments/network-simulator` | Source outbox persistence exists; relay pending/duplicate state is in memory. Experimental ciphertext journal is not production durable custody. |

## Security and receipt boundary

Packet-v0 uses RSA-3072 signatures, AES-256-GCM content encryption and RSA-OAEP wrapping. Sender/recipient identity and ciphertext are transport-independent. The fixed v0 lifetime is five minutes, forwarding budget six, and remaining-hop metadata is not a signed path trace. These are experimental envelopes, not a reviewed forward-secret conversation ratchet. Changing radio must not create a new contact or regenerate keys.

Destination receipts follow verification and saving; read status requires visibility. Transport enqueue, socket success, relay retention and notification display are not equivalent to destination delivery. Protected storage/locked execution can defer receipt processing. Preserve packet bytes and existing receipt semantics in any later adapter integration.

## Performance suspects to measure, not silently change

Android Aware's receive loop includes a 250 ms delay per frame. iOS LAN pacing and 15-second mesh retry windows can also affect observed latency. At four 16 KiB frames/second the Android delay alone imposes an approximate 64 KiB/s receive-processing ceiling before other costs. This is a calculated code-path bound, **not a radio benchmark**. RSA verification, chunk size, queue fairness and background runtime also need timing. First compare the raw isolated path with encrypted packet-v0 traffic; otherwise radio improvements can mask application bottlenecks.

Read [compatibility](05-cross-platform-compatibility.md) and [recommendation](12-architecture-recommendation.md) before integration.
