# Contacts, onboarding and network privacy

Product direction requested October 2, 2026. Adding a friend and establishing a network link are different actions. People should not manually copy public-key strings in ordinary use.

## Bundled avatars and visible request stack — 0.6.57 (October 5, 2026)

The optional [LP1 avatar control](../protocol/NEARBY-PEOPLE-V1.md#bundled-avatar-metadata--preview-0657) carries a whitelisted bundled-illustration ID bound to the accepted per-link profile challenge and device key. Both apps resolve the same bundled art locally in Nearby, requests and cached saved-friend portraits. This sends no image file and adds no contact trust, message routing or cryptographic primitive. Camera/library photos remain local. Old peers continue exchanging the unchanged name/profile and consent frames. See the [internal review](../security/NEARBY-PEOPLE-REVIEW.md).

Incoming requests appear above the Nearby beacon as a compact stack. Accept remains explicit; left swipe/Decline uses existing refusal, while right swipe/Later only sets aside the local card. Show later restores pending cards. Software interoperability and native Android/iPad fixture review passed; physical-device avatar propagation remains to be observed.

## Typing and composer — preview 0.6.29 (October 3, 2026)

Approved contacts can see “Typing…” over a recently responsive direct local link. Hints use the existing encrypted LP1 control channel, contain no draft text, are never saved/forwarded, are throttled, and expire within eight seconds. The UI sends a stop after idle time, clearing/sending the draft, leaving the conversation or backgrounding. Slow/stale links omit typing; existing messaging and store-and-forward behavior are unchanged. This responsiveness test is not a bandwidth estimate. Real-time voice/video calling and call recommendations remain unavailable pending media, capability and throughput/loss/jitter work.

Composer microphone, camera and attachment glyphs now have consistent sizes and accessible tap targets on both platforms. The microphone uses the same plain icon treatment as the camera and attachment; Send keeps its distinct action styling.

Validation: 60 Android core tests plus the app unit test, Android lint/build, signed iOS build, native Swift regressions and actual Kotlin–Swift profile/consent/typing exchange passed. Version 0.6.29 (37) was installed in place on both connected Samsungs and the iPhone. Physical typing visibility/radio behavior remains a user test; software interoperability does not prove radio performance.

## Nearby people — preview 0.6.28 (October 3, 2026)

Android and iOS now exchange self-chosen profile names over established local links using [LP1](../protocol/NEARBY-PEOPLE-V1.md). This implements the user's explicit choice to show names while nearby name sharing is enabled. The setting is independent of anonymous relay participation. A received profile proves possession of that device key, not a verified real-world identity or physical proximity.

Nearby shows initial avatars, names, Message for saved friends, and Request chat for others. Recipient Accept adds the sender locally; the signed acceptance adds the recipient at the sender, with bounded retry and acknowledgement. Decline does not authorize chat. Request counts appear on the Nearby selector. Pending consent and blocks are encrypted locally; removing a friend blocks consent replay. Packet-v0 chat still requires a trusted sender, and LP1 controls are not forwarded as personal messages. Existing QR workflows remain available.

Names require the updated build, name sharing enabled, and a completed direct local link. Discovery advertisements alone do not contain profiles. Older/nonparticipating/unconnected phones display “Nearby phone / Name not shared yet”; no numbered names or fabricated person identities. iOS still has a single selected BLE connection, so this change does not promise profiles for every unconnected advertisement. Known profiles on simultaneous local links are deduplicated by device key.

The consumer list hides radio names. Six separated bars animate actual fresh BLE RSSI level changes; stale/unavailable measurements show neutral bars. RSSI is not meters, throughput, or proof of a working end-to-end route. The floating new-chat icon has visible contrast; group messaging remains unimplemented.

Implementation and software tests do not establish range or background reliability. Physical verification must cover both request directions, restart/lost replies, mixed versions, and each supported local transport. See the [internal security review](../security/NEARBY-PEOPLE-REVIEW.md).

## Existing QR preview

Settings → My contact code shows a QR containing a versioned `loka://contact/v1#…` link with the public device key. Share the link through the Android share sheet or save the QR image. Connect a friend accepts the link or scans a QR with the camera or scans an image selected through the system picker. Both paths preserve the existing full-fingerprint comparison and explicit trust confirmation; neither automatically trusts a scanned identity. Names are labels stored on the recipient's phone, not authenticated profiles.

Links contain no phone number, name, private key or message history. A public device fingerprint is stable and linkable; this is not anonymous identity. Version, payload length, syntax and public-key validity are checked before confirmation. An invalid/self contact cannot be added. Raw public-key import remains available only in engineering tools.

Contacts can exchange codes while apart. Importing a contact does not create a route: delivery still needs a viable LOKA Local route, or a future Go/Gateway route. Internet messaging and a registered HTTPS invitation domain are not implemented. The current custom-scheme link works with installed LOKA and can also be pasted; some sharing apps may not make custom-scheme text clickable. It is not a verified Android App Link.

Settings → Local connection contains local connection controls and status, without Bluetooth device names, addresses, people lists or phone numbers. Engineering tools retain manual peer controls for physical tests. Current radio discovery cannot authenticate a LOKA user, so the consumer screen does not present arbitrary Bluetooth devices as people or fabricate verified-user counts.

## Requested account flow

- Onboarding links a verified phone number to an immutable LOKA account and separate device identities. Phone numbers support contact lookup and recovery; they are not primary account identifiers and are not advertised over nearby radios.
- Add a friend by verified phone-number lookup, or scan/import their voluntarily shared contact code. Contact discovery must respect discoverability settings and require recipient acceptance/authorization before enabling personal messages. Knowing a number alone is not cryptographic proof of identity or recipient consent.
- Resolve a number through an authenticated, privacy-reviewed account directory into verified account/device credentials. Plan number changes/reassignment, enumeration resistance, rate limits, blocking, revocation and recovery before implementing lookup. An unverified local number field must not be treated as registration.
- Separate permission to relay encrypted packets from permission to send someone personal messages. Being a network neighbor must never automatically create a contact or authorize inbound plaintext messages.
- When protocol discovery can verify LOKA capability, the network screen may show anonymous node indicators/counts without exposing names, numbers or contact identities. Hiding names in the UI does not provide radio anonymity; privacy-preserving identifiers and authenticated handshakes require design and security review.
- Manage compatible links automatically only after discovery, authenticated peer binding, consent, concurrency and background behavior are designed and tested. Keep raw radio devices in diagnostics.

## Implementation boundaries

Verified registration, number lookup, consent credentials, revocation and remote transport are future work. Existing destination processing requires a trusted sender fingerprint; exchanging a code in one direction does not grant reciprocal trust. Both people must explicitly add/verify the other in this preview.

This change packages existing public keys for transport and preserves the cryptographic envelope and trust decision. New authenticated discovery, account-to-device binding and authorization protocol changes require explicit security review under [AGENTS.md](../AGENTS.md). Local delivery must remain independent of live directory requests once suitable contacts/credentials are provisioned; [the radio note](WIFI-RADIO-VS-INTERNET.md) still applies.

QR encoding/decoding uses [ZXing](https://github.com/zxing/zxing). Image selection uses Android’s [GetContent contract](https://developer.android.com/reference/androidx/activity/result/contract/ActivityResultContracts.GetContent); link handling follows [Android deep-link guidance](https://developer.android.com/training/app-links/create-deeplinks). Camera scanning uses [ZXing Android Embedded](https://github.com/journeyapps/zxing-android-embedded) and requests camera access only when scanning. Image import requires no broad photo-library access and remains available without a camera.


## Seamless experience requirement and current status

The [additional product brief](SEAMLESS-CONTACT-EXPERIENCE.md) applies alongside the networking and security requirements. The user chooses the person; LOKA chooses the network.

Android and iOS offer **Add someone → Scan QR**, QR-image import, contact-link review, explicit full-code verification and **My LOKA → Share My LOKA**. Empty friend lists encourage contact exchange without inventing registered-user counts. QR exchange works without a directory or Internet; it saves a device identity, not a verified account profile or delivery route. The iPhone now has the experimental v0 messaging engine; physical delivery is a separate test.

| Required experience | Implementation / dependency |
| --- | --- |
| One Nearby Devices explanation, automatic connection after permission | One-time permission explanation implemented on both platforms. Full onboarding and authenticated automatic discovery remain pending; foreground lab requires manual setup. |
| Optional Contacts: Local / LOKA / Invite | Pending consent-based privacy-reviewed account matching. No address-book upload or account directory exists. |
| Anonymous nearby discovery | Consumer views conceal arbitrary Bluetooth names. Discovery identifiers have not been reviewed for production unlinkability. |
| Permanent LOKA Number | Pending account issuance, directory authorization and recovery; device fingerprints are not LOKA Numbers. |
| Public HTTPS profile / install link | Pending domain ownership, hosted install page, verified Android App Links and iOS Universal Links. Existing custom links require LOKA installed. |
| Invitations to selected contacts | Pending account matching and consent-based contact picker; existing share action sends the actual contact link through the system share sheet. |
| Local badge on a person | Requires authenticated identity binding and viable route evidence, not device discovery or QR import. |
| Automatic normal conversation and call | Experimental Android–iPhone text is implemented and software interoperability checks pass. Physical receipt, calls, Go fallback and automatic transport handoff remain outstanding. |

Do not add placeholder account search, fabricated registered friends, fake call buttons or a Local badge based only on radio proximity. Implement directory/discovery trust and authorization separately from transport discovery. Preserve engineering controls until the physical relay, alternate-route and background gates pass.

## Simple friend confirmation

Both apps show a Friend saved confirmation after a successful local add and offer Share My LOKA for the reciprocal exchange. iPhone friend details keep the full code inside Check friend’s code; code comparison is still required during trust confirmation. Additional implementation explanations are disclosed on request. Names remain labels on the receiving phone. Adding a friend is not synchronized to the other phone and does not synchronize message history; automatic reciprocal authorization, profile synchronization and multi-device history synchronization are unimplemented.

Version 0.4 added explicit nearby test-connection controls; version 0.5.0 moves them into Settings → Local connection and surfaces incoming approval over the current screen. These reuse lab allowlisting, expose no device names/addresses and do not grant contact trust. Reciprocal QR verification is still required. Both platforms offer familiar conversations and matching plain waiting/unconfirmed/expired wording; only Android currently persists encrypted history.

Version 0.4.1 remembers local connection intent and resumes discovery/listening for already-granted access when opening the apps. Explicit Off remains respected. This is independent of account/profile sync or automatic authenticated peer selection. The first physical feedback is Waiting to send; actual receipt is still pending.


Version 0.5.0 uses Chats and Settings on both platforms, matching green/ivory styling, initial avatars, search, QR shortcuts and conversation controls. On iPhone, a successful public link check follows Android approval automatically (bounded foreground retries); it does not imply authenticated peer discovery or message delivery. Android approval is shown only for currently subscribed peers, with dismissed requests available in Local connection. Neither platform stops the connection when navigating. iPhone still keeps temporary chat history in memory, and Android keeps encrypted persistent history.

## Optional phone-contact naming — 0.6.1

Both platforms now offer a phone-number field and Use phone contacts while adding/verifying a friend. That explicit action requests the native Contacts permission with a local-use explanation. Android uses ContactsContract.PhoneLookup; iPhone uses CNContactStore and respects limited access on supported iOS versions. Reads run off the UI thread. Only a unique exact international-number match can fill the editable label. Country code is required; suffix matches and ambiguous names are refused. iPhone national-format-only entries may need a country code added in Contacts. Denied/restricted access or no match still allows a manually entered name.

The OS address book is the local source of truth. LOKA does not upload it, copy the entire book, retain a number-to-key directory or automatically grant trust. Only the chosen name is saved with the existing local friend record. Contact changes are read on each lookup; previously saved labels remain editable and are not silently overwritten. The number itself is discarded when the add flow closes. QR codes still contain no number, so the user must supply the known number for this preview's lookup. Registered private number discovery remains separate future work.

Sources: [Android PhoneLookup](https://developer.android.com/reference/kotlin/android/provider/ContactsContract.PhoneLookup), [Apple Contacts access](https://developer.apple.com/documentation/contacts/accessing-the-contact-store), [CNContactStore](https://developer.apple.com/documentation/contacts/cncontactstore). Local labeling does not establish phone-number ownership or consent to message.

## 0.6.9 — contact code hub and Nearby entry

Both apps now provide My code / Scan code from the QR page, with a profile-led card, high-contrast unmodified QR modules/quiet zone, sharing and existing explicit contact verification. Android scan mode exposes camera, saved-image and paste actions; iOS scan mode embeds the existing add/scan/image/link review flow. Chats has Chats / Nearby controls. Nearby presents anonymous connection status, add/share actions and settings, not an unverified directory of people. No new identity broadcast, profile synchronization or automatic trust is implied. The sending and receiving endpoints still add one another; a relay does not need either endpoint as a friend.

Android build/lint and signed iOS build passed; Android QR page visually reviewed on the isolated emulator and Scan code actions confirmed by UI hierarchy. QR encoding and packet formats unchanged. iPhone UI compiled but has not received equivalent simulator visual review. Physical installs and remaining device availability are recorded in VALIDATION.


## Chosen nearby policy — October 2, 2026

The user explicitly chose: **show chosen names whenever nearby people discovery is on; approve new chat requests**. This supersedes the earlier requirement to hide every nearby name. Anonymous relay participation remains separate from people discovery and personal-message permission. Disabling people discovery must stop profile sharing without requiring relay participation to stop.

Required next implementation: a bounded, versioned profile exchange that binds each self-chosen name to its device identity, expires stale nearby entries, and supports explicit accept/decline/block before authorizing a new sender. A displayed name is self-asserted, not proof of a person or a globally unique username. Requests need duplicate/rate limits and revocation behavior. These controls must work locally without directory access. Review the new identity/authorization protocol before enabling it, preserving existing v0 messaging interoperability.

**Not implemented in 0.6.10:** broadcasting profiles, a nearby people list, or over-the-air chat requests. The existing QR exchange remains the contact path. Do not interpret automatic BLE link establishment as automatic friend discovery or approval.

0.6.10 adds a two-step local profile onboarding flow to both apps (name, nearby access and optional notifications), preserving existing keys and history. Camera/microphone/contact permissions remain feature-triggered. Apps follow device light/dark appearance; QR remains black on white. This is local device setup, not backend account registration, a reserved username or a permanent LOKA Number. The chosen name is not yet transmitted to nearby users.

## 0.6.12 nearby and scanner UI

Nearby now lists observed LOKA radio candidates using generic device labels, with separate off/empty states and no QR/add actions in that panel. Advertised Bluetooth names are not treated as user identities. Observations age out after 30 seconds; an active connection remains visible. This is discovery evidence, not verified friend identity, delivery reachability or proof that every physical device is discoverable. iOS remains a BLE central; two iPhones are not made mutually discoverable by this UI change.

Android reports valid LOKA advertisement tokens to the UI before role election so a device is visible even when the other phone is responsible for initiating. Role-election and trust policy are unchanged. UI peer history is bounded. Both apps keep QR tools in My LOKA; Scan code opens the camera with a frame, scanning animation and back control. iOS respects Reduce Motion for its scan-line animation. Android uses ZXing's existing animated viewfinder and camera lifecycle.

Automatic reciprocal contact synchronization is still **not implemented**. Required flow: scanned identity → authenticated, bounded chat request → recipient accepts → acceptance acknowledgement → both contact lists persist the approved identities. Being nearby or scanning a public code is not recipient approval. Do not display synchronization success before acknowledgement. This requires the explicit identity/authorization security review described above; the existing v0 trusted-sender message format cannot authorize an unknown requester by itself.

Onboarding has three focused stages (name, nearby access, notifications), segmented progress, accessible back arrows and optional Not now actions. Granted permissions skip automatically. Benefit-first copy and brief optional setup follow [Apple onboarding guidance](https://developer.apple.com/design/human-interface-guidelines/onboarding). Conversion improvement has not been measured and is not claimed.

## 0.6.13 UI follow-up

QR is smaller; the main chat action opens My LOKA, replacing duplicate top-level QR/plus actions. The empty-chat invite card explains that more nearby LOKA participants can help local coverage, without guaranteeing range. Shared invitations currently carry the contact custom-scheme link and explicitly assume LOKA is installed; no public download domain is configured. Contact avatars are still initials; tapping them edits the local name label. Nearby signal labels use recent measurements only and do not imply distance.

Profile photos, named nearby profiles and automatic contact synchronization remain the next identity/discovery work. The newly implemented photo **message** type is not a profile-photo distribution mechanism. Message encryption does not authenticate an arbitrary nearby radio advertisement; do not attach private friend data to an unverified radio handle. See the profile/request requirements above.

## Contact consent implementation in progress

Kotlin and Swift now contain an isolated LC1 request/accept/acknowledgement/decline codec and bounded consent state machine. It handles explicit approval, matching retries after lost replies, key/request/deadline binding, block/decline tombstones and expiry. It has no trust-store or transport side effects and is **not enabled in the installed apps**. Persistence, authenticated discovery, admission limits and request UI remain required before users can add each other automatically. See the [experiment contract](../protocol/CONTACT-CONSENT-EXPERIMENT.md) and [internal security review](../security/CONTACT-CONSENT-REVIEW.md).

## 0.6.21 — Local Network onboarding

iPhone setup now has five steps: name, nearby access, local Wi-Fi, notifications and backup. Local Wi-Fi explains the benefit before Enable begins Bonjour browsing; Not now leaves this new path disabled. The saved `loka.wifi.explained` flag is user intent, not proof of OS permission. Already enabled setup skips this explanation. iOS owns the system prompt and remembers its result; denial requires iPhone Settings. No general authorization query is invented. Existing installed users can choose Settings → Enable local Wi-Fi without resetting their profile or messages. This gate also prevents unsolicited Bonjour startup during initial setup/background launch.

Android's current target SDK 36, without the local-network protection opt-in, needs no additional runtime permission for this socket path. Nearby onboarding explains Bluetooth plus shared Wi-Fi. Revisit this when targeting SDK 37; do not request nonexistent permission dialogs. Camera, microphone and contacts remain feature-triggered.

Sources: [Apple local network privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy), [Android local network permission](https://developer.android.com/privacy-and-security/local-network-permission). iPhone build and Android build/lint are the verification for this UI change; no physical permission-flow success is asserted.

## 0.6.25 — Setup and signal presentation

Android setup separates nearby messaging, optional nearby Wi-Fi, notifications, optional background battery settings and backup information. Wi-Fi Aware is included only on API 29+ hardware advertising the feature. Forward/back navigation skips already granted access and battery optimization exemption (unless background activity is still restricted). Name setup can be skipped on both platforms. Android finishes in Chats rather than automatically opening backup export. No backend account or automatic backup is created.

Android remembers a nearby permission request and offers app Settings after denial instead of repeatedly opening a permission prompt; Aware has the same persistent recovery flow. The screens explain which feature needs access and show the Settings path. iPhone retains its separate Local Network step and adds clearer denied-permission instructions. There is no Android-style battery exemption or enabled iPhone Aware permission step on iOS.

Both Nearby lists put signal bars in the name row: green at -60 dBm or better, orange down to -75 dBm, red below -75 dBm. Missing, invalid or older-than-30-second measurements show a neutral dash. Android measurement age is now separate from device observation age: a link-status event cannot refresh an old signal or erase a fresh one. Duplicate BLE handles prefer the latest measured entry. These are qualitative RSSI bands, not measured distance, throughput or end-to-end route quality; Wi-Fi paths without a measurement show no invented bars.

**Remaining requested work:** named nearby profiles and tap-to-request friendship are not implemented by this UI update. Radio handles are not bound to an authenticated profile. The isolated LC1 consent codec is still not enabled; durable request/block storage, verified discovery, approval UI and cross-platform integration remain necessary. Generic device labels are intentionally retained until the actual profile exchange exists, rather than treating the Bluetooth device name as the person's name.

Validation: Android unit tests/build/lint and signed iPhone build. Physical motion/signal and fresh-install onboarding behavior still require device testing; existing profiles are not reset by installation.

Permission references: [Android runtime permission flow](https://developer.android.com/training/permissions/requesting), [Apple connected RSSI reads](https://developer.apple.com/documentation/corebluetooth/cbperipheral/readrssi()).

## 0.6.26 — Required nearby access and contextual permission recovery

The user's updated onboarding instruction supersedes the skippable Nearby step in 0.6.25. On phones supporting the current Bluetooth nearby path, onboarding cannot pass Nearby until the required access is granted **and Bluetooth is powered on**. Completion checks this again, so skipping later optional steps cannot bypass revoked access. There is no Nearby skip or Not now control. Unsupported hardware does not receive a permission request for this path. Wi-Fi Aware remains an additional optional Android path; it is not a prerequisite for the existing Bluetooth messaging path.

Optional steps use an accessible circular forward chevron alongside progress instead of repeated Not now buttons. Granted Bluetooth/notification access skips automatically, while a granted permission with Bluetooth off remains on the enable step. One primary action and benefit-focused copy appear before the system prompt. After denial, the same action becomes Open app settings, with recovery instructions in the description. Denials are persisted on Android after the native result callback, not merely when the button is tapped. Returning from Settings refreshes actual authorization and radio state. Settings are never presented as proof of a grant.

For iPhone Local Network access, only native browser PolicyDenied or connection localNetworkDenied observations trigger the Settings recovery state. A timeout or an empty Nearby list is not interpreted as denial. The existing wifi.explained preference remains user intent, not an authorization query. A policy-blocked browser restarts when the app returns to the foreground; normal active Wi-Fi connections are not restarted by this recovery action. There is no new packet or trust policy.

Validation: Android build, unit tests and lint passed; signed iPhone build passed. On the isolated Android emulator, fresh setup showed the forward control on Name; Nearby had no skip/Not now/premature Settings control; denying the native prompt retained Nearby and changed the primary action and description; that action opened the app's Settings page; enabling Nearby devices in Settings and returning automatically advanced to Notifications with its optional forward control. Name and denial screenshots were visually inspected. This is software/UI evidence, not a physical delivery or conversion-rate measurement. Physical phone histories and profiles are not reset for this test.

The design follows contextual explanations and brief permission steps described in [Android permissions guidance](https://developer.android.com/training/permissions/requesting) and [Apple onboarding guidance](https://developer.apple.com/design/human-interface-guidelines/onboarding). Local Network denial handling follows [TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy). Conversion uplift has not been measured.

## 0.6.27 — Short Android background setup

Battery onboarding now has one short explanation: “Let LOKA stay active when you leave the app. This may use more battery.” The primary action requests Android's native, app-specific battery optimization exemption. The manifest declares REQUEST_IGNORE_BATTERY_OPTIMIZATIONS; this is a request for user approval, not automatic exemption. Offline local messaging cannot depend on FCM, matching the direct-request messaging use case in [Android's Doze guidance](https://developer.android.com/training/monitoring-device-state/doze-standby).

After the system activity returns, actual PowerManager exemption and ActivityManager restriction state are checked. resultCode is not treated as approval. If access remains restricted, the single action becomes Open battery settings with a short instruction. Exemption-list Settings is used when Doze exemption is missing; app battery Settings is used when a separate background restriction remains. Granted setup advances automatically; the existing optional progress chevron is retained. Long Samsung instructions, duplicate explanations and multiple concurrent buttons are removed.

No background transport or packet behavior changes. A battery exemption does not prove OEM sleeping restrictions are removed or override Force stop. iOS has no equivalent Android battery exemption prompt; no synthetic iPhone permission is introduced.


## Verified control-route ranking — 2026-10-05

Friend requests, approvals/declines, confirmation replies and typing indicators
now use the same queue-load and transport-preference callbacks as message routing
on Android and iOS. Selection is by authenticated recipient identity, never the
first discovered radio handle: lowest nonnegative queued bytes, then existing
local Wi-Fi/Aware preference, then deterministic handle order. A synchronous send
failure immediately tries the next authenticated route with the exact same
encrypted frame. Queue acceptance still does not prove destination receipt;
consent retains its existing state, expiry and periodic retry behavior. Retry
runs once per recipient rather than once per radio alias. Typing remains temporary
and requires a recently responsive verified route.

Discovery challenges, challenge-bound profile/avatar responses and per-link
capability negotiation remain on their specific links; moving these would defeat
connection identity verification. No cryptography, wire formats, trust approvals
or relay authorization changed. This is basic shared ranking, not a measured
throughput/latency predictor. Availability of Internet alone does not establish
a usable local Wi-Fi route; all selected connections must already be verified.
Native tests cover Wi-Fi preference, queue-load override, approvals, typing,
identical-frame fallback and disconnected-route exclusion. Physical speed and
background behavior require separate measurements.
