# LOKA

**No data. Still connected.**

For locally deliverable messages, this means no cellular/mobile data or Internet connection is required. Local radios still transmit bytes and consume battery. See the [Wi-Fi radio engineering note](docs/WIFI-RADIO-VS-INTERNET.md).

LOKA is an Android-first research project for offline local communication. Engineering requirements are in [AGENTS.md](AGENTS.md), with current [system boundaries](docs/ARCHITECTURE.md). The product direction is in [the master architecture](<LOKA-MasterTechinical Architecture & product state.md>). The current implementation is **LOKA**, a native Android messaging preview with an embedded **Mesh Lab** for testing encrypted A → B → C communication.

## What is built

- Kotlin + Jetpack Compose Android messaging preview (Android 8 / API 26 and later): Chats, Settings, real conversation bubbles, and embedded engineering tools.
- Native Bluetooth Classic discovery, pairing, and secure RFCOMM links behind a platform-independent transport contract and injected Android provider.
- Device-private RSA keys in Android Keystore; manually verified public-key trust stored locally.
- Signed hybrid RSA-OAEP / AES-256-GCM text envelopes; relays handle ciphertext.
- Bounded flooding, duplicate suppression, hop limits, five-minute expiry, and in-memory replay when a link reconnects.
- Explicit link allowlists to force A–B–C topology, relay toggle, and diagnostics export.
- JVM tests exercising the actual codec, cryptography, relay engine, and injected transport orchestration; Android integration tests cover Keystore-backed messaging.

This is an experimental network lab. Hardware discovery, simultaneous Bluetooth links, physical-device Keystore compatibility, screen-off operation, and battery behavior are **not yet proven**. The Keystore envelope has passed an Android 16 emulator test. A successful JVM simulation does not establish a working physical mesh. The current Bluetooth build has no backend dependency or Android `INTERNET` permission. Future local Wi-Fi sockets may require that permission; the requirement is a local delivery path without Internet dependence, rather than the absence of a particular permission name. See the [implementation audit](docs/LOCAL-NETWORKING-AUDIT.md).

## Build and run

