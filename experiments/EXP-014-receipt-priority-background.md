# EXP-014 — Receipt scheduling and background recovery

Build 0.6.18 (26), October 3, 2026. Targeted improvement to the existing app; not a replacement network or proof of mesh reliability.

## Measured queue experiment

Kotlin `BleFramingTest` and Swift `BleFramingChecks` enqueue twenty 1,400-byte frames, start the first, then enqueue a synthetic 1,400-byte receipt. Reassemble every output frame and compare exact bytes.

| Schedule | Chunks transmitted until receipt complete |
| --- | ---: |
| FIFO baseline | 1,554 |
| Receipt ahead of waiting frames | 148 |

90.48% fewer chunks before this receipt completes. This is deterministic queue work, **not measured radio latency, delivery rate, range or battery improvement**. Both implementations preserve a partially transmitted frame. Normal traffic has a 1,920-chunk admission limit, leaving 128 chunks inside the existing 2,048 maximum for receipts. Full queues reject without corrupting existing frames. A receipt may still wait for a large active frame or transport backpressure.

## Integration

Only locally created, validated save/read receipts request priority. Encryption and packet-v0 bytes stay unchanged. Android dispatches through the transport abstraction; BLE central and peripheral implement priority, other transports use normal send. Swift uses the equivalent BLE scheduler. Current-session retries preserve priority; restored ciphertext and forwarded packets remain normal priority because they carry no trusted priority metadata. The existing retry frequency, packet count, expiry and relay budget are unchanged. There is no general claim that text or media throughput increased.

Android now returns START_STICKY while local connection is enabled and resumes when stores become ready after process recreation. Explicit Off returns START_NOT_STICKY. Permissions and radio checks remain required. iOS creates its stores and restoration-enabled central manager in application launch rather than waiting for a SwiftUI screen to appear. Pending data-deletion cleanup still precedes store creation.

## Platform limits

- Android foreground services can support background BLE, but scheduling, battery restrictions and force-stop still matter. Sticky service restart is requested, not a guaranteed recovery time. [Android background BLE](https://developer.android.com/develop/connectivity/bluetooth/ble/background), [Service lifecycle](https://developer.android.com/reference/android/app/Service).
- iOS Bluetooth restoration requires qualifying system events and pending Bluetooth activity. User force-quit prevents normal Bluetooth relaunch. [Apple TN3115](https://developer.apple.com/documentation/technotes/tn3115-bluetooth-state-restoration-app-relaunch-rules).
- Private keys remain WhenUnlockedThisDeviceOnly. Locked-screen ciphertext retention/notifications do not imply decryption or authenticated save receipts; cold locked launch can wait for unlock. No security setting was weakened to promise always-on messaging.
- Neither platform uses Internet push to deliver these local packets. A usable local route is still necessary. iPhone remains a single-link endpoint, not an operational multi-link relay.

## Physical test — NOT YET PROVEN

With mobile data and Internet uplinks unavailable, keep local radios and local connection enabled. Use synthetic messages only. Test Android→iPhone and iPhone→Android in foreground, after Home, and with the receiving screen locked. Record send/save-receipt latency separately; a background notification must not mark Read. Repeat after ordinary OS process eviction, then separately after user force-stop/force-quit, recording the expected need to reopen. Test notification Reply and explicit Turn off. Repeat with a media queue and an intermittent route. Check no duplicate bubbles, false delivered/read states or unbounded retries.

No new physical range, relay, screen-off reliability, battery or 1,000-node simulator results are asserted here. The unfinished network-simulator scaffold is separate from this executed queue experiment.

## Validation and deployment

Android core tests, app unit tests, lint and debug assembly passed. Swift protocol, framing, contact, encrypted archive and actual JVM↔Swift crypto interoperability checks passed; signed iOS build succeeded. Build 26 installed on the connected iPhone without clearing its app data. At deployment time ADB listed only an emulator; neither physical Android phone was connected, so Android physical installation remains pending. No new physical delivery result is recorded.

## iOS 0.6.19 follow-up — background sending

User reports iPhone→Android transfers stall or slow when the sender is backgrounded. Source inspection found that the timer skipped even encrypted outbox retries while protected data was unavailable. The retry now runs before the protected-data check; decrypting, creating read receipts and archive writes remain protected. BLE outgoing-queue drain is also a retry opportunity, using the same 15-second eligibility and four-packet bound, without depending exclusively on the UI timer. Link confirmation already replays pending packets.

An active outgoing transfer now requests finite UIKit background execution time. The task ends when the queue drains, disconnects, fails, or UIKit expires the grant. Expiration prevents another request until the app becomes active. This does not extend packet expiry, keep an idle app alive indefinitely, defeat force-quit or change key accessibility. Cold locked startup still cannot initialize the protected history. Requested runtime duration is controlled by iOS, not promised by LOKA.

Source: [Apple — extending background execution](https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time). Physical comparison remains pending: identical short synthetic texts, same phones/route, receiver foreground, sender foreground versus Home versus lock. Record destination save time and receipt separately. No throughput improvement is claimed from source inspection.
