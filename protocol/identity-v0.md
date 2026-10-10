# Device identity v0

The lab creates a 3072-bit RSA key pair locally. Android stores the private key under `loka-mesh-lab-identity-v0` in Android Keystore, authorized for OAEP decryption and SHA-256/PKCS#1 signing. Public keys use X.509 SubjectPublicKeyInfo DER and Base64 for manual sharing. Supported exponent: 65537.

Device route identifier = full lowercase hex SHA-256 of the public-key DER (64 ASCII characters). This is a local device identity, **not** a permanent user account or LOKA Number. Clearing app data/reinstalling may destroy identity and requires trust exchange again. No recovery exists.

Recipient public keys must be imported manually, after comparing the full fingerprint through an authenticated external channel. The destination accepts messages only from imported sender fingerprints. Relays check each packet's self-signature and key-derived source identifier but do not grant account trust from a self-signature.

Bluetooth pairing protects an adjacent link; it does not replace end-to-end fingerprint verification. No peer handshake automatically trusts keys. Relays intentionally see sender public keys and stable route identifiers in this lab. Rotating route pseudonyms, identity credentials, revocation, key rotation, and a reviewed E2EE session protocol are production follow-up work.
