# EXP-008 — Android ↔ iPhone foreground encrypted text

Status: implementation/software compatibility checks passed; physical message receipt and offline-radio proof are pending observation. Installation is not delivery proof.

## Scope

Version 0.5.0 on the connected Samsung and iPhone, both apps open. Reciprocal full-code contact verification, one Android BLE peripheral and one iPhone central. No backend or Internet-validation prerequisite. Use non-sensitive test texts. iPhone plaintext history is bounded memory only; existing Android encrypted history and both private identities are preserved.

## Procedure

1. Add each phone on the other via My LOKA → Add someone → Scan QR, compare full codes and confirm.
2. Android: Settings → Local connection → Turn on local connection; permit Nearby Devices. iPhone: Chats → Connect nearby → Find nearby phones; permit access and select the test phone.
3. Android: tap Allow connection in the incoming prompt. iPhone checks automatically; wait for Local connection is on. If approval took more than one minute, tap Try again.
4. Android friend chat: send `Hello from Android`. Observe the incoming bubble on iPhone. Reply `Hello from iPhone`; observe the Android incoming bubble.
5. Remove Internet uplinks and disable mobile data while preserving Bluetooth; repeat with a new identifiable test text in each direction. Record the actual radio and Internet settings.
6. Switch between Chats, Settings and Local connection without closing the apps and repeat. Leaving connection setup must not stop the link.
7. Disconnect, queue one new message, reconnect before five-minute expiry and check the connection. Verify one incoming bubble rather than duplicates. Queue another while disconnected and wait beyond expiry; it must not arrive after reconnecting.
8. Remove contact trust on the recipient and attempt a new sender message; it must not appear. Restore trust only after explicit QR verification.

## Record results

| Check | Observed result |
| --- | --- |
| Hardware / OS / app versions | Record from both physical phones |
| Reciprocal contact verification | Pending |
| Two-way public radio probe | Pending |
| Android → iPhone plaintext received | User reports Waiting to send; no receipt established |
| iPhone → Android plaintext received | Pending |
| No Internet, radios preserved | Pending |
| Tab changes retain connection | Pending |
| Reconnect replay and deduplication | Pending |
| Expired message rejected | Pending |
| Untrusted sender rejected | Pending |
| Discovery / delivery latency and failures | Pending |

## Software evidence already obtained

`sh tests/check-ios-messaging.sh` passed native Swift ↔ actual Android-core encryption, native QR round trip and BLE framing checks. JavaInterop exercises the actual Android ciphertext relay and trusted-destination branch with a Swift-origin packet. Signature/tag/padding/truncation/trust/expiry/deduplication/queue/replay checks passed. Android core tests, debug build/lint, iOS simulator and signed-device builds passed; both physical installations and iPhone launch succeeded.

## Limits

No authenticated delivery/read receipts, automatic authenticated peer selection, cloud sync, calls or proven background reliability. One iPhone link is an endpoint, not a demonstrated multi-link relay. An anonymous radio connection is not a person-specific Local route. Keep EXP-001–005 Android relay/alternate-route gates and EXP-007 realistic-network gates separate. See [security scope](../security/IOS-V0-COMPATIBILITY-REVIEW.md).

### First physical feedback and follow-up

User reports a queued/waiting message and asks why nearby access would be turned off. Android Bluetooth diagnostics show the radio on and LOKA service registered; no AndroidRuntime crash was found in the bounded recent log. Neither registration nor radio-on proves an allowed subscribed link or destination receipt. Exact iPhone Network status and Android connection-card state are still requested.

Version 0.4.1 remembers local connection intent, resumes Android listener/discovery on app startup/resume when permissions are already granted and the radio is available, and resumes iPhone discovery when previously authorized unless explicitly turned off. Off is in Settings, and the conversation offers a direct connection setup action. This does not silently grant contact trust, bypass manual lab link authorization or claim background operation.


### Approval failure report and correction

User reports iPhone's Android-rejected-write status and Android still showing Ready to connect. Source showed iPhone replayed queued packets at subscription time, before Android allowlisting, and a synchronous queued-write exception could suppress the link-state callback. Version 0.4.2 gates iPhone outgoing data on the public two-way check, makes Connect iPhone the primary Android approval action, handles transport rejection without losing pending ciphertext/status and moves GATT-to-mesh callbacks outside the transport monitor. This explains a reproducible sequencing failure; it does not establish the cause of every GATT write error. Debug Android logs now record approval/subscription/length/offset flags without addresses, public keys or message content. Post-fix physical receipt remains pending.


### Observed missing approval and version 0.5.0 follow-up

On October 2 at 17:38:50, the connected Samsung debug log recorded `Subscription: valid=true allowed=false`. This is evidence of a valid subscribed link still awaiting Android authorization; it is not evidence of failed cryptography, a passed probe, or destination receipt.

Version 0.5.0 removes the Network tab. A current subscribed incoming request prompts Android approval from Chats or any other app screen. Dismissal does not grant permission; setup remains available from Settings. iPhone checks the explicitly selected phone automatically with bounded, cancellable retries. No radio address is bound to a friend's identity, and neither automatic checks nor user approval grants contact trust. Physical bidirectional text receipt remains pending.


### First version 0.5.0 physical check

On the updated Samsung, a fresh subscription at 18:01:30 was valid but not yet allowed. Six-byte public probe writes were rejected at 18:01:30, 18:01:33 and 18:01:37. At 18:01:41, the next six-byte probe logged `accepted=true peerPresent=true allowed=true subscribed=true`. This verifies automatic requests reaching Android and explicit approval changing Android's acceptance state. It does not independently confirm iPhone received the reply or that either destination decrypted a message. The user was then asked to send a new test text in each direction and report incoming bubbles.
