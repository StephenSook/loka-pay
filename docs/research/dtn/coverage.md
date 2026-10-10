# Assignment coverage and remaining work

This checklist prevents a directory of reports from being mistaken for completed
physical research. Dates and measurements are in the linked artifacts.

| Assignment area | Evidence now | Remaining work |
|---|---|---|
| Existing architecture | [Source audit and lifecycle diagrams](current-architecture.md) | Native event capture of the user's failed route |
| Primary research | Linked NASA/IETF/MIT/NIST/platform/paper assessments | Deeper version-pinned competitor source verification and real trace selection |
| Six routing baselines | Executable direct, controlled, epidemic, binary spray, simplified PRoPHET, structural LOKA v0 model | Exact native LOKA packet/retry replay; RFC-faithful PRoPHET if needed |
| Population sweep | [Raw matrix](../../../experiments/dtn-sim/results/matrix.jsonl) | Calibrated load scaling; capped probe traffic is not capacity proof |
| Environment / mobility | Eleven labeled synthetic contact scenarios | Spatial walking/random mobility, calibrated vehicle/community traces and stationary controls |
| Lifetime / retention | Boundary tests and constructed 10 min–24 h carry ablations | Native compatible policy, clock-skew and disk tests |
| Replication | Binary conservation tests; 1/2/4/8/16 sensitivity sample | Adaptive policy, crash-safe allocation, dishonest carriers |
| Congestion | Finite byte/item admission, duplicate/cost counters, atomic-size stress | Utility eviction, control reservations, overload recovery and sustained mixed load |
| One isolated improvement | Paired ACK/destination/small-first scheduling | Fairness, encrypted class visibility, native timing, physical comparison |
| Inventory / tombstones / cancellation | [Design tradeoffs](queue-management.md), [lifetime controls](ttl-lifetime.md) | Compact encoding, false-positive tests, reviewed authentication/privacy, implementation |
| Failure scenarios | Eight controlled traces plus invariant tests | Full duration/load combinations, OEM background, radio coexistence, storage corruption, attacker scenarios |
| Metrics | Delivery, latency, bytes, copies, queue/admission and return-ACK records | Measured battery, radio airtime, phone CPU/memory and actual path diagnostics |
| Media / Moments / calls | Classified architecture proposals | Actual chunk-size/transmission tests; Moments and real-time calling are not this DTN prototype |
| Physical validation | [Explicit NOT RUN register](physical-test-results.md) | Reviewed native prototype then controlled phones, long-duration carry and background qualification |
| Production adoption | [Ordered recommendations](recommendations.md) | No algorithm winner or phone deployment approved by simulation alone |

The highest-priority gap is still proof of basic encrypted A→B→C carriage and
return ACK on actual devices, followed by supported restart/background behavior.
The new research harness makes proposed changes testable; it does not resolve
the user's existing delivery failure by itself.
