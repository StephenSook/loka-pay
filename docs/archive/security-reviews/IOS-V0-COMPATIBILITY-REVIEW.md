# iOS v0 compatibility — explicit internal design review

Date: 2026-10-02. Reviewer: Codex (implementation author, internal review). This is not independent security approval. Scope: proposed Swift port of the existing experimental packet v0, Keychain identity, contact links and BLE framing. No production security claim is granted.

## Design reviewed before implementation

Preserve the exact v0 signature/AAD/wire bytes and RSA-3072 SPKI identity contract. Apple Security handles RSA private operations and signatures; CryptoKit handles AES-GCM and hashing. v0 OAEP uses SHA-256 with MGF1 SHA-1, whereas Apple's combined OAEP SHA-256 algorithm does not expose independently selectable MGF digest. A compatible port would need the RFC 8017 encoding/decoding around Apple's raw RSA operation, restricted to a 32-byte AES key. This is established OAEP, not a new algorithm, but handwritten padding is security-sensitive and a production blocker.

References: [packet v0](../protocol/packet-v0.md), [identity v0](../protocol/identity-v0.md), [RFC 8017 §§7.1/B.2.1](https://www.rfc-editor.org/rfc/rfc8017.html), [Apple raw RSA API](https://developer.apple.com/documentation/security/seckeyalgorithm/rsaencryptionraw), [threat model](threat-model.md).

## Findings and required controls

- **Critical production limitation:** existing v0 has static RSA identity, no forward secrecy/post-compromise security or reviewed conversation protocol. Do not broaden its security claims. A native reviewed session protocol/library remains required before release.
- **Padding implementation risk:** require bidirectional Java JCA ↔ Swift encrypted vectors and malformed-padding/signature/tag tests. Restrict key plaintext to exactly 32 bytes; OAEP label is empty; SHA-256 label hash and MGF1 SHA-1 must match Java explicitly. RSA encoded block size is 384 bytes. Validate leading zero, every expected zero padding octet, separator and label hash with a single generic error. Swift runtime timing/zeroization is not established constant-time and cannot be described as such.
- **Identity format:** accept canonical RSA-3072/exponent-65537 SPKI only; reject malformed/truncated/trailing bytes. Fingerprints hash identical SPKI bytes, not Apple PKCS#1 bytes. Private identity remains permanent Keychain `WhenUnlockedThisDeviceOnly`; Keychain access failures must not silently replace it.
- **Authentication ordering:** decode bounds/time/source identity/signature before private-key decryption. Require explicit imported sender trust and recipient match. BLE service UUID/link encryption is never contact authentication. No automatic contact trust from discovery.
- **Retention:** keep iPhone plaintext messages in bounded process memory for this first lab; do not persist plaintext conversation history. This is a clear feature limitation until separately keyed encrypted history is reviewed. Public contact labels/keys may persist. No backups or private-key exports in product code.
- **Replay/DoS:** bound frames to 16 KiB, text to 2048 bytes, retained messages/seen IDs to fixed caps; expire deduplication entries. Bound outbound BLE chunks; reject unsupported versions, prepared writes and excess fragments. Only permitted Android links enter the engine. Generic crypto failures must not leak padding distinctions over BLE.
- **Test key handling:** interoperability tooling may export freshly generated ephemeral fixture keys solely inside `/tmp`, separate from product Keychain identities. Never export either physical phone's private key or real conversations.
- **BLE limitation:** first proof is foreground direct text only. Fragment acknowledgement is transport acceptance, not end-to-end delivery. Background, routing, recovery, receipts and radio reliability require separate evidence.

## Disposition

Earlier automatic approval review rejected the proposed implementation twice, and no crypto port was written at that stage. Following the explicit request for experimental testing approval, the user requested implementation of both-platform two-way messaging for testing the core network. This authorizes the described non-sensitive lab scope; it is not independent security approval. The implementation tool calls subsequently succeeded and the required software compatibility checks passed. It is not approved for production or sensitive messages. Prefer a reviewed compatibility library/session protocol for release. Preserve the Android v0 baseline and existing identity/trust/history. Record physical failures rather than claiming success from vectors or builds.

## Concrete first delivery milestone

Requested again on 2026-10-02: foreground Android–iPhone text messaging after reciprocal contact QR verification. The user subsequently requested implementation of this two-platform core-network test scope.

1. Implement the reviewed, bounded v0 packet codec and compatibility encryption on iOS while preserving existing device keys and Android wire behavior.
2. Verify both encryption directions against Java-generated ephemeral fixtures and reject malformed packets, untrusted senders, altered signatures/tags, expired packets and duplicates before enabling chat.
3. Own the iPhone transport and messaging state at app scope so moving from connection setup to a conversation does not stop the link. Dispatch received frames to the authenticated message processor; send encrypted packets through the transport abstraction.
4. Present normal friend conversations and plain connection/sending states. Retain manual lab allowlisting during this first experiment; automatic authenticated peer selection needs a separate reviewed design. Do not mark messages delivered from Bluetooth write acknowledgements.
5. Install on both physical phones and test reciprocal QR import, Android → iPhone and iPhone → Android delivery with Internet unavailable and both apps foregrounded. Record the actual outcome; builds alone do not pass this milestone.

Scope excludes sensitive conversations, production release, calls, cloud sync, persistent iPhone plaintext history and reliable background/multi-hop claims. Existing Swift contact QR and BLE framing checks were rerun successfully before requesting authorization; they do not prove encrypted chat.


## Implementation source review and software evidence

Implemented 2026-10-02 after the follow-up implementation request. Native Security signs/verifies and performs RSA private operations without exporting private identity. CryptoKit performs SHA-256, MGF1-SHA1 hashing and AES-GCM. The compatibility-only OAEP encoder/decoder is restricted to exactly 32-byte keys and 384-byte blocks; it checks the full expected hash, padding and delimiter and returns one generic protocol failure. No timing or guaranteed zeroization claim is made. Swift packet decoding caps allocations and validates canonical ASCII identifiers, signature, trust, recipient and lifetime before private decryption in the receive path.

Source review confirmed caps of 128 queued ciphertext packets, 2048 live replay IDs, 500 in-memory iPhone messages, 16 KiB frames and 2048-byte UTF-8 messages. The first iPhone link cannot forward to another peer; Android intermediaries handle relay. Explicit Android radio allowlisting and reciprocal contact trust remain necessary. Transport ACKs are not delivery receipts. Contacts removed in the UI purge pending outgoing packets and in-memory messages for that person.

`sh tests/check-ios-messaging.sh` passed actual Android-core ↔ Swift encryption and actual Android ciphertext relay/deduplication, malformed codec/padding/signature/tag checks, expiry/trust/replay controls, queue capacity and reconnect replay. QR and BLE-framing checks also passed. Initial mutation-test indexing was corrected to respect Foundation Data slice indices; no physical keys or messages were involved. Physical receipt, background delivery and independent production security audit remain outstanding.
