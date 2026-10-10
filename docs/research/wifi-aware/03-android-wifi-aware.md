# Android Wi-Fi Aware findings

Checked 2026-10-03 against official API references, installed API 36 SDK signatures and one physical Samsung.

Base NAN discovery is available from API 26, conditional on hardware. Check FEATURE_WIFI_AWARE, current availability and availability broadcasts. Attach once, publish/subscribe a matching service, discover a PeerHandle, then request an Aware network; bind sockets to that network. Nearby Wi-Fi runtime permission applies to target 33+, with older location requirements differing. Wi-Fi Direct/hotspot coexistence depends on firmware. [Android guide](https://developer.android.com/develop/connectivity/wifi/wifi-aware)

Native pairing is separate from old PSK datapaths. API 34 provides bootstrapping/pair setup/verification callbacks and PIN-based pairing calls; empty credentials can mean opportunistic pairing and must not silently replace authenticated pairing. [DiscoverySession reference](https://developer.android.com/reference/android/net/wifi/aware/DiscoverySession)

The isolated publisher uses cache/setup/verification configuration and PIN display, a short explicit pairing window and user confirmation. `AwarePairingConfig.Builder.setSupportedCipherSuites` is API 36; the min-34 probe does not invoke it unguarded. Installed SDK signatures, not newly added online APIs, determine what this build can call. [Pairing configuration](https://developer.android.com/reference/android/net/wifi/aware/AwarePairingConfig.Builder)

## Physical capability result

[Raw Samsung probe](raw/samsung-capabilities.json), SM-S948U1, Android 16 / API 36:

| Capability | Observed value | Meaning |
| --- | --- | --- |
| Aware feature / currently available | true / true | Can attempt a session now |
| Native pairing | true | API reports the feature, not a completed pairing |
| Pairing cipher mask | 48 | SDK constants 16 + 32: PASN 128/256 |
| Data cipher mask | 1 | NCS-SK-128 capability; do not confuse this enumeration with pairing ciphers |
| Max data paths / interfaces | 8 / 1 | Advertised device resource limits; not measured simultaneous usable peers |
| Max publishers / subscribers | 8 / 8 | Supported maxima, not currently free resources |
| Instant mode / suspension support | false / false | Optional features absent in this observation |

Capability APIs and remaining-resource APIs represent different quantities. [Characteristics](https://developer.android.com/reference/android/net/wifi/aware/Characteristics)

## Open compatibility issue

The probe initiates a network request only after native pair success, scopes the peer, and validates its IPv6 address before synthetic traffic. It intentionally does not exchange a new PSK. Whether API-36 NetworkSpecifier uses this paired security context compatibly with Apple is **unproven**; inspect firmware/OS evidence if discovery/pairing succeeds but the datapath fails. Do not claim encryption or solve failures by falling back to an unpaired public endpoint. No real conversations enter the probe.

Current LOKA's Aware adapter does exchange a PSK over discovery and uses a different service. Its app E2EE remains necessary regardless of link security. This experiment must precede adapting that transport.

Android's connectedDevice foreground service can provide runtime for a user-started session, subject to start restrictions and power management. The isolated probe intentionally has no foreground service yet, so its background results cannot certify LOKA's service implementation. [Foreground-service types](https://developer.android.com/develop/background-work/services/fgs/service-types)
