# DTN research harness — experiment only

Run from this directory with Python 3.9+; no third-party packages:

```sh
python3 -m unittest -v test_sim.py
python3 run.py
python3 sensitivity.py
python3 verify_results.py
python3 report.py
```

Paired carrier-prediction follow-up (2026-10-05):

```sh
python3 -m unittest -v test_prediction_comparison.py
python3 prediction_comparison.py --output /tmp/loka-prediction-smoke
python3 prediction_comparison.py --full --output /tmp/loka-prediction-full
```

The full run offers one assumed 1024-byte text per user/minute from 100 users for
30 minutes, followed by a fixed ten-minute drain window. It compares direct,
controlled flooding, four-token spray and simplified PRoPHET on identical offers
and contacts for three seeds. Routine, cold-start, changed-routine and small-store/
low-contact-capacity cases are reported separately. Warm cases have ten minutes of
past contacts before any offered message. This synthetic fixture is not a captured
campus trace or a replay of current v3 routing. It adds no Internet gateway model,
native peer-summary exchange, adversarial claims or phone behavior. Outputs include
raw rows, a summary and code hashes; no adoption approval is inferred from them.

`--quick` runs a smaller smoke matrix. `--output /tmp/loka-dtn-results` preserves
the checked-in result set. Inputs are generated deterministically from seeds 1–3.
`results/matrix.jsonl` contains every case, not just successful ones.
Use `python3 run.py --resume --workers 4` to resume unchanged model/seeds from
complete JSONL records. Parallelism runs independent cases in subprocesses; it
does not change the simulated scheduling. Run metadata reports the final invocation's
wall time separately from any earlier resumed work. Do not resume after changing
model code; use a fresh output directory instead.

## Model and baseline definitions

This is original experiment code, not an implementation of BPv7, production LOKA,
or any competitor. A contact is a scheduled pair with a shared byte allowance;
whole packets are instantaneous at that contact's timestamp. No global topology
is consulted by routing. Sender/destination are integer pseudonyms in the model.

| Baseline | Rule |
|---|---|
| direct | Retain at sender; send only when destination encountered |
| controlled | Flood; six relay forwards; suppress duplicates on receipt; exclude ingress |
| epidemic | Exact queue inventory; transfer missing packets |
| spray | Binary token splitting; one-token carriers wait for destination |
| prophet | Bounded 64-entry encounter table; forward to strictly higher predictor |
| loka_v0 | **Approximation** of bounded flooding with five-minute lifetime and volatile relay copies |
| spray + priority | Same spray rules, only candidate ordering changes: ACK, destination, small packets |

PRoPHET-style uses encounter increment .75, transitivity .25 and decay .98/minute.
It is not RFC 6693 wire compatibility or its refined characteristic-time model.
Four spray tokens are an experimental parameter, not a selected production default.

All comparison candidates except `loka_v0` have a six-hour lifetime; source offers
are identical. `controlled` provides the same-lifetime flooding comparison.
**Do not attribute the difference from `loka_v0` solely to routing**: lifetime,
persistence and simplified packet sizes also differ. The v0 approximation omits
15-second timed retries, asynchronous writes, chunking, separate peer handles,
platform callbacks and per-message encryption overhead. It cannot predict app latency.
The matrix's large atomic messages are not valid individual v0 packets: native
LOKA splits media into smaller encrypted packets. An exact current-LOKA baseline
requires replaying captured native packet/event traces; that required follow-up is
not replaced by the `loka_v0` approximation here.

## Experimental assumptions and accounting

- 128 items / 256 KiB per node (32 KiB in congested scenario), 2048 replay entries.
  Reject new data when full; no utility eviction in this baseline. Source rejection
  stays in the offered-message denominator. Sizes are assumed wire sizes, not codec measurements.
- Inventory = 32-byte session overhead + 16 bytes per queued ID; predictor entries
  cost 12 bytes. Flood baselines pay session overhead but do not exchange inventories.
  Even an empty successful encounter consumes session bytes. These assumptions
  must be replaced by measured encoded control sizes before deployment decisions.
- Data, ACK and duplicate payload bytes consume the same shared contact capacity.
  Payload too large for remaining capacity is deferred; no fragmentation/resume.
- Destination ACK is a separate 512-byte routed object generated at receipt. Only
  its return updates sender confirmation. No globally instant delivery knowledge.
  Relays retain copies until expiry; endpoint receipts are not relay tombstones.
  Candidate snapshots mean a newly created ACK waits until another modeled contact;
  the model does not represent immediate reverse writes within a live connection.
