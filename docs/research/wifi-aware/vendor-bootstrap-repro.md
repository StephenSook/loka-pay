# Draft reproduction: Android subscriber cannot bootstrap with Apple publisher

Prepared 2026-10-03. **Not submitted or sent to any third party.** No PINs, private identities, chats, radio addresses or device serials included.

## Environment

- Samsung SM-S948U1, Android 16/API 36; Aware available and pairing-supported runtime flags true. Pairing cipher mask 48. Exact firmware and Wi-Fi module versions still to collect if needed.
- iPhone SE3, iOS 26.3 build 23D5103d; runtime WiFiAware support true.
- Separate probe identifier `org.loka.awareprobe`, service `_loka-probe._tcp`; no production LOKA dependency.
- iPhone uses DevicePairingView with Publish entitlement and matching service declaration. User keeps its system pairing screen open.
- Android uses active subscription with pairing setup/cache/verification enabled and PIN-keypad advertised. It discovers a publisher advertising PIN-display. User confirms the intended experiment before bootstrapping.

## Reproduce

1. Open Make iPhone discoverable in the iPhone probe.
2. On Android choose Find and pair with iPhone, then Continue.
3. Android calls `initiateBootstrappingRequest(peer, PAIRING_BOOTSTRAPPING_PIN_CODE_KEYPAD)`.
4. Observe the iPhone remains waiting for a pairing request; Android receives `onBootstrappingFailed` roughly 20 seconds later.

Expected: successful bootstrap and system PIN display, followed by user PIN entry on Android. Actual: no bootstrap success and no code. No pair-setup request is sent after bootstrap failure. PIN-display method was also tried previously and failed.

## Evidence

[Raw keypad callbacks](raw/reverse-pairing-v2-events.jsonl): two request-to-failure durations 20,009 ms and 20,018 ms. Service found in both. No native failure reason is exposed in this callback. These do not establish whether the request was transmitted, received or rejected by iPhone. Internet-off conditions were not independently certified for these runs.

## Questions for platform investigation

- Does this firmware transmit the requested subscriber keypad method, NIRA/NPK/NIK caching flags and required SDEA metadata?
- How can an API-36 third-party Android app supply the bootstrap TXT metadata required by Apple §56.3? The public overload accepting metadata is documented from API 37.
- Does iOS reject or ignore this request before presenting it, and for which field/reason?
- Are group/management protection flags correctly advertised by this chipset/firmware combination?
- Can the vendor reproduce using the public minimal probe and Apple's own sample, with a controlled second Apple device as a reference?

## Scope and next evidence

Do not assume the cause is a permission, missing text box, hardware impossibility, or an iOS defect. App code, metadata, OS implementation and vendor firmware remain candidates. Obtain narrowly scoped NAN diagnostics or an over-the-air trace with operator consent; avoid bulk personal-device log capture. A known-compatible reference or API-37 device is a controlled experiment, not a promised fix. Keep all production LOKA transports unchanged during diagnosis.

Primary references: [Apple requirements](https://developer.apple.com/accessories/Accessory-Design-Guidelines.pdf), [Android bootstrap API](https://developer.android.com/reference/android/net/wifi/aware/DiscoverySession), [Android 16 HAL adapter](https://android.googlesource.com/platform/packages/modules/Wifi/+/refs/heads/android16-release/service/java/com/android/server/wifi/hal/WifiNanIfaceAidlImpl.java).
