# Architecture recommendation — evidence checkpoint

2026-10-03. **Do not replace production networking yet.** An isolated native-pairing/transfer probe has been built and installed on one Android and one iPhone. Capability checks are positive; Android publication callbacks succeeded, but no peer pairing/data-path event was captured. Direct native pairing, offline transfer and the dependent multi-hop/background/media gates remain unproven.

## Answers to the three primary questions

**Can Apple + Android Wi-Fi Aware be LOKA's primary cross-platform high-bandwidth local transport?** It is a viable candidate to investigate, not a proven primary transport. The current production adapters have incompatible service/security setup. Native pairing capability alone does not establish compatible data-path negotiation or useful bandwidth.

**Should BLE become primarily discovery/control/fallback?** Retain BLE now. Measure native Aware discovery against BLE-assisted upgrade, including tiny-message setup/energy cost and unsupported devices. No result yet justifies universally demoting BLE payload delivery or imposing BLE-first discovery.

**Can this reliably support offline cross-platform multi-hop messaging, voice and video?** Not established. iOS currently does not forward foreign packets, durable relay custody and a measured quality engine are absent, and background execution is constrained. Better direct Wi-Fi cannot by itself repair routing, persistence, trust or lifecycle gaps.

## Decisions

| Classification | Proposal | Evidence and prerequisite |
| --- | --- | --- |
| ADOPT | Preserve transport-independent packet identity/E2EE and local/cloud separation | Existing code already supports opaque transport handles and endpoint ciphertext. |
| ADOPT | Keep BLE and current LAN paths | No measured replacement advantage; retain compatibility. |
| ADAPT | Treat hardware, pairing, permission, resources and reachable identity as separate capability states | Samsung reports Aware plus pairing, but no direct connection result. Existing aggregate capabilities are incomplete. Integrate only after review. |
| EXPERIMENT | Native Android PIN pairing with Apple's picker | Isolated probe installed; direct physical test is the immediate gate. |
| EXPERIMENT | Remove artificial frame pacing only in benchmark variants | Android 250 ms/frame is a code-level bottleneck hypothesis; measure queue fairness/CPU before changing production. |
| EXPERIMENT | Authenticate same identity on a new route, retain trust | Existing challenge/consent logic provides a basis; no redundant app friend approval, but first OS pairing still applies. Security review required. |
| EXPERIMENT | BLE-assisted versus native Aware discovery | Compare success/latency/energy, not assumptions about preferred radio. |
| EXPERIMENT | Peer-aware iOS relay and bounded durable ciphertext journal | Separate from radio; direct/concurrency tests, ingress exclusion, quotas, expiry and restart tests first. |
| EXPERIMENT | Measured route selection with hysteresis and fallback | No production scorer currently exists; normalize and age observations, bound probes/replication. |
| FUTURE | Live audio, video and media handoff | Gate on direct encrypted throughput, background and relay results; use reviewed session security. |
| REJECT | Replace BLE, claim reliable mesh, or promise range from specifications | No physical evidence supports those claims. |
| REJECT | Silent first native pairing or fake background keepalive | Platform requirements and runtime constraints; no fabricated grants. |
| REJECT | Call Aware “Wi-Fi Direct,” or infer LOKA APIs from AirDrop support | Different protocols and integration contracts. |
| REJECT | Treat link encryption as end-to-end conversation security | Relays must continue to see only endpoint ciphertext. |

## Integration gate

Before production changes: collect direct native-pairing/data-path evidence with operator-confirmed Internet/router removal; verify unchanged packet-v0 E2EE using test identities; obtain repeatable throughput/latency and reconnect baselines; validate two concurrent relay links and the required background states; review security/identity binding and resource limits. Preserve existing provider fallback and message/receipt IDs. No fixed radio preference or production code modification is authorized merely by a successful compile.

Open findings and evidence live in [current audit](01-current-loka-architecture.md), [direct results](06-direct-device-results.md), [background matrix](10-background-results.md) and [comparison](11-power-performance.md). The next operator action is the [isolated pairing runbook](../../../experiments/wifi-aware-probe/README.md).

## Updated physical evidence: discovery yes, pairing blocked

Reverse discovery now has native callback evidence. Both PIN-display and PIN-keypad bootstrap attempts fail before a code appears; two keypad trials failed about 20 seconds after request. Retain this transport as experimental. See the [updated direct results](06-direct-device-results.md) and [prepared vendor reproduction](vendor-bootstrap-repro.md). Repeating the same user flow is not the next diagnostic. Validate native request contents/firmware behavior, or test a controlled API-37-capable device with the documented metadata overload. Neither requires production stack replacement.
