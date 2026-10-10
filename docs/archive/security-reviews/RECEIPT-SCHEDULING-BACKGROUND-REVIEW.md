# Receipt scheduling and background launch review

October 3, 2026 — implementation review for 0.6.18, not an independent cryptographic audit.

Scope: local A/B receipt scheduling, Android service recreation, iOS early store/central-manager initialization.

- No cipher, key format, packet schema, signature verification or recipient trust changes. Locally generated priority requests are parsed and restricted to save/read content. Relay ciphertext cannot set the priority flag; restored packets default to normal priority.
- Save receipts still follow durable message saving. Read receipts still require visibility in the active conversation. Transport acceptance and notifications are not destination receipts.
- Queue capacity remains 2,048 chunks; 128 are reserved for priority admission. Scheduling never splits a packet currently in flight. An attacker cannot promote relayed frames using an unauthenticated wire field. Existing ingress limits and packet expiry remain.
- Priority is not a fair scheduler: a sustained stream of locally generated receipts can delay ordinary packets. The existing bounded pending queue and expiry constrain retention; measure mixed-load fairness before expanding priority to other content.
- Android restart respects local connection Off and existing permission checks. START_STICKY does not override force-stop or guarantee scheduling.
- iOS early initialization remains behind the pending-deletion journal. Store creation is idempotent per runtime except explicit reset. Protected key accessibility is unchanged, so locked-device limitations remain visible.

Regression checks cover exact reconstructed bytes, partially sent frames, queue reserve/rejection, encrypted receipt callback selection, retry selection, invalid-priority rejection, and ordinary relay classification on Android. Existing cross-platform crypto/content checks must also pass. Physical background reliability remains an open gate (EXP-014).

## iOS 0.6.19 follow-up review

Already signed/encrypted in-memory outbox packets may retry while protected data is unavailable; no new key access, decryption or history access is authorized by this change. The existing expiry, retry interval and batch limits remain. BLE queue drain now invokes the same bounded retry method. A finite background task is balanced on queue completion, disconnect, write failure and expiration; expiration suppresses new grants until foreground resume. Reset clears the callback and stops the link. Receipt semantics and key accessibility remain unchanged. This review does not assert successful physical background delivery.
