# Message route evidence — 0.6.35 (43)

Implementation self-review, 2026-10-03. No envelope, key, signature, receipt or
capability format changes. This adds local observations to encrypted chat history
and a message-info flow on both platforms. It does not introduce a relay-readable
message body or share names/route histories over the network.

A source observation is recorded after the local transport accepts a write. It is
labelled a local attempt, never remote custody or delivered proof. A receiving
observation is recorded after packet verification, sender trust and decryption,
before saving the logical message. Existing A/B receipt validation remains the
only outgoing delivery/read authority. Route metadata alone cannot mark delivery.

The UI uses an already known contact/nearby name for the signed carrier ID, otherwise
“Nearby phone.” A selected carrier is labelled selected until hop information is
reported; it is not presented as having stored the packet. Hop counts remain
recipient reports over the encrypted channel, not tamper-proof route attestations.
One-hop reports hide an unused selected carrier. Legacy unknown relays stay unnamed.
Connections not observed on this phone are explicitly not reported. Media evidence
is per observed packet, not a complete proof for every attachment fragment.

Local fields (transport code, carrier ID, observation time and packet expiry) are
stored in the existing authenticated encrypted history. Old rows remain readable.
Transport codes are allowlisted; fingerprints and timestamps are validated on load.
The transient observation cache is bounded to 256 entries. No plaintext chat content
or new permanent identifiers are added to diagnostic logs.

The expiry display is the envelope's authorized expiry, not an assertion that each
relay has acknowledged retention or deleted its disk copy at that exact instant.
“Received and decrypted” is shown only on the receiving device or after existing
validated destination delivery confirmation. It does not mean read by a person.

The iPhone chooses available links in increasing queued-byte order, with stable
handle order for ties. This is queue avoidance, not a measured throughput predictor.
It retains one-send-per-identity retry suppression and write-failure fallback. Queue
counts do not prove radio completion, background eligibility or geographic range.

Validation: native queue-choice and observation test, Swift encrypted-history reopen,
Android isolated encrypted-history test, existing packet/framing/interop suites and
both app builds. Hardware speed comparison remains outstanding. Full per-relay
custody/transport attestations and authenticated relay-wide cancellation remain
unimplemented; no UI step invents those reports.
