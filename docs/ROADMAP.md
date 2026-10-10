# Engineering roadmap

The [integrated research, quality and calling specification](LOCAL-CALLING-MASTER-SPEC.md) combines research and implementation into one LOKA project. It maps sources to code gaps and [EXP-011](../experiments/EXP-011-quality-routing-adaptive-voice.md), after the physical delivery/relay gates below. For current native Android/iOS behavior use the dated [cross-platform audit](CROSS-PLATFORM-MESH-AUDIT.md); older scaffold-only milestones below are historical. Research does not establish call support.

## Current implementation

The Mesh Lab source implements discovery, direct and relayed encrypted text, explicit topology control, limited in-memory partition replay, and diagnostics. Completion of the code is not completion of the hardware milestone. [AGENTS.md](../AGENTS.md) defines engineering requirements; [architecture gaps](ARCHITECTURE.md) and [validation evidence](VALIDATION.md) define the current state.

## Controlling implementation sequence

Follow the 18 phases in [LOCAL-CALLING-MASTER-SPEC](LOCAL-CALLING-MASTER-SPEC.md#required-implementation-order--controlling-sequence). Phase 1 is authenticated automatic reconnection, with 100 physical cycles and zero unnecessary approvals; the [EXP-012 procedure](../experiments/EXP-012-authenticated-reconnection.md) distinguishes public link readiness from peer authentication. This supersedes older ordering below. Current one-peer iOS code is not a platform limit; iPhone relay capability remains an experiment.

## Earlier technical gates (still required after Phase 1)

1. **Three phones, Internet off:** execute [EXP-001](../experiments/EXP-001-direct-discovery.md), [EXP-002](../experiments/EXP-002-direct-message.md), and [EXP-003](../experiments/EXP-003-three-node-relay.md). A cannot link directly to C; B forwards ciphertext; C decrypts and replies. Fix hardware, Keystore, and simultaneous-link failures first.
2. **Alternate route after failure:** use [EXP-005](../experiments/EXP-005-alternate-route.md) with A–B–C and A–D–C. Add the required link recovery, authenticated delivery receipts, and bounded retransmission based on observed failures. Preconnected flooding does not demonstrate automatic discovery of a missing route. Changes affecting cryptography require explicit security review.
3. **Background reliability and battery:** execute [EXP-004](../experiments/EXP-004-background-relay.md) across screen-off, Doze, battery saver, movement, Android versions, and vendors. Define acceptable measured budgets and a visible, user-controlled relay service before claiming background support.

Do not advance to large-scale product development until these gates have experimental evidence. Record failures and unmeasured metrics explicitly.

## Supporting work after the foreground baseline

- The application-to-transport boundary is implemented with an injected `MeshNode`/`LokaTransport` contract and Android provider. Validate the Bluetooth baseline on hardware before adding BLE or Wi-Fi implementations. Keep OS-specific radio and permission logic in providers; local Wi-Fi does not require Internet. Add a local transport manager for cooperating providers and investigate Wi-Fi Aware/Direct, BLE discovery/control, and radio coexistence using [EXP-006](../experiments/EXP-006-local-wifi-feasibility.md). The role of each radio depends on physical evidence; the long-term architecture is not Bluetooth-only.
- Add Room-backed ciphertext relay queues with byte/item quotas, expiration, duplicate/replay protection, cleanup, and restart tests. Include storage and key-protection review.
- Define a platform-independent wire specification and shared test vectors. Evaluate Protocol Buffers before freezing a future version; review changes to cryptographic serialization.
- Measure four-node and then ten-node delivery, link lifetime, loss, congestion, and power before optimizing route scores.
- Select and explicitly review the production E2EE protocol, key rotation, credentials, and revocation design before consumer deployment.

## Deferred product systems

- Cloud identity: TypeScript, Node.js, NestJS, PostgreSQL modular monolith. Add Redis only with a concrete need. Accounts, LOKA Numbers, recovery, device credentials, communities, and backup metadata must not become online delivery dependencies for Local.
- Backup: optional archives encrypted on device, with keys separate from account recovery. See [recovery and backup boundaries](RECOVERY-AND-BACKUP.md).
- Dashboard: Next.js, React, TypeScript for organizations.
- Native iOS: keep a repository scaffold now; test Apple networking independently after Android feasibility. Share protocol specifications, not Android transport assumptions.
- Messaging product: groups, voice notes, photos/files, then calling as measured network conditions permit. Evaluate Opus for audio.
- Go and Gateway: future external connectivity with local-first, cost-aware route policy. Satellite is possible gateway backhaul, not initial mesh work.

Payments, cryptocurrency, marketplaces, social feeds, AI features, video calls, nationwide mesh, complex synchronization, and custom hardware remain outside the initial engineering priorities.
