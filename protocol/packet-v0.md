# Packet v0

All integers use signed big-endian encoding. UUIDs and fingerprints are canonical lowercase ASCII. Frame limit: 16,384 bytes. Text limit: 2,048 UTF-8 bytes. Lifetime: five minutes. Clock skew allowance at creation: 30 seconds. Initial forwarding budget: 6 (up to 7 links; each intermediary decrements once).

## Frame

RFCOMM carries `int32 length` followed by exactly `length` packet bytes. Length must be 1–16,384 before allocation. No compression or media is supported.

## Packet layout

In order:

| Field | Encoding |
| --- | --- |
| version | int32 = 0 |
| packet ID | Java writeUTF UUID string |
| source | Java writeUTF SHA-256 key fingerprint |
| destination | Java writeUTF SHA-256 recipient fingerprint |
| created at | int64 Unix milliseconds |
| expires at | int64 Unix milliseconds |
| remaining hops | int32, 0–6 |
| sender public key | int32 byte count + DER bytes, ≤1024 |
| wrapped AES key | int32 byte count + 384 bytes |
| nonce | int32 byte count + 12 bytes |
| ciphertext | int32 byte count + 16–2064 bytes, includes GCM tag |
| signature | int32 byte count + 384 bytes |

Trailing bytes, truncated fields, invalid lengths, unsupported versions, invalid fingerprints, invalid lifetimes, invalid signatures, and exhausted intermediary hop budgets are rejected.

## Encryption and authentication

Each message generates a fresh random 256-bit AES key and 96-bit GCM nonce. The recipient's RSA key wraps the AES key with OAEP (main digest SHA-256, MGF1 SHA-1, empty label), explicitly parameterized for Android Keystore compatibility. AES-GCM uses a 128-bit tag.

GCM associated data is the serialized version, packet ID, source, destination, creation time, and expiration time. Signature input is that associated data followed by length-prefixed sender public key, wrapped key, nonce, and ciphertext. RSA SHA-256/PKCS#1 signs this input. Private keys never travel with packets.

Remaining hops is mutable and not covered by the sender signature. Its upper bound and live packet-ID cache limit honest forwarding; a hostile relay can reset the budget. Do not interpret the reported hop count as an authenticated metric. Production routing needs a separate reviewed anti-abuse design.

## Relay behavior

Links are explicitly allowlisted Bluetooth addresses for lab topology control. Flood a new valid packet to all connected neighbors except ingress. Intermediaries forward only ciphertext and decrement the remaining budget. Zero-budget packets can be consumed by their destination, but cannot be relayed further.

Per process: at most 128 pending envelopes and 2048 live packet-ID replay records. Refuse incoming packets when limits are reached. Remove expired entries on arrival, link establishment, and ten-second maintenance ticks. New/reconnected links replay pending packets except packets originally received from that neighbor. Disabling relay purges other devices' pending packets. Originated packets remain queued until expiry, even after apparent receipt, because v0 has no delivery ACK.

Pending state is memory-only. There is no reliable transfer ACK, retransmission timer, durable storage, or delivery guarantee. Clocks must be approximately aligned. Production protocol selection and security review precede consumer deployment.
