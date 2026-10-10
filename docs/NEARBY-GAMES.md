> Current focus: Party Cards. The four-game shelf is restored; see [Cards implementation](PARTY-CARDS.md). The Quick quiz work below remains a separate fourth game and its earlier evidence does not prove Cards.

# Nearby games: untimed Quick Quiz vertical slice

## Inspection before implementation

The existing Android `MeshNode`/`MeshEngine` and Swift `LokaMesh` already deliver signed encrypted application plaintext over the native local transport managers. Verified profiles bind opaque handles to device identities; automatic routing uses existing queue-aware selection, fallback and bounded carrier authorization. Relays retain ciphertext. The ChatStore/LabViewModel application owners provide the suitable integration boundary, with protected local archives, chat-specific content parsing and receipt handling. Play was a nonfunctional design preview on both platforms.

The networking audit contains later implementation updates that supersede historical “not implemented” rows. Recorded 2026-10-04 foreground Bluetooth and shared-LAN relays do not establish fast game synchronization or reliable background play. The supplied party UI reference establishes purple/mint card surfaces, simple game states and an adaptive library, not proof of a game engine.

Validated `gameJson/games.json`: eight games, 218 uniquely identified party prompts. No multiple-choice options or answer keys; these are not suitable quiz questions. The catalog remains bundled for later party-game work. `gameJson/quiz/quick-quiz-v1.json` supplies ten clean multiple-choice questions, stable question IDs, pack/game/rules version 1 and an exact-byte SHA-256 fingerprint, loaded and validated independently by both apps.

## Implemented behavior

Play → Quick Quiz → invite a verified friend. A matching capability/pack response precedes the invitation. The other phone explicitly accepts from the invitation alert or Play screen. An authoritative initial snapshot opens the same session. Players alternate untimed questions, one point per correct answer, with five questions each. Both devices recompute the same scores from committed answers. Question index maps to the local pack ID; neither questions nor answer keys cross the network.

`QuickQuiz.kt`/`QuickQuiz.swift` own rules/state. Their injected send/save/discard callbacks know no radio APIs. The existing app owner demultiplexes `L1|G|` before chat decoding and sends through the existing encrypted messaging boundary with automatic routing. Older chat decoders reject the reserved unknown G type. Existing packet layouts and chat content are unchanged. No game content, game acknowledgment, or invitation is appended to chat history or used as a chat delivery receipt.

The host authorizes revisions, and guests submit action UUIDs against a base revision. Applying the same action twice cannot advance twice. Stale exact commits ACK; revision gaps request recovery; conflicting prefixes/choices and invalid senders/turns reject. A guest draft survives expiry/restart and is either confirmed by a snapshot or resubmitted with the original action UUID. The host waits for applied acknowledgment. If a snapshot ACK confirms earlier commits, their outstanding envelopes are retired too.

Resume / sync requests a bounded authoritative prefix. Both platforms restore protected game state independently from chat history and disable answering until session confirmation. Old snapshots cannot roll back answers. Host absence pauses; there is no host election. End/Leave closes the session and informs the other participant through acknowledged ordinary delivery. Simultaneous invitations do not merge; end the existing invitation before creating another. Failed storage rolls back state and prevents applied acknowledgment.

## Bounds and network costs

One session; ten committed answers; one pending guest draft; eight pending events; 64 recently applied event IDs; 1,024-byte ASCII event maximum; 16-KiB persisted game-state maximum. Invitations and encrypted event envelopes expire after at most 120 seconds; accepted sessions expire after 24 hours. The existing signed packet expiry is selected before encrypting/signing; normal chat lifetimes are unchanged. Relays can prune expired game ciphertext without reading it. Expired moves do not silently become new turns; explicit recovery uses snapshots and saved action IDs.

Game sends are admitted only while the local origin queue has fewer than 96 packets, below the existing ordinary/carry and receipt limits. The game engine creates at most one new queued event per maintenance pass, uses ordinary transport priority, and delegates retries to the existing mesh. Disposable applied ACK/capability responses are rate-limited per event; dropped ACKs are regenerated when the source event is retransmitted. No countdowns, animation ticks, broadcast discovery or independent radio connection exists in the game code.

The UUID/hash-based ASCII application event is small relative to bundled content but is not a 30-byte optimized format. Existing RSA wrapping, public keys, signatures, route metadata and framing add substantial bytes. `tests/check-game-protocol.sh` prints a measured capability-event plaintext/encrypted-packet size using fresh synthetic keys. Carrier grants add further bytes. Acknowledgments, retries and hops increase traffic. Do not equate payload size with total air traffic.

## Verification and limitations

