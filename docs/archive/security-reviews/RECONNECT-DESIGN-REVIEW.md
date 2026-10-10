# Phase 1 reconnect design review — 2026-10-02

Internal coding-agent source review, not an independent security audit. Disposition: the radio-lifecycle repair may proceed with unchanged message cryptography. Authenticated-neighbor sessions are not implemented or approved by this review.

## Existing boundaries

Saved contact keys authorize destination message processing. Android automatic BLE admission and iOS service discovery admit untrusted ciphertext routes. The public six-byte probe proves a round trip only. Never display its success as authenticated identity, and never persist a radio address as cryptographic trust. Contact removal, explicit local Off and blocked-handle policy remain effective.

## Standards candidate and concrete compatibility gap

TLS 1.3 offers a standardized authenticated handshake with transcript-bound CertificateVerify and Finished messages, unlike an improvised signed nonce exchange. It is a candidate for a reliable byte-stream transport/session adapter, not an implemented selection. Mutual authentication, verification against pinned LOKA identities, certificate/identity binding, framing, handshake byte budgets and both platforms' native implementations need an interoperable experiment. Keep TLS hop authentication separate from the existing end-to-end message envelope; a relay TLS session would not authorize reading recipient ciphertext.

Source: [RFC 8446 §§4.4.3–4.4.4](https://www.rfc-editor.org/rfc/rfc8446.html#section-4.4.3). TLS 1.3 RSA CertificateVerify uses RSA-PSS; Android DeviceIdentity currently authorizes only RSA PKCS#1 v1.5 signatures in its persistent Keystore key. Existing key permissions cannot be assumed to support PSS. Do not silently replace keys, invalidate QR contacts or weaken verification to make an experiment pass. Choosing a compatible reviewed protocol or a separately bound session credential needs an explicit design/migration review and Android/Swift test vectors. Native iOS key access while locked must also be tested under the selected policy.

Mandatory negative cases: replay across sessions/transports, claimed versus proven identity mismatch, revoked/changed key, stale asynchronous callbacks authenticating a replacement connection, downgrade, unknown relay identity versus friend authorization, resource exhaustion and forwarded handshakes that do not prove physical proximity. A cryptographic session does not prove distance or radio adjacency.

## Radio-recovery patch scope

Build 0.6.7 keeps Android's already-running connected-device foreground service alive across adapter loss while the user's local-connection preference remains enabled. The service owns a receiver independent of the Classic transport receiver that unregisters when stopped. Actual BluetoothAdapter state is checked rather than trusting broadcast extras. Transports pause on OFF/TURNING_OFF and resume on ON after ordinary permissions/activation guards. Explicit Off persists before transport shutdown and stops the service, so late events cannot re-enable it.

The receiver is exported to accept privileged Bluetooth process broadcasts; it neither trusts extras nor imports keys. Repeated broadcasts cannot authorize a peer. No new background service is started by the radio event: recovery uses the existing enabled service. No boot receiver, force-stop bypass, key-accessibility relaxation, packet-version change or new cryptographic handshake is introduced. Process death, vendor power management and physical radio reliability remain test gates.

Platform references: [Bluetooth setup/state broadcasts](https://developer.android.com/develop/connectivity/bluetooth/setup), [background Bluetooth guidance](https://developer.android.com/develop/connectivity/bluetooth/ble/background). Their availability is not physical evidence of LOKA recovery.
