# Experimental BLE GATT link v1

Transport framing only; this does not change encrypted packet v0 or grant contact trust. Implementation: Android GATT peripheral, iPhone Core Bluetooth central. Foreground only, physical interoperability not yet tested.

Service UUID: `9ebc1000-6ec2-4f17-97ef-48594c4f4b41`.

- RX characteristic: `9ebc1001-6ec2-4f17-97ef-48594c4f4b41`, central writes with response.
- TX characteristic: `9ebc1002-6ec2-4f17-97ef-48594c4f4b41`, peripheral indicates; central subscribes via CCCD.
- Each value is 2–20 bytes: one flags byte plus 1–19 bytes of packet payload. Bit 0 starts/restarts a frame; bit 1 ends it. Other flag bits are rejected. A complete single-chunk frame has flags `3`.
- Reassemble at most 16,384 payload bytes. Continuation without start, excessive length, unsupported flags and a continuation more than ten seconds after the prior fragment are rejected/reset. No arbitrary data is interpreted as contact trust.
- Maximum queue is 2048 chunks per peer; each write/indication completes before the next. Transport acknowledgement means only fragment acceptance, never recipient message delivery.
- Android limits BLE connections to four, requires explicit lab allowlisting before accepting packet/probe writes, and exposes anonymous LOKA link labels. This is a cap, not a measured useful peer count.

## Public diagnostic probe

Exactly `7f 4c 4f 4b 41 01` on RX is a public link probe. If the peer is allowed and subscribed, Android queues exactly `7f 4c 4f 4b 41 02` on TX. These reserved control values contain no identity, private conversation or secret and never enter MeshEngine. Receipt of the reply proves only an observed round trip during that session. The iPhone supports this public test and the experimental encrypted packet-v0 engine. A successful probe triggers replay of queued packets but grants no identity trust or delivery confirmation.

These six-byte diagnostic values are distinct from ordinary framing, whose first byte can only be 0–3. No server, Internet validation, Wi-Fi router or cellular connection is involved. Background reliability, BLE security binding, automatic reconnection and route repair remain unproven.


## Approval/readiness correction — app 0.4.2

CCCD subscription alone is not permission to write packets. iPhone holds encrypted outgoing packets in the mesh queue until an outstanding public probe receives its exact reply. A rejected/timed-out probe keeps that route unavailable, with an explicit Android approval action. This is observed transport readiness, not peer identity authentication or a message receipt. Android still requires the session allowlist and trusted sender processing remains separate.

Android acknowledges CCCD setup before publishing link readiness and dispatches complete frames/link events outside its GATT monitor, with at most 128 frame callbacks waiting. Mesh transport exceptions retain pending ciphertext and do not prevent the app's link-status callback or other available links from progressing. Regression tests exercise queued-write rejection/reconnect and another viable route. Probe retry has a twelve-second timeout; it does not fabricate a success.


## Foreground approval checks (0.5.0)

The public probe bytes and packet framing are unchanged. After explicit peripheral selection and subscription, iOS initiates a bounded check window: up to 20 requests, at least 3 seconds apart, within 60 seconds. Only one acknowledged-write operation/check is outstanding; each check times out after 12 seconds. An outstanding write that times out disconnects rather than being reused. Success, disconnect and explicit Off cancel the retry window. No message writes start until a probe reply is received during an outstanding check. Rejected writes cannot implicitly grant link authorization. These public bytes prove transport connectivity only; packet authentication and recipient trust stay in the messaging layer.

Android marks a BLE peer ready for consent after a valid subscription, clears readiness on unsubscription/disconnect/stop and presents the explicit allow action in the main app. Authorization remains separate from contact trust. No capability negotiation or wire migration was introduced.

## Background and application content (0.6.0)

The GATT bytes, probe and explicit approval remain unchanged. Typed encrypted [chat content](CHAT-CONTENT-V1.md) adds short voice fragments and recipient-save receipts. Android runs the enabled local session under a connected-device foreground service; iPhone enables bluetooth-central restoration for the selected peripheral. This provides best-effort wake opportunities, not guaranteed continuous background delivery. iPhone locked private keys defer decryption and acknowledgement until unlock; expiry is never extended. Both apps must be updated for voice/receipts.

## Remembered approval and bounded restoration — 0.6.3

