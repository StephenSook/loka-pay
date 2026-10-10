# Controlled and adaptive replication

The initial candidate is bounded binary spray, described in the
[routing assessment](spray-and-wait.md), not a newly invented algorithm.
The initial matrix's four tokens are not a production recommendation.

## Proposal

Persist the authenticated sender's maximum allowance separately from the local
transferable allowance. For cooperative peers, splitting an allowance must be an
idempotent, journaled exchange with a unique transfer ID. Crash before/after commit,
duplicate offers and concurrent radios must not mint extra tokens. A receiver's
admission ACK concerns custody of that copy, never destination delivery.

Exact live global copy count is unknowable during partitions. Use local owned
allowance and bounded reported knowledge, not a fictional global oracle. A forged
or withholding peer can still waste allocations; a budget is not Sybil resistance.

Adaptive behavior is EXPERIMENT: choose how much of the remaining authorized budget
to spend using local congestion, remaining time and measured carrier usefulness.
Never replenish spent global allowance just because local copies disappeared.
To support adaptive maxima, authorize the upper bound at creation and preserve
accounting; do not silently rewrite signed policy. At critical congestion, stop
ordinary replication even for nearly expired messages.

The initial 1/2/4/8/16 sweep covers only 50 nodes, three environments and three seeds;
[its results](simulation-results.md) show increasing replication can worsen delivery.
Before selection, broaden it and compare delivery, bytes, residence
and ACK return under identical contacts. Then add adaptation as one variable,
including adversarial resource advertisements and cold starts. Current results
justify keeping a bounded baseline, not adopting adaptive weights.

Evidence: [copy-conservation and rejection tests](../../../experiments/dtn-sim/test_sim.py),
[matrix](simulation-results.md). Persistent transactional allocation on phones remains
NOT IMPLEMENTED by this research change.
