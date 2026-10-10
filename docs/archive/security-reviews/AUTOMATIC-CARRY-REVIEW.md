# Automatic carry implementation security review

2026-10-03. Scope: packet v2, live capability exchange, native routing and journal
integration in build 0.6.33 (41). Implementation self-review; not independent audit.

## Decision and threat analysis

The user explicitly requested routing inside the normal message flow. The source
selects a relay internally; manual carrier UI is removed. This supersedes the v1
experiment-only UX, without extending v0 lifetime or enabling unrestricted flooding.
See [wire contract](../protocol/PACKET-V2-AUTOMATIC-CARRY.md).

The v2 carrier authorization is signed outside GCM AAD. This is a deliberate change:
recipient confidentiality and content authentication stay unchanged while the original
sender can add one relay after composing offline. Every receive verifies the complete
sender signature before accepting or decrypting the packet. An intermediary cannot
replace carrier, destination, deadline or ciphertext without invalidating that signature.
The origin verifies its own identity and an empty carrier before authorizing. No new
cryptographic primitive is introduced; no forward-secrecy claim is made.

Carrier selection is persisted using the entire encoded envelope before transfer.
Comparing only IDs would miss this mutation and allow additional carriers after a
crash; both cores now compare encoded durable records. Storage failure retains the
unassigned source packet and prevents carrier writes. Restart restores the existing
signed carrier, never reallocating it merely because it is absent. A source with a
compromised signing key can mint packets regardless; the copy bound is for cooperating
implementations, not a Sybil/global anti-abuse guarantee.

Compatible identities come from challenge-bound verified profile exchange and signed,
encrypted control on the same live handle. Capability is not proof of storage capacity,
future destination contact or honest behavior. An admitted relay can withhold delivery.
The sender keeps its copy and accepts only existing authenticated destination receipts
as delivery; transport acceptance is never marked Delivered. Stable identity ordering
is a bounded baseline, not a quality-optimal route claim.

A relay accepts only envelopes naming it and can forward only to the verified
compatible destination, preventing recursive replication. The destination permits
both direct and relayed packets, with idempotent app save. Mutable hop counts remain
non-attesting. Packet ID/ciphertext are unchanged when authorizing a carrier, so a
later relay arrival does not create a second chat message after direct delivery.

Encrypted storage, one-hour absolute expiry, 128-count and 512-KiB limits remain.
No cloud dependency, plaintext relay content or weakening of Apple complete file
protection. Existing local metadata (source/destination/carrier, timestamps) remains
visible; the added capability reveals protocol support, not a contact graph. Short
local event logs are diagnostic evidence, not cryptographic path proofs.

## Remaining limits

One relay only per packet; no safe carrier reassignment/custody transfer, no route
prediction or generalized multi-hop carry, no relay-readable cancellation, no full
fairness or authenticated congestion feedback. Older peers need an app update for
new v2 messages. A carrier that cannot run/access its store in the background cannot
forward then. Hardware delivery and lifecycle gates remain outstanding until observed.

Validation: Kotlin automatic routing tests, encrypted Swift archive recovery and
Java/Swift v2 interop, existing v0/v1 and profile/consent regressions, both app builds.
These tests use simulated clock advancement and do not establish physical carry.