Android persists explicitly approved opaque link handles locally, capped at 32, excluded from OS backup. Removing approval persists revocation and disconnects. A handle is transport consent, not authenticated identity; address rotation/spoofing remains a limitation. Unknown handles need explicit approval. Trusted-sender/recipient checks and wire/cryptography are unchanged.

iPhone bounds connection/service setup, handles restored active indications, checks elapsed deadlines on app activation and times out acknowledged writes. Six backoff retries precede a single OS-managed known-phone wait; repeated failures do not create unlimited active retries. Waiting has no setup spinner. Foreground/radio recovery restarts the budget; Off cancels requests. Physical recovery remains unconfirmed.

## Automatic consumer links — 0.6.5

Supersedes consumer address approval above. With local connection enabled, Android admits compatible BLE links automatically; engineering tools retain Manual BLE topology control for experiments. Explicit blocked handles still reject. iPhone discovers a current service-filtered candidate rather than repeatedly connecting to an obsolete cached handle. Radio neighbors remain untrusted ciphertext routes, not contacts. QR verification and authenticated recipient receipts remain mandatory for private delivery and Delivered status.

Android processes at most an 8-item burst followed by 4 complete frames/public probes per second per peer before signature processing. Existing connection/frame/queue bounds remain. The public probe reply takes priority after any in-flight indication; queued mesh replay starts only after that reply is acknowledged. The control bytes and encrypted packet wire format are unchanged. See [admission review](../security/LOCAL-LINK-ADMISSION-REVIEW.md). Automatic BLE admission does not implement automatic Classic pairing, iPhone multi-hop forwarding or an end-to-end route guarantee.

## 0.6.8 Android central discovery

Android now also scans and connects as a GATT central. Updated Android peripherals keep the same service UUID in their advertisement and add eight ephemeral random bytes as service data for that UUID in the scan response. Between updated Androids, the lexicographically smaller unsigned token initiates; equal/absent/malformed tokens do not. Tokens carry no identity and do not grant trust. iPhone behavior and packet/probe framing are unchanged.

Outgoing Android handles use `ble:out:`; incoming handles retain `ble:`. Both obey the existing manual/automatic/blocked admission policy. Connections remain untrusted ciphertext routes until existing destination packet verification; fresh authenticated-neighbor sessions remain unimplemented. Code caps, concurrency and discovery success are not hardware support claims. See the incremental admission review and validation record.


## Apple peripheral role — October 3, 2026

iPhone/iPad now publish the same service, writable RX and indicating TX alongside their existing central. Only the service UUID is advertised; LP1 profile exchange and LC1 chat consent remain above transport. Up to four subscribed incoming peers, each with independent assembler, 2048-chunk queue and an 8-frame/probe burst / 4-per-second admission budget. Incoming handles use `ble:in:`; readiness starts after a valid subscribed public probe is accepted and its reply queued. Core Bluetooth `updateValue` acceptance is local queue acceptance, not a recipient delivery receipt. Backpressure retains the exact queued chunk until the ready callback. The existing central remains single-peer; this change does not provide full multi-peer scanning, Wi-Fi handoff or iPhone relaying.

Off, reset, unsubscription and radio loss clear incoming sessions and profile routes. `bluetooth-peripheral` enables OS-permitted background events; peripheral restoration after process termination is not implemented. No force-quit/background reliability claim. Physical Apple discovery, concurrent Android coexistence, duplicate duplex links and delivery remain test gates.


## Discovery follow-up — October 3, 2026

Physical launch logs confirmed that both Apple peripherals advertised, but restored outgoing connections stopped the original central scan. The first peripheral-only update was insufficient for discovery alongside an existing route.

Foreground discovery now runs in bounded 20-second windows, paced at least 30 seconds apart. New candidates while the original central is occupied can use up to three additional outgoing GATT sessions, with separate `ble:extra:` handles. The original route remains intact. Additional sessions require the existing public round-trip probe before profile/message use, have 20-second setup and 12-second write deadlines checked on the runtime tick, and use the existing bounded 20-byte framing queues. Off/reset disconnect all extra sessions. Native background restoration of these additional sessions is not implemented.

Signed build and messaging regression suite passed, including independent inbound/outbound route availability. Updated build installed on both Apple devices. Post-install live verification initially blocked by locked device; actual concurrent discovery/profile exchange/delivery remains pending.
