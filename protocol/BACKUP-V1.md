# LOKA portable history backup v1

Experimental application archive, separate from the mesh packet protocol and device identity. See [the internal review](../security/STORAGE-BACKUP-REVIEW.md). No independent production security audit has approved this format.

## Outer file

| Field | Bytes | Meaning |
| --- | --- | --- |
| Header | 8 | ASCII `LOKABK01`; passed unchanged as AES-GCM additional authenticated data |
| Nonce | 12 | Newly generated CSPRNG nonce for this export |
| Ciphertext and authentication tag | Remaining | AES-256-GCM encrypted payload, with a 16-byte tag |

The entire file is at most 16 MiB. Each export generates a new 32-byte CSPRNG AES key. The recovery code is the canonical, unpadded Base64url representation of that key (43 ASCII characters). There is no password KDF because this is a random key, not a user-selected password. It is never included in the archive. Reject unsupported headers, wrong lengths, noncanonical keys and failed GCM authentication before parsing history.

## Authenticated payload

Integers use big-endian byte order. The payload starts with a signed 32-bit version (`1`) and a signed 32-bit message count (`0..5000`). Each record contains:

| Field | Encoding / bound |
| --- | --- |
| Message ID | 32-bit byte length + UTF-8, 1–128 ASCII alphanumeric/hyphen characters |
| Peer device fingerprint | 32-bit byte length + UTF-8; 64 lowercase hex characters |
| Body | 32-bit byte length + UTF-8; 1–2048 bytes |
| Outgoing direction | One byte, exactly `0` or `1` |
| Timestamp | Signed 64-bit nonnegative milliseconds since Unix epoch |
| Local display label | 32-bit byte length + UTF-8; at most 160 bytes and 40 UTF-16 code units |

Validate counts and lengths before allocation; reject malformed UTF-8, duplicate message IDs, incomplete records and trailing data. The binary layout avoids unbounded JSON nesting/object allocation for external archives. No compression is used.

## Restore semantics

Authenticate and validate every record before changing the database. Merge transactionally, with existing records winning ID conflicts, retain the newest 5,000 records by timestamp and encrypt each record with the destination device's local storage key. Preserve any already-live destination queues in memory; never create a queue from imported history. Archived outgoing direction is historical, not proof of delivery or pending transmission.

The archive contains no contact public-key trust list, private keys, local encryption keys, account credentials, provider tokens, relay packets, routing state or delivery/read receipts. It can restore readable history on another phone without moving the old phone's identity or authorizing senders. Local display labels are user-defined, unauthenticated metadata.

## Local database (Android implementation)

The app-private SQLite table contains opaque message IDs and encrypted payloads. Each payload uses the separate Android Keystore AES-256-GCM storage key, with provider-generated 12-byte IV and `loka.history.v1:<message-id>` as additional authenticated data. The encrypted per-row JSON contains ID, fingerprint, message body, direction, timestamp and display label. No readable message columns or plaintext temporary archives are created. IDs/counts/sizes, database schema and existing contact preferences are outside this payload encryption. Local encryption does not hide data from a compromised, running endpoint.
