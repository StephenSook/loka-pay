# LOKA for iPhone — experimental local messaging

Open `LOKA.xcodeproj` in Xcode and select **LOKA**. Requires iOS 17 or newer. Version 0.6.0 supports verified QR contact exchange, encrypted text, short recorded voice notes and delivery receipts with Android over a local BLE link. Both phones need this version for the new content format.

Implemented: native Chats/Settings, Keychain device identity, QR/link sharing and scanning, explicitly verified friends, v0 packet encryption/decryption, bounded duplicate/expiry controls and outgoing queues, familiar conversation bubbles, and an app-owned connection that remains active when switching tabs. Two ticks appear only after the authenticated recipient app confirms it saved the complete message. They do not mean it was read.

Use non-sensitive test messages. This is an internal-reviewed compatibility implementation, not an independently audited production messaging protocol. History is encrypted on this iPhone with a separate Keychain key (500 messages). Pending outgoing ciphertext survives restart within its original five-minute lifetime and 128-packet cap. Android retains its encrypted history. Microphone access is requested only when recording; voice notes are limited to 12 seconds / 32 KiB in this preview.

Not implemented: calls, encrypted iPhone backups, cloud or multi-device sync, automatic authenticated peer selection, reliable background delivery, or an iPhone intermediary with multiple simultaneous links. iPhone endpoints use the same packet contract as Android, so an Android intermediary can relay their ciphertext. Physical relay/background gates remain unproven.

## Install on a connected iPhone

1. In Xcode → Settings → Apple Accounts, add your Apple Account if needed. A Personal Team can be used for local development.
2. Select the LOKA project → LOKA target → Signing & Capabilities. Keep automatic signing enabled and select your team. If Apple reports the bundle identifier is unavailable, change `us.zerobars.lokapay` to a unique identifier.
3. Select your connected iPhone as the run destination. Unlock it and trust the Mac if prompted.
4. Enable Settings → Privacy & Security → Developer Mode on the phone if needed; follow its restart/confirmation prompts.
5. Press Run (⌘R). Let Xcode finish any device preparation or required component downloads.

Development builds require signing; an unsigned `.app` cannot be installed as an ordinary downloadable iPhone app. No TestFlight or App Store release is available.

If an installed development build will not open and iOS reports an app-verification or developer-trust error, first give the iPhone Internet access and launch it before beginning the offline radio test. The 0.6.39 provisioning profile has `PPQCheck=true`; its signature verifies and its profile expires 2027-10-03. Apple requires applicable development builds to contact its certificate-verification service at first launch. This is a development-build installation requirement, not LOKA's message transport. Once verified, repeat the messaging experiment with Internet removed and local radios enabled. Do not delete the app or change its bundle identifier to troubleshoot this, because existing data/identity must be preserved.

