# Contact consent experiment review

Internal source review, not an independent security audit. Disposition: isolated codec/state-machine tests only; **not approved for production admission of unknown senders**.

The change does not alter packet-v0 cryptography, remove trusted-sender checks, import keys, broadcast profiles, or persist trust from radio observations. It establishes a bounded decision model for a later request coordinator. Existing encrypted envelope verification is a caller precondition and must be enforced by integration tests before activation.

Reviewed cases include impersonating the expected accepting key, swapping request IDs/deadlines, malformed UTF-8/Base64, oversized names, control/bidirectional-format characters, unsolicited acceptance, acknowledgement before local consent, replay after decline/block, expiry and inbox exhaustion. Matching duplicate requests/replies can recover dropped control replies without changing consent. No unknown payload is treated as a personal message by this change.

Remaining risks/gates:

- The in-memory book cannot survive restart. Persistent blocks, tombstones, requests and contact authorization need crash-safe encrypted storage before activation.
- Caller-level byte/rate budgets must apply before expensive signature verification/decryption. A 16-entry inbox is not a CPU or notification spam defense. Attackers can generate multiple keys.
- Request/accept names are self-asserted; cryptographic key possession is not verification of a person's name or physical proximity.
- This does not authenticate BLE adjacency or prevent relay/wormhole attacks. Do not bind friend avatars or signal measurements to radio handles using this codec alone.
- Clock rollback/skew, crossed requests, user cancellation and contact revocation need explicit integration policy. The five-minute deadline is not silently extended.
- An accepting endpoint can crash after committing consent but before sending its response. Atomic local persistence and retryable acknowledgements must address that; distributed simultaneous completion cannot be promised.
- Compatibility negotiation is absent. Do not transmit LC1 to released clients or expose raw LC1 as chat text.

The codec uses the existing envelope rather than introducing new signature algorithms or replacing device keys. Existing v0 limitations, including lack of forward secrecy, remain. Physical reliability and automatic contact synchronization are unproven.
