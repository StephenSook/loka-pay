# Bounded encounter intelligence

Research motivation: [PRoPHET](prophet.md), [MIT mobility evidence](mit-opportunistic-networking.md).
Prediction remains experimental; it cannot repair unsupported background execution
or a message that has already expired.

Proposed local record: short-lived peer pseudonym, coarse last-contact bucket,
decayed encounter count, useful-byte/failed-transfer counters and confidence.
Cap entries, expire records and reset on identity rotation as appropriate. No GPS,
phone-number graph or central encounter upload is necessary for this experiment.

Count a meaningful session once, not every scan result. Require a cooldown to
prevent one stationary peer generating high apparent mobility. Separate discovery
from authenticated connection and completed useful transfer. A high RSSI alone
does not prove the peer will later meet the destination.

Experiment plan: compare 16/64/256-entry limits, several decay times and no-prediction
baseline; train on past contacts only. Measure metadata bytes as part of the contact
budget. Replay partitions, routine changes and malicious high-score announcements.
Reject transitive table exchange if privacy or overhead outweighs delivery gain.

The current harness has only a 64-entry simplified predictor. It does not implement
private transitive matching, poisoning resistance, identity rotation or calibrated
community detection. [Results](simulation-results.md) therefore do not select a
production carrier score. No device needs a complete global topology.

## Native shadow foundation — 2026-10-05

Persistence follow-up: raw bounded records now survive restart in authenticated encrypted native storage; original age is retained and active sessions must qualify again. See the [storage review](../../../security/ENCOUNTER-STORAGE-REVIEW.md). The memory-only description below records the first implementation slice and is superseded by this follow-up. Routing still does not use the estimates, and no peer/cloud exchange exists.

Kotlin and Swift now contain matching `EncounterHistory` recorders, wired to authenticated profiles on connected local routes. The recorder takes a set of device identities, coalescing radio aliases, and requires five seconds of observed continuity. One session counts once; reconnects within 60 seconds are suppressed. It stores at most 64 records, applies the existing experimental .75 update and .98/minute decay, and expires records at 24 hours. Observation gaps above 30 seconds require a new five-second qualification; backwards wall-clock changes reset history. These constants are experimental, not calibrated mobility parameters.

History is memory-only: restart deliberately starts cold. No contact graph is persisted, sent to peers or uploaded. Development route snapshots expose only the number of records. The recorder does not grant trust, select carriers, expand copy budgets, change protocol bytes or enable gateways. Full durable encounter history, useful-transfer counters, privacy-reviewed transitive summaries and prediction-driven selection remain outstanding.

Matching native checks cover short sessions, repeated observations, reconnect suppression, later encounters, suspension, decay, one-record eviction, expiry, clock reversal and clear/cold start. Phone performance improvements are not claimed from these software checks.
