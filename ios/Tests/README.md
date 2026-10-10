# iOS Tests

Run the non-cryptographic BLE framing checks on macOS:

```sh
xcrun swiftc ios/Network/BleFraming.swift ios/Tests/BleFramingChecks.swift -o /tmp/loka-ble-framing-checks
/tmp/loka-ble-framing-checks
```

Checks cover maximum 16 KiB frames, chunk boundaries, multiple messages, unsupported flags, timeout, overflow and recovery. These do not establish physical Bluetooth success or encrypted messaging interoperability.


Native public-contact checks on macOS:

```sh
xcrun swiftc ios/Core/ContactIdentity.swift ios/Core/LokaProtocol.swift ios/Core/ContactQrCodec.swift ios/Tests/ContactCodeChecks.swift -o /tmp/loka-contact-checks
/tmp/loka-contact-checks
```

These generate an ephemeral RSA identity, verify public SPKI/link/fingerprint, reject malformed links/keys, and perform an actual QR → PNG → Vision → exact-key round trip. They export only a public test fixture. `IosContactCompatibilityTest` verifies Android’s actual decoder against [the public fixture](../../protocol/test-vectors/contact-v1-ios.json). No physical private keys or real conversations are read.


## Encrypted message interoperability

After building `:core:classes` on Android, run `sh tests/check-ios-messaging.sh` from the repository root (Mac/Xcode and JDK 17+). It calls the actual Android Kotlin core through `JavaInterop.java` and native Apple Security/CryptoKit through `MessageProtocolChecks.swift`.

Checks cover Java → Swift and Swift → Java encrypted UTF-8 messages, the actual Android ciphertext relay branch and duplicate suppression, byte codec round trips, signatures, authenticated encryption, malformed OAEP rejection, contact trust, wrong destination, expiry, queue limits and offline reconnect replay. Only fresh ephemeral test keys are generated; Java private fixtures live in a fresh private `/tmp` directory and are removed after the run. No physical device keys or real conversations are read/exported. These software tests are not physical radio proof or an independent security audit.
