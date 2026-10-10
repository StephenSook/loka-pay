# Contact consent experiment (LC1)

Status: implemented as isolated Kotlin and Swift state machines, **not enabled in either app**. This is a prerequisite for one-sided QR initiation and Nearby chat requests, not a completed discovery or contact-sync feature. Existing v0 messages and trusted-sender checks are unchanged.

## Scope and identity boundary

The experiment uses the existing signed, encrypted packet-v0 envelope without modifying its schema or cryptographic algorithms. The caller must verify signature, destination, key fingerprint and envelope expiry before supplying a sender fingerprint to the state machine. A radio handle, advertisement name or link probe is never such a fingerprint. The codec itself performs no authentication.

The recipient's public key must already be known from a verified QR or a separately reviewed discovery mechanism. LC1 does not discover keys, authenticate nearby advertisements, establish accounts or prove proximity. Names are self-chosen labels bound to the authenticated envelope sender, not verified people or reserved usernames.

## Content

`LC1|kind|request-uuid|request-expiry-ms|base64-name`

Kinds: R (request), A (accept), K (acceptance acknowledgement), D (decline). A, K and D retain the original request UUID and deadline. Source and destination are bound by the outer envelope, not duplicated in plaintext. Request IDs use canonical lower-case UUID notation. Expiry is canonical nonnegative decimal milliseconds; a request lives for at most 300,000 ms. No deadline extension on retries.

Names appear only in R/A, use strict UTF-8 and canonical padded Base64, and are limited to 128 UTF-8 bytes. Control, format, line-separator and paragraph-separator Unicode scalars are rejected. Leading/trailing space is rejected for U+0020, U+00A0, U+1680, U+2000–200A, U+202F, U+205F and U+3000. K/D names are empty. Whole content is limited to 256 UTF-8 bytes. There is no avatar/media payload or URL.

Shared vector: `LC1|R|11111111-1111-4111-8111-111111111111|300000|TWFyeQ==` (Mary).

## State transitions

1. Initiator explicitly requests a conversation: OUTGOING.
2. Receiver accepts R into INCOMING; this never authorizes private messages.
3. Receiver explicitly accepts: APPROVED; returns A with its chosen name. Decline creates a DECLINED tombstone and returns D.
4. Initiator accepts A only for its own matching outgoing request, sender and deadline: COMPLETE; returns K.
5. Receiver accepts K only for its already approved request: COMPLETE.

APPROVED means the receiver made a local decision; it does not mean the other device received it. COMPLETE describes this local protocol state, not an atomic transaction across phones or confirmed message delivery. No state transition currently imports a contact key.

Repeated R returns the previously chosen A/D. Repeated matching A returns K; repeated K is harmless. Conflicting names, changed deadlines, wrong senders, unsolicited acceptance, acknowledgement before approval and acceptance after decline are rejected. Blocking removes pending entries and prevents new entries for that key. A different key is a different identity, so this is not Sybil resistance.

The book allows 32 live records, at most 16 inbound records, one record per peer, and 128 blocked identities. Terminal records consume capacity until expiry rather than being evicted to reopen declined requests. Crossing requests currently reject the second request; a production UI/coordinator must resolve this without silently approving either side. Calls must be serialized; Kotlin methods are synchronized, Swift requires caller serialization.

## Activation work still required

- Durable, encrypted request/block journal and atomic contact-store commits. Current books are memory-only: do not activate them on phones and lose blocks on restart.
- Bounded pre-decryption admission for unknown requesters, separate from chat/media processing. Existing mesh engines deliberately still reject unknown senders.
- Send retry scheduling and durable response replay; the book defines idempotent replies but does not schedule radio writes.
- Explicit accept/decline/block UI, cancellation/revocation policy and local-alias preservation.
- Authenticated profile/key discovery and a people-visibility control separate from anonymous relay participation.
- Restart/crash tests, simultaneous requests and physical Android/iPhone exchange. Software LC1 interoperability now exercises a Swift encrypted request, Kotlin encrypted acceptance and Swift encrypted acknowledgement using the actual packet-v0 implementations and disposable test keys.

Until these are complete, QR verification remains the app contact flow and both users still add one another. See [security review](../security/CONTACT-CONSENT-REVIEW.md).
