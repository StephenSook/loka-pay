# EXP-012 — authenticated reconnection acceptance

2026-10-02. Status: planned; no qualifying physical cycles recorded. Implements Phase 1 of [the master specification](../docs/LOCAL-CALLING-MASTER-SPEC.md#phase-1-implementation-audit-and-acceptance-protocol). This is a test procedure, not a supported-capability claim.

## Entry conditions

1. Review and implement a transport-independent authenticated session/reconnect design, including freshness, intended identity binding, replay protection, key change/revocation handling, bounded resource use and compatibility. Changes affecting cryptography require explicit security review. Do not turn the current public probe into an invented cryptographic handshake.
2. Preserve saved contact trust across ordinary disconnection. A radio address, peripheral UUID, display name or service advertisement is not cryptographic identity. A transit relay need not become a friend; do not conflate neighbor-session authentication with permission to deliver private chat content.
3. Record exact app versions, models, OS versions, roles, privacy-safe peer labels, permissions, battery/power state, debugging attachment, connection mode and starting trust state. Use consenting testers and non-sensitive test text only. Never reset real identities or remove private history for a test.
4. Choose and record the discovery/authentication/delivery timeout budgets before running; an indefinite Restoring state is a failure. Current packet expiry is five minutes; use fresh messages and do not extend expiry to hide failed recovery.
5. Remove Internet/cellular uplinks while preserving radios required by that trial. Record offline verification. Starting the app while unlocked is not evidence of locked or suspended execution.

## Proposed 100-cycle matrix

This is a planned allocation, not measured data. Record both message directions and report results by platform/device/lifecycle, not just one aggregate. Unsupported cases remain blocked and do not count as successes. Transport-change trials cannot pass until two eligible transports and the session binding exist; report baseline progress separately rather than marking the whole gate complete.

| Trigger | Cycles | Observation |
| --- | ---: | --- |
| Background → foreground | 15 | Recovery during background versus only after foreground are separate outcomes |
| Lock → unlock | 15 | Record locked delivery/authentication separately from unlock-triggered recovery |
| Leave → return to range | 20 | Physical movement and radio evidence; no manual peer selection |
| Bluetooth off → on | 15 | User's OS toggle is the injected fault; no subsequent app Accept/restart should be required |
| Wi-Fi off → on | 5 | Record active transport; BLE surviving a Wi-Fi toggle does not prove Wi-Fi routing |
| App/process restart | 10 | Distinguish normal relaunch, OS process termination and user force-stop/force-quit |
| Device restart | 10 | Record first unlock and permitted runtime; do not assume pre-unlock operation |
| Transport change | 10 | Same intended identity over another supported local adapter; no new friend approval |
| **Total** | **100** | **0 executed under this procedure** |

## Each cycle

- Establish and record the initial trusted cryptographic identity using the normal consent flow. First-use permissions/verification are not recurring reconnection approvals.
- Inject the scheduled fault, record disappearance and rediscovery timestamps, and observe the automatic session recovery.
- Verify fresh authentication of the expected saved identity for the new session from metadata-only instrumentation. A public probe, matching device name, or an ACK from a distant destination cannot stand in for immediate-neighbor authentication.
- Send fresh uniquely labeled non-sensitive text; observe one saved destination message and its authenticated recipient-save receipt. Reverse direction. Do not infer delivery from GATT acceptance, notification presence or relay storage.
- Record every manual action. The intentional fault and sending test text are allowed; manual reconnection, peer selection or repeated Accept are failures unless a separately established security-state change requires reverification.
- Check that identities/contact trust were not recreated or silently changed. Record latency, retries, duplicates, queue bounds and cleanup. No expired-message resurrection.
- Record failure and evidence even if a later retry passes. Do not restart the counter to discard failures; keep the full attempt ledger and state whether a subsequent clean 100-cycle run is needed after fixes.

## Security negative cases (outside the 100 normal cycles)

Test address rotation with unchanged identity; copied advertisement/name with a different key; replayed authentication; changed key; revoked identity reconnect; stale credentials; malicious transit; connection/packet flooding and Sybil identities. Unknown or revoked peers must never inherit friend trust. Document expected versus actual policy for an untrusted relay separately. Do not label successful relay admission as authorized private-message delivery.

## Result ledger

Use one row per physical attempt in an accompanying result file; do not prepopulate success rows.

`attempt_id, timestamp_with_timezone, build, device_pair, os_versions, trigger, lifecycle, transport_before, transport_after, intended_identity_label, discovery_ms, authentication_ms, message_delivery_ms, ack_ms, retries, duplicates, manual_approvals, other_manual_actions, trust_preserved, auth_evidence_ref, packet_metadata_ref, result, failure_category`

Use unknown/not measured for absent observations. Failure category: LOKA bug / documented OS restriction / device-specific / transport limitation / unclassified. A suspected cause stays unclassified until isolated with evidence. Use monotonic timing for durations; report clock uncertainty for cross-device timing.

Record battery/idle comparison, useful concurrent-peer counts and lifecycle durations in [RESULT-TEMPLATE](RESULT-TEMPLATE.md) when measured. Link every result summary, decision, limitation and failure back into the master specification. No raw private message contents, private keys or address books belong in diagnostic artifacts.

## Exit decision

Pass requires a documented reviewed authentication design, the complete physical 100-cycle matrix with zero unnecessary approvals, correct identity/security behavior, and fresh bidirectional destination-save receipts within the declared budgets. Scope support to the exact tested configuration. If hardware, an adapter, or authenticated session implementation is missing, keep the applicable rows blocked and the phase open. Software unit tests and app installations do not count as physical cycles.