1. Open `android/loka-mesh-lab` in Android Studio.
2. Install Android SDK platform 36 and use JDK 17 or newer (Android Studio's bundled JDK works).
3. Let Gradle sync; initial dependency downloads require Internet on the development computer.
4. Run `app` on physical Android phones. Bluetooth mesh experiments do not work on a standard emulator.

From a terminal:

```sh
cd android/loka-mesh-lab
./gradlew :core:test :app:assembleDebug :app:lintDebug
adb -s DEVICE_SERIAL install -r app/build/outputs/apk/debug/app-debug.apk
```

Set `JAVA_HOME` to a compatible JDK and configure `ANDROID_HOME` or an ignored `local.properties` SDK path if needed. The Gradle wrapper is included; no global Gradle install is required.

## Messaging preview

- **Chats:** imported trusted friends and actual messages. The first launch has an empty conversation list.
- **Local connection:** guided setup from Chats or Settings, with incoming Android approval shown on your current screen and automatic iPhone connection checks. No separate Network tab, device names or phone numbers.
- **Settings:** edit your profile, open Chats/backups, manage verified contacts in Privacy, share your contact QR, and open connection preferences. Engineering controls live under Local connection → Engineering tools.
- **Add someone:** paste a contact link or scan a QR with the camera/from a saved image, compare the full security code through a trusted channel, then confirm. Both endpoints need to add each other. Codes can be exchanged remotely; delivery still needs a route. Verified phone-number lookup is not implemented. See [contacts and discovery](docs/CONTACTS-AND-DISCOVERY.md).
- **Conversation:** send encrypted text and view incoming/outgoing bubbles. Outgoing status is waiting/sending/not confirmed; two ticks require an authenticated recipient save receipt, never an inferred read receipt. Short recorded voice notes and local notification replies are included in 0.6.0. The latest 5,000 messages are saved encrypted on the phone.

“Listening nearby” with zero links means the local connection is enabled but no other device is connected. Open the second phone's app and establish a link. No contacts or conversations are fabricated.

## Three-phone experiment

1. Turn off mobile data and remove Internet uplinks on A, B, and C, including any Internet-bearing Wi-Fi, tethering, or other active uplinks. Keep Bluetooth enabled for this baseline. Future local Wi-Fi tests keep the Wi-Fi radio enabled while upstream Internet remains unavailable. For Android 8–11 discovery, grant location permission and enable system location services.
2. Pair A with B and B with C using Android Bluetooth settings. Open **Settings → Local connection → Engineering tools** and start the lab on all three phones and grant nearby-device permissions. Use **Be visible** and **Discover** if needed.
3. Allow only B on A; allow A and C on B; allow only B on C. These controls reject other incoming connections too. Never allow a direct A–C link.
4. Copy A's public key to C and C's public key to A through a trusted channel (USB/manual transfer is sufficient). Compare the full SHA-256 fingerprints on the originating screens, then import and explicitly trust. B does not need A's or C's trusted keys to relay.
5. Connect A to B, then B to C. Initiate each link from only one end. B should show two connected links; A and C should each show one. Keep all apps foregrounded.
6. Select C's fingerprint on A and send `Hello C`. C should display the message. B should report ciphertext byte counts and relay events, without the message text.
7. Select A's fingerprint on C and reply `Hello A`. Export diagnostics on all three phones.
8. Disconnect B–C, send a new message from A, then reconnect before five minutes. The running B process should replay its queued ciphertext to C.

**Encrypt & queue** is not a delivery receipt. Confirm receipt on the destination phone. Exported diagnostics omit message text but contain device fingerprints, Bluetooth addresses, and timestamps; review before sharing.

## Encrypted chat backup

Open **Settings → Chats**. Create a backup, store the generated recovery key separately, then choose local storage or Google Drive if it appears in the Android file picker. Restore by selecting the file and entering its key. This is manual backup, with no automatic cloud sync or account recovery. A provider write does not establish cloud upload completion.

Backups restore history and local labels, never private identity keys, contact trust or network queues. See [backup behavior and limits](docs/RECOVERY-AND-BACKUP.md) and the [internal security review](security/STORAGE-BACKUP-REVIEW.md).

## Current limits

- Manual link establishment and bounded flooding, rather than automatic route discovery/optimization.
- Relay queues and replay records remain memory-only. Own pending outgoing ciphertext now persists and retries only until its original expiry. Encrypted history, trusted public keys and identity persist. Old history without a retained packet is never silently resent.
- No read receipts, durable relay store-and-forward, groups, accounts or identity recovery. Version 0.6.0 adds bounded text/voice receipts and retries; delivery and audio latency require physical verification.
- Android uses a user-started connected-device foreground service; iPhone uses Bluetooth restoration. Neither establishes screen-off reliability. iPhone private-key operations require unlock.
- Experimental encryption envelope has no forward secrecy, key rotation, production identity credentials, or independent security review. See [threat model](security/threat-model.md).
- BLE and Wi-Fi Aware/Direct implementations, a concurrent transport manager, and cross-radio handoff are not implemented. Their investigation is tracked in [EXP-006](experiments/EXP-006-local-wifi-feasibility.md).

Build and test evidence: [validation record](docs/VALIDATION.md).

## Repository

| Path | Purpose |
| --- | --- |
| `android/loka-mesh-lab` | Working Android lab and portable JVM protocol engine |
| `protocol` | Versioned identity, packet, and trust specifications |
| `security` | Threat model and unresolved production requirements |
| `experiments` | Repeatable device-test procedures and result template |
| `docs` | Product scope, architecture, and implementation roadmap |
| `ios` | Native SwiftUI interface preview and Xcode project; messaging engine/transport deferred |
| `backend`, `dashboard`, `infrastructure` | Deferred systems with scope notes |
| `tests` | Cross-platform testing entry point |

Prove the network before building the ecosystem.


## Android ↔ iPhone core test

Version 0.6.0 implements experimental encrypted text, short voice notes and recipient-save receipts on both native platforms using the same local packet protocol. QR trust is reciprocal; choose a friend in Chats after explicitly connecting the test phones through Chats → connection icon beside QR. The iPhone link stays active across tab changes. Both apps now persist encrypted history and bounded own outgoing ciphertext. Use non-sensitive texts with both apps foregrounded.

See [iPhone setup and exact two-phone steps](ios/README.md) and [EXP-008](experiments/EXP-008-android-iphone-messaging.md). Software interoperability and actual Android-core relay checks pass; physical receipt/offline radio proof remains pending observation. This is not a production audit or reliable background-mesh claim.

For local notifications, recorded voice notes, reply actions and exact background limits, see [the 0.6.0 test checklist](experiments/EXP-009-voice-notifications.md). These features require both apps to be updated.

The [cross-platform mesh audit](docs/CROSS-PLATFORM-MESH-AUDIT.md) distinguishes implemented source behavior from unproven hardware results, and records the smallest justified adaptations. Version 0.6.2 improves composer/status styling; the existing encrypted voice-note cap remains 12 seconds / 32 KiB pending media-transfer experiments.

The [integrated research and calling specification](docs/LOCAL-CALLING-MASTER-SPEC.md) connects Knit, DTN, MIT and NIST research to quality measurement, routing, durable forwarding and adaptive audio inside these same LOKA apps. [EXP-011](experiments/EXP-011-quality-routing-adaptive-voice.md) defines evidence gates; live calling remains unimplemented.

Version **0.6.5** connects the Android/iPhone BLE route automatically while local connection is enabled; repeated per-link approval is no longer part of the default flow. QR friend verification remains required. Automatic physical link setup was observed; fresh message delivery/background recovery still require testing. See the updated [two-phone instructions](ios/README.md) and [validation record](docs/VALIDATION.md).

### Android 0.6.8 automatic nearby connections

Both Android phones need 0.6.8 for automatic BLE discovery/connection attempts. Enable local connection and grant required Nearby access. The normal BLE path does not require Classic pairing or adding a relay as a friend. Manual BLE topology control remains an engineering override. Recipients still verify each other for private messages. Existing iPhone packet framing is unchanged.

This is an experimental transport addition: physical two-Android delivery and mixed relay validation are pending. It does not yet provide authenticated-neighbor sessions, local Wi-Fi or measured best-route selection. See docs/LOCAL-CALLING-MASTER-SPEC.md and docs/VALIDATION.md for evidence and remaining gates.
