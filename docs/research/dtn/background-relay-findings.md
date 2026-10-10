# Background relay investigation — 2026-10-03

Connected iPad Air 5 and iPhone SE3 diagnostics were copied read-only. Their latest
snapshots at epochs 1791062591/1791062590 both show applicationState=2,
protected data unavailable, local connection enabled, and the other Apple device
as a verified v2 BLE peer. These are cached snapshots, not proof of current radio
liveness. The iPad log contains repeated incoming carrier-addressed frames, with
some earlier commits. This does not correlate the user's exact logical message.

Confirmed code blocker: ChatStore.receiveFrame drops foreign packets while
protected data is unavailable. The carry journal uses Complete file protection.
Removing only the guard would therefore not make durable locked admission work.
Added a short-ID diagnostic for this deferral; storage/security behavior unchanged.

Other gaps: the main BLE central has restoration support, but AppleBlePeripheral
and NearbyBleConnections lack restoration identifiers/restore handlers. Retry and
extra-link timeouts rely partly on a two-second timer, which cannot keep a suspended
process executing. Profile handshakes require unlocked identity access. A verified
link and cached ciphertext can continue making progress during granted execution,
but neither a radio switch nor a timer grants perpetual background runtime.

## Concrete proposal awaiting explicit approval

Change only `loka-carry-v1.enc` from Complete to
CompleteUntilFirstUserAuthentication, and permit foreign-destination admission
through the existing signature/role/quota/save-before-forward checks while locked.
The file remains AES-GCM encrypted and contains end-to-end encrypted packets.
History/contact files and keychain private-key accessibility remain unchanged.
Only an already configured process with its cached archive key benefits; locked
cold starts, new identity handshakes and iOS suspension remain separate work.

Risk: the OS-protected sealed carry file becomes accessible after first unlock,
including while screen-locked. This is a weaker file-protection boundary even
though payload encryption remains. Automatic approval review rejected applying
this exact downgrade without explicit user authorization. No downgrade was applied.

Validation after approval: native archive/tamper/expiry checks, signed build,
physical screen-lock receive→durable commit→later verified destination contact,
then destination receipt; separately test process restoration and force-quit.

## Platform sources and follow-up

- Apple Core Bluetooth background guide: background modes allow event-driven
  work, with slower/coalesced scans and altered peripheral advertisements. They
  do not provide unlimited execution:
  https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html
- Apple Wi-Fi API overview distinguishes available APIs; do not assume Android
  Wi-Fi Direct is an iOS background mechanism:
  https://developer.apple.com/documentation/technotes/tn3111-ios-wifi-api-overview
- Current Core Bluetooth documentation describes Live Activity-associated
  background privileges. Evaluate for an explicit user-visible active delivery
  session, not a hidden permanent relay; not implemented or phone-validated here:
  https://developer.apple.com/documentation/corebluetooth
- Android recommends connectedDevice foreground services for long-lived BLE
  communication, subject to launch restrictions and process lifecycle:
  https://developer.android.com/develop/connectivity/bluetooth/ble/background

Next independent engineering work is restoration coverage for all BLE roles and
retry/drain on actual transport events. Preserve file protection until approval;
do not route around the rejected change with a second less-protected journal.

## Approved implementation — build 0.6.36 (44)

The user explicitly approved fixing both issues after the protection tradeoff was
explained. The previously rejected change is now applied: foreign ciphertext can
enter verified bounded durable admission while locked, and only the carry journal
uses CompleteUntilFirstUserAuthentication. Existing ciphertext frames are rewritten
atomically at unlocked setup to migrate the file protection. History/nearby files
and private-key accessibility retain their previous protection. See
security/LOCKED-CARRY-REVIEW.md for the review and remaining risks.

Peripheral and additional-central BLE managers now have distinct restoration IDs
and restore handlers. Services/subscriptions and connected/pending peripherals are
reconstructed within existing peer limits. Partial frames and transport send queues
are discarded; a fresh probe/signed profile remains required. Explicit local Off
is respected. Background transitions register a service-filtered scan without a
foreground scan timeout; completion of the main link probe renews this scan when
backgrounded. Additional-central queue drains trigger bounded mesh retries, and
foreground/unlock events drain deferred own-destination messages. No new Wi-Fi
transport, background mode, perpetual timer or force-quit guarantee is introduced.

Signed iOS build, full native Swift/Java messaging suite and 69 Android core tests
passed. Android debug build passed. Actual locked admission/receipt performance
still requires phone evidence, as does OS-driven restoration after process eviction.

## Device installation and migration evidence

0.6.36 (44) installed and launched successfully on Samsung SM-S948U1, iPhone SE3
and iPad Air5, preserving data. Post-launch snapshots on both Apple devices report
`NSFileProtectionCompleteUntilFirstUserAuthentication` for the carry journal,
ready=true, protected data available and local connection enabled. The iPad has
verified v2 BLE profiles for both the Samsung and iPhone. The iPhone has the iPad
as v2 and a Samsung profile still reporting v0 at that snapshot (negotiation can
finish later). Multiple handles per Apple identity are present; core per-identity
retry suppression remains in effect. These routes are BLE, not a Wi-Fi proof.

Redacted snapshots: experiments/results/2026-10-03-background/. A fresh locked-iPad
relay test has been requested. No locked admission/delivery pass is claimed from
these foreground snapshots. Force-quit/background recovery gate remains open.

## Locked background forwarding observation

Post-update snapshots at epochs 1791063641/1791063642 report both Apple devices
backgrounded (state 2), protected data unavailable, mesh ready, correct migrated
carry protection and verified v2 BLE peers. The iPad log records foreign frames
handled while locked and onward writes at hops=5 toward both destinations.
The iPhone log records relayed frame arrivals at hops=5, carrier=iPad.

This establishes observed locked/background forwarding activity and relayed packet
arrival with the updated app. It does not identify which frame is the user's exact
chat payload versus control/receipt, prove a new durable admission while locked
(the current bounded log contains no matching fresh commit), prove delivery/read
receipt latency or prove force-quit restoration. Own-destination payloads remain
in the bounded encrypted inbox until protected data becomes available; destination
receipt generation still follows successful decrypted app save. Further locked
receipt changes would require a separate key-access/storage review, not permission
prompts or a radio change. Redacted evidence is saved alongside migration snapshots.
