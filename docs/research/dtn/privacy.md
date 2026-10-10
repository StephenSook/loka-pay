# Security and metadata boundary

Source context: [BPSec assessment](ietf-bundle-protocol.md),
[Wesh protocol's metadata discussion](https://berty.tech/docs/protocol/).
Encryption of content does not hide addresses, encounter timing, size or storage
behavior. Berty's documented rotating rendezvous ideas illustrate tradeoffs, not
a drop-in privacy guarantee for LOKA.

Current LOKA packets expose stable identity fingerprints. The RSA/AES experimental
envelope must not be described as a modern forward-secret double ratchet. Relays
do not need plaintext, but metadata privacy is a separate unfinished design.

## Proposed review boundaries

- Preserve ciphertext and sender-authenticated expiry across radios and carriers.
- Encrypt relay storage at rest and define keys/file protection accessible in each
  supported lock/reboot state. Do not weaken device protection just to pass a test.
- Review pseudonymous destination tokens and rotating encounter identifiers together:
  rotation reduces tracking but also invalidates learned carrier scores.
- Evaluate sealed-sender-like addressing and Bundle-in-Bundle concepts as FUTURE
  research, not features provided by packet v0 or this simulator. No new crypto is invented.
- Authenticate cancellation and delivery proofs; reject forged tombstones. Keep
  receipt dissemination minimal because it exposes communication relationships.
- Bound inventories, proof cache, verification work and peer quotas. A copy budget
  cannot stop a malicious peer from copying ciphertext or creating Sybil identities.
- Record test IDs and timings with redacted peer aliases; do not log message text,
  private keys, phone numbers or a persistent location graph.

The simulator assumes authentication, trusted endpoints and atomic persistence.
Its tests cannot validate cryptography, disk confidentiality, nonce handling,
replay attacks across app reinstalls or secure deletion. Those remain separate
security and physical gates before adoption.

## Additional metadata approaches

Signal's [sealed-sender design explanation](https://signal.org/blog/sealed-sender/)
describes an encrypted sender envelope with sender certificates and delivery-token
authorization. ADAPT the goal of minimizing exposed identity; FUTURE the mechanism.
Its service-side authorization assumptions are not a solution for arbitrary offline
carrier admission. Replacing visible senders also changes abuse control and
signature verification at relays, so this cannot be a cosmetic header edit.

[Bundle-in-Bundle Encapsulation](https://datatracker.ietf.org/doc/draft-ietf-dtn-bibe/)
is an evolving IETF draft, not an implemented LOKA feature or blanket anonymity
guarantee. FUTURE experiment: assess whether encapsulation reduces visible internal
addresses for a chosen tunnel while measuring overhead and the information still
visible at its endpoints. Do not assume an outer envelope hides radio proximity,
packet size, traffic timing or all intermediate identities.
