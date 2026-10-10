# iOS encrypted relay — October 3, 2026

## Implementation

LokaMesh now tracks up to 16 opaque ready-link handles. Foreign verified packets with remaining hops are retained in the bounded RAM queue, their hop budget decremented once, and ciphertext forwarded to ready links except the recorded ingress handle. New links replay eligible pending packets; retries retain the 15-second pacing/four-packet batch, five-minute packet lifetime, 128 pending and 2048 seen bounds. Duplicate packets are suppressed. Turning relay off removes foreign pending packets. Only locally originated packets are serialized in the existing outbox; relayed packets still do not survive process restart.

ChatStore passes actual ingress handles and uses a targeted writer for each Bluetooth central/peripheral, extra BLE, shared LAN and Aware link. A newly ready route updates the mesh even if aggregate connection availability was already true. A disconnected route is removed independently. Unknown-ingress legacy inbox frames cannot be relayed; that inbox contains only locally addressed ciphertext awaiting unlock.

The adapter still requires available app runtime; receive-side processing while protected data is unavailable remains gated. No always-on background promise. Exclusion is by exact connection handle, not an authenticated cross-radio device binding. Two connections to the same physical phone can still receive duplicate ciphertext; packet deduplication/expiry/hop bounds constrain this. This is bounded flooding, not scored best-route selection.

## Software evidence

Signed iOS build passed. New Swift relay tests exercise A-to-relay-to-B ciphertext preservation, signature verification, recipient decryption, relay inability to decrypt, ingress exclusion, duplicate suppression, alternate-link replay, late link arrival, failed-link isolation, retry, expiry, hop exhaustion, unknown ingress and relay disabled. Existing Kotlin/Swift protocol interoperability and consent suite remains required. No packet format or crypto change.

## Physical gate — NOT YET RUN

Use Android A, iPad B, iPhone C. A and C are verified friends; B need not be their friend. Keep apps foreground and local radios enabled; remove Internet uplinks. Exclude every direct A–C path, including shared LAN and extra BLE links. Record actual topology rather than inferring it from distance or displayed names. Send fresh unique text A→C and C→A; verify content, authenticated receipts and available hop metadata. Disable B's local connection and verify the isolated path stops, then restore B and retry unexpired messages. Repeat with C initially absent and arriving before expiry. Only then test movement, locked/background states and an alternate relay.
