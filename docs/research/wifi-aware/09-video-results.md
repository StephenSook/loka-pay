# Video, adaptive voice and route handoff

**NOT RUN / NOT IMPLEMENTED in this probe.** No raw Aware throughput, encrypted-media throughput or multi-hop voice/video has been measured. Signal bars cannot establish call quality.

## Gated experiment

1. Pass direct bidirectional Aware and unchanged LOKA E2EE validation.
2. Measure sustained usable throughput, application latency, jitter proxy, deadline loss and thermal/energy cost.
3. Prototype direct audio with a reviewed secure media transport and congestion control; do not substitute long-lived RSA packet-per-frame signing for a reviewed media session design.
4. Test 360p, then 480p, 720p, 1080p only when the previous level meets a declared bitrate/FPS/latency budget.
5. Attempt encrypted two-hop media after direct video and relay gates; then three-hop and route removal/alternate-route handoff.

Capture actual encoder bitrate/resolution/FPS, rendered FPS, dropped frames, capture-to-display latency with a valid shared measurement method, p50/p95/p99, CPU, RSS, battery/hour and thermal state. Count setup/reconnect interruptions, not just steady-state averages. Relays must not decode or transcode private media.

## Proposed quality engine — EXPERIMENT

Use throughput headroom, recent latency and deadline failures, queue depth, route stability, hop cost and local battery/thermal constraints. Reject unsupported/unauthenticated routes before scoring. Normalize metrics across radio types and apply freshness, hysteresis and minimum dwell time to prevent route oscillation. Do not add raw dBm to Mbps in an arbitrary score.

Provisional behavior to test: video → lower bitrate/resolution → audio → push-to-talk → voice note/queued text. Thresholds must be calibrated against measured codecs and phone behavior; none are production-certified. A user should receive a plain message when live delivery cannot continue.

Route-change test: carry the same secure media session through a newly authenticated next hop; preserve sequence/replay protection, discard late frames, measure interruption and inform the user if live media ends. Stored voice notes may tolerate delay; a real-time call cannot be described as continuing while only queued.
