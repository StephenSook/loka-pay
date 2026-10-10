# Validation — October 2, 2026

| Check | Observed result |
| --- | --- |
| Debug APK assembly | Pass |
| Portable protocol/crypto/mesh/transport/contact-code/backup suite | 20 tests, 0 failures/errors |
| Android Keystore, messaging, QR, encrypted history and backup integration | 9 tests, 0 failures/errors on Android 16 / API 36 emulator |
| App installation / cold startup | Pass on Android 16 emulator |
| Native messaging preview | Chats, Nearby and You navigation checked on emulator; installed and cold-launched on connected Samsung SM-S948U1 |
| Lab startup after transport refactor | Cold launch succeeds; UI hierarchy confirms provider labels, peer controls, and loaded device fingerprint |
| Android lint | No errors; remaining warnings concern newer dependency versions |
| Bluetooth discovery / paired connection | Not run on physical phones |
| Simultaneous A–B and B–C radio links | Not run on physical phones |
| Three-phone ciphertext relay | Not run on physical phones; only actual engine JVM simulation tested |
| Screen-off / Doze / battery | Not measured |

Commands used from `android/loka-mesh-lab`:

```sh
./gradlew :core:test :app:assembleDebug :app:lintDebug
./gradlew :app:connectedDebugAndroidTest
```

The emulator Keystore test generated a real AndroidKeyStore identity, signed an envelope, verified its signature, decrypted its wrapped AES key and AES-GCM payload, and confirmed identity reuse. Emulator success does not establish hardware-backed storage or cryptographic compatibility on every physical device.

Build outputs (ignored by Git):

- APK: `app/build/outputs/apk/debug/app-debug.apk`
- JVM test report: `core/build/reports/tests/test/index.html`
- Android test report: `app/build/reports/androidTests/connected/debug/index.html`
- Lint report: `app/build/reports/lint-results-debug.html`

## Transport refactor verification

`MeshNodeTest` exercises the production node through an injected local transport: bidirectional A–B–C encrypted messages, no A–C shortcut, ciphertext-only relay diagnostics, stopped-link notifications, and ephemeral queue replay after reconnection.

`TransportCompositionTest` injects a provider into the real Android ViewModel. With no radio permissions or Bluetooth implementation, it receives an authenticated encrypted message, decrypts it through Android Keystore, produces an encrypted reply for the remote identity, and updates stopped-link state. This is a software integration test, not evidence of radio feasibility.

The latest APK was installed separately after instrumentation cleanup and launched through the new `LokaApplication` composition root. A UI hierarchy check confirmed selected provider labels, refreshed peer controls, and a loaded device fingerprint.

Native stale-socket/listener cleanup was reviewed in source and compiled/linted. Physical tests must still check reconnect races, radio shutdown, permission revocation, discovery, and simultaneous links. Cipher algorithms, signed packet bytes, and the v0 wire format were not modified by this refactor.

The first required hardware check is [EXP-003](../experiments/EXP-003-three-node-relay.md), after direct discovery and messaging pass. No physical-network success is claimed in this record.


## Engineering-note alignment

The [Wi-Fi radio note](WIFI-RADIO-VS-INTERNET.md) is preserved verbatim and referenced from AGENTS.md. The [source audit](LOCAL-NETWORKING-AUDIT.md) records local-only delivery, remaining Wi-Fi/concurrent-provider gaps, and Android permission semantics. Experiment instructions now separate enabled local radios from unavailable Internet uplinks; EXP-006 records the planned Wi-Fi/coexistence investigation.

This update changes documentation, transport-contract comments, and the lab's explanatory UI wording. Debug APK assembly and Android lint pass (zero errors). The packaged Bluetooth manifest was inspected and has no `INTERNET` permission; this is not a permanent rule for future Wi-Fi adapters. Existing core/instrumentation results above are from the transport-refactor validation, not new radio tests. No physical hardware result was added.

## Native messaging preview verification

The v0.2 preview opens to a native Compose messaging interface with Chats, Nearby and You tabs. The original engineering controls remain available under You → Mesh Lab. Empty conversations contain no generated contacts or messages. Sent messages enter the typed conversation only after the engine queues them; the UI does not claim delivery or read receipts.

The portable suite passes all 16 tests. Both Android instrumentation tests pass on the API 36 emulator, including authenticated inbound messages and queued outbound messages through the real ViewModel with an injected transport. Debug assembly and lint pass with zero lint errors. Instrumentation was installed and run explicitly on the emulator, avoiding test cleanup on the user's physical phone.

The update was installed over the existing app on a USB-connected Samsung SM-S948U1 and cold-launched. Screenshots were inspected on the emulator and physical phone; spacing was adjusted for the phone's larger text settings and system bar contrast. Emulator UI hierarchy checks confirm Nearby setup and profile/key/engineering controls. The previous physical lab screen reported listening with zero links: starting the local listener succeeded, but no second device was connected. These checks establish installation and UI behavior, not physical message delivery or relay feasibility.

## Contact-code and network privacy update

The subsequent contact update replaces raw-key transfer in the consumer interface with versioned QR/contact links, a native share sheet, PNG export, camera scanning and saved-image scanning. Network replaces Nearby and hides radio device names/addresses; manual peer setup remains in Mesh Lab. Verified phone-number lookup and authenticated automatic discovery are not implemented; see [the product direction and boundaries](CONTACTS-AND-DISCOVERY.md).

All 18 portable tests pass, including exact public-key/fingerprint preservation and rejection of malformed, unsupported or oversized links. All three Android instrumentation tests pass on the API 36 emulator, including an actual QR → PNG → ContentResolver image → decoder → exact public-key round trip. Image testing exposed an uninitialized bitmap sampling divisor; initialization was fixed and the full Android suite rerun successfully. Debug assembly and lint pass with zero errors.

Manual emulator checks confirm a valid external link opens explicit trust confirmation, an invalid link delivered to the already-open Activity disables Add friend, and the virtual camera scanner opens. The profile QR was visually inspected. This does not establish camera scan reliability on physical devices. The phone briefly disconnected from USB, then reconnected. The final APK was installed over the existing Samsung app and cold-launched successfully (390 ms); its UI hierarchy confirms My contact code and the contact QR. Physical camera decoding and phone-to-phone messaging remain untested.


## Encrypted history and manual backup — v0.3

The portable suite passes 20 tests; the emulator Android suite passes nine tests. New coverage checks full message history after ViewModel recreation, loss of live queue state across restart, encrypted payloads without readable body/peer/name, row-ID authentication, missing-key preservation, conflict-safe merging, malformed archive limits, wrong recovery keys, actual ContentResolver export/import and restore without granting contacts trust or transmitting old messages. Debug assembly and lint pass with zero errors. Markdown links resolve.

The final APK was installed over the Samsung SM-S948U1 app and cold-launched successfully (417 ms), preserving existing device identity and trust preferences. Emulator UI hierarchy confirms Create encrypted backup and Choose backup to restore, and window state confirms FLAG_SECURE for the backup screen. No real recovery key was generated or exposed during UI hierarchy verification.

