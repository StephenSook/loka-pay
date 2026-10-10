# LOKA protocol research

Version 0 is implemented in `android/loka-mesh-lab/core`. It is an experimental, Bluetooth-independent packet format, not a frozen interoperability contract or reviewed production protocol.

- [Packet v0](packet-v0.md): framing, immutable signature data, expiry, forwarding.
- [Identity v0](identity-v0.md): local device keys and manual trust.

Changes to the packet layout must increment the version and update codec/security tests. Unknown versions fail closed. A future native iOS implementation will need identical binary encoding, explicit test vectors, and cryptographic compatibility tests. Version 0 uses Java `DataOutputStream.writeUTF` (modified UTF-8) for ASCII-only protocol fields; plaintext uses standard UTF-8. Avoid implementing it as generic JSON or standard UTF-8 length-prefixed strings.

No usernames, LOKA Numbers, phone numbers, contacts, or cloud account identifiers belong in v0 packets.


## Portability work before the next implementation

The required protocol contract is platform independent. The v0 Java encoding references are an existing lab limitation, not an architectural requirement for iOS. Specify exact byte order, field lengths, string encoding, framing, limits, version negotiation, and authentication inputs in platform-neutral terms, with shared test vectors.

Evaluate Protocol Buffers for compact serialization before selecting a future version. Schema evolution and deterministic authenticated-byte handling must be assessed explicitly; adopting a serializer alone does not solve signature interoperability. Any change affecting encrypted or signed bytes requires explicit security review and a versioned migration. No serialization or cryptographic behavior changes in this documentation update.
