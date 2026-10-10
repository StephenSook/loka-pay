# Designated-carrier experiment — packet v1

Status: historical opt-in experiment, 2026-10-03. Superseded for new ordinary chats by [automatic v2](PACKET-V2-AUTOMATIC-CARRY.md) in 0.6.33; the manual UI is removed. The following describes 0.6.32. Normal chat stays packet v0. This is not general adaptive DTN or automatic capability negotiation. Install version 0.6.32 (40) on all three participants before using Settings → Carry test.

## Wire contract

Use the existing big-endian v0 encoding, replacing the first version integer with 1 and inserting a Java modified-UTF string `carrier` after `expiresAt`, before the mutable hop integer. The carrier is a lowercase 64-character SHA-256 device-key fingerprint, distinct from source and destination. The same insertion is included in AES-GCM associated data and the sender signature. Existing key wrapping, encryption and signature algorithms are unchanged. Unknown versions fail closed; old v0-only builds cannot carry this experiment.

The source sets six remaining hops. Only the named carrier admits a foreign v1 packet at six, durably saves ciphertext, and forwards at five. The destination admits five and ignores direct six-hop copies. The existing hop field is mutable: this rule isolates cooperative testing but is not cryptographic proof of the route. Correlate device traces for physical proof.

Maximum lifetime is 3,600,000 ms from original signed creation time; forwarding/restart never extends it. Existing 30-second future-clock tolerance remains. v0 retains its 300,000-ms limit and exact encoding. Existing frame and plaintext limits remain 16,384 and 2,048 bytes. Delivery and hop receipts for v1 use the same carrier and v1 expiry policy; other ordinary application traffic remains v0.

## Durable admission

Persist before forwarding. Journals contain v1 source packets, carrier ciphertext and receipts, encrypted with the existing protected local history key and separate `loka.carry.v1` AAD. Android uses an atomic SQLite row replacement; Apple uses an atomic protected file. Restore verifies signatures, identity, packet shape and original expiry before admitting any frames. Failed storage does not mark a new packet seen. Expired entries are never forwarded, even if disk cleanup failed.

Pending capacity is 128; nonurgent v1 admissions stop at 112. Encoded v1 journal contents are bounded to 512 KiB. The remaining slots are headroom, not a separately authenticated relay receipt class. Cooperative replication is limited to origin and one designated carrier; no spray, unrestricted lifetime extension or additional relay is enabled. Transport discovery and link retry are unchanged.

## Physical acceptance

With mobile data and Internet uplinks absent, preserve local radios. First use open apps: A sends to C via B; record origin and carrier commit with matching packet ID. Disconnect A before B meets C. Wait more than five minutes but less than one hour; restart B and verify a restored event before taking B to C. Record destination saved, readable message, two link traversals where reported, and return delivery receipt via B. Repeat reverse platform direction, then separately background/screen-off tests. A connected three-device demonstration alone does not prove store-carry-forward. No physical pass has yet been recorded for this build.
