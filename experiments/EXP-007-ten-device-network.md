# EXP-007 — Ten-device local network and load

Status: planned, not run. Requires repeatable physical EXP-003, background EXP-004, and automatic-recovery EXP-005 results first. Current manual-link, memory-queue lab cannot pass automatic discovery or durable forwarding cases. No mesh scalability claim follows from this procedure.

Purpose: compare measured delivery, load, storage and energy across a controlled ten-phone network. Follow [the research assessment](../docs/OFFLINE-NETWORKING-RESEARCH.md), [engineering note](../docs/WIFI-RADIO-VS-INTERNET.md), and [result template](RESULT-TEMPLATE.md).

## Hardware and controls

Use ten physical Android phones labeled A–J. Include at least three manufacturers and record OS/API, app/commit, supported/available radios, permissions, power-management settings and link capacities. Repeat same-model subsets where possible to isolate vendor differences. Record physical placement, indoors/outdoors, distance, obstructions, charging state and interference.

Disable mobile data and remove Wi-Fi/WAN, VPN, USB/Ethernet/tethering uplinks. Preserve the local radios under test. No router/cloud/server participates in message delivery. Record packet interfaces/paths and upstream isolation. Endpoint trust is established out of band; relays do not need endpoint private keys. Use synthetic non-sensitive text only.

## Cases

1. **Known topology control:** allow only neighboring links in a ten-device ring (A–B–C–D–E–F–G–H–I–J–A). Record actual established edges; do not assume all connections fit controller limits. A→F has five links, within the current v0 six-link hop budget. Exclude shortcuts through allowlists and verify logs/recipient receipt. This is manual topology control, not automatic discovery.
2. **Load:** proposed starting settings are unique 128-byte messages at one message per second network-wide for ten minutes. Repeat lower and higher loads only after observing queue/thermal behavior. Rotate endpoint pairs and seeds; distinguish per-message success from total packet forwards. The rate/duration are test settings, not promised capacity. Record failures/timeouts and actual UTF-8/frame sizes.
3. **Failure/repair:** remove a relay with the alternate path initially absent. Measure automatic discovery, link establishment and recipient delivery separately. Report manual repair or already-connected alternate flooding as controls. Record hop-limit exclusions; removing a ring edge can leave a path longer than v0 supports.
4. **Partitions and movement:** split the network; let one relay move between partitions and restore local contact. Record store-carry-forward, duplicates, expiration and queue pressure. Repeat relay process death/restart. Current memory-only queues must be reported as lost; durable success requires a later reviewed implementation.
5. **Background:** repeat screen off/locked, app backgrounded, natural and forced Doze, battery saver, OEM default restrictions, OS kill, force stop and reboot separately. Observe discovery, advertising, receive and relay survival individually. Do not combine all failure states into one background result.
6. **Policy comparison:** once implemented, compare bounded flooding, bounded-copy forwarding and encounter-based policies with identical message/movement schedules. Record control traffic and privacy-relevant encounter state as well as delivered traffic. An unimplemented policy is not tested.
7. **Radio comparison:** repeat on supported subsets for RFCOMM, BLE, Aware/Direct and hybrid providers. Unsupported combinations are results. Record provider per hop and simultaneous-link limits; do not mix radio changes with routing-policy changes in the same comparison.

## Measurements and disposition

Collect discovery/connect time, recipient delivery success rate, median/p95 latency, unique messages versus duplicate frames, hop count, loss, route lifetime/recovery, pending bytes/evictions, forwards and control bytes. Record CPU method, memory, temperature, battery consumption per hour and background survival duration. Include idle baseline and repeat runs with equivalent charging/thermal conditions. Percentage-per-hour is a coarse observation, not a precise energy measurement; use available energy instrumentation and record its method. Avoid subtracting wall clocks on unsynchronized phones; use external timing or an explicitly characterized clock-offset method.

Agree reliability, recovery and resource budgets before scored runs, after baseline measurements. Report attempts, successes, failures and censored/time-limited outcomes; never substitute queued/sent events for endpoint receipt. Passing a ten-phone foreground topology does not establish city-scale reach, user density, autonomous route discovery, iOS support or reliable voice calls. Stop expansion when gates fail and document the failure before optimizing.