Run Android core tests/build/lint, `tests/check-game-protocol.sh`, and the unchanged `tests/check-ios-messaging.sh`. The game suite drives a live JVM peer against Swift with either host role, ten answers, duplicate commits, lost authoritative commits, restart recovery and matching scores. Kotlin tests also cover gaps, conflicting snapshots, lost ACKs, expired drafts, invalid moves/participants/packs/versions, queue/storage bounds and failed persistence. Encrypted relay tests carry games alongside chat and a chat receipt, verify relay inability to decrypt, reject game priority, and preserve queue reserve for chat. Swift checks cover signed short expiry, unchanged chat defaults, isolated encrypted persistence and tamper rejection.

These are software checks. The two-device offline game experiment is [EXP-NEARBY-GAMES](../experiments/EXP-NEARBY-GAMES.md). No physical game result is implied by pre-existing message experiments, simulator rendering or a signed build.

The host can cheat and installed answer keys can be inspected. No anti-cheat or malicious-host guarantee. There is no timed mode, group-game session, host migration, automatic cloud delivery, push-game invitation, production cryptographic review or perpetual background relay. Slow/intermittent routes may require Resume; they cannot promise real-time play. Both apps require matching game/rules/pack versions. Unsupported peers time out instead of falling back into chat. Invitations from discovered unverified devices remain prohibited; existing contact verification is separate from game acceptance.

Protocol and implementation threat review: [game events](../protocol/GAME-EVENT-V1.md), [security review](../security/GAME-EVENT-V1-REVIEW.md).

## Recorded software validation (October 5, 2026)

Android: 103 core tests passed; debug APK build and lint passed. Native Kotlin–Swift game tests passed in both host directions; all existing messaging/nearby/relay/carry regression checks passed. Signed iOS device build passed with existing development signing. The Android Play screen was installed and visually inspected on the emulator; that confirms UI/asset loading, not physical multiplayer.

A synthetic capability event measured **167 plaintext bytes and 1,601 encrypted v2 packet bytes before transport framing**. The pack hash and question data remain local; snapshots are larger but bounded. Counts are one packet at the source, not total retransmission/relay radio traffic.

Physical offline game verification remains pending because only an Android emulator is connected and Internet isolation of the connected Apple devices has not been confirmed. No game synchronization latency or reliability measurement on hardware is claimed.

## Native emulator and simulator UI validation

The native screens now have repeatable UI tests: Android `QuickQuizUiTest` and `QuickQuizAppSmokeTest`, and Apple `QuickQuizUiTests` in the `LOKAUITests` Xcode target. Production owners still supply all state and delivery. Tests reuse the actual Compose/SwiftUI presentation and actual QuickQuiz engines; the second player uses in-memory application-event delivery. The Apple fixture is restricted to Debug **and** Simulator builds and requires an explicit launch argument. It is absent from physical-device and Release builds.

Game-flow cases cover host invitation, guest acceptance, disabled answers during the other player's turn, ten answers with a 5–5 result, duplicated authoritative commits, a saved-state restart followed by Resume / sync, and End/Leave. Android guest UI runs at 1.6× font scale. Apple checks include iPhone Dynamic Type accessibility-extra-large, iPad portrait, and landscape controls. Separate normal-app tests open Play through the actual application root and check the bundled pack loads through LabViewModel/ChatStore. Screenshots and machine-readable results are in [the UI evidence directory](../experiments/results/2026-10-05-nearby-games/ui/).

Run Android UI tests on an isolated emulator:

```sh
cd android/loka-mesh-lab
./gradlew :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=org.loka.meshlab.QuickQuizUiTest,org.loka.meshlab.QuickQuizAppSmokeTest
```

Run Apple UI tests with a booted simulator UUID, using normal Xcode signing:

```sh
xcodebuild -project ios/LOKA.xcodeproj -scheme LOKA \
  -destination 'platform=iOS Simulator,id=YOUR_SIMULATOR_UUID' test
```

Do **not** disable signing for normal-app tests. An initial `CODE_SIGNING_ALLOWED=NO` run passed the presentation fixture but failed the real-root test because Simulator Keychain identity access lacked the app's simulated entitlements. Normal signing restored identity access and the real-root check passed. No keychain bypass, key deletion, or cryptographic change was made.

These checks prove native screen behavior with simulated application-event delivery. They do not prove radio discovery, cross-device invitation delivery, actual transport fallback, hardware synchronization latency, or offline mesh reliability. Saved-state restart in the UI fixture uses an in-memory archive; protected-storage and encrypted-mesh behavior are covered separately by the existing automated suites. The physical experiment remains pending. Only Quick Quiz is implemented; party-card multiplayer remains future work.
