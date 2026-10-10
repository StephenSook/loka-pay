# Lifetime, retention and Forward & Carry

LOKA v0 already authenticates creation and expiration. Both validators also reject
creation older than five minutes. Changing only `expiresAt` or a UI countdown will
not enable hour-long carriage. [Audit](current-architecture.md).

## Proposed successor policy — not shipped

Use three independent values:

1. **Hard expiration**: immutable, sender-authorized, authenticated end-to-end.
2. **Local retention deadline**: carrier-owned, at most hard expiration, never written
   back over the originator's policy.
3. **Replication allowance**: bounded forwarding resource, independent of time.

The distinction is consistent with the [IETF assessment](ietf-bundle-protocol.md).
Do not call a mutable hop budget a lifetime. Keep both if needed.

Forward & Carry proposal: authorize a normal delivery target and a later absolute
hard deadline at origination. Passing the normal target may change UI/scheduling;
it never grants a new lease. If the sender later opts into a longer window, create
a newly authenticated policy/message version with explicit duplicate and supersession
semantics. An absent sender cannot authorize an extension retroactively.

No 24-hour production default is chosen. Test candidate 10-minute, 1-hour, 6-hour,
12-hour and 24-hour windows against contact traces, storage residence, stale
delivery and battery. A 24-hour encounter requires an expiration **after** that
encounter; equality means expired. The focused simulator deliberately sets the
long bound to encounter time plus ten minutes and compares a separate 300-second
policy. [Carry measurements](simulation-results.md).

Local deletion, low battery or relay opt-out can shorten retention. A source may
retain its own encrypted outbox differently from volunteered relay data, but neither
may send an expired envelope. Cleanup must run at startup and before admission,
offer, forwarding and destination acceptance, not only on a live timer.

Cancellation proposal: a reviewed sender-authenticated control object binds the
exact message digest/ID, policy version and original maximum expiration. Cache and
forward it with bounded retention. Accept only the original sender's authorization;
receiving an arbitrary “cancel” must not delete data. Disconnected carriers learn
later; no immediate global deletion guarantee. Deleting a sender's UI history is
not silently equivalent to a network-wide cancellation.

Migration gate: feature/version negotiation, old-peer behavior, replay/clock-skew
vectors and explicit security review before either platform changes v0. Atomic
queue persistence must precede claims of restart-safe carry.
