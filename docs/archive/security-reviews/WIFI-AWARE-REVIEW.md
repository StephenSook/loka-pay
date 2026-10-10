# Wi-Fi Aware experiment internal review

0.6.24, October 3, 2026. Not an independent security audit or production approval.

No packet-v0, key storage, recipient trust, cipher or receipt semantics changes. All application messages remain encrypted and signed before transport. Relays continue to receive ciphertext only. Random discovery tokens are temporary routing identifiers, not contact keys, usernames or authentication. Discovery never adds a friend.

The Android data path uses a generated per-attempt PSK sent in the native discovery control exchange. **That exchange is not authenticated or confidential**: do not treat the PSK as E2E protection or proof of peer identity. It configures native link encryption only; an observer may learn it. LOKA's existing signed/encrypted packet boundary is still mandatory. This experiment does not implement Apple NAN pairing or an authenticated cross-radio handoff.

Bound discovery fields before native network requests; enforce two links, 32 candidate cooldown records, finite setup deadlines, two request/reply retries, frame/queue bounds and paced ingress. Incoming publisher socket address must match the IPv6 peer reported for the native data path. Subscriber sockets use Network.socketFactory, without binding the whole app to a network. Availability broadcasts cause the manager's actual availability to be checked, not trust in broadcast extras. Generation checks reject late attach callbacks, and per-link identity checks reject stale network callbacks. Permission revocation/start failure leaves other transports intact.

Admission now recognizes `wifi:` and `aware:` as untrusted automatic links, subject to the existing automatic-mode opt-out and explicit block policy. This intentionally fixes the earlier shared-Wi-Fi admission omission. Classic links and arbitrary external schemes retain their previous rules. Tests cover these boundaries; no link admission grants unknown senders permission to deliver chat plaintext.

Remaining risks: unauthenticated discovery can occupy limited slots, ephemeral-handle blocking is not identity revocation, publisher socket exposure before peer validation, recovery after lost discovery events, driver PSK/cipher compatibility, native resource exhaustion and background/OEM behavior. Physical testing and stronger identity-bound negotiation are still required before production reliability claims.
