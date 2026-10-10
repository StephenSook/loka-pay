# Scheduling, inventories, duplicate state and eviction

Research context: [RAPID](rapid.md), [epidemic anti-entropy](epidemic-routing.md).
The proposed design below is not the current app implementation.

## Scheduling

Bounded control/ACK service first, then verified emergency (if ever introduced),
direct-destination data, text, ordinary carry, voice, photo and files. A sender's
unencrypted “urgent” label is not a trusted classification. Relays cannot infer
encrypted content type; any exposed class/cost hint needs authentication, quotas
and privacy review. Locally generated receipts can already be classified safely.

Use bounded chunks and weighted fair service so text can pass media without
starving media forever. Reserve capacity for control; use deadlines and age as
secondary tie breakers. A partially transferred attachment needs resumable chunk
hashes and bounded reassembly, not retransmission of an entire video.

The isolated scheduler test orders ACK, destination, small size only. It does not
implement fairness or full classes. [Paired results](simulation-results.md).

## Inventory and duplicate state

Start from measured exact summaries as a correctness baseline. Research session-salted
Bloom or other compact summaries, bounded deltas and explicit missing-item requests.
Measure encoded bytes and false positives; a positive must not indefinitely suppress
destination delivery. Force periodic bounded exact reconciliation. Filters can leak
membership through probing; salting alone does not make them private.

Keep separate bounded states: STORED, FORWARDED, DELIVERED, REJECTED_UNTIL,
EXPIRED and CANCELLED. A temporary rejection must not become permanent duplicate
suppression until hard expiry. Current cores mark seen before some admission failures;
test retry-after-capacity-recovery before retaining this behavior in a successor.

## Eviction and ACK knowledge

First delete expired, validly cancelled and safely proven delivered copies; collapse
duplicate local records. Then select lower-value relay data deterministically using
configured class, remaining usefulness, size, age and local carrier evidence. Reserve
own outbox separately. Do not use random eviction or a fabricated global replica count.
The current simulator reports zero evictions because it rejects instead; this policy
is not yet experimentally compared.

Only destination authentication permits Delivered. Public tombstones need a proof
bound to the exact envelope and intended recipient, with replay/forgery resistance;
retain no longer than needed to cover outstanding valid copies plus bounded skew.
Exposing such a proof can link recipient and message. Keep current encrypted receipts
until a reviewed design justifies that privacy cost. A relay's receipt is not proof
of destination acceptance, and a transport write is neither.

## Traffic beyond text

Voice notes and photos need bounded size, encrypted chunks and resumability. Calls
are real-time and require a continuing route; they are not DTN queue entries.
Moments remain FUTURE under repository priorities: at most an encrypted availability
manifest, with access-controlled content-addressed retrieval on demand. Do not flood
videos. Chunk hashes should cover ciphertext and not expose predictable plaintext
hashes. Multi-source retrieval requires independent integrity checks and cancellation.