For field testing without activation Internet, Apple offers a separately generated seven-day offline provisioning profile. It must be legitimately issued through the developer account with the same app capabilities; editing a signed profile is not a solution. See [Apple provisioning profile updates](https://developer.apple.com/help/account/provisioning-profiles/provisioning-profile-updates). A failed launch with a generic signing error alone does not prove a PPQ failure; record the device alert and successful subsequent launch.


## Build for testing

```sh
xcodebuild -project ios/LOKA.xcodeproj -scheme LOKA \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/loka-ios-simulator build

xcodebuild -project ios/LOKA.xcodeproj -scheme LOKA \
  -destination 'generic/platform=iOS' \
  -derivedDataPath /tmp/loka-ios-device CODE_SIGNING_ALLOWED=NO build
```

The simulator build uses normal local signing and `App/LOKA.entitlements` so native Keychain APIs can work. An unsigned simulator build can compile but cannot exercise contact identity. Device compilation without signing does not permit physical installation.

See [validation](../docs/VALIDATION.md) for actual build/device checks. Simulator results do not establish physical networking behavior.


## Test Android ↔ iPhone messages

These steps apply to both phones on 0.6.5 in default automatic mode.

1. If not already saved, exchange and verify each other's LOKA QR contact codes. Existing verified friends remain saved.
2. Enable **Local connection** on both phones and allow the required OS nearby access. Keep both apps open for the initial test.
3. LOKA discovers the current local BLE route automatically. No nearby-device selection or Android per-link approval is required in default mode. Engineering Manual BLE topology control intentionally restores manual allowlists for controlled experiments.
4. Open the saved conversation and send a fresh `Hello from Android`, then reply `Hello from iPhone`. Verify destination content and recipient-save ticks in both directions. Pending packets older than five minutes have expired and will not be delivered by reconnecting.
5. For offline proof, disable mobile data and remove Internet uplinks while keeping Bluetooth enabled, then repeat. Automatic link setup by itself does not prove offline message delivery or background reliability.

A link is not a friend-specific Local route badge. **Not confirmed** means there is no authenticated delivery receipt, even if the recipient has actually received the text. If the link disconnects, reconnect and check it to replay unexpired outgoing packets. Both contacts must remain trusted. Sender and recipient clocks must be approximately aligned.

See [experiment checklist](../experiments/EXP-008-android-iphone-messaging.md), [compatibility review](../security/IOS-V0-COMPATIBILITY-REVIEW.md), [BLE contract](../protocol/BLE-LINK-V1.md) and [validation](../docs/VALIDATION.md). Builds/software vectors do not establish physical radio success.

Local connection remains enabled after first permission/setup and resumes discovery/listening when the app opens. Switching tabs does not stop it. Turn off local connection only intentionally in Settings. OS permission/radio availability and explicit lab link authorization still apply; background delivery remains best-effort. Android keeps a visible local-connection service; iPhone uses Core Bluetooth restoration for its selected connection. When the iPhone is locked, private-key operations wait for unlock. A verified ciphertext arrival can show a generic local-activity notification, but does not confirm delivery. Force-quit, OS suspension, expired packets or a lost link can prevent receipt.

In 0.5.0, iPhone subscription starts bounded approval checks automatically: at most twenty probes, spaced by at least three seconds, within a sixty-second window. Each probe has a twelve-second timeout; an unacknowledged write closes the stalled connection instead of overlapping writes. Off, disconnection and success cancel retries. Message writes remain gated on an actual reply. Android exposes only currently subscribed BLE peers for approval; offline/stale peers cannot trigger a new approval prompt. Explicit link authorization and separate contact verification remain required.

## Voice notes and notification replies

In a chat with an empty composer, tap the microphone, allow access, record, then Stop → Preview → Send. The draft clears after local queueing; delivery waits for the other phone’s receipt. Allow notifications on both phones. Background one app while leaving its local connection on, send from the other phone, and use Reply on the notification (unlock if requested). No Internet service or push server is needed for these local notifications. A notification cannot deliver a message when no local route exists. See [EXP-009](../experiments/EXP-009-voice-notifications.md) for the physical test checklist and limitations.

Build 8 recovery follow-up: after one successful connection check, iPhone remembers that selected phone and attempts reconnection after a disconnect or reopening. Keep local connection enabled; turning it off cancels recovery. Use Choose another phone to clear the remembered selection. Android still requires link approval if its process restarted; a radio identifier is not authenticated friend identity. Reconnection cannot guarantee background runtime or bypass force-quit.

## Contact names and connection details — 0.6.1

While verifying a friend, optionally enter their phone number including country code and tap Use phone contacts. Allow full or selected-contact access when prompted. An exact accessible match fills the editable name. The chosen name is saved locally; phone numbers are not in current QR codes and are not automatically mapped to LOKA accounts. You can always type the name yourself.

Local connection now shows text/voice-note limits and live calls unavailable. Check signal reads the nearby connected phone's signal; readings expire after 30 seconds and do not imply end-to-end delivery or call quality. See the [Knit review](../docs/KNIT-REVIEW.md) for researched networking improvements.

## Restoration correction — 0.6.3

Connecting and service/subscription setup now have monotonic deadlines checked on foreground return. Already-active restored subscriptions proceed without waiting for a new callback; stalled acknowledged writes trigger recovery after 12 seconds. Six bounded backoff retries precede one OS-managed known-phone wait with a waiting label instead of an endless spinner. Reopening/radio recovery restarts attempts; explicit Off cancels them.

Android remembers explicit link approval across app restarts. After upgrading from older builds, approve once because the old grant existed only in memory. A changed BLE address can still require approval. This does not establish authenticated automatic peer selection or guaranteed background runtime.

## Stale-reference rediscovery — 0.6.4

Live testing found the remembered peripheral stuck connecting while a different LOKA advertisement was visible. Recovery now performs a bounded current scan; if the remembered attempt fails with alternative candidates visible, selection becomes available instead of retrying the stale reference. Select the current nearby test phone and approve on Android if requested. Saved friends do not need reimporting. This is a recovery path, not automatic authenticated identity matching across radio-address changes; seamless recovery remains incomplete. After a long failed connection, send a fresh test message because old outgoing packets expire after five minutes.

## Automatic local routes — 0.6.5

This supersedes the manual nearby selection/Android approval steps above for two updated apps in their default mode. Keep local connection enabled on both phones; iPhone scans for a live LOKA service and Android admits the ciphertext route automatically. Your friends still need reciprocal verified QR contact records. Open a saved chat and send a fresh message; no repeated connection approval is required in default mode. Engineering tools can deliberately restore manual BLE topology control.

A nearby route is not authenticated friend identity. Only a valid recipient-save receipt marks delivery. The iPhone still has one active link and cannot act as a functioning multi-link relay. Five-minute expiry, limited background runtime and topology-specific testing still apply.


## 0.6.18 — receipts and background recovery

Locally generated save/read receipts can pass waiting BLE media packets without splitting a frame already being sent. Android requests foreground-service restart after system process eviction while local connection remains enabled. iOS initializes Bluetooth restoration during application launch, independent of screen appearance. Explicit Off and all existing permission/key-protection checks remain in effect.

This does not guarantee messaging after force-stop/force-quit. iPhone locked-key restrictions can delay decryption and receipts until unlock. Test Home/background separately from force-quitting. See [EXP-014](../experiments/EXP-014-receipt-priority-background.md) for measured queue results, platform limits and the outstanding physical test.

## 0.6.19 — sending after leaving the app

An active BLE transfer requests finite background execution time and releases it at completion, failure, disconnect or OS expiration. Already encrypted pending packets can retry while locked; Bluetooth queue completion also triggers the existing bounded retry scheduler. New encryption/decryption and protected history still require access to protected data. This is not an always-on guarantee or a force-quit workaround. The signed build and existing protocol/interoperability regressions passed; physical Home/lock delivery comparison is still pending (EXP-014).


## 0.6.20 — shared local Wi-Fi experiment

Connect the iPhone and Android to the same private IPv4 Wi-Fi LAN and allow iPhone Local Network access. Enable LOKA local connections as usual. Android advertises a local listener; iPhone discovers it automatically and both can exchange the existing encrypted messages. Bluetooth remains available in parallel. The LAN needs neither a working Internet uplink nor cellular data, but must allow Bonjour discovery and traffic between devices.

This is a testable shared-network transport, not Wi-Fi Aware, automatic hotspot setup or best-route scoring. It currently supports an iPhone client and Android server; Android↔Android Wi-Fi initiation and an iPhone Wi-Fi server remain future work. Background and force-quit limitations still apply. See EXP-015 and protocol/LOCAL-WIFI-V0.md for proof requirements and bounds.


## 0.6.30 — opt-in Apple Wi-Fi Aware experiment

The app includes an iOS 26 capability-gated, paired Wi-Fi Aware TCP transport. Settings → Local connection → Phone-to-phone Wi-Fi provides the native pairing flow on supported, authorized builds. It uses the `_loka-v0._tcp` service, `LWF0` framing and unchanged encrypted packet-v0/LP1 content. Choose Connect a phone on one participating iOS app and Let another phone connect on the other; follow Apple's pairing UI. Saved host/client roles resume discovery/listening when local connection is enabled. This experimental one-peer route remains independent of BLE and shared-LAN availability. Discovery and trust remain separate.

Build the entitled variant:

```sh
xcodebuild -project ios/LOKA.xcodeproj -scheme LOKA \
  -destination 'generic/platform=iOS' -derivedDataPath /tmp/loka-ios-aware \
  -allowProvisioningUpdates LOKA_WIFI_AWARE=YES \
  CODE_SIGN_ENTITLEMENTS=App/LOKA-Aware.entitlements build
```

Normal builds leave this experiment disabled (`LOKA_WIFI_AWARE=NO`). Do not enable the flag without the matching signed entitlement. Runtime `WACapabilities.supportedFeatures` determines hardware availability; do not infer support solely from OS version or the phone's release date. Debug builds write only capability/build/OS metadata to `Library/Caches/loka-aware-capability.json` for hardware checks.

This is **not yet Android interoperability**: Android's existing `loka-aware-v0` path negotiates a PSK and does not implement Apple's NAN pairing flow. A separate compatible Android pairing/service/datapath adapter and physical tests are required. It is also not a Wi-Fi Direct group-owner API. Group owner/hotspot compatibility and Apple-only peer-to-peer Wi-Fi are separate mechanisms; do not label them equivalent.

Bounds: one established Aware channel, 32 queued 16-KiB frames, strict length/magic checks, 15-second setup/partial-frame/write deadlines, discovery restart paced at five seconds. No cloud/Internet validation gates; no app crypto change. Native pairing permits a link, not private chat trust. Background/force-quit, suspended tasks, physical range, throughput and Android interoperability remain unproven.

References: [Apple Wi-Fi Aware](https://developer.apple.com/videos/play/wwdc2025/228/), [entitlement/services](https://developer.apple.com/documentation/wifiaware/adopting-wi-fi-aware), [Android Aware pairing capability](https://developer.android.com/reference/android/net/wifi/aware/Characteristics#isAwarePairingSupported()).


Hardware check (October 3, 2026): the connected iPhone SE (3rd generation), running iOS 26.3 build 23D5103d, returned `supported: true` from `WACapabilities.supportedFeatures.contains(.wifiAware)` in the signed enabled build. Installation and launch succeeded. This verifies API capability on this specific device, **not** successful native pairing or data transfer. No phone-model blacklist is used.


## 0.6.31 — required supported-device onboarding

New iPhone onboarding includes Phone-to-phone Wi-Fi between Local Wi-Fi and Notifications when runtime Aware support and the entitled build flag are both present. It has the same progress/back controls as the other steps, no skip action, and completion checks that the app feature is enabled. Already-enabled setup is skipped; unsupported/unentitled builds omit the step. Existing completed profiles are not reset.

Enable phone-to-phone Wi-Fi records the user's explicit app setting and starts the paired-device route when local messaging is on. It is **not** an OS permission-granted result or a successful pairing. Apple's native device pairing stays in the connect-a-phone flow, so a new user can complete onboarding without another phone present. No permission-denial/Settings state is fabricated for this preference. Bluetooth denial continues to use the actual native permission status and Settings guidance.


## Apple Bluetooth discovery — October 3, 2026

The Apple app now advertises the LOKA GATT service and accepts up to four incoming subscribers alongside its existing single outgoing central. Profile names and chat requests use unchanged LP1/LC1 over that link. Nearby Off stops both roles. Background peripheral mode is declared; restoration/force-quit delivery is not promised. See [physical test](../experiments/EXP-APPLE-BLE-DISCOVERY.md) and [incremental security review](../security/APPLE-BLE-PERIPHERAL-REVIEW.md).

Signed device build and full `tests/check-ios-messaging.sh` suite passed, including framing, route independence, admission budgets, encryption interoperability, profile exchange and consent. Updated build installed on the connected iPhone SE3 and iPad Air5 with data preserved. Actual Apple-to-Apple discovery and message delivery await user observation.


## iOS relay implementation — October 3, 2026

The previous endpoint-only limitation is superseded: the mesh now forwards verified foreign ciphertext across concrete ready links, excluding the incoming handle. Software relay checks and signed build pass. Physical three-device delivery, background relaying and durable relay storage remain unproven/unimplemented as detailed in [the iOS relay experiment](../experiments/EXP-IOS-RELAY.md).

## 0.6.41 — concurrent shared local Wi-Fi routes

The iPhone can maintain up to four discovered Android local Wi-Fi sessions at once. Keeping a source connection no longer prevents a connection to a non-friend carrier on the same private IPv4 LAN. Each link has its own profile verification, queue and disconnect handling; discovering a phone does not add it as a friend. The ordinary encrypted carry protocol is unchanged.

A controlled physical Samsung → Samsung carrier → iPhone text reached the destination with two hops and the sender showed Delivered. See [test evidence](../experiments/results/2026-10-04-multi-wifi-nonfriend/result.json) for packet IDs, receipt timing and limitations. This shared-LAN result is not Wi-Fi Direct/Aware interoperability, a distance test or a background guarantee.

The reverse controlled iPhone → same non-friend Samsung carrier → Samsung friend text also reached its destination with two hops. Two-hop return receipts were stored at the iPhone and its acknowledged outgoing packet left the queue. Repeated copies were logged as duplicates at the destination. Temporary test exclusions were cleared afterward; see the same result record.

## 2026-10-04 — 0.6.42 Bluetooth-only relay attempt

The physical non-friend Samsung → Samsung → iPhone Bluetooth test **did not pass**. Packet `cfe8b8d2` reached and was durably retained by the carrier, but no destination storage or delivery receipt was observed before normal Wi-Fi was restored. Android accepted previously rejected valid subscriptions after service-slot admission was moved to the native CCCD request; repeated connection callbacks preserve working sessions. Both platforms reduce established capability refresh to 120 seconds and stop periodic completed-consent chatter, retaining unknown-capability negotiation, pending requests and reconnect replay. Core tests (80), native interoperability and both signed/debug builds pass. Additional iPhone central connection/recovery and payload queue progress remain unproven. See [physical failure evidence](../experiments/results/2026-10-04-bluetooth-nonfriend/result.json) for radio-state qualifications and trace timestamps. Any later Wi-Fi delivery is not Bluetooth proof.

## 2026-10-04 — 0.6.43 Bluetooth relay retry

The controlled foreground Bluetooth retry passed payload delivery in both directions through a Samsung that is not the iPhone's friend. Android now initiates a bounded connection to a tokenless advertisement matching the LOKA service; existing Android token election, malformed-token rejection, profile verification and message trust remain in place. The reverse iPhone → carrier → Samsung exchange blocked every non-BLE packet path and returned its authenticated receipt via the same carrier, with two hops in each direction. Forward text took roughly 24 seconds, reverse text 69 seconds and its delivery receipt about 125 seconds round trip under existing queued traffic. This establishes a foreground local Bluetooth route, not background, range, high throughput or fast receipts. Wi-Fi radio stayed on at the iPhone; the carrier had Wi-Fi disabled, and reverse transport isolation was enforced in the development test build. See [packet-level proof and qualifications](../experiments/results/2026-10-04-bluetooth-nonfriend-retry/result.json). The previous failed experiment remains recorded.
