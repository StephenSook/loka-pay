# iOS Core

`ContactIdentity.swift` protects the native RSA identity in Keychain and exposes public serialization plus native private-key operations without private-key export. `ContactQrCodec.swift` implements Core Image QR generation and Vision decoding.

`LokaProtocol.swift` implements the exact [packet-v0](../../protocol/packet-v0.md) codec and reviewed experimental RSA-OAEP compatibility around native Security RSA and CryptoKit AES-GCM. `LokaMesh.swift` adds bounded queues, signature validation, contact trust, deduplication and expiry behind an injected packet transport. It has one foreground link; it is an endpoint, not a demonstrated multi-link intermediary.

See the [internal review and experimental authorization](../../security/IOS-V0-COMPATIBILITY-REVIEW.md). A production reviewed session protocol and independent security audit remain required.