- Authentication, synchronized clocks, trust, ciphertext and atomic durable storage
  are **assumed**. No cryptographic security or disk durability is tested here.
- The priority variant assumes carriers know ACK class. Current encrypted receipts
  do not expose that class to relays. A compatible authenticated hint or restricting
  priority to locally generated receipts requires a separate security/protocol decision.
- Binary copy tokens split only after successful admission. Honest cooperative nodes
  conserve tokens; malicious duplication and crash-safe token transfer need protocol work.
- The application message and envelope are one atomic object. Actual LOKA media
  splits across packets, so large-media rows are admission/scheduling counterexamples.

## Coverage and limits

The population matrix includes 3, 10, 20, 50, 100, 500, 1000, 5000 and 10000.
Eleven environment labels select random, community, periodic-shift, vehicle-like
or partition/merge **synthetic contact patterns**. These are not calibrated physical
mobility models of a hospital, city or campus. Sparse/rural use 3N contacts; others
12N over six hours. Five percent fail (25% for disaster). Offered traffic is capped
at min(2N,128). This is a scale smoke test, **not a 10000-user load proof**.
All matrix traffic originates at time zero; there is no sustained arrival process.
Contact capacity is a scenario parameter, not a measured BLE/Aware radio model.

Focused carry cases isolate lifetime and restart survival at 10 minutes, 1, 6, 12
and 24 hours of simulated time. The long policy expires 10 minutes after the
encounter; it does not silently extend any existing envelope. Size-only stress
offers 10000 texts, 1000 voice notes, 500 photos and 100 Moments separately.

Offline/uncooperative flags and reboot primitives exist. Exhaustive OEM background,
thermal, battery death, user deletion, radio coexistence, Wi-Fi Aware loss, Internet
toggle, malicious identity, random-walk position and real-trace tests remain pending.
Internet is absent from the model; it is not proof that phone traffic avoided it.

`sensitivity.py` adds 45 budget cases (1/2/4/8/16 tokens, three seeds, three
environments at 50 nodes) and eight controlled failure traces. A suspended or dead
carrier is modeled as unavailable, not as a prediction of platform wake behavior.

## Metrics

Delivery denominator includes all offered source messages. P50/95/99 use nearest
rank among deliveries only; `null` means none, not zero latency. Report delivery
rate alongside latency to avoid survivorship bias. With few deliveries p99 is
just the maximum observation. ACK p95 is receipt-return time after data arrival.

`wire_bytes_per_delivered_byte` includes inventory, retries/duplicates and ACKs;
`tx_per_delivered` counts payload transmissions including ACKs, not control frames.
Copy mean is encounter-sampled, includes ACK copies, and is not a time integral;
peak is per packet, including ACK packets. Queue/byte peaks are per node, whereas
remaining storage is network-wide. Expiry counts are copies plus a separate unique
undelivered-message counter. Rejections can repeat and are not unique evictions.
Cleanup is lazy on node activity and at final measurement: sampled stored-copy
counts can include expired objects on inactive nodes, not just useful live replicas.

Contact capacity utilization is a model budget ratio, **not radio airtime**.
Battery joules, phone CPU/memory and physical radio utilization remain null.
Route changes are null: forwarding has no selected end-to-end route. Run wall time
is host execution only. No hardware battery estimate is inferred from byte counts.

Research interpretation and remaining gates: [DTN research](../../docs/research/dtn/README.md).

### Heterogeneous storage regression cases (2026-10-03)

`Simulator(..., node_capacities=[...])` supplies a byte quota for each device;
without it, the existing uniform `capacity` behavior is unchanged. Run
`python3 -m unittest discover -s experiments/dtn-sim -p test_sim.py`.
New cases cover refusal by a full relay without losing spray tokens, unequal
storage quotas under congestion, cleanup at the original expiry, and two carriers
meeting a destination that already received a message. In that controlled-routing
model, the second carrier can acquire the independently routed acknowledgment and
return it without another application delivery.

This does not implement multiple authorized carriers in native packet v2. The
model assumes authentic receipts and uses an assumed 512-byte ACK: it is not a
measurement of the current RSA envelope. Existing matrix outputs have not been
regenerated; these are additional deterministic regression cases.

Native anonymous observation replay: `python3 experiments/dtn-sim/encounter_replay.py TRACE.json` from the repository root. See [capture limits and collection](../../docs/research/dtn/encounter-trace.md). This replays cold local shadow history, not global mesh routing.
