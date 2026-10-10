# Storage and backup security review — October 2, 2026

Reviewer: Codex, implementation/source review. This is an explicit internal engineering review, not an independent audit or production security approval. Scope: encrypted local chat records, portable manual history backups, recovery-key handling, restore authorization and resource limits. The existing mesh encryption protocol is outside this change and remains experimental.

## Design review before implementation

Use Android's documented AES-256-GCM Keystore pattern for app-private SQLite payloads. Generate the local key under a separate alias from messaging identity, require randomized encryption, and authenticate the row identifier and storage version as additional data. All message content, peer identity, local contact label, direction and timestamp belong inside encrypted payloads. Database row IDs/counts/sizes are still observable. No plaintext fallback or automatic key reset on decryption failure is permitted.

Portable backups use an independently generated 256-bit random AES key, represented as a recovery code; no password derivation, SMS, account or Drive credential grants archive access. Use standard AES-GCM, a fresh 96-bit nonce per export and an authenticated fixed version header. Encrypt the entire bounded history archive before opening the external output stream. No plaintext archive or recovery key may be written into the backup file, diagnostics or ordinary preferences.

Restore authenticates the complete archive and validates schema/limits before a database transaction. Merge by immutable message ID; never replace existing entries on conflict. Re-encrypt restored records under the destination phone's local key. Restore history labels only, never keys, account credentials, trust decisions, packet queues, routing state or delivery receipts. A restored contact must be verified separately before sending/receiving authorized personal messages. A restored device gets no old private identity from the archive.

Recovery codes are shown only in a screenshot-protected backup screen, kept in process memory, cleared on cancel/completion and excluded from saved-instance state. Clipboard copying must mark the content sensitive. Clipboard/compromised endpoint exposure cannot be eliminated; the user must store the key separately from the archive. Loss of all copies of the code makes that archive unrecoverable. There is no server recovery or rotation/revocation of already exported files; a new export generates a new key and does not invalidate old backups.

Google Drive is an optional user-selected Android document provider. A successful provider write means file creation, not independently confirmed cloud synchronization. No background upload, Google OAuth integration or backend backup service is claimed. Provider deletion/retention remains under the user's control. Android automatic backup remains disabled.

References: [Android cryptography](https://developer.android.com/privacy-and-security/cryptography), [Keystore key generation](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec), [Storage Access Framework](https://developer.android.com/training/data-storage/shared/documents-files).

## Required implementation checks and disposition

Before marking this implementation review complete, inspect nonce generation/reuse, AAD binding, key separation, archive/plaintext paths, parser bounds, corruption handling, transaction rollback, concurrency, restored contact authorization, queue status, secret UI lifecycle and failure reporting. Run restart/round-trip, wrong-key/tamper/truncation/version, local ciphertext/AAD, merge and authorization tests. Record findings below after inspecting final source. Device compromise, independent protocol review, hardware-backed key guarantees, durable relay queues and provider sync verification remain outside approval.

Disposition at design stage: proceed with a bounded experimental preview under these controls; final implementation review and validation are pending.


## Final source review findings

Inspected `BackupCipher`, `HistoryStore`, `LabViewModel`, `BackupScreen`, conversation/contact rendering, manifest and extraction rules. Local history and portable archives use distinct keys; the messaging RSA identity is not exported or reused. Local IVs come from the Keystore encryption provider with randomized encryption required; each export generates a new 32-byte key and fresh 12-byte SecureRandom nonce. Row IDs/version and archive header are authenticated. Corrupt or missing local keys produce an error without deleting data or generating a replacement over an existing database. No plaintext fallback or disk archive is present. Export streams receive only already-encrypted bytes. Import authenticates before parsing and finishes validation/encryption before a SQLite transaction. Existing records win conflicts.

Findings/remediation:

- Whole-archive JSON parsing could allocate deeply nested objects before record limits were checked. Replaced external archive JSON with length-prefixed binary fields, bounded count/field allocation, strict UTF-8 and trailing/duplicate validation. Local encrypted rows remain bounded JSON.
- Restored chat records could have been confused with trusted contacts or queued packets. Separated history-only contacts, disabled sending to unverified histories, retained engine trust checks, omitted keys/trust from archives, and kept queue activity memory-only. Restored outgoing history explicitly says delivery is unconfirmed.
- Concurrent message arrival during restore could overwrite the UI snapshot. Serialized message recording and restore merge/publication on the ViewModel; database operations are synchronized and transactional. Included current in-memory history in merges to retain entries after a prior storage failure.
- Concurrent local-key initialization is serialized. Missing keys over existing databases fail closed. Storage failures are visible and retained as a warning; successful queueing is not presented as successful disk persistence after a write failure.
- Sanitized startup/storage/archive errors so decrypted parsing exceptions cannot enter diagnostics. Clear temporary plaintext byte arrays on local encryption/decryption and portable export/import. JVM strings/cipher internals cannot be guaranteed zeroized; this is not heap protection.
- Protect the backup screen from screenshots, keep recovery state out of saved-instance state, mark clipboard content sensitive, clear pending recovery/archive state on cancellation/completion, and block navigation while a backup operation runs. A pasted key remains in the protected restore dialog after failure to allow correction; it clears on dismissal/success. Clipboard/endpoint exposure remains a limitation.

Validation includes authenticated ciphertext/reopen, row-ID substitution rejection, missing-key preservation, conflict-safe merge, full ViewModel export/restore, wrong-key failure without chat replacement, lack of restored trust/network sends, and queue state after ViewModel recreation. Portable tests cover fresh encryption, wrong keys, tampering, truncation, unsupported headers and oversized archives. Parser tests cover bounded counts, duplicate IDs, trailing bytes and incomplete data.

Disposition: explicit internal source review complete for the experimental v0.3 preview. No independent production approval is claimed. Automated tests support the source findings; they are not a substitute for review. Outstanding: independent audit, physical key backing/reliability evidence, file-provider cloud synchronization tests, rate limits/durable relay/replay design, long-term retention controls, automatic backup scheduling, account/revocation/rotation policy and robust key-loss recovery UX. Existing exported backups cannot be remotely revoked; user/provider deletion is required. Hardware compromise can expose readable messages and pasted keys while the app is running.
