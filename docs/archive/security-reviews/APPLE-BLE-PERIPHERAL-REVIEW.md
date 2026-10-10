# Apple BLE peripheral incremental review

October 3, 2026. Internal implementation review, not an independent security audit.

The new public GATT service uses unchanged BLE v1 framing and probes. Automatic radio admission cannot add a contact or authenticate a name. Existing LP1 challenge/signature verification, LC1 explicit consent, recipient checks and encrypted packet v0 remain unchanged; no cryptographic algorithm or key storage change. Advertisement contains only service UUID.

Per-peer resource bounds: four tracked subscribers, 16 KiB assembled frame, 2–20 byte characteristic writes, 32 writes per batch, 2048 queued output chunks, burst eight completed frames/probes then four per second before identity work. Batch validation uses a copy and only commits on success, malformed input clears partial assembly. Stop/radio loss/unsubscribe remove routes and queued data. Native subscription overflow cannot be disconnected through CBPeripheralManager; untracked peers receive no payload and writes are rejected.

BLE transport is not itself authenticated or encrypted by this adapter. Existing application encryption and signed profile/consent processing are the security boundary. Flooding, battery denial of service, duplicate reciprocal links, OS-buffer residence and suspended-process cleanup remain physical/audit concerns. No background or mesh reliability guarantee.

Primary API references: [updateValue and backpressure](https://developer.apple.com/documentation/corebluetooth/cbperipheralmanager/updatevalue(_:for:onsubscribedcentrals:)), [advertising](https://developer.apple.com/documentation/corebluetooth/cbperipheralmanager/startadvertising(_:)).


## Discovery follow-up — October 3, 2026

Physical launch logs confirmed that both Apple peripherals advertised, but restored outgoing connections stopped the original central scan. The first peripheral-only update was insufficient for discovery alongside an existing route.

Foreground discovery now runs in bounded 20-second windows, paced at least 30 seconds apart. New candidates while the original central is occupied can use up to three additional outgoing GATT sessions, with separate `ble:extra:` handles. The original route remains intact. Additional sessions require the existing public round-trip probe before profile/message use, have 20-second setup and 12-second write deadlines checked on the runtime tick, and use the existing bounded 20-byte framing queues. Off/reset disconnect all extra sessions. Native background restoration of these additional sessions is not implemented.

Signed build and messaging regression suite passed, including independent inbound/outbound route availability. Updated build installed on both Apple devices. Post-install live verification initially blocked by locked device; actual concurrent discovery/profile exchange/delivery remains pending.


## iOS relay integration

The mesh now forwards signature-verified foreign ciphertext to concrete links other than its recorded ingress. No relay decryption or new key material is introduced. Hop count is decremented once per retained packet; existing v0 signature semantics remain unchanged. Queue/replay bounds and expiration stay enforced. Unknown ingress is never forwarded. Foreign RAM queues are excluded from own-message backup/outbox. Exact-handle exclusion is not proof of cross-radio neighbor identity; redundant routes may return duplicates and remain a hardware/flooding risk to measure.