The [explicit internal source review](../security/STORAGE-BACKUP-REVIEW.md) records storage/backup design and implementation findings. This is not independent cryptographic approval or physical mesh validation. History storage does not persist relay queues or replay caches. New archive format and recovery semantics are documented in [backup v1](../protocol/BACKUP-V1.md) and [backup boundaries](RECOVERY-AND-BACKUP.md).

Google Drive synchronization, backend storage, automatic backup scheduling and physical camera/radio delivery were not tested or implemented by this change. Manual export can select an available Drive document provider; successful provider writes do not establish cloud synchronization. Actual backup/restore byte round trips were tested against emulator-private files, with no access to the user's cloud account or physical conversations.


## Messaging-style profile and Settings redesign

The consumer profile is now a compact editable avatar/name card with a QR shortcut and grouped Settings rows. Chat backups, Privacy/trusted-contact controls, contact QR sharing, Connections and Help each open a real destination. The large QR card lives on its own page. Relay controls and Mesh Lab are under Settings → Connections → Engineering tools; the tab formerly called You is now Settings.

Debug assembly and Android lint pass with zero errors. Manual emulator UI hierarchy checks cover Settings entry, QR sharing/save controls, Privacy, Help, Chats/backups, and Connections → Engineering tools → back to Connections → back to Settings. Screenshots were inspected at normal and 1.3× system font scaling: rows expand/wrap and the page scrolls without overlap. No fake contacts, delivery status or unimplemented settings controls were added. Existing encryption/storage/network code was not changed; the previously recorded 29 automated tests were not rerun for this visual/navigation change.

The updated APK was installed over the authorized Samsung app and cold-launched. No coordinate taps were issued to the physical phone during design verification; interactive checks used the isolated emulator. The temporary emulator was closed after validation.


## iPhone interface preview — 2026-10-02

Added the native SwiftUI LOKA Xcode project, Chats/Settings navigation, locally persistent editable profile name, and honest Privacy/feature-status pages. No messaging engine, device identity, transport, encryption, QR contact exchange or backups were implemented. Android implementation and protocol bytes were not changed.

Unsigned device (arm64) and simulator builds passed with Xcode 26.6 / iOS SDK 26.5. Installed and launched the simulator build on an isolated iPhone 17e simulator running iOS 26.5. A settled startup screenshot was inspected and shows the Chats empty state, preview limitation and Chats/Settings tabs without overlap. An initial screenshot captured the launch screen and was replaced after the interface rendered. Interactive profile persistence and accessibility checks remain to be performed.

The connected iPhone SE (3rd generation), running iOS 26.3 beta, is paired and has Developer Mode enabled. Physical deployment did **not** succeed: Xcode could not mount the developer disk image, and a separate generic-device signed build failed because no development team is selected. The signing identity check returned zero valid identities. Opened the project in Xcode for Apple Account/team selection and device preparation. No physical app installation, messaging, radio interoperability or relay success is claimed.

## Cross-platform BLE link implementation — 2026-10-02

Added an Android BLE GATT peripheral, a minimal Classic/BLE provider manager, and an iPhone Core Bluetooth central with a Network connection/probe page. The transport boundary remains independent of messaging/routing. Existing Android device identity, encryption, trust and encrypted history were preserved. The public diagnostic probe contains no conversation or private identity data. iPhone chat encryption/contact identity is not implemented.

Android debug assembly and lint pass (zero errors, 12 warnings); all 24 portable tests pass, including four new BLE framing cases covering maximum 16 KiB frames at minimum MTU, chunk boundaries, timeout, unsupported flags, overflow, recovery and partial-frame replacement. Equivalent Swift parser checks pass on macOS. The unsigned iOS device build passes. These tests exercise transport framing and existing core behavior, not physical radio delivery or iOS encryption interoperability. Android instrumentation was not run against the user's physical data.

The Android APK was installed over the connected Samsung SM-S948U1 app using `adb install -r` and launched successfully. There is still no valid Apple signing identity available on the Mac, so the iPhone update was not installed. No two-phone BLE probe, encrypted cross-platform chat, relay, background or battery success is claimed.

Automatic approval review rejected the proposed Swift v0 crypto port twice: first for missing explicit review, then because the internal review was self-authored and did not constitute independent security authorization. The proposed crypto file was not written and no private keys were exported. The exact design, risks and pending approval are recorded in [iOS compatibility review](../security/IOS-V0-COMPATIBILITY-REVIEW.md). Remaining blockers are Apple account/team signing, device preparation if needed, and crypto authorization/implementation plus interoperability tests. A link-probe result cannot be substituted for encrypted message delivery.

## iPhone signing and physical installation follow-up — 2026-10-02

After the user selected their Apple development team in Xcode, the project contained a DEVELOPMENT_TEAM and the Mac reported one valid Apple Development identity. Signed device assembly passed. `devicectl device install app` successfully installed `org.loka.iospreview` on the connected iPhone SE (3rd generation); `devicectl device process launch` then launched it successfully. Developer disk image services succeeded during deployment, resolving the earlier device-preparation blocker for this attempt.

This establishes signed physical installation and process launch only. Two-way BLE probing and encrypted Android–iPhone chat have no observed physical success yet; the iOS cryptographic implementation remains blocked as described above. No phone data was reset or private key exported.

## iPhone contact QR and verified friends — 2026-10-02

Added native Keychain device identity, Android-compatible public contact QR/link sharing, native camera scanning, selected-image QR decoding, contact-link opening and explicit full-fingerprint confirmation. Public contacts/local labels persist with bounded parsing; own-key import is rejected. No message encryption, decryption, OAEP or private-key export was added. The rejected message-crypto implementation remains unwritten.

Native contact tests pass on macOS using a fresh ephemeral key: canonical RSA-3072 SPKI, exact link/fingerprint, malformed version/base64/exponent/trailing-key rejection, and actual QR → PNG → Vision → exact-key round trip. Android's actual contact decoder/encoder preserves the public Apple fixture and fingerprint exactly. All 25 portable tests pass. These are software compatibility results, not evidence of physical camera decoding or messaging.

Device and simulator builds passed before the Keychain-entitlement follow-up. Version 0.2.0 was installed over the existing iPhone app and launched successfully. Simulator visual QA then exposed missing identity access in an unsigned build: the required app-scoped Keychain entitlement and normal simulator signing resolved that error. A settled simulator screenshot confirms real Add friend/My contact code entry points, empty friend list and clear messaging limitation without overlap. The final physical entitlement signing pass is waiting for macOS Keychain authorization; it has not been recorded as completed. The already-installed signed 0.2.0 build has the same QR/contact application code and its existing application-identifier entitlement. No private keys or physical conversations were read or exported.

The [limited public-contact review](../security/IOS-CONTACT-IDENTITY-REVIEW.md) records native identity/QR scope separately from the [blocked message-crypto port](../security/IOS-V0-COMPATIBILITY-REVIEW.md). No physical encrypted Android–iPhone chat, BLE round trip, relay or background reliability is claimed.

