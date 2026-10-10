# Apple BLE discovery and messaging

Status: implementation added; physical results pending.

1. Update iPhone and iPad. Open LOKA, complete setup, enable nearby and profile name sharing; grant Bluetooth access. For the first direct-link control, stop LOKA nearby on Android so Apple's single outgoing central does not select Android first.
2. With both apps foreground, verify profile names in Nearby, request chat on one, accept on the other. Check no contact is silently added by subscription.
3. Send unique fresh text in both directions; verify recipient contents and authenticated delivery ticks. Record discovery time, delivery latency, OS, radio state and failures.
4. Stop nearby on one; verify profile/link withdrawal. Re-enable and repeat. Then enable Android and test coexistence; one outgoing central may stay occupied by Android. Do not label this full automatic multi-peer discovery.
5. Repeat without Internet while retaining Bluetooth; then lock/background one device separately. Force quit is a separate failure case, never assumed to keep working.
6. Exercise malformed frames, queue pressure, rapid subscription changes and repeated mutual connection attempts. Software framing/rate/route tests do not establish physical throughput or reliability.


## Discovery follow-up — October 3, 2026

Physical launch logs confirmed that both Apple peripherals advertised, but restored outgoing connections stopped the original central scan. The first peripheral-only update was insufficient for discovery alongside an existing route.

Foreground discovery now runs in bounded 20-second windows, paced at least 30 seconds apart. New candidates while the original central is occupied can use up to three additional outgoing GATT sessions, with separate `ble:extra:` handles. The original route remains intact. Additional sessions require the existing public round-trip probe before profile/message use, have 20-second setup and 12-second write deadlines checked on the runtime tick, and use the existing bounded 20-byte framing queues. Off/reset disconnect all extra sessions. Native background restoration of these additional sessions is not implemented.

Signed build and messaging regression suite passed, including independent inbound/outbound route availability. Updated build installed on both Apple devices. Post-install live verification initially blocked by locked device; actual concurrent discovery/profile exchange/delivery remains pending.
