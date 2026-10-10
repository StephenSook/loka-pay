# Carry experiment security review

Reviewed 2026-10-03 against packet v0, Kotlin/Swift packet and mesh implementations, encrypted history stores and experiment entry points. Scope: opt-in version 0.6.32 (40), one designated carrier, one-hour maximum. This is an implementation self-review, not an independent cryptographic audit or production approval.

- No new cryptographic primitive. Version, carrier, source, destination, creation and deadline are authenticated by existing encryption associated data and sender signature. Carrier/expiry edits fail signature validation. Carrier has ciphertext and cannot unwrap the recipient key.
- Normal messages remain byte-compatible v0. No silent v1 upgrade; all experiment devices must be deliberately updated. Capability negotiation remains unimplemented.
- Save-before-forward prevents falsely claiming durable admission. Journals are bounded, authenticated encrypted at rest, atomically replaced, and restored only after full validation. Failed admission remains retryable. Expiry is absolute and checked on restore and forwarding.
- Existing iOS complete file protection is preserved. Locked-device access and OS suspension may prevent admission or forwarding; no always-on background claim follows from persistence.
- Source and destination identities, carrier identity, timestamps and traffic patterns remain visible metadata. Short packet IDs in local diagnostic event caches are not message plaintext or keys. These caches are evidence, not authenticated route attestations.
- Mutable hop counters cannot prove carrier traversal against a malicious peer. The direct-copy rejection is an experimental control, not security against fabricated hop counts. Correlated carrier and recipient observations are required.
- Resource exhaustion remains possible from signed strangers; byte/count limits bound local impact, but no reputation, global congestion control or fair admission is claimed. Reserved count headroom is not a full urgent-relay scheduling policy.
- Local deletion/revocation and expiry use durable queue updates. Storage failures preserve queues until retry; expired disk records may remain until a later successful rewrite but cannot be sent after expiry.

Validation gates: native Kotlin carry tests; native Swift encrypted-journal restart, expiry, failed-write and tamper tests; Java/Swift v1 payload and receipt interoperability; existing v0 compatibility suite; Android and iOS app builds. Record actual results separately from physical proof. Production rollout requires general protocol negotiation, broader storage/backpressure testing and observed physical background behavior.