## Seamless contact UI — 2026-10-02

Android debug assembly and lint passed; iOS simulator build passed after contact labels, real share navigation and one-time nearby permission explanations were updated. No cryptographic or transport behavior changed. These checks do not establish physical permission flow, camera scanning, automatic contact discovery or cross-platform messaging. Device installation and a physical UI walkthrough for this update remain to be performed.

## Simple friend confirmation — 2026-10-02

Android debug build and lint passed. iOS simulator and signed-device builds passed. Updated apps installed successfully on the connected Samsung and iPhone; iPhone launch succeeded. Simulator Chats screenshot visually checked for layout and plain capability wording. Friend-add confirmation and reciprocal QR sharing still require a physical walkthrough. Contact authorization, cryptography and sync behavior were not changed.


## Android ↔ iPhone messaging implementation — 2026-10-02

Implemented and installed native version 0.4. Android core JVM tests and app debug assembly/lint passed; iOS simulator and signed-device builds passed. Samsung update succeeded; iPhone installation and launch succeeded. Simulator Chats and physical Android conversation screenshots were visually checked for matching plain wording and green/ivory styling.

`sh tests/check-ios-messaging.sh` passed actual Android-core ↔ native Swift encryption, actual Android ciphertext relay/destination deduplication, signature/tag/OAEP/truncation/wrong-recipient/trust/expiry rejection, iPhone queue capacity, duplicate suppression and offline reconnect replay. Native public QR round-trip and BLE framing checks also passed. All interoperability private fixtures are ephemeral test-only keys; no physical private keys or real conversations were read/exported.

The first mutation-check crash was test code indexing a Foundation Data slice at zero; corrected checks use the slice startIndex. Application source compilation and the corrected suite passed. No crypto algorithm or Android packet version changed.

Physical two-way radio probe, actual encrypted receipt in either direction, offline-radio settings, tab-switch retention, background behavior and relay hardware proof are not yet recorded. [EXP-008](../experiments/EXP-008-android-iphone-messaging.md) has the procedure and pending result table. Installation and software vectors do not establish those outcomes. The iPhone stores at most 500 plaintext messages in process memory; Android encrypted persistent history is unchanged.


### Nearby preference follow-up — version 0.4.1

The user reports Waiting to send, with no recipient receipt recorded. Android radio checks show Bluetooth ON and LOKA registered in the Bluetooth diagnostics; a bounded recent AndroidRuntime log showed no crash. Exact iPhone Network state and Android test-connection state remain requested.

Both apps now resume local discovery/listening for already granted permission when opened, unless local connection was explicitly disabled. Android guards permission and radio activation before automatic startup; any system radio activation dialog follows an explicit user action. iPhone Off is in Settings and the connection is still app-owned across tab changes. Android conversation includes the same direct setup action as iPhone. This does not persist or silently grant lab link authorization or claim background reliability.

Final Android debug assembly/lint and signed iOS device build passed. Both physical updates installed successfully. Existing crypto compatibility checks remain unchanged. Actual encrypted receipt and one-time connection authorization are still required for the physical gate.


### Android approval/readiness fix — version 0.4.2

User reports Android-rejected writes on iPhone and Ready to connect on Android. Source confirmed iPhone published message readiness on subscription before Android allowlisting. A rejected queued write could also throw through MeshNode linkUp before its link-state callback. Corrected by gating iPhone data/replay on an outstanding successful two-way check, highlighting Android approval, retaining packets after per-link write exceptions and dispatching GATT-to-mesh callbacks outside the GATT monitor. A twelve-second check timeout avoids an indefinitely checking status. Explicit allowlisting/contact trust remain intact.

All 27 Android core tests passed, including queued rejection without suppressed link state, reconnect replay, and another viable encrypted route after a rejected direct write. Android debug assembly/lint, iOS simulator and signed-device builds passed. Native Java/Swift interoperability, Android relay, QR and BLE framing suite passed after the change. Android update installed. Physical post-fix approval, observed probe reply and text receipt still need verification; no physical success is inferred from these checks.

The signed iPhone 0.4.2 update also installed successfully; both app launches succeeded. Post-fix physical connection/message outcome remains pending.


## Shared messaging UX and guided approval — version 0.5.0

Both native apps now use Chats and Settings. Local connection is available from the conversation and Settings, with matching green/ivory cards, initial avatars, search and QR shortcuts. Android displays incoming connection consent over the current screen for subscribed peers only. iPhone automatically checks the user-selected phone with bounded retries; the message engine still waits for an actual public probe reply. Navigation does not stop the app-owned connection. Contact trust, encryption, packet version and Internet independence are unchanged.

Validation on October 2, 2026:

- Android core test task passed with the existing 27 tests up to date; final debug assembly and lint passed.
- Native Android-core Java ↔ Swift encryption/relay/negative/queue/replay suite passed, as did QR round-trip and BLE framing checks. New deterministic checks passed for retry pacing, attempt limit, cancellation and elapsed deadline.
- Final iOS simulator and signed-device builds passed.
- Android emulator navigation checks passed: Chats/Settings only, connection setup/back, QR share/save entry, Settings connection, engineering tools and back navigation. Android home, connection and Settings screenshots were visually inspected; the larger-font Settings capture showed no overlapping rows. No physical instrumentation or automated taps were used on personal phones.
- iPhone simulator Chats screenshot exposed unwanted native List chevrons inside custom controls; changed the layout to a scroll view and inspected the corrected screenshot. Contact removal is now a long-press action with confirmation. Other iPhone screens compiled; a complete interactive iPhone walkthrough remains pending.
- Final 0.5.0 updates installed over both physical apps, preserving data. Android launch succeeded. iPhone installation succeeded, but the launch request was rejected because the phone was locked; the user was asked to unlock and open it.

Physical evidence before this update: Samsung logged `Subscription: valid=true allowed=false` at 17:38:50. This establishes a subscribed link awaiting explicit permission. There is still no recorded successful physical probe or destination text receipt. The user has been asked to select the Android device from iPhone Chats → Connect nearby and tap Allow connection on Android. [EXP-008](../experiments/EXP-008-android-iphone-messaging.md) records the pending gate. Software success does not establish offline physical delivery, multi-hop mesh, automatic authenticated discovery, background reliability or receipts. iPhone history remains bounded process memory.

