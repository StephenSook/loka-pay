# iOS public contact identity — internal security review

Date: 2026-10-02. Reviewer: Codex, internal source/design review. Scope is restricted to native Keychain RSA identity generation, public-key serialization/fingerprinting, public QR/link sharing, camera/photo import and explicit contact trust. No RSA encryption, decryption, OAEP, message signatures or packet crypto implementation is authorized or added by this change. The previously rejected iOS message-crypto port remains blocked.

Use Apple's Security framework to generate RSA-3072 private keys with a permanent application tag and `WhenUnlockedThisDeviceOnly`. Existing key retrieval failures must not regenerate/overwrite keys. No private key export or upload is permitted. Android-compatible public SPKI serialization is encoding, not a crypto primitive; validate the canonical header, positive 3072-bit modulus and exponent 65537 before accepting a public contact key. Fingerprints use CryptoKit SHA-256 over identical SPKI bytes.

QR/link includes only the public key in the existing `loka://contact/v1#` contract. It contains no phone number, profile name, private key or conversation. Scanning merely proposes a contact; require full fingerprint comparison and an explicit confirmation before saving trust. A QR alone does not prove a human name, proximity, messaging reachability or account identity. Reject own keys, oversized/malformed links and unsupported keys. Limit contact count and label length. Persist only public keys and locally chosen labels in UserDefaults; no plaintext chat storage is introduced.

Native camera access requires permission and a usage description; denied access offers photo/paste alternatives. Photo selection uses the system picker, bounded image input and a downsampled decoder. Camera session stops on dismissal. No general camera roll/contact permission, remote resource loading or network dependency is added.

Disposition: internal review permits implementation of this limited public-contact feature using native APIs, subject to native key/link/parser/QR round-trip checks and source/build verification. It does not resolve the automatic-review rejection of custom RSA/OAEP or approve a production messaging protocol. Physical camera scanning and Android contact import remain measurements to record separately.


## Source and validation addendum

Source scope was checked against the stated native-only boundary: no message encryption, decryption, OAEP or private-key export exists. Identity retrieval failures preserve existing keys; failed contact decoding prevents overwriting the existing store. Contact trust requires the full-code checkbox, rejects own keys and limits saved contacts to 128. Camera setup/stop is serialized on its dedicated queue; selected QR images are bounded/downsampled.

Native tests pass for key/link validation and actual QR image decoding. Android accepts the Apple-generated public fixture with exactly the same fingerprint. Simulator QA exposed missing Keychain entitlements in the unsigned build; normal signing plus app-scoped Keychain entitlement fixed access. The iPhone signing identifier and Keychain group are scoped to its existing app identifier. No shared external app group, private-key export or protocol encryption change is introduced. Camera scanning on physical phones and conversation interoperability remain unproven.

## Later message-engine scope

The native-contact-only statements above describe the 0.2 review stage. Version 0.4 adds experimental private RSA operations and packet-v0 messaging under the separate [message compatibility review and user-requested core-test scope](IOS-V0-COMPATIBILITY-REVIEW.md). This does not turn the contact review into a production crypto approval.
