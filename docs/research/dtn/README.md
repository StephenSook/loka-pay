# LOKA store-carry-forward research

Audit date: 2026-10-03. Status: **initial research and isolated simulation; production
adoption and physical qualification pending**. This work stays inside LOKA's repository.
It does not create another app or change the installed apps' protocol.

[Source snapshot hashes](source-snapshot.json) identify the key audited production
files. They are not a whole-app build attestation.

The key finding is that current packet v0 allows only five minutes and foreign relay
queues are volatile. Neither a stronger radio nor longer UI retry text can provide
hours-long carry while those constraints remain.

Start with [current architecture](current-architecture.md), [measured simulation
results](simulation-results.md), [physical test status](physical-test-results.md),
and [recommendations](recommendations.md).

[Coverage and remaining work](coverage.md) maps the assignment to completed evidence
and explicitly pending experiments.

## Research map

- Standards/platforms: [NASA](nasa-dtn.md), [IETF](ietf-bundle-protocol.md),
  [MIT](mit-opportunistic-networking.md), [NIST](nist-d2d.md),
  [Google](google-nearby-aware.md), [Apple](apple-wifi-aware.md).
- Routing: [Spray-and-Wait](spray-and-wait.md), [PRoPHET](prophet.md),
  [epidemic](epidemic-routing.md), [RAPID](rapid.md).
- Design proposals: [congestion](congestion-control.md), [queues](queue-management.md),
  [replication](replication.md), [lifetime](ttl-lifetime.md),
  [encounter prediction](encounter-prediction.md), [privacy](privacy.md).
- [Public competitor assessment](competitor-analysis.md).
- [Executable simulator and definitions](../../../experiments/dtn-sim/README.md).
- [Next native prototype and crash-test plan](native-prototype-plan.md).

Every proposal is labeled ADOPT (principle), ADAPT, EXPERIMENT, FUTURE or REJECT.
ADOPT does not mean code shipped. Source descriptions are distinguished from LOKA
proposals. Sources were accessed 2026-10-03; live repository documents are moving
targets, not pinned implementation attestations. No external implementation was copied.

The physical phase cannot honestly pass on this evidence: supported lifecycle,
radio interoperability, at-rest relay security and battery must be measured on
actual phones after a reviewed compatible prototype exists. See the explicit gaps
in the simulator README rather than interpreting the matrix as exhaustive research.
