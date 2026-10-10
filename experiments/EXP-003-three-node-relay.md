# EXP-003 — Three physical Androids, encrypted relay and destination ACK

Phase 2 acceptance procedure, revised 2026-10-02. Status: **physical test pending**. User requested Phase 2 preparation while Phase 1 remains open; this does not waive authenticated-reconnection acceptance. Production Android MeshNode/MeshEngine forwarding already exists. A software pass or a successful install is not a physical relay pass.

```text
Android A ↔ Android B ↔ Android C
             ciphertext relay
A and C must have no usable direct route.
```

## Hardware and preparation

Use three physical Android phones with compatible LOKA builds (baseline 0.6.7). An emulator or iPhone cannot substitute for an Android in this gate. Label phones A/B/C; record model, OS, version, battery, charging/debugging and timestamps using RESULT-TEMPLATE.md. Export metadata only; use non-sensitive test text. Never reset existing identities or private histories to prepare a run.

Turn off cellular data and remove Internet uplinks, tethering, VPN/upstream and USB networking; keep Bluetooth on. Record how Internet absence was verified. Wi-Fi radio availability and Internet access are separate; future local Wi-Fi runs must keep their required radio active. LOKA backend must not participate.

Establish A–C exclusion by actual placement/shielding and a direct-link negative control, with B stopped, before and after the run. An application allowlist alone demonstrates a controlled topology but does not prove A and C are beyond direct reach; label that preliminary trial accordingly. No fixed separation distance is assumed. Record distances, walls/obstacles and interference conditions.

## Set up the controlled topology

1. On each phone open Settings → Local connection → Engineering tools. Start local connections. Enable Manual BLE topology control for this experiment so unrelated compatible BLE devices cannot become hidden shortcuts. Record initial settings and restore the user's preferred automatic mode after testing.
2. Use the Classic link controls: make phones visible, discover, allow and pair A–B and B–C only. One-time OS pairing and engineering topology consent are setup actions, not evidence of seamless reconnection. Do not allow an A–C link; exclude other connected peers.
3. A and C add each other using their LOKA contact QR codes and verify identities. B need not trust either endpoint and must not be given their private keys. For clean no-contact evidence use consenting test devices; do not delete real contacts just to satisfy the fixture.
4. Connect A–B and B–C from one end of each link. Verify simultaneous link counts **1 / 2 / 1** and exact peer membership in engineering diagnostics. B must hold both links at the same time. Keep all apps foreground for the baseline; background acceptance is separate.
5. Enable B's Forward ciphertext switch. Record clock agreement; use external timing or monotonic sender Send-to-ACK measurements rather than treating packet wall-clock age as precise one-way latency. Declare a delivery timeout before starting (for the baseline, 60 seconds; packets still expire at five minutes).

## Positive trials and receipt semantics

Run 30 fresh short texts A→C and 30 C→A, one outstanding at a time, using unique non-sensitive labels such as P2-A-001. For each attempt record:

- Send time, first destination save/notification observation, authenticated Delivered observation and timeout/failure.
- Sender/destination logical ID and per-hop packet metadata where available; frame ingress/egress on B, hop decrement, transport and connection membership.
- Exactly one destination bubble; B shows forwarding metadata and no plaintext conversation for the test packet.
- Retransmissions, duplicate frames versus duplicate delivered messages, receipt loss and manual actions. A received notification or relay event alone never counts as Delivered.

Only the trusted destination's encrypted signed receipt establishes final delivery. Return traffic must traverse C→B→A (or A→B→C for reverse messages); B cannot generate a valid destination receipt. The software regression tests exercise the actual packet crypto and relay path, including B's inability to decrypt and rejection of a forged relay receipt. Physical logs alone do not establish cryptographic secrecy.

Report attempted/saved/confirmed/duplicate/failure counts separately for each direction, delivery and ACK latency distributions, discovery/setup time and battery start/end with elapsed duration and idle baseline where available. Mark metrics not measured instead of estimating them.

## Negative controls and interruptions

- **Relay disabled:** turn off B's Forward ciphertext; send fresh text and confirm no delivery. This operation drops B's relay queue. Restore forwarding and use a new message for the next positive trial; duplicate caching can prevent the rejected packet being forwarded later.
- **Relay removed:** stop/disconnect B and send a fresh uniquely labeled message. Confirm no direct delivery; inspect A/C for unintended links. If it arrives, topology isolation failed and the run is invalid.
- **Temporary B–C gap:** keep A–B connected, disconnect B–C, send from A, verify retained ciphertext on B, then reconnect within five minutes. Expect one destination message and returning ACK. This is volatile store-and-forward, not durable custody.
- **Expiry:** retain ciphertext while C is absent, wait beyond packet expiry, then reconnect. No delivery or expired resurrection should occur. Use a fresh message afterwards.
- **Relay restart diagnostic:** let B retain a packet with C absent, then disconnect A before restarting B. Reconnect only B–C. The current volatile B queue should not survive. Keeping A connected would allow sender replay and falsely appear to prove durable relay storage. Full durable storage is Phase 4, not a Phase 2 pass condition.

Do not toggle radios, force-stop or restart a participant's personal phone without the tester's control. Preserve all failures and repeat runs after fixes rather than removing failed attempts from the record.

## Acceptance and evidence

Pass requires the isolated physical A–B–C topology, simultaneous links at B, successful bidirectional encrypted destination delivery and authenticated return ACKs, no duplicate bubbles, and the no-shortcut/relay-off controls. Record the 60-trial delivery/confirmation rates and all failures; never label partial success as reliable support. Repeat after correcting failures, retaining previous results. Battery and background performance remain unproven unless separately measured.

Store each run using RESULT-TEMPLATE.md; summarize exact configuration, evidence references, limitations and failures in docs/LOCAL-CALLING-MASTER-SPEC.md and docs/VALIDATION.md. Scope any support claim to the tested configuration. Phase 1 remains independently open; Phase 3 is automatic alternative-route discovery/recovery, not this manually configured topology.
