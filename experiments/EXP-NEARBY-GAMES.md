# EXP-NEARBY-GAMES — two-device untimed quiz, no Internet

Status: physical game proof pending. Automated tests are recorded separately in docs/NEARBY-GAMES.md. Prior chat relay results do not pass this experiment.

Record hardware, OS/build, app build, actual route/interface, radio/Internet controls, distance, session/pack identifiers, invitation latency, acceptance/snapshot latency, answer-to-commit and commit-to-applied-ACK latency, revisions, scores, retries and failures. Use synthetic quiz answers; do not export private chats/keys.

1. Install both new builds without clearing existing identity/contact data. Verify the other player through LOKA's existing contact flow. Nearby discovery alone does not authorize a player.
2. Disable cellular data and remove Internet uplinks on both phones while preserving the radios needed for the actual local route. Disable USB/network sharing, VPN or hotspot uplinks as applicable. A local shared LAN without a WAN is a useful control, not proof of phone-only discovery. A Wi-Fi-off run cannot prove Wi-Fi delivery.
3. Open Play on host, invite the verified peer. Accept on guest. Verify matching pack hash, session and revision zero on both. Record actual transport from engineering evidence, without inserting radio controls into the game UI.
4. Answer ten alternating questions and compare final scores. Measure synchronization latency and record timeouts honestly. Send ordinary synthetic chat traffic and verify chat delivery/receipt progress while playing.
5. Interrupt the route after a guest submits an answer, before its commit/ACK reaches the other phone. Reconnect and tap Resume / sync. Repeat with app termination/reopen. The saved answer must be confirmed or resubmitted with its original action UUID; revisions/scores must never advance twice.
6. Repeat with interruption longer than 120 seconds, a lost ACK, host disconnection, invitation rejection and expiration. Host loss pauses; no replacement host is promised. End/Leave stops the session.
7. If existing carrier authorization permits a relayed path, repeat while excluding a direct endpoint route. Relays must not decrypt game content. Record delays as turn-based delayed delivery, not real-time play.

Foreground success is not screen-off/background proof. Later background, manufacturer, battery and route-failover experiments remain separate gates. Record failures and uncertainty rather than inferred success.

Available hardware inspected during implementation: Android emulator only; iPhone SE (3rd generation) and iPad Air (5th generation) connected. Physical Android availability and Apple Internet-isolation confirmation remain outstanding; no offline game latency or successful hardware synchronization has been measured for this change.
