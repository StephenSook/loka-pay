# EXP-010 — cross-platform feasibility, recovery and power

2026-10-02. Status: designed, not executed. Complements EXP-003/004/005/007/008/009. See [audit](../docs/CROSS-PLATFORM-MESH-AUDIT.md). A single Android and single iPhone cannot execute all cases. Do not fabricate unavailable measurements.

## Topologies

| ID | Path | Current feasibility / prerequisite |
| --- | --- | --- |
| A | Android ↔ Android | Classic adapter available; two physical Android phones |
| B | iPhone ↔ iPhone | Blocked by current central-only role; experiment with peripheral role or supported local adapter first |
| C | Android → iPhone | Existing BLE roles; reciprocal trust + link approval |
| D | iPhone → Android | Existing BLE roles; public probe reply + destination receipt |
| E | Android A → Android B → iPhone C | Exclude A–C; B holds Classic and BLE links |
| F | iPhone A → Android B → iPhone C | Two iPhones and one Android; verify B can hold both BLE sessions |
| G | Android → iPhone → Android → iPhone | Blocked by iPhone forwarding/multi-link gap; do not label a retained packet a relay |

A blocked experiment is not a failed hardware measurement. Record source limitation, proposed adapter change and gate needed before attempting it. For A/E and a four-Android control, run a diamond: A–B–C initially; disconnect B and measure A–D–C with D initially unconnected. Repeat with D preconnected as a distinct control. Manual reconnect is recorded separately and cannot pass automatic route recovery.

## Procedure

1. Record build/commit, model, OS, OEM battery policy, granted permissions, app lifecycle, charging state, radio capability/availability and transport per link. Verify both endpoints support the content version.
2. Disable cellular data and remove Internet uplinks/tethering/VPN. Preserve radios needed for the tested local transport. Never use a failed Internet request alone as proof of the path.
3. Establish trusted test identities and allowed links. Confirm endpoint keys are correct; intermediaries must not import destination private keys. Ensure no direct endpoint shortcut by topology control and bounded link logs. Record distance without claiming RSSI is distance.
4. Send 30 uniquely labeled non-sensitive text messages each direction per condition; record receipt on the destination and ACK separately. Include deliberate duplicate/reordered packets in a software control, not by corrupting personal history.
5. Send ten 3–5-second voice notes per direction; compare decoded bytes in isolated software fixtures, and intelligible playback physically. Include recorder cancel/max-duration/size rejection. Do not raise the current media cap for this experiment.
6. Break links for 10/60/240 seconds, reconnect before expiry, and repeat after expiry. Restart an endpoint and separately a relay. Record that current relay memory is lost on process death. Measure unconfirmed messages even when the body arrived but ACK did not.
7. Repeat screen on, app background/unlocked, screen off/locked, OS idle, battery saver, movement/out-of-range return and relay disappearance. Force-quit is its own condition. On iPhone record ciphertext notification, unlock time, decrypt/save time and ACK separately; expired locked inbox entries must not become delivered later.
8. Run idle/discovery/relay/media workloads for at least one hour on battery, then repeat; a debugger/USB charger can alter power and lifecycle, so label diagnostic runs separately. Do not disable user power settings without recording the change.
9. Use application-scoped, metadata-only counters/logs; never export private keys, address books, plaintext conversation archives or unrelated system data. User observations may supply recipient text and audio success.

## Measurements (one row per condition and direction)

Record: run ID; topology; build; model/OS; transport at every edge; radio/uplink proof; distance; discovery ms; connect ms; offered count; unique received count; ACK count; expired count; success percentage; median/p95 destination latency; ACK latency; controlled physical hop count; duplicates suppressed; retries; disconnects/hour; recovery ms (or timeout); store-forward delay; background survival duration; start/end battery and %/hour; CPU mean/peak; process RSS mean/peak; temperature; radio activity; charging/debugger state; errors and manual interventions.

Use N/M for an unmeasured value, and blocked for an unsupported scenario. Mutable packet hops are not authenticated path evidence; use controlled topology and per-link observation. Define latency from monotonic sender timers plus receipt round trips or explicitly synchronized clocks; record clock uncertainty for one-way timing. Do not compare power from different workloads or pretend packet enqueue is delivery.

Acceptance budgets must be agreed after baseline measurements. A topology passes only with observed endpoint content, correct trust/crypto behavior, documented radio-only path, no duplicate UI messages and truthful delivery status. Screen-off/background and automatic recovery each receive separate decisions. This file contains no physical success, latency or battery results yet.

## Cable-free distance trial and debugger controls

Installed apps can continue running after USB removal; a debugger is not required to deliver messages. For Android wireless debugging, use the supported Developer options → Wireless debugging → Pair using pairing code workflow on the same Wi-Fi network as the Mac. Pair with `adb pair <pairing-ip>:<pairing-port>` interactively, then use the separate connect endpoint if auto-discovery does not connect. Do not substitute the legacy unencrypted TCP-port workflow. Wireless debugging was not enabled during the 0.6.9 preflight (no advertised ADB mDNS services).

Reference: https://developer.android.com/tools/adb#connect-to-a-device-over-wi-fi . Use an isolated Wi-Fi network with its Internet uplink removed for offline measurements and record the debugging connection separately. A common debugger LAN is not proof that LOKA uses LAN or that BLE traversed the intended relay. Record per-hop transport metadata and repeat a representative run without an attached debugger because debugging/charging can affect lifecycle and battery results. If Wi-Fi coverage ends, debugger loss does not establish LOKA message loss; collect metadata after the walk.

For Android A → Android B → iPhone C, establish A/B and B/C links and exclude A/C using physical placement plus a B-off negative control. A and C exchange contact codes; B requires no contact friendship. A controlled app allowlist alone is not distance evidence. Initial three-phone mixed test remains separate from the three-Android Phase 2 gate. Do not publish a distance before measuring delivery and returning destination-save ACKs at recorded positions.
