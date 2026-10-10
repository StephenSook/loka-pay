# LOKA Mesh Lab threat model

## Assets and boundaries

Protect message plaintext and device-private keys from intermediary phones. Bluetooth neighbors, imported identities, and local app storage are distinct trust boundaries. Cloud services are absent. The lab has no Internet permission and disables Android backup.

Private keys are created in Android Keystore. Hardware backing depends on device support and is not assumed. Sender and recipient public keys are authenticated manually by fingerprint comparison. Relay code verifies a self-signature and handles encrypted envelopes; destination code additionally requires a trusted sender fingerprint before decrypting. AES-GCM authenticates payloads and immutable routing fields. Cryptographic operations use standard JCA primitives, not custom algorithms.

## Threats and current mitigations

| Threat | Current handling | Remaining limitation |
| --- | --- | --- |
| Relay reads content | Recipient-only key wrap; authenticated ciphertext | Compromised endpoints can read their own messages |
| Payload/header modification | RSA signature plus AES-GCM tag | Hop budget is mutable |
| Key substitution | Full out-of-band fingerprint comparison | Users can trust an attacker if verification is skipped |
| Replay/loops | Bounded live packet-ID cache and expiry | Cache is lost on restart; no durable replay protection |
| Memory exhaustion | Frame/text/key limits; queue and cache caps | Signature checks consume CPU; no sender rate limit yet |
| Unauthorized topology link | Bluetooth pairing and explicit address allowlist | Bluetooth address is a lab link selector, not account identity |
| Lost phone | OS storage protections | No revocation or account recovery |
| Metadata analysis | No phone/contact data in packets | Stable fingerprints, timestamps, sizes, and adjacent Bluetooth addresses visible |
| Relay withholding | Diagnostics and manual destination checks | No delivery guarantee or authenticated receipt |

## Production blockers

This envelope is an experimental construction using established primitives; it is **not an independently reviewed messaging protocol**. It has no forward secrecy, ratchet, key rotation, group security, production credential verification, remote revocation, durable replay protection, or meaningful anonymous routing. Do not use it for sensitive production communications.

Before production: select an independently reviewed E2EE session protocol with an appropriate library/license, define identity verification and migration, limit relay abuse with tested quotas, establish protected durable storage and data retention, design privacy-preserving routing identifiers, and audit all transport/parser/session boundaries.

Lab diagnostics exclude plaintext but include device identifiers, addresses, timestamps, and errors. Public-key clipboard transfer can expose metadata to clipboard readers. Export requires explicit user action. No analytics SDK or remote collection is present.


## Review requirement and future recovery threats

Changes affecting cryptography require explicit security review. Record the scope, protocol/design references, reviewer, findings, remediation, and disposition before treating a changed cryptographic design as approved. A passing test, generated design, or use of standard primitives is not a security review. The current lab envelope remains unreviewed and experimental.

Future account/backup work must cover account takeover, SIM swapping, device revocation, key rotation, compromised backup providers, archive metadata, and backup-key loss. Keep account authorization separate from history-decryption authority; never intentionally upload plaintext private history. See [recovery and backup requirements](../docs/RECOVERY-AND-BACKUP.md).


## Encrypted history and portable backups

The v0.3 preview adds separately keyed encrypted local history and manual recovery-key-protected archives. This does not upgrade the mesh envelope to a reviewed production protocol. The [explicit internal storage/backup review](STORAGE-BACKUP-REVIEW.md) records scope, source findings, remediation, validation and residual limitations; independent production audit remains outstanding. Local database IDs/counts/sizes and existing contact preferences remain observable. Backup restore transfers history labels, never sender trust, private identity or live queues. Google/document-provider access does not grant the independent recovery key.

## Automatic BLE route admission — 0.6.5

The earlier explicit-address-allowlist row now applies to engineering Manual BLE topology control and Classic links. Default consumer BLE admission permits compatible untrusted ciphertext routes while local connection is enabled, with per-peer work budgets and blocked-handle overrides. This never imports a contact/key or bypasses destination trust. See the [internal admission review](LOCAL-LINK-ADMISSION-REVIEW.md) for source findings, tests and remaining metadata/resource risks.
