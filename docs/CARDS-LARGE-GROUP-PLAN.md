# Cards for larger nearby groups — proposal

Status: design proposal, not an implemented or measured 24-device capability. The current accepted G2 round remains limited to 2–4 devices. The default filtered deck remains single-device. Neither UI changes nor USB installation prove offline radio delivery.

## Existing foundation

Reuse LOKA's transport-independent encrypted messaging boundary, verified local route selection, existing relay authorization and bounded delivery queues. Add no game-specific radios, cloud dependency or encryption algorithm. Invitation and explicit acceptance authorize a participant; friendship is unnecessary and nearby discovery alone grants no membership. Preserve chat authorization, history and receipt behavior.

Android and iOS already bundle the same `avatar_0` through `avatar_41` catalog. The encrypted profile control can exchange an avatar ID instead of image bytes. An ID is 8–9 UTF-8 bytes; this is not the encrypted packet size. Profile controls are currently best effort over direct links, not a reliable relayed session roster. Custom photos stay local and use the existing absent-ID fallback. Unknown IDs use a placeholder, never a remote image URL. See [profile protocol](../protocol/NEARBY-PEOPLE-V1.md).

The existing shared round now displays Playing and Up next using authenticated roster order and locally available profile IDs. The next player is roster[(revision + 1) modulo member count], never whichever packet arrived most recently. The local filtered deck has no remote roster and cannot honestly display a remote next player.

## Proposed first capacity gate: 24 accepted devices

Use 24 as an initial engineering target, not a supported limit until measured. Retain one accepted session per device and one authoritative host. Multiple sessions nearby also contribute to congestion. Do not raise the G2 constant: its 2048-byte envelope, four-member roster, 12-event pending queue and 24-action round do not implement this target.

A new explicitly negotiated application protocol/rules version must carry a bounded roster, selected categories, content-pack hash, roster revision, authenticated device identities and avatar-catalog version/IDs. Bind avatar references to accepted identities through the existing authenticated channel. Capability negotiation must reject older clients safely; never reinterpret G2 packets or alter chat/v0 interoperability. A protocol and authorization review is required before implementation, especially for larger non-contact identity archives and relay permissions.

The catalog currently contains player-count limits up to 20. Review prompt suitability and update pack metadata/version deliberately before offering a 24-person deck. Do not merely change every maximum. Each participant confirms eligibility locally: Dirty 18+, Drinking 21+. Do not transmit birth dates. Shared categories must be eligible for every accepted player; otherwise offer Clean or refuse that restricted session. Self-declaration is not age attestation or malicious-client protection.

## Traffic and recovery

Send card IDs and small proposed actions/commits with unique action IDs and expected revisions. Bundle all prompts, mascots and card art locally. Swipes, rear-card motion, dealing and countdown animations are local presentation, with no per-frame messages. Validate membership, acceptance, session, expiry, turn, pack and revision before applying a move. Duplicate commits get an applied acknowledgement without advancing again. Missing revisions trigger bounded recovery; contradictory histories pause and request authoritative reconciliation.

At 24 participants, one host transition normally fans out to 23 guests and receives 23 applied acknowledgements. Retries, discovery and relay hops add traffic. Reference-only avatars reduce payload size but do not eliminate this fanout. Snapshot the roster/avatar references on admission/recovery; do not broadcast them with every move.

Suggested bounds to evaluate, not shipped constants:

- 24 fixed members, one session/device, no host migration; host loss pauses play until that same host resumes.
- Invitation lifetime 120 seconds; accepted-session lifetime at most 24 hours, matching current policy. Expire obsolete invitations and presence hints.
- 256 retained actions; checkpoint before trimming. Maximum 32 KiB protected session archive, subject to measured identity/roster overhead. Stop and resynchronize safely if a bound cannot be met.
- Snapshot chunks must fit the existing encrypted packet limit after envelope overhead. Use a bounded transfer ID, count, checksum/version, expiry and reassembly budget; review the exact schema before implementation. Never assume the whole 24-member roster fits one 2048-byte event.
- At most 32 pending logical game events/session; per-recipient bookkeeping must also be bounded. Do not enqueue all peers blindly when that exceeds the queue reserve. Batch fanout fairly and submit at most one new game packet per maintenance opportunity initially.
- Preserve the existing total-queue threshold below 96 of 128 packets, leaving room for chat and receipts. Add measured scheduling that prevents game retries from dominating messaging; ordinary priority alone is not a capacity guarantee.
- Coalesce transient presence updates, avoid tick traffic and bound retry attempts/time. Reuse existing transport backoff rather than stacking independent unlimited game retransmission loops. Reliable move completion means authenticated applied acknowledgements, not transport acceptance.

Untimed play may wait for relayed/store-carry-forward delivery where existing authorization allows it. Show Reconnecting or Waiting for players honestly. All-member acknowledgement can make a large round slow when one device is intermittent; the first version pauses rather than silently advancing divergent turns. A future removal/roster-change policy requires its own accepted, revisioned protocol. Public bundled party prompts offer no protection against inspecting future cards or a malicious host. Hidden-hand games require a different reviewed design.

## Required evidence before enabling the higher limit

Automated cross-platform tests must exercise 24 simulated members in both host directions, version rejection, admission, duplicate/reordered/lost actions and acknowledgements, reconnect/checkpoint recovery, archive limits, unauthorized identities, eligibility, snapshot expiry/reassembly and simultaneous chat traffic. Measure queue depth, bytes including encryption/relay overhead, convergence latency and chat/receipt delay at 4, 8, 16 and 24 members. Simulation does not establish radio capacity.

Then test physical Android–Android and Android–iOS invitations, avatars, turns and interrupted connections without Internet while preserving usable local radios. Record hardware, OS, actual transport/hops, distance, latency distribution, failures, queue occupancy, foreground/background and battery impact. Three connected phones can verify a small real session, not 24-device capacity. Larger physical groups and competing sessions are needed before publishing a supported maximum. Preserve the Android-first encrypted relay, alternate-route and screen-off gates in AGENTS.md.

Implementation order: review the protocol/security design; implement roster/filtered-deck synchronization behind existing delivery; prove small cross-platform physical sessions; run larger load experiments; enable only the measured limit. See [current G2](../protocol/PARTY-CARDS-V2.md), [authorization review](../security/PARTY-CARDS-REVIEW.md), [local networking audit](LOCAL-NETWORKING-AUDIT.md) and [filtered-deck gap](FILTERED-CARDS.md).
