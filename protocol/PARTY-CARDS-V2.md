# Nearby Party Cards v2

This is a native Android/Swift party-prompt session over LOKA's existing encrypted messaging boundary. It does not introduce a radio provider or alter encrypted packet versions. The four-game Play shelf remains; Cards opens the party catalog, while Quick quiz retains its separate v1 protocol. Ludo and Chess remain unavailable.

## Wire format and negotiation

ASCII, maximum 2048 bytes:

`L1|G|2|kind|eventUUID|sessionUUID|catalogSHA256|expiresMs|revision|value|referenceUUID`

UUIDs are canonical lowercase, identities/hash are 64 lowercase hexadecimal characters, revision is 0–24. `-` denotes an absent value/reference. Unknown versions, kinds, expired events and mismatching catalog hashes are rejected. Capability C/K must succeed before the host sends I; a v1-only app cannot enter a v2 session. Hash the exact bundled `gameJson/games.json` bytes on both platforms. No card text, date of birth, countdowns or animations are sent.

| Kind | Meaning |
| --- | --- |
| C / K | Capability probe / matching version and catalog reply |
| I / J | Invitation with settings and roster / explicit acceptance |
| S | Initial or recovery snapshot from host |
| M | Guest's proposed action at the expected revision |
| U | Host's validated commit, revision advanced by one |
| A | Applied acknowledgement referencing an event UUID |
| R | Request authoritative snapshot |
| E | End or leave; leaving ends the first-version group |

Snapshot/invitation body is nine semicolon-separated fields: game ID, mode, intensity, consent flag, drinking flag, ordered member IDs, sorted accepted IDs, phase, ordered action log. Flags are `0/1`; lists use commas; actions are `kind.actionUUID`. No actions are encoded as `-`.

## Admission and rules

One accepted session per device; 2–4 fixed authenticated device identities, host first. Couples/friends modes require two devices; group requires three or four. A verified signed nearby profile permits an invitation only. Chat contact permission is neither required nor granted. Every selected member must explicitly accept before the first card.

The catalog contains party prompts, not quiz questions. Both engines validate the catalog's schema (v3.2, at least one game, unique game and card IDs, game and card totals equal to the catalog's own `meta` totals, explicit restriction tags), filter by mode/count/intensity/consent and require the drinking setting for drinking-tagged prompts, and sort by card ID. Cards are public bundled content; this version offers no hidden hand or future-answer secrecy. Done, skip and optional sip remove the current card. Shuffle removes it then rotates the remaining deck by the first eight hexadecimal digits of the action UUID modulo remaining length. Actions never repeat a card. Turn is roster[revision modulo player count]. Only that member may advance. Sip requires the invited drinking setting. Skipping is always allowed.

Actions and revisions determine order, not network arrival. Duplicate matching commits are acknowledged without advancing. Gaps request a snapshot; conflicting histories or settings are rejected. A host cannot silently substitute a different locally pending guest action. Host mutation waits for all guests' applied acknowledgements. A radio accepting an encrypted frame is not an applied acknowledgement.

## Recovery and limits

The host remains authoritative. No host migration. Restart enters recovery; initial/recovery snapshots carry a bounded prefix-compatible action log. A guest's unconfirmed proposal is persisted and reconciled against that log. Request sync after interruption; inactivity over 90 seconds also asks for synchronization. Untimed play permits delayed routes but does not promise real-time delivery.

Invitations and event envelopes expire in 120 seconds (30-second future-clock allowance); an accepted session expires after 24 hours. A round ends at the smaller of eligible deck size and 24 actions. Engine pending queue: 12 events; export: 16 KiB. Protected app archive including member public keys: 32 KiB. At most 16 unexpired received invitation IDs are retained across restart to reject replays. Applied/capability replies are throttled per event to 15 seconds, with 64 tracked IDs per two minutes. Each maintenance flush submits at most one new queued event. The existing mesh performs bounded retransmission; expired transient packets are discarded.

App submission requires fewer than 96 total queued packets, preserving space below the mesh's 128-packet cap for chat/receipts. Game packets have ordinary priority. This is a conservative policy, not a measured congestion or capacity guarantee. Multiple independent sessions in the same physical area still share the network.

Settings changes apply to the next invited round so every player accepts the same rules. All devices display the same public card. This implementation does not claim protection against a malicious host.

The new single-device filtered-deck UI is documented in `docs/FILTERED-CARDS.md`. Its live filter edits and full 218-card deck state are not G2 events. Catalog 3.1 changes the exact-byte pack hash, so a saved 3.0 round cannot resume as a 3.1 round; older apps reject the mismatch safely. Chat packet interoperability is unchanged.


Catalog 3.2 adds 76 authored prompts while preserving the original 218 IDs, texts and restrictions. Pack/stage/named-template metadata belongs to single-phone UI; it does not alter G2 event encoding or introduce hidden hands to Nearby. The shared exact-byte pack hash changes, so both nearby apps must update together. A protected, bounded archive with a recognized different PC2 hash remains archived while a fresh engine is allowed; matching and malformed archives continue through the existing restore checks. No older round is interpreted as a new-catalog round.
