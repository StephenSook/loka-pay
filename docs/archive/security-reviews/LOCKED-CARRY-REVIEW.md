# Locked ciphertext carry review — 2026-10-03

Implementation self-review, not independent audit. The user approved both fixes
following explicit disclosure of the proposed queue file-protection change.

## Scope and controls

Only `loka-carry-v1.enc` changes from Complete file protection to
CompleteUntilFirstUserAuthentication. Encoded packets remain end-to-end encrypted
and the journal remains additionally AES-GCM sealed with its existing archive key
and carry-specific AAD. Existing files are atomically rewritten with identical
frames during unlocked archive setup. No ciphertext, ID, sender expiry or packet
signature is changed by migration. Admission still enforces signature, authorized
carrier role, count/byte quotas and commit-before-forward.

Foreign-destination packets may enter the existing relay admission path while
locked, provided the already-configured mesh and cached key are available. The
own-destination path still requires unlocked data before decryption/app receipt.
Chat history and nearby files keep Complete protection. Keychain identity and
archive key accessibility stay WhenUnlockedThisDeviceOnly.

## Security tradeoff and limits

The sealed carry file has a weaker OS protection boundary after first unlock.
A process with the cached archive key can inspect its packet metadata; foreign
payloads still require the recipient private key. No plaintext message storage or
new cryptographic primitive is added. No keychain accessibility downgrade occurs.
Locked cold-start configuration remains unavailable. This avoids claiming that
state restoration also restores private identity/key access before unlock.

BLE restoration re-registers bounded peripheral/extra-central managers, discards
partial frame/queue state, repeats link probes and preserves signed profile/trust
requirements. Restored radio identities never authorize a contact or v2 destination.
Service-filtered background scanning is registered with Core Bluetooth; timers
and transport drain callbacks do not grant unlimited execution. Explicit local
connection Off is respected. Force-quit and OS suspension remain limitations.

Validation is recorded in docs/research/dtn/background-relay-findings.md. Mac
software tests cannot prove screen-lock file access or reliable physical delivery.