Design/API references checked: [Android navigation patterns](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns?hl=en) and [Apple acknowledged-write callback](https://developer.apple.com/documentation/corebluetooth/cbperipheraldelegate/1518823-peripheral). Familiar navigation groups the app's primary destinations; transport success still depends on callbacks and observed peer replies, not interface state alone.


Live follow-up after final installation: Android logged the version 0.5.0 automatic six-byte probe being accepted at 18:01:41 after earlier unapproved rejections. This establishes physical request reception after explicit approval. iPhone receipt of the reply and actual text delivery still require observation; a bidirectional chat test was requested. See EXP-008 for timestamps.


## Voice, local notifications and recipient-save receipts — 0.6.0

2026-10-02. Native implementations added on both platforms: short recorded AAC voice notes, typed encrypted content and recipient-bound save receipts, local notifications with reply actions, encrypted iPhone history, persisted own outgoing ciphertext, paced retries, duplicate submission guards, compact connection icon beside QR, keyboard-aware composers and draft clearing after queueing. Voice is limited to 12 seconds / 32 KiB. Outer packet-v0 cryptography is unchanged; see the [internal design review](../security/CHAT-NOTIFICATIONS-REVIEW.md).

Verification:

- All 32 Android core JVM tests passed, including content parsing/bounds, voice reordering/conflicts/expiry, authenticated receipt correlation, identical ciphertext restoration/retry and expiry.
- Android debug assembly and lint passed (0 errors; existing/dependency/style warnings remain).
- All 10 native Android instrumentation tests passed on isolated emulator-5560, including real Keystore encryption, encrypted history and backups, QR decoding, native notification with RemoteInput Reply, voice fragment assembly, intended-recipient ACK validation, immediate duplicate send suppression, repeated notification reply action suppression and persisted outgoing replay after ViewModel restart. Instrumentation was never run on either physical phone.
- Actual Android-core Java ↔ Swift encryption and Android ciphertext relay checks passed, including negative signature/tag/OAEP/trust/expiry cases. Shared content vectors, bounded voice assembly and encrypted Swift archive restart/tamper rejection passed.
- iOS simulator and signed-device builds passed. Android home and keyboard screenshots were visually inspected on the isolated emulator. The iPhone simulator showed the native notification permission prompt and compact connection/QR toolbar; a complete interactive voice/keyboard walkthrough is still pending.
- Both 0.6.0 physical updates installed over existing apps, preserving data. Samsung launch succeeded. Initial iPhone launch was refused because the device was locked, not because signing or installation failed.

The user then reported needing to re-establish Bluetooth after reopening and poor background behavior; device/dismissal details were requested. Read-only Samsung diagnostics showed LocalConnectionService running as a connected-device foreground service. No recent matching crash was returned by the bounded log check. Source inspection found missing ordinary iPhone reconnect and remembered-peer recovery. A follow-up iPhone build (0.6.0 build 8) remembers only the user-selected peripheral after an actual probe reply, submits one Core Bluetooth reconnect request, retries failures with bounded backoff, resumes on app activation, and cancels on explicit Off. Choose another phone clears that selection. No contact trust or Android transport approval is granted automatically. The follow-up signed build and deterministic known-peer/Off/backoff/reset tests passed. Build 8 installed successfully on the connected iPhone at 19:06 local time. Physical reconnect behavior remains unconfirmed.

Earlier foreground-only/no-iPhone-history/no-receipt statements describe previous builds. Current scope still does not establish physical text or voice delivery, native cross-platform audio playback quality, background reliability, mesh relay, route recovery or battery performance. Locked iPhone private operations defer until unlock; generic verified-ciphertext activity is not a message delivery receipt. Follow [EXP-009](../experiments/EXP-009-voice-notifications.md).

API references: [Android BLE background operation](https://developer.android.com/develop/connectivity/bluetooth/ble/background), [foreground-service types](https://developer.android.com/develop/background-work/services/fgs/service-types), [Apple Core Bluetooth restoration](https://developer.apple.com/documentation/corebluetooth/cbcentralmanagerdelegate/centralmanager(_:willrestorestate:)), [Apple connect](https://developer.apple.com/documentation/corebluetooth/cbcentralmanager/connect(_:options:)), [Apple notification replies](https://developer.apple.com/documentation/usernotifications/untextinputnotificationaction). Documentation supports the implementation choices, not claims of physical success.

## Optional contact naming and connection limits — 0.6.1

2026-10-02. Both apps now request Contacts access only after Use phone contacts in the add/verify flow. They query the on-device provider for an exact international-number match and fill an editable name; they do not grant identity trust, upload/cache the whole address book or persist the entered phone number. iPhone handles limited authorization as well as full access. No-match/ambiguous/denied cases retain manual naming. Existing QR bytes and message encryption are unchanged.

Both Local connection screens list text, the 12-second / 32-KiB voice-note limit and live calls unavailable. iPhone obtains actual connected-peripheral RSSI through readRSSI, labels its provisional nearby-signal band and invalidates it after 30 seconds/disconnect. Android's current adapter reports signal unmeasured. These labels do not establish end-to-end route quality or remote feature negotiation.

Android core tests, debug assembly and lint passed (0 errors). Two new native tests passed on emulator-5560: international-number normalization rejects national-only/extension/malformed inputs; real Contacts Provider lookup fills a synthetic contact name and rejects unmatched/different-country numbers with the same suffix. Synthetic records were deleted afterward. No physical contacts were read and no physical contact permissions were automatically granted. iOS signed-device and simulator builds passed. Native iPhone limited/denied access and physical RSSI behavior still need user testing.

[Knit review](KNIT-REVIEW.md) pins the external source revision and distinguishes source findings from unverified hardware claims. No Knit code or new transport/protocol was imported.

Version 0.6.1 installed successfully over both physical apps, preserving data. Samsung launch succeeded. Contact matching was verified using emulator fixtures; physical permission choices and signal samples remain user-driven checks.

## Composer/status refinement and cross-platform audit — 0.6.2

2026-10-02. Android and iPhone composers now use rounded input surfaces, clear focus borders and matching circular microphone/send actions. Pending bubbles are neutral; delivered bubbles are green. Unconfirmed status is amber and explicitly labeled (Android additionally uses an amber bubble tint), so color is not the only cue. Sending has a progress indicator. Existing draft clearing, submission guards and authenticated recipient-save logic are unchanged. Voice remains 12 seconds / 32 KiB; a proposed 60-second recording cannot fit the current content/queue bounds at the configured bitrate. No encryption, packet schema or routing changes were made.

Android core test task, debug assembly and lint passed. iOS signed-device build passed. The Java/Swift interoperability, Android relay, malformed crypto/packet cases, queue/retry/expiry, QR, reconnect policy, BLE framing, voice assembly and encrypted archive checks passed again. Android's empty fixture composer was visually inspected on emulator-5560. Physical status transitions, audio and screen-off reliability are still user/hardware gates; no success is inferred from UI appearance.

The [cross-platform audit](CROSS-PLATFORM-MESH-AUDIT.md) provides the message trace, full implementation matrix, current primary-source platform findings, Knit review, risks and KEEP/HARDEN/ADAPT/EXPERIMENT FIRST plan. [EXP-010](../experiments/EXP-010-cross-platform-audit.md) defines A–G topologies, blocked current iPhone roles and required measurement fields. No networking rewrite was undertaken.

Final iOS simulator build passed. Version 0.6.2 installed successfully over the physical iPhone. Samsung update was attempted but the USB device was disconnected; its installation remains pending. The APK is built at android/loka-mesh-lab/app/build/outputs/apk/debug/app-debug.apk.

An emulator-only synthetic send was visually checked: neutral pending bubble, Waiting for connection label and cleared composer; no transport was active. Final iPhone launch was refused because the device was locked. Samsung remained disconnected at the last check, so 0.6.2 must not be reported as installed there.

## Restoration and remembered transport consent — 0.6.3

2026-10-02. User reports endless iPhone restoration after prior connection. Source inspection found no setup deadline on restoration/recovery, an early return on foreground activation while connecting, and waiting for a new subscription callback even when the restored subscription was already active. Android transport approval was memory-only and lost on app restart.

Corrections: monotonic setup deadlines checked after suspension, restored-active subscription handling, 12-second acknowledged-write watchdog, bounded retry followed by a single OS-managed known-phone wait with no spinner, and explicit Android link approval persisted locally with a 32-entry cap. Consent revocation persists/disconnects. Handles are not authenticated identities; BLE address rotation/spoofing remains unresolved. No wire/crypto change or automatic contact trust. Older in-memory grants need one approval after update.

Swift deadline/backoff/approval/framing checks passed. Android core test task, debug/test APK assembly and lint passed; the injected native transport test passed on isolated emulator-5560, covering encrypted messages/history/queue restoration, remembered link approval after ViewModel recreation and persisted revocation. No personal-phone instrumentation or conversation/contacts export was used. Final signed iPhone build and deployment are recorded below when completed. Physical reconnect/message delivery remains a user-test gate.

Final signed iPhone build passed. Both physical devices report LOKA 0.6.3 / build 11 after successful in-place installation. Samsung launch succeeded; iPhone launch was refused because it was locked. Unlock/open LOKA and approve the link once on Android to test the migrated consent and subsequent automatic restoration. Installation and software checks are not physical recovery proof.

## Live restoration failure investigation — 0.6.4

2026-10-02. The user reports 0.6.3 still does not deliver messages. Do not describe its timeout change as verified automatic recovery. Physical Samsung service inspection showed a connected-device foreground service and local connection enabled. LOKA-only logs recorded BLE advertising; there were no connection/subscription/probe events in the retained diagnostic interval.

Physical iPhone console: restored peripheral state 1 (connecting), powered-on central, repeated remembered-peer timeout; a filtered scan observed another LOKA advertisement with remembered=false and selected=false. This is consistent with a stale peripheral reference; the new advertisement is not cryptographically linked to the saved friend, so its identity is not proven. Apple explicitly documents that a changed random address can invalidate a retrieved peripheral and requires rediscovery.

0.6.4 adds bounded service-filtered rediscovery alongside remembered recovery. When that attempt fails and other current candidates exist, it stops retrying the stale reference and enables explicit selection. It never treats a new advertisement as the old trusted friend. Development-only stage logs contain no keys, messages, contact names or radio identifiers. The previously missing Swift DEBUG condition is now configured for the Debug target. Android adds corresponding BLE stage logs.

Android debug and signed iPhone builds passed; Swift deadline/backoff/approval/framing checks passed. Both physical apps were updated in place and launched. Automatic identity verification across changed handles, radio bonding/address-resolution feasibility, autonomous mesh route repair and actual destination delivery remain unresolved. Current outgoing packets expire after five minutes, so tests after long diagnosis must use a fresh message. No production mesh success is inferred.

Reference: [Apple reconnection guidance](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/BestPracticesForInteractingWithARemotePeripheralDevice/BestPracticesForInteractingWithARemotePeripheralDevice.html), especially Reconnecting to Peripherals.

Physical follow-up at 20:14–20:15 (device log time): 0.6.4 rediscovery stopped the cached-reference loop, then the user-selected current peripheral connected and completed iPhone service discovery/subscription. Samsung recorded valid subscription with allowed=false, followed by rejected six-byte probes; after user approval it recorded allowed=true and accepted the public probe at 20:15:02. This demonstrates the live transport reached the approval stage and accepted a probe. iPhone receipt of the response and recipient message delivery still require confirmation. Console-attached runs are foreground diagnostic evidence only.

## Automatic consumer BLE admission — 0.6.5

The user rejected repeated per-link approval as incompatible with the product. Consumer BLE transport admission is now separate from contact authorization: compatible BLE routes are automatically admitted while local connection is enabled; engineering Manual BLE topology control retains explicit address allowlists. Explicit blocked handles are honored. iPhone rediscovers live candidates, uses bounded per-candidate cooldown/backoff and keeps untrusted route selection separate from verified friends.

The public check reply now precedes queued payload while preserving the in-flight fragment; Android publishes route readiness only after the reply indication is acknowledged. Complete-frame/probe ingress has a per-peer burst/rate budget before signature processing. No encryption, packet wire format, QR trust or recipient receipt changes. The [internal admission review](../security/LOCAL-LINK-ADMISSION-REVIEW.md) records trust boundaries and residual abuse/metadata limitations.

Android core tests, assembly and lint passed, including four new tests for changed-handle/manual/block policy, actual unknown-sender plaintext rejection, bounded ingress and non-corrupting probe priority. Swift candidate/deadline/backoff/approval/framing checks pass. Physical rollout/results follow below.

0.6.5 physical run (20:29 device log time): both in-place updates and ordinary app launches succeeded. With default automatic mode, Samsung recorded valid subscription/allowed=true, accepted public probe and reply indication acknowledgement (`packet route ready`) at 20:29:33.941. No new user per-link approval was requested in this run. This is automatic BLE route-setup evidence, not recipient message delivery or screen-off recovery proof. A fresh bidirectional text/receipt test was requested. Signed iPhone build passed; both installed versions were checked separately.

## 2026-10-02 — 0.6.6 (build 14): receipt retry and message layout

- Android/iOS receipt creation no longer immediately discards the encrypted ACK. Normal bounded retry, restart persistence, reconnect replay and expiry apply. Duplicate receipt creation is suppressed during its lifetime; receipts do not acknowledge receipts.
- Explicit 12-hour local times on conversation and chat-list rows. Android bubbles cap at 88% of available row width / 420 dp; iOS metadata no longer has an expanding spacer that stretches short text bubbles. Long text still wraps; existing voice controls remain.
- Android manual engineering approval now identifies that mode and offers a direct switch to automatic connections, also available on the Local connection page. Automatic BLE policy itself is unchanged from 0.6.5. The user's repeated approval prompt has not been observed directly in this session: physical Android was absent from adb, so app-vs-system prompt remains unconfirmed.
- Android core tests, debug APK and lint passed. Signed iOS build passed. Actual Android-core/Swift crypto interoperability, receipt ciphertext restore/expiry, contact QR, framing/recovery and archive checks passed.
- iPhone installation verified as 0.6.6 (14). Launch was refused because the phone was locked. Physical Android update and bidirectional/locked-screen receipt testing remain pending.
- Limits: iOS protected private operations still await unlock. Five-minute expiry is unchanged (user confirmed request was for the 12-hour clock). Image attachments are not implemented; encryption is not compression. This is not proof of background mesh reliability.

Emulator-only regression: `TransportCompositionTest` passed (1 test) on `emulator-5560`. It injects duplicate encrypted content after disconnect, verifies one saved bubble, then reconnects and verifies exactly one retained receipt replays. It also exercises existing encrypted storage/outbox restoration and approval persistence. No synthetic test ran on either physical phone.

## 2026-10-02 — Android 0.6.7 (15): radio recovery lifecycle

Android foreground service now retains radio-state monitoring while local connection is enabled, independently of Classic transport teardown. OFF pauses Classic/BLE without clearing trust or the enabled preference; actual ON resumes within the existing service; explicit Off prevents recovery. Notification text reports radio-off/paused status honestly. Removed stale setup text instructing consumer BLE approval.

Validation: `:core:test :app:assembleDebug :app:lintDebug :app:assembleDebugAndroidTest` passed. `TransportCompositionTest` on emulator-5560 passed (1 test), adding injected radio-loss/recovery, trust retention, queued-packet replay and explicit-Off checks. No physical-radio or new authentication evidence. Phone not connected at deployment check; physical install pending. iOS stays 0.6.6 because this is an Android-specific fix. See master specification and security/RECONNECT-DESIGN-REVIEW.md for remaining authenticated-session work; 0/100 qualifying physical cycles unchanged.

## 2026-10-02 — Phase 2 software preparation and Android rollout

`:core:test` passed: 37 tests, 0 failures/errors. Added three-node destination-receipt regression through an untrusted/no-contact relay, lost return-write recovery, fake relay receipt rejection, reverse delivery and relay-off control. No crypto/wire or runtime forwarding change; the existing implementation is under test. Expanded EXP-003 physical procedure and corrected relay-restart control to exclude sender replay.

Samsung 0.6.7 (15) in-place installation succeeded. Only one physical Android is connected; two more are needed. Physical Phase 2 remains pending and Phase 1 remains open. No new range, power, multi-peer or background capability claim.

## 2026-10-02 — Android 0.6.8 (16): automatic BLE client

Implemented Android BLE scanning/client transport and ephemeral token role election alongside the existing peripheral. Unchanged GATT framing/public probe/encrypted packets; Classic remains available for explicit engineering control. Candidate/session/queue limits, deadlines, scan-error retries and stop cancellation documented in the admission review.

39 core tests passed; debug APK, lint, test APK and emulator TransportCompositionTest passed. Android-core/Swift interoperability suite passed. New native BLE callback behavior has not yet been exercised between two updated physical Androids. First Samsung installation/version verification and launch succeeded; scoped LokaBle log reports advertising. Second Samsung is USB unauthorized, so its update is pending. No automatic Android pair, message/ACK, mixed relay, range or power success is claimed.

## 2026-10-02 — two-Android automatic BLE setup observed

After the computer ADB service was restarted and the user accepted USB debugging on the second Samsung, installed 0.6.8 (16) there in place and verified its version. Both Android apps were opened normally. Scoped LokaBle diagnostics show the new Samsung (SM_S926U) reporting `BLE automatic outgoing route ready` at device-log time 21:59:06.633; the first Samsung (SM_S948U1) records valid subscription, allowed=true, accepted six-byte probe and reply indication acknowledgement/packet route ready around 21:59:06.749–.787. Device clocks are not calibrated; these are stage observations, not latency measurements.

No Classic pairing or LOKA per-link approval was requested by the operator for this setup. This is physical automatic Android BLE link-setup evidence only. No fresh application-message/recipient receipt, relay, reconnect-cycle, range, background or battery result was observed. USB authorization is computer debugging permission and is separate from peer connection approval. Both Androids now have 0.6.8; iPhone remains on its compatible 0.6.6 build.

## 2026-10-02 — 0.6.9 (17): QR hub and Nearby interface

Native Android/iOS My code / Scan code navigation, redesigned QR card and Chats/Nearby controls added. Nearby shows anonymous connection status and explicit add/share entry points, not discovered people's identities. Existing camera/image/link review and contact trust preserved. Corrected the iOS Chats timestamp row to the existing explicit 12-hour helper.

Android APK/lint and signed iOS build passed. Isolated emulator QR page visually inspected; switching to Scan code showed Open camera / Choose QR image / Paste contact link. Final Android chip selection uses the existing green palette. QR data/rendering algorithms and wire/crypto unchanged; no camera hardware scan or new relay-distance claim. iPhone installed and verified 0.6.9 (17). First Samsung updated in place; second Android absent from adb and still needs update. Secure wireless-debugging discovery returned no services; setup pending, and USB-free testing remains possible without a debugger. See EXP-010 for offline/debugger controls.

## 2026-10-02 — 0.6.10 onboarding and adaptive appearance

- Android: `:app:assembleDebug :app:lintDebug` passed. iOS signed device build and iOS Simulator build passed. No packet, crypto, route-selection or delivery-receipt changes in this update.
- Both platforms now offer a local profile name step, nearby-access action, optional notifications action, and Open chats. Existing device keys/contact history are preserved. Completion is persisted; this is device setup, not account registration or LOKA Number issuance.
- Removed forced light appearance on iOS; introduced Android dark palette and semantic surfaces for chat composer, bubbles, profile/QR cards and connection screens. QR images retain a white background.
- Isolated Android emulator: inspected dark name step and light permission step; entered synthetic name LokaTest; finished without enabling radios/notifications; restarted emulator app and confirmed Chats remained visible (onboarding completion persisted). Screenshots `/tmp/loka-0610-android-dark.png`, `/tmp/loka-0610-android-light.png`.
- iOS simulator onboarding rendered; complete visual/interaction review remains outstanding because a notification authorization alert obscured the screen. Only the onboarding notification button calls requestPermission in current source. No physical permission buttons were automated.
- Installed via in-place updates and verified version **0.6.10 / 18** on Samsung [adb-serial-redacted], Samsung [adb-serial-redacted] and iPhone [device-id-redacted]. Android launch requests succeeded. iPhone install succeeded but launch was denied because it was locked; user must unlock/open it.
- User selected visible self-chosen names when nearby people discovery is on, with approval for new chats. Recorded in CONTACTS-AND-DISCOVERY; profile exchange and over-the-air request acceptance remain unimplemented. QR remains necessary to add a new friend in this version. Automatic transport selection, multi-hop range and background reliability are not established by this UI validation.

## 2026-10-02 — 0.6.11 plain-language, permission-aware setup

- Replaced device-identity explanations in onboarding with name and messaging benefits. Both platforms show Step 1 of 2 / Step 2 of 2 plus progress.
- Permission checks use OS authorization rather than whether the messaging service happens to be running. Granted permissions appear completed without request buttons. An inactive connection retains a separate Turn on nearby messaging action. Continue skips the permission screen when both permissions and nearby messaging are already enabled.
- Android refreshes authorization after permission results and activity resume; iOS refreshes on scene activation and Bluetooth state/status changes. Denied notifications offer Settings rather than repeatedly issuing an ineffective request. Setup can still be completed without granting permissions; existing completion is preserved.
- Android assembleDebug/lintDebug passed; signed iOS build passed. Isolated emulator with synthetic profile and granted nearby/notification permissions showed completed checks, no Allow nearby access or Turn on notifications button, and a separate connection activation action. Inspected `/tmp/loka-0611-granted.png`. iOS permission transitions and automatic full-step skipping still need physical interaction validation.
- In-place install and version metadata confirmed 0.6.11 / 19 on both Samsungs [adb-serial-redacted] and [adb-serial-redacted] and iPhone [device-id-redacted]. No physical phone onboarding flags or permissions were reset. No networking protocol changes.

## 2026-10-02 — 0.6.12 focused onboarding, Nearby and camera UI

- Android core tests: 39 passed, zero failures/errors. Android assembleDebug/lintDebug and signed iOS build passed.
- Android emulator: granted permissions skipped from name directly to Chats; Scan code opened LokaScanActivity; custom frame/viewfinder inspected; in-app back arrow returned to My LOKA. Initial screenshot `/tmp/loka-0612-scanner.png` exposed missing horizontal safe-area padding; corrected inset handling and rebuilt/linted successfully. Final padding revision and iOS camera framing have not had equivalent visual review. No claim of physical camera decode success in this turn.
- Nearby renders discovered LOKA candidates instead of QR/add controls; generic labels intentionally do not assert authenticated profiles. Android now reports matching advertisements before unchanged connection-role election. Consumer observations are bounded/expire; no message format or cryptography change. Multi-phone discovery completeness, expiry under radio loss and reciprocal contact exchange are not physically proven.
- Verified in-place 0.6.12 / 20 installs on Samsung [adb-serial-redacted], Samsung [adb-serial-redacted] and iPhone [device-id-redacted]. Phone data and permissions preserved.
- Automatic reciprocal contact sync remains unimplemented and must not be inferred from these UI/build results. See CONTACTS-AND-DISCOVERY for required approval/acknowledgement flow.

## 2026-10-02 — 0.6.13 compact chat UI and bounded media

Implemented on Android and iOS:
- Smaller QR card; Android prevents repeated camera launch requests; one prominent QR action replaces the duplicate plus/header QR controls. Separate Better together invite card for empty chats shares the real installed-app contact link, not an invented download URL.
- Circular contact-name editing and a tappable security explanation replace the colored privacy/edit strip. Nearby shows fresh available signal estimates without claiming distance or a destination route.
- Up-to-60-second AAC voice recording (requested mono 16 kHz / 12 kbps, 96 KiB cap), real microphone-level bars and elapsed timer. Removed repetitive idle voice-limit text. Physical codec quality, full-duration recording size and delivery speed remain unmeasured.
- Photos: picker → resize/orientation normalization → JPEG re-encoding with 1024-pixel / 64 KiB limits → preview → explicit Send photo → existing encrypted outbox/receipt path. Android backup history version 3 adds image type while retaining v1/v2 readers. iOS optional image field reads old archives.
- Media testing found the old Android encrypted-row 64 KiB cap prevented large media history reopening. Corrected the bounded cap to include Base64, JSON escaping and packet IDs, preserving existing ciphertext format. A full BLE client queue no longer deliberately disconnects; the already-persisted message remains pending for retry. This queue behavior still needs stress testing over radios.

Validation: Android core 40 tests, zero failures/errors; Android build/lint passed; signed iOS build passed; Java/Swift interoperability suite passed, including JPEG bounds/reassembly, 96 KiB voice and encrypted media archive restore/tampering checks. Isolated emulator instrumentation passed **8 tests**, including orientation/metadata removal, media history/backup, encrypted incoming image receipt, notifications and duplicate-send handling. QR page inspected at `/tmp/loka-0613-qr.png`; both share actions fit the tested emulator viewport. No physical UI automation or physical conversation export performed.

Verified in-place version **0.6.13 / 21** on both Samsungs ([adb-serial-redacted], [adb-serial-redacted]) and iPhone [device-id-redacted]. All media endpoints must update; no capability negotiation exists. Requested a manual two-direction photo/voice delivery test. No physical media Delivered result has been reported yet.

Still incomplete: shared nearby profile names/photos, automatic reciprocal contact approval/sync, public app-install invitation URL, authenticated nearby identity binding, and reliable mesh/background/range proof. Generic device labels are retained rather than inventing names. Signal estimates depend on a fresh supported measurement and are not meters. The media update does not pass these separate networking gates.
# Contact consent experiment — follow-up to 0.6.13

Implemented isolated Kotlin/Swift LC1 consent books; see [EXP-013](../experiments/EXP-013-contact-consent.md). Final `:core:test` passes all 45 tests (five new consent tests). `sh tests/check-ios-messaging.sh` passes, including actual encrypted Swift request → Kotlin acceptance → Swift acknowledgement interoperability with disposable identities and the existing message/QR/framing/archive regressions. Logs: `/tmp/loka-consent-core.log`, `/tmp/loka-consent-interop.log`.

Tested: explicit approval, canonical content, malformed Unicode/Base64, wrong sender/request/deadline, lost control replies, duplicates, expiry, decline/block and bounded incoming records. No physical consent exchange, production request persistence, Nearby identity binding or approval UI is claimed. No phone deployment or version bump was performed for this isolated work; installed app behavior remains 0.6.13. Production mesh trusted-sender gates were not relaxed. The Swift consent source is compiled by the experiment runner, not yet added to the application target.
# 0.6.14 / build 22 — message info, reactions and compact chat chrome

Implemented on Android and iOS: status symbols beside the 12-hour timestamp, long-press message info/copy/reactions, six emoji reactions and removal, persistent reported-hop metadata, recipient hop reports, and reaction acknowledgements. Android removes a duplicate status-bar inset and consumes Scaffold insets before keyboard padding. iPhone moves avatar/name/security into its native navigation toolbar, removing the extra header row. The explanatory delivery banner is moved into message info.

Validation completed:

- Android build/lint passed; core tests: **46 passed**.
- Signed iPhone build passed.
- `tests/check-ios-messaging.sh` passed, including new H/R codec/order and encrypted archive metadata checks plus existing Kotlin/Swift encryption/relay/consent checks.
- Isolated Android emulator: **8 integration tests passed**, including wrong-contact hop/reaction rejection, reaction acknowledgement matching, and history/backup metadata round-trip. These exercise the real Android ViewModel with a synthetic transport, not physical radios.
- Android chat header/status and long-press dialog visually reviewed using only synthetic emulator history. Screenshots: `/tmp/loka-0614-chat.png`, `/tmp/loka-0614-info.png`; the latter preceded the final neutral dialog surface/text wording polish. Equivalent iPhone visual/gesture testing remains a user-device check.
- In-place install verified **0.6.14 (22)** on Samsung SM_S948U1, Samsung SM_S926U and iPhone SE (3rd generation); all launch commands succeeded. No data reset, device-key replacement or physical conversation inspection was performed.

Logs: `/tmp/loka-message-info-android.log`, `/tmp/loka-message-info-final.log`, `/tmp/loka-message-info-ios.log`, `/tmp/loka-message-info-interop.log`, `/tmp/loka-message-info-instrumentation.log`.

Reported hops are **unverified packet-counter estimates**: direct=1; media uses the packet completing reassembly. They are not authenticated relay paths, measured distance or proof of a mesh. Old messages may have no report. Physical bidirectional reactions and hop reports still require testing; software success does not establish radio range/background reliability. See the [content extension](../protocol/CHAT-CONTENT-V1.md) and [internal review](../security/MESSAGE-INFO-REACTIONS-REVIEW.md).
# 0.6.15 / build 23 — reactions, message details, camera and read receipts

Android and iPhone now use hold-to-react and double-tap-to-info. Details show short sent/delivered/read rows, reported hops only when present, and a brief encryption label. The header security lock has a soft circular background. The composer separates camera capture from + library selection. Prepared photos show explicit Send/Remove while hiding the normal composer, avoiding competing send actions.

Read confirmation is now encrypted B content with the recipient's persisted viewed timestamp. Only active conversation viewport visibility records new reads; background delivery and notifications do not. Grey checks mean saved-message confirmation; blue checks mean read confirmation arrived. Read is display status, not proof of comprehension or voice playback. Existing signed/encrypted v0 packet handling, queue limits, expiry and sender trust remain in effect.

Completed validation:

- Android core: **47 tests passed**; app build and lint passed.
- Signed iPhone build passed.
- Swift/Kotlin interoperability/archive suite passed, including canonical B timestamps and read metadata archive round-trip.
- Isolated Android emulator: **8 integration tests passed**, including background-notification exclusion, explicit visible conversation read, wrong-recipient and future-timestamp rejection, reaction/hop handling and encrypted persistence.
- Android visual checks: composer camera/library separation, compact reaction picker on long press, and short details on double tap. Synthetic emulator camera capture returned successfully to a compressed photo preview with Send/Remove. The capture was not sent. Screenshots: `/tmp/loka-0615-composer.png`, `/tmp/loka-0615-reactions.png`, `/tmp/loka-0615-info.png`. Final photo-preview composer hiding is a subsequent compiled layout adjustment.
- In-place installs verified **0.6.15 (23)** on Samsung SM_S948U1, Samsung SM_S926U and iPhone SE (3rd generation). Android launch commands succeeded; iPhone launch was denied because the phone was locked, so unlock and open LOKA manually. Contacts, history and device keys were preserved; no physical UI automation or private conversation inspection was performed.

Logs: `/tmp/loka-0615-android.log`, `/tmp/loka-0615-android-final.log`, `/tmp/loka-0615-ios.log`, `/tmp/loka-0615-interop.log`, `/tmp/loka-0615-instrumentation.log`.

Still requires user-device testing: native iPhone gestures/camera, bidirectional physical read confirmations and reaction/photo delivery. Software validation does not certify radio/background reliability. Read confirmations may remain unconfirmed after the existing five-minute retry expiry, and hop reports remain estimates. See [chat interactions](CHAT-EXPERIENCE.md), [protocol](../protocol/CHAT-CONTENT-V1.md), and [security review](../security/MESSAGE-INFO-REACTIONS-REVIEW.md).

## 0.6.16 data controls

Android emulator only: opened Settings → Privacy, verified destructive confirmation with backup-first/cancel alternatives, deleted synthetic app data, waited for the OS operation and reopened. Empty “Step 1 of 4 · Your name” appeared and the synthetic profile was absent. The OS clear request closes the app asynchronously; immediately launching before it finishes can be stopped by that same clear operation. Physical devices were not reset.

iOS deletion has compile validation only, not simulator/device execution. Onboarding backup preference does not establish cloud backup. Group messaging, iPhone archive export/restore and cloud backend provisioning remain incomplete.

Final packaging: Android core regression suite, assembleDebug and lintDebug passed (`/tmp/loka-0616-android.log`); signed iOS build passed (`/tmp/loka-0616-ios.log`); Swift/Android messaging checks passed (`/tmp/loka-0616-interop.log`). Installed and launched 0.6.16 build 24 on connected Samsung [adb-serial-redacted] and iPhone SE [device-id-redacted]; both installed versions verified. The second Samsung was not connected. No physical reset or live messaging/group/backup test was performed.

## 0.6.17 chronological message presentation

Android delayed-arrival regression passed, covering equal send times and delivered/read timestamps that must not move messages. Android assembleDebug and lintDebug passed (`/tmp/loka-0617-android.log`). Swift checks cover multiple arrival permutations, latest-preview selection and encrypted archive reload; the protocol suite passed (`/tmp/loka-0617-interop.log`) and the final Swift archive/tamper check passed after preserving the existing plaintext-exposure assertion. Signed iOS build passed (`/tmp/loka-0617-ios.log`). Installed build 25 / version 0.6.17 on both connected Samsungs and the iPhone. No physical chat contents were inspected and no live message ordering test was performed. Group entry is informational; group delivery remains unimplemented. Sender clocks determine chronological order; this UI change cannot establish causality between unsynchronized phones.

## 0.6.26 required Nearby onboarding

Android testDebugUnitTest, assembleDebug and lintDebug passed. Signed iPhone build passed. Logs: `/tmp/loka-required-onboarding-final-android.log`, `/tmp/loka-required-onboarding-release-android.log`, `/tmp/loka-required-onboarding-final-ios.log`.

Fresh onboarding was exercised only on the isolated emulator. Assertions against the actual UI hierarchy confirmed no skip/Not now/premature Settings on required Nearby; a real native denial changed the action to Open app settings with description instructions; the action opened the LOKA app settings; granting Nearby devices there and returning advanced to Notifications with its optional forward control. Name and denial layouts were visually inspected. Captures: `/tmp/loka-onboarding.png`, `/tmp/loka-denied.png`. The progress/control colors were subsequently matched to LOKA's green palette and rebuilt/linted successfully. No physical data was cleared and no physical permission was changed by automation.

In-place install succeeded on Samsung [adb-serial-redacted] and iPhone SE [device-id-redacted], version 0.6.26 build 34. Samsung launch and package version verification succeeded. iPhone launch was denied because the phone was locked; unlock and open it manually. The second Samsung was absent from adb, so it was not updated in this run. Existing physical profiles and message history were preserved; their completed onboarding was not reset. iPhone permission recovery remains build-validated, not physically exercised. No live delivery or conversion uplift is claimed.

## 0.6.27 short battery setup

Android assembleDebug and lintDebug passed (`/tmp/loka-short-battery.log`). On the isolated emulator, the background step showed one short benefit explanation and Allow background messaging, without premature Settings instructions. Tapping it opened Android's native “Let app always run in background?” dialog with Deny and Allow. Denying returned to the same step and changed its action to Open battery settings with a short instruction. The final layout additionally removes the initial benefit explanation during recovery; build/lint checked in `/tmp/loka-short-battery-final.log`. No physical phone battery setting was changed or permission automatically granted. This does not prove improved background delivery or override OEM sleep controls.

Final 0.6.27 build 35 installed in place on connected Samsung [adb-serial-redacted]; launch and installed version were verified. Physical profile, messages and battery settings were preserved. The second Android was disconnected. iOS has no equivalent Android exemption prompt and was not rebuilt for this Android-only step.
