# Multi-peer results

**NOT RUN.** Prerequisite: direct Android↔iPhone Aware data-path and E2EE gates. The probe is intentionally one-peer. Samsung's reported eight datapaths are not eight successful peers.

| Simultaneous peers | Required physical nodes | Current evidence |
| --- | --- | --- |
| 1 | 2 | Capability only; direct measurement pending |
| 2 | 3 | Not run; second Samsung currently disconnected |
| 3 | 4 | Not run; insufficient phones |
| 4 | 5 | Not run; insufficient phones |
| 5+ | 6+ | Not run; insufficient phones |

After direct success, extend only the isolated probe to maintain bounded per-peer sessions. Log shared resource counts before/after each addition, role combinations, admitted/rejected requests and native error codes. Test Android and iPhone as the hub separately, then simultaneous publisher/subscriber roles. Current production's two Android Aware links and one iOS Aware link are application caps, not measured radio ceilings.

For each peer count: 10 minutes of concurrent traffic; per-peer and total useful throughput, p50/p95/p99 transfer latency, transaction failures, disconnects/hour, queue delay, CPU/RSS, battery/thermal observations. Normalize offered load, test fairness and recovery after one peer leaves. A falling aggregate result must not be hidden by averaging only the fastest peer. Repeat with BLE and infrastructure Wi-Fi active, then isolated, recording interference.

No production peer cap increase is recommended until memory bounds, fairness, lifecycle cleanup and actual phone stability are measured.
