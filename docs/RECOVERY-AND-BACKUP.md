# Account recovery and encrypted backup boundaries

Status: the Android v0.3 preview implements encrypted local history and manual portable backup/restore. Accounts, account recovery, automatic cloud synchronization and backend backup services remain future systems. Android automatic backup and device transfer remain disabled.

## Identity and recovery

An account has an immutable internal identifier, a public LOKA Number, optional username, and linked recovery methods. A phone number is a linked verification/contact/recovery attribute. Changing it must not change the account identity. Each registered device has separate key material protected by platform mechanisms.

Account recovery restores control of an account and may authorize a new device. It must not by itself release message-history backup keys. Do not rely on SMS alone: architecture should support passkeys, recovery codes, trusted-device approval, and additional verification. Define lost-device revocation and offline credential behavior before implementation.

## Optional backup

LOKA Local must work when backup is disabled, unavailable, or inaccessible. Manual backup can save an already encrypted file to local storage or to a document provider such as Google Drive when it is available in Android’s file picker. This is not direct Drive API integration or background cloud backup. iCloud and LOKA Cloud remain future providers.

The pipeline is local data → prepare archive → encrypt on device → upload encrypted archive. Do not intentionally upload plaintext private conversation history. Protect backup encryption keys separately from normal account authentication and phone verification. Account takeover or a SIM swap must not automatically provide history access.

Before implementation, explicitly review key generation, wrapping, recovery, rotation, device migration, archive authentication, metadata exposure, deletion, retention, and provider access. A design decision must state what happens if the user loses every backup-unlock method. Do not imply that server-side account recovery can recover a key the server does not possess.

The future backend manages authorization and backup metadata within the Cloud boundary. Go and Gateway carry external communication/backhaul. Neither changes the requirement to encrypt backups on the originating device.


## Current Android backup flow

Open Settings → Chats. Local chat payloads are encrypted with a separate AES-256-GCM Android Keystore key in app-private SQLite storage. The latest 5,000 messages survive app/process restarts. Database row IDs, counts and sizes are not hidden. Existing trust/name preferences remain outside the encrypted message payloads. Relay queues and replay caches are still memory-only; saved outgoing history is not an active queue or delivery receipt after restart.

Create encrypted backup generates a new random 256-bit recovery key for that export. Save it separately, acknowledge that it is stored safely, then choose a local or cloud document location. Only the encrypted archive is sent to the selected provider. A successful file write does not confirm that Drive has finished remote synchronization. Local file export/restore can run without Internet; cloud synchronization cannot. No plaintext temporary archive is created.

Choose backup to restore selects an archive and requests its recovery key. The entire archive is authenticated and its bounded binary schema is validated before a merge transaction. Existing message IDs win on conflicts. The archive contains messages and local display labels; it contains no device-private keys, trust decisions, Google tokens, account credentials, active network queues or delivery receipts. Imported contact history can be viewed without granting messaging authorization. Verify contacts again when moving to a new device; friends must also verify the new device's contact code.

Recovery keys are not stored alongside exports or tied to SMS/Google account recovery. They are shown in a screenshot-protected screen and marked sensitive when copied. Losing every copy of the key makes that backup permanently unreadable. Creating a new backup generates a new key; it does not revoke older files. Users manage backup retention/deletion in their selected storage provider.

Uninstalling or clearing app data removes local history and its Keystore key. Device identity is not transferred through these backups. If an existing history database has lost its key or fails authentication, the app does not silently replace it; recovering on a fresh installation with a valid backup is the supported preview path. Export first when possible. Storage failures are surfaced, with no plaintext fallback.

The explicit internal [storage/backup security review](../security/STORAGE-BACKUP-REVIEW.md) records design, source findings and limitations. It is not an independent production audit. The current mesh protocol remains experimental. Archive files are limited to 16 MiB, with 5,000 records and the existing 2,048-byte text limit per message; no media backup is implemented.

## Preview 0.6.16: deletion and onboarding

Android onboarding now includes an optional backup step. “Set up backup” opens the existing encrypted file export screen after onboarding; “Not now” leaves local messaging available. This does not enable automatic cloud backup. iOS onboarding records interest in backups and explicitly says that neither export nor cloud backup is available yet.

Android Settings → Privacy → Delete all app data offers “Back up first,” Cancel and an explicit destructive confirmation. The OS clears this application's data and permissions and closes it; reopening starts onboarding. iOS Settings → Delete all app data stops message/radio callbacks, waits for any identity generation, deletes scoped LOKA Keychain items and owned files/preferences, then recreates the root at onboarding. An interrupted iOS deletion is retried before loading stores. Exported backup files must be deleted in their chosen document provider. Other phones' histories are not erased. Contacts must verify the replacement device identity.

See [internal deletion review](../security/APP-DATA-DELETION-REVIEW.md). Android uses the [platform clear-app-data API](https://developer.android.com/reference/android/app/ActivityManager#clearApplicationUserData()). This action has only been executed on synthetic emulator data during development.
