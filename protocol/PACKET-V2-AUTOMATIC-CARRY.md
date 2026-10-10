# Packet v2: automatic single-carrier routing

2026-10-03, build 0.6.33 (41). Ordinary chat sends, notification replies, media chunks,
reactions and read receipts use this policy. Users choose a recipient only. The manual
carry screen is removed. This implements bounded automatic single-carrier forwarding,
not predictive routing, arbitrary relay chains or unlimited replication.

## Automatic policy

1. Save a new source packet encrypted at rest, with its original one-hour deadline.
2. Wait for writable links and authenticated nearby profiles advertising v2 support.
3. Prefer a directly connected destination. No relay is required for direct delivery.
4. Otherwise select one available compatible non-destination device (stable identity
   order). The sender signs that carrier authorization and atomically replaces its
   journal entry before transferring it. Selection can happen after the message was
   composed, without re-encrypting, changing message ID or renewing expiry.
5. Only that carrier may retain the foreign packet. It saves ciphertext before
   forwarding and may send only to the destination. Its copy survives supported app
   restarts. It need not be a friend and cannot decrypt the message.
6. The source retains its own copy and may still deliver directly. A committed carrier
   is not replaced on a timeout: doing so could create unbounded copies. Loss of that
   carrier leaves direct delivery available. Each packet has at most two cooperative
   retained copies before destination delivery (origin plus one relay).
7. Destination acknowledgments use v2 and the same authorized carrier, with direct
   delivery allowed. The existing encrypted destination receipt remains authoritative.

A synchronous failed v2 write places that handle on a 30-second cooldown, allowing
another available relay to be selected. Asynchronous transport acceptance still does
not prove delivery. Selection uses verified availability, not advertised signal alone. It does not yet
exchange destination reachability tables or predict future encounters. A physically
present radio without a writable, verified application link is not an eligible route.
A reply or read receipt can independently select a carrier if none is preauthorized.

## Wire and authentication

The big-endian v2 wire layout follows v1: version, ID, source, destination, createdAt,
expiresAt, carrier string, mutable hops, then sender key, wrapped AES key, nonce,
ciphertext and signature. Carrier is empty or a distinct 64-character lowercase
fingerprint. All strings remain canonical ASCII with the existing two-byte lengths.

V2 AES-GCM AAD is version + ID + source + destination + createdAt + expiresAt.
V2 signature input is that AAD + carrier string + the existing length-prefixed key,
wrapped key, nonce and ciphertext. The carrier is authenticated by the sender's
signature but excluded from GCM AAD so the origin can authorize its first carrier
later without knowing the recipient's private key or changing ciphertext. Only the
origin signing key can do this. The origin implementation permits empty → one carrier
once and persists the complete replacement envelope before use. Journal comparison
uses full encoded bytes, not packet IDs alone.

V0 and v1 encoding/verification remain unchanged. V2 destination accepts source hops=6
or carrier hops=5; v1 retains its old forced-carrier experiment semantics. The hop
counter remains mutable and cannot attest the physical route against malicious peers.

## Capability and migration

After challenge-bound LP1 profile exchange, peers send an encrypted/signed v0 control
`LP1|V|2`. Only controls from the verified identity on that live handle update its
capability; disconnect removes the profile. Capability is retried with the existing
15-second profile maintenance. Old peers can still parse the unchanged profile reply
and ignore the new control. V2 payloads are sent only to live handles advertising v2.
No fallback silently creates a second differently encrypted copy of a queued message.
Old devices must update to exchange newly created v2 chats; pending old v0/v1 packets
retain their original behavior and expiry. All three test devices must update.

The same carrier journal supports v1 and v2, with atomic encrypted storage, 512-KiB
encoded-byte limit, 128 pending entries and nonurgent v1/v2 admission below 112.
No expiry renewal, relay decryption, Internet dependency or relaxation of iOS locked
file protection is introduced. Existing radio connection and OS lifecycle restrictions
still apply. Automatic routing is not proof of reliable background execution.

## Validation

Native tests cover offline enqueue, delayed authenticated peer availability, direct
preference, failed selection persistence, identity/hop/expiry checks, immutable
ciphertext, no reassignment after restart, relay restart after a simulated ten minutes,
no carrier-to-carrier replication and actual Swift/Kotlin payload and receipt interop.
Physical results must be recorded separately; one-hop direct delivery remains valid.
