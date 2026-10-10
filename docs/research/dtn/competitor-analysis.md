# Public implementation and product comparisons

Reviewed public documentation 2026-10-03. These are **documented claims**, not
independently reproduced behavior. Unknown cells must remain unknown. No code was
copied or dependency added; any later reuse requires checking the exact commit,
license and security status.

| System / primary source | Documented mechanisms | Useful LOKA idea | Limits / unknowns |
|---|---|---|---|
| [Knit](https://github.com/getknit/knit), [architecture](https://github.com/getknit/knit/blob/main/docs/ARCHITECTURE.md) | Android Aware + BLE, bounded forwarding, custody/anti-entropy and encrypted attachment retrieval described | Separate ciphertext storage, offer/reconcile and payload retrieval from radios | Android behavior does not prove Apple background compatibility; README and architecture claims need pinned source/tests; GPL-3.0-or-later repository, no copying here |
| [BitChat whitepaper](https://github.com/permissionlesstech/bitchat/blob/main/WHITEPAPER.md) | BLE and Internet-assisted paths, Noise-based security, sender outbox/courier mechanisms in current document | Bounded couriers and distinction between offline and live-session security | Do not use old “ephemeral-only” descriptions; offline envelope forward secrecy and static identity metadata need separate assessment; no physical replication performed |
| [Briar](https://briarproject.org/how-it-works/), [manual](https://briarproject.org/manual/) | Contact synchronization over Bluetooth/Wi-Fi/Tor; Mailbox for asynchronous online contacts | Persistent synchronization and explicit trust boundaries | Private-contact sync is not arbitrary anonymous stranger relay; group/forum rules differ; no universal packet TTL or Android/iOS parity established by these pages |
| [Berty/Wesh](https://berty.tech/docs/protocol/) | IPFS/libp2p, replicated logs, direct transports, rotating rendezvous design | Encrypted replicated state and separate content availability | Document is dated 2023 and warns implementation/audit incomplete; cannot assume every described feature shipped or bypasses OS limits |
| [Bridgefy SDK](https://docs.bridgefy.me/sdk/ios/usage) | Configurable propagation profiles, separate hop/lifetime/sharing limits, mesh/broadcast/p2p modes | Explicit distinction between send callback and destination delivery | First-use license validation needs Internet in documented SDK; opaque internals leave durable queue, ACK authentication and congestion behavior unverified |

## Coverage that still needs repository-level validation

For each candidate pin a version and trace discovery → identity → envelope → queue
commit → replication → retry → expiry → destination receipt. In this pass, none
has been built on our phones. Durable disk format, eviction ordering, ACK forgery
resistance, crash-safe replica accounting and exact background behavior remain
unverified where not demonstrated by the cited public material.

LOKA decisions: ADAPT concepts that can be independently specified and tested;
REJECT wholesale replacement on the strength of a README. Neither attractive UI
nor a large advertised hop limit establishes useful range or reliable store-carry-forward.
Compare our own [baseline measurements](simulation-results.md) and
[physical gates](physical-test-results.md) before claiming superiority.
