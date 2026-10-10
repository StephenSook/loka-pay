# Network gap analysis

October 3, 2026. Source audit before experimentation. Quantitative results are recorded separately in [the ledger](EXPERIMENT-LEDGER.md). No physical success is inferred from source or simulations.

## Five highest-priority problems

| Priority / problem | Current / expected behavior | Evidence / likely cause | Research / possible improvement | Risk / required experiment / success metric |
|---|---|---|---|---|
| P0: no authenticated neighbor binding | Public probe works over an untrusted route; expected identity-bound session when authenticating a known peer | BleLink/BleTransport probe is six public bytes; rotating radio handle is not a saved key; reconnect complaints recorded, 100-cycle gate unrun | Platform pairing/authentication and reviewed session protocols; maintain trust independently of connectivity | Key permissions, downgrade and replay risks; EXP-012 100 physical reconnect cycles, zero unnecessary app approvals and no false authentication |
| P0: volatile relay custody | Relay can wait only while process lives; expected ciphertext survives restart and later recipient contact | MeshEngine pending/seen RAM; queued() exports only own source packets | NASA DTN store-and-forward/resource bounds; isolated persistent-ciphertext experiment | Disk abuse, replay, stale ingress, expiry/clock rollback; disconnect source before restarting relay, deliver through later contact + authenticated destination receipt; zero plaintext at relay |
| P1: flooding/retry amplification | Every valid first packet and retry goes to all non-ingress neighbors; expected bounded useful overhead under density/load | MeshEngine linkUp/tick/receive; ACK cannot discard relay copies; hop cap limits reach | Controlled replication, suppression/backpressure, Spray-and-Wait as later comparison | Reducing copies may lose bridge routes; unchanged baseline at 10–1,000 nodes with loss, finite bandwidth, then one predeclared experiment only; delivery, tx/delivery, tail latency, drop counts |
| P1: iOS operational multi-link relay absent | One central path; expected tested simultaneous contacts and forwarding | BleLink selected peer + LokaMesh incoming flag; no peripheral/peer-tagged outgoing path | Apple Core Bluetooth and Wi-Fi Aware research; peer-tagged isolated adapter trials | Do not infer platform impossibility; direct two-iPhone, mixed three-device, then lifecycle tests; qualified receipts and no shortcut |
| P1: missing reliable measurements/backpressure | Async transport send may return before acceptance/drop; only string diagnostics; expected queue/drop/bytes/receipt observations | Classic send missing socket returns; BLE client callback can drop; no route-bound telemetry | Nearby transport semantics, deterministic congestion tests; diagnostic counters before route scoring | Privacy and observer overhead; separate attempted, enqueued, on-air, destination-saved and ACK-confirmed; missing CPU/battery/range remain unknown |

## Additional gaps

| Priority | Gap | Next measurement / decision |
|---|---|---|
| P0 | Self-signed unknown origins can consume verification and replay budget; no global/per-origin quota; hops can be reset by hostile relay | Existing real-crypto tamper/unknown-sender tests plus future Sybil/flood workload; no crypto rewrite from simulation |
| P1 | Refused relay packet becomes seen before pending capacity check, preventing a later duplicate from filling freed capacity | Deterministic saturation regression; disclose this baseline behavior rather than quietly fixing it before comparison |
| P1 | No destination resolution or autonomous alternate-route discovery | Separately measure an already-connected diamond and an initially absent backup path; synthetic scheduled link-up is not discovery proof |
| P1 | Own history/enqueue/persist sequence is not atomic | Fault injection around each write; count stranded history and orphan packets; persistent relay cannot fix this sender transaction |
| P2 | No negotiated transports or remote features, Wi-Fi/LAN adapters | Check runtime/hardware and authenticated capabilities, direct link first; Wi-Fi Aware standard names do not establish phone interoperability |
| P2 | Multiple handles to one physical identity can duplicate transmissions | Measure Classic/BLE coexistence; authenticated identity binding required before identity-based merging |
| P2 | No priority/fair scheduling; fragmented media consumes queue slots | Mixed 128-byte text / 64-KiB image trace, control receipt delay and queue rejection rate |
| P3 | RSSI thresholds do not define route workload quality | Shadow-mode RTT/goodput/freshness collector after physical baseline; no fabricated Excellent/call thresholds |
| P4 | Live voice/PTT/AI routing | Defer until reliability, measured transport budgets and session/security design; NASA COMMANDS is not a justification for AI now |

## Scope of this execution

Audit, fresh primary-source assessment, unchanged-routing simulator baseline and one isolated experiment. Simulator results describe an explicit synthetic model, not 100+ working phones. Only two Androids and one iPhone have been available in recent development; this cannot satisfy three-Android, two-iPhone or four-node physical gates. Preserve unsuccessful and unavailable trials. Stop after the selected experiment's comparison before another major architectural change, as requested.
