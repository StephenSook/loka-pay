# Testing

Executable protocol/crypto/mesh tests are in `android/loka-mesh-lab/core/src/test`. Run `./gradlew :core:test` from the Android project. They cover recipient isolation, signature tampering, codec limits, three-node bidirectional relay, ephemeral partition replay, duplicate suppression, trust, expiry, and relay controls. `MeshNodeTest` additionally exercises the production transport boundary using injected local transports, including three-node encrypted replies and partition/reconnect replay.

Physical-device acceptance is specified in `experiments/`. JVM tests cannot establish Bluetooth concurrency, Keystore behavior, RF range, background viability, or battery usage. Add cross-platform test vectors before another platform implements the wire protocol.

Android Keystore integration test: `./gradlew :app:connectedDebugAndroidTest` with an attached emulator/device. The tests check the actual Android provider's OAEP decryption, signature generation, codec round trip, and identity reuse. `TransportCompositionTest` injects a local transport into the real ViewModel, receives and replies with Keystore-backed encrypted envelopes, and checks stopped-link UI state. It does not test Bluetooth radio behavior.

See [validation record](../docs/VALIDATION.md) for verified scope.
