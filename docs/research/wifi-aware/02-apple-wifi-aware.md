# Apple Wi-Fi Aware findings

Research checked 2026-10-03. Documented support is distinct from measured interoperability.

Apple exposes WiFiAware from iOS/iPadOS 26. Its device list names iPhone 12 and later; iPad 10+, Air 4+, Pro 11-inch 3+, Pro 12.9-inch 5+, mini 6+. Connections can coexist with infrastructure Wi-Fi and multiple peers, with no published universal peer count. Background use requires the app to actually have runtime. [Framework documentation](https://developer.apple.com/documentation/wifiaware)

The attached iPhone SE (3rd generation), iOS 26.3 build 23D5103d, reports `WACapabilities.supportedFeatures.contains(.wifiAware) == true`. Treat this runtime observation as a reason to test this exact device, not a blanket reinterpretation of Apple's model list. [Captured report](raw/iphone-capabilities.json)

## App setup and lifecycle

Declare `com.apple.developer.wifi-aware` with Publish and/or Subscribe and the exact fully qualified service under `WiFiAwareServices`; roles use `Publishable`/`Subscribable` dictionaries. An invalid service declaration can fail at runtime. The isolated subscriber declares `_loka-probe._tcp`. [Adoption guide](https://developer.apple.com/documentation/wifiaware/adopting-wi-fi-aware)

DeviceDiscoveryUI is appropriate for app-to-app pairing; AccessorySetupKit targets accessory setup. After user pairing/access authorization, paired-device records permit later connection attempts; records do not prove proximity. NetworkBrowser finds paired services, NetworkListener publishes, NetworkConnection carries data, and NWPath exposes Aware-specific path/performance information. [Connection guide](https://developer.apple.com/documentation/wifiaware/connecting-paired-devices)

The probe uses a native DevicePicker and requires an actual Aware path after its TCP handshake. An onboarding toggle cannot grant native pairing, fabricate a paired record, or keep an app running. First pairing is required; its failure should be measured separately from connection failure. [Apple DTS clarification](https://developer.apple.com/forums/thread/791628)

## Interoperability requirements

Apple's accessory guide, edition 2026-09-21, chapter 56, describes six-digit PIN display/keypad bootstrapping, NIK/NPK caching, protected management/group frames, service TXT metadata during pairing, and GTK-required attributes. Android's HAL/firmware must implement the parts its app APIs cannot set directly. App code alone cannot infer that those requirements are met from basic NAN discovery. Use pairing and data-path callbacks, then actual traffic, to establish evidence. [Accessory Design Guidelines](https://developer.apple.com/accessories/Accessory-Design-Guidelines.pdf)

## Runtime, tuning and distribution

Bulk versus real-time performance modes and traffic service class trade latency against energy. WAPerformanceReport offers connection feedback; advertised metrics must still be compared with application delivery measurements. Real-time mode does not grant background runtime. [WWDC25 session 228](https://developer.apple.com/videos/play/wwdc2025/228/)

The Developer Program agreement §3.3.7(G) limits Aware use to app peer connectivity/data transfer, requires protection of Aware information, prohibits unrelated tracking/remote storage, and prohibits keeping paired connections active when idle. Consequently indefinite keepalive traffic is not an acceptable background strategy. Signing success does not establish App Store approval. The developer must review applicable terms before distribution. [Current agreement](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/)

The probe signed successfully with a separate bundle and Subscribe entitlement and installed on the iPhone. Production's prior entitled build also signed. No App Store submission occurred. Public framework documentation does not specify an EU-only API gate; worldwide availability across regions has **not been experimentally verified**. Do not infer regional entitlement rules from the DMA decision alone.
