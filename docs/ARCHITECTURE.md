# LOKA architecture and implementation state

Repository engineering requirements live in [AGENTS.md](../AGENTS.md). The [Wi-Fi radio engineering note](WIFI-RADIO-VS-INTERNET.md) and [implementation audit](LOCAL-NETWORKING-AUDIT.md) define the distinction between local radio links and Internet connectivity. The [offline networking research assessment](OFFLINE-NETWORKING-RESEARCH.md) compares current platform capabilities and records physical evidence gates. Read these documents and the relevant protocol, security, and experiment documents before architectural changes.

## System boundaries

| Layer | Responsibility | Local operation depends on it? | Current state |
| --- | --- | --- | --- |
| LOKA Local | Discovery, local links, encrypted messages, relaying, local queues | This is the local communication plane | Experimental Android Mesh Lab |
| LOKA Cloud | Accounts, identity, recovery, credentials, revocation, optional encrypted-backup metadata/storage | No online dependency for ordinary local message delivery | Deferred |
| LOKA Go | Internet-based communication beyond local reach | No | Deferred |
| LOKA Gateway | Connect a local network to external Internet or future satellite backhaul | No | Deferred |

Cloud is the control plane. Devices form the local communication plane. Previously provisioned credentials may be verified locally under a future expiry/revocation policy; their lifecycle must not silently introduce a server request on every local delivery.

The proposed [optional Internet gateway requirements](INTERNET-GATEWAY-REQUIREMENTS.md) define volunteer data sharing, remote discovery, encrypted mailbox delivery and return receipts. This is an implementation specification; Go/Gateway remain unimplemented.

Local Wi-Fi radio communication does not imply Internet access. Transport implementations may use BLE, Wi-Fi Aware, Wi-Fi Direct, or other supported local technologies without involving Cloud, Go, or Gateway.

The future route-selection policy is local first: use a suitable local route when available; otherwise consider an available external route subject to user policy and cost; otherwise queue encrypted data for store-and-forward. Satellite belongs to external backhaul and is outside the initial implementation. No external routing or cost-selection logic exists in the lab.

Account identity and device identity remain separate. Future accounts use an immutable internal ID, a public LOKA Number, optional username, and linked recovery methods. Phone numbers are not account primary keys. See [recovery and backup boundaries](RECOVERY-AND-BACKUP.md).

## Implemented lab

```text
Compose messaging preview + engineering tools / runtime permissions / explicit public-key trust
    ↓
LabViewModel: StateFlow, bounded diagnostics, trust preferences
    ↓
MeshNode → MeshEngine (pure Kotlin): validation, deduplication, flooding, ephemeral queues
    ↓
LokaTransport contract → selected native local transport
    ↓
Native Android Bluetooth radio
```

`core` contains the wire codec, lab crypto, synchronous serialized mesh engine, `MeshNode` orchestration, and the local `LokaTransport` contract. It has no Android dependency and uses JVM integration tests to simulate topology/partitions. Android uses Keystore-backed identity; tests supply regular JCA key pairs to exercise identical envelope operations.

`app` contains Compose screens, AndroidViewModel lifecycle, Bluetooth discovery/paired-device listing, link allowlisting, bounded stream framing, trust import, and Storage Access Framework diagnostics export. Blocking connect/read/write operations run on coroutine IO dispatchers. Connected sockets close on disconnect/stop; ViewModel ownership survives configuration changes. As of 0.6.0, the Application owns messaging and a user-started connected-device foreground service keeps the local session active with a visible Off action; OS restrictions still apply.

`LokaApplication` selects an `AndroidTransportProvider` at the Android composition boundary. The provider supplies runtime permissions, visibility-dialog intent, setup labels, and a transport factory. `LabViewModel` and the Compose UI use provider contracts and transport capabilities, with no direct Bluetooth API dependencies. The lab now composes the Classic baseline with an experimental Android BLE GATT peripheral for iPhone link diagnostics. Neither adapter is production-proven. This is a first transport baseline, not a Bluetooth-only product architecture or a choice that excludes Wi-Fi. A small local manager dispatches Classic and BLE links behind the same contract with `ble:`-scoped handles. Wi-Fi handoff, failure isolation and simultaneous-radio feasibility still require implementation and hardware evidence.

`MeshNode` wires transport peer/link/frame/lifecycle callbacks into `MeshEngine`. Transport peer handles are opaque link identifiers, distinct from cryptographic device fingerprints and account identities. Optional discovery, peer preparation, and visibility capabilities determine which lab controls are available. Unsupported optional operations fail explicitly.

Bluetooth startup cleans up partially acquired resources on failure. Listener failure or radio shutdown closes links and updates running status. Connection attachment checks the current listener generation, and stale read/write failures remove only their own socket; they cannot disconnect a replacement link. These lifecycle fixes still need physical reconnect testing.

Transport: Bluetooth Classic RFCOMM is the first measurable baseline; physical evidence is still pending in [EXP-001](../experiments/EXP-001-direct-discovery.md) through [EXP-003](../experiments/EXP-003-three-node-relay.md). Android BLE GATT advertising/peripheral links are implemented for iPhone diagnostics but physically unproven; Wi-Fi remains future work. Pairing is required. Allowlisting incoming and outgoing links prevents accidental A–C shortcuts during relay tests.

Persistence: public-key trust, local contact labels, and the local display name (SharedPreferences), plus private identity (Keystore). Chat history now uses app-private SQLite with AES-GCM encrypted payloads and a separate Android Keystore key. Durable relay queues/replay storage remain future work; Room may be introduced with that design. No backend code is required for lab identity.

The native preview adds Chats, Network, Settings, and a conversation screen. `LabViewModel` keeps a bounded list of 5,000 typed chat messages loaded from encrypted local history, grouped by cryptographic sender/recipient ID; the lab also retains its bounded legacy received-message view. Outgoing messages are added only after encryption/queueing succeeds, and the draft clears only after that success. No delivery/read ticks, generated contacts, account registration or calling are implied. History persists independently of ephemeral network queues. Manual encrypted backup/restore is implemented through Android document providers, with independent recovery keys and no trust or identity restoration; see [backup boundaries](RECOVERY-AND-BACKUP.md). Public-key trust remains explicit, with full-code comparison before importing QR/contact-link identities. The consumer interface hides raw keys and radio device names; engineering tools retain manual controls. Versioned contact links package public device keys without modifying the message envelope. See [contacts and discovery](CONTACTS-AND-DISCOVERY.md) for planned verified number lookup and anonymous LOKA-only discovery. Names are local labels and are not authenticated public profile claims.

Startup errors are surfaced as snackbars rather than buried in diagnostics. A listening lab with zero links means no nearby connection has been established; it is not a ready conversation or confirmed recipient route.

Security and current metadata limitations are specified in `security/threat-model.md` and `protocol`. No production or hardware success is inferred from unit tests.

## Gaps against the required architecture

- A minimal Classic/BLE manager is implemented, but provider failure coordination, authenticated discovery/handoff, Wi-Fi adapters and physical simultaneous-link proof remain missing. Investigate Wi-Fi Aware/Direct and radio coexistence in [EXP-006](../experiments/EXP-006-local-wifi-feasibility.md); determine roles from measurements.
- The v0 packet documentation and codec still depend on Java serialization conventions. Define a language-neutral byte contract and shared test vectors before another platform implements it. Evaluate Protocol Buffers, including how signatures bind bytes, before selecting a future wire version.
- Relay queues have bounds, expiry, duplicate checks, and ciphertext-only payloads, but are in memory. Durable storage requires Room, storage quotas, cleanup, restart tests, and reviewed protection for keys and replay state.
- The lab's cryptographic envelope has not received independent security review. Changes affecting cryptography require explicit security review, including changes to signed serialization and backup key handling. Existing automated tests are not that review.
- No physical relay, alternate-route, background-reliability, or battery gate has passed. See [validation evidence](VALIDATION.md); proposed architecture must not be presented as experimentally proven.

## Android reference decisions

The Classic baseline follows Android's [paired-device discovery guidance](https://developer.android.com/develop/connectivity/bluetooth/find-bluetooth-devices) and [runtime Bluetooth permissions](https://developer.android.com/develop/connectivity/bluetooth/bt-permissions). The explicit OAEP parameters follow the documented [Android Keystore MGF1 digest behavior](https://developer.android.com/privacy-and-security/cryptography).


## iPhone link diagnostic

The SwiftUI iPhone preview now includes real Core Bluetooth central discovery, GATT connection and a public two-way diagnostic marker. It now also has a native Keychain identity, Android-compatible public QR/link exchange, camera/image scanning, and explicitly verified contacts. It now has the experimental v0 packet engine and chat UI after the user requested non-sensitive two-platform core-network testing; see [the exact review and scope](../security/IOS-V0-COMPATIBILITY-REVIEW.md). The app owns its foreground transport across tab changes. As of 0.6.0 both endpoints save encrypted history and their own bounded outgoing ciphertext. Relay persistence remains unimplemented. iPhone private operations defer until unlock; verified locked ciphertext has a bounded local inbox. A successful public BLE probe would not satisfy encrypted messaging or mesh gates.


## Additional transport-independent protocol requirement

The [supplied note](TRANSPORT-INDEPENDENT-PROTOCOL-NOTE.md) reinforces the existing packet/mesh/transport boundaries. Android and Swift carry the same signed encrypted v0 packet bytes through injected frame transports; a radio connection never grants sender trust. BLE approval/readiness fixes do not change packet fields, cryptography or require a backend. The note's illustrative LOKA/1 schema, mixed-radio hops, authenticated capability negotiation, version negotiation, route scoring and delivery ACK are future work; v0 still rejects unsupported versions rather than negotiating. No Wi-Fi or Go implementation is implied.

## Application content and notifications (0.6.0)

[Chat content v1](../protocol/CHAT-CONTENT-V1.md) adds encrypted typed text, bounded AAC voice fragments and recipient-save receipts inside unchanged v0 packets. Both platforms share canonical vectors and enforce recipient-bound receipt acceptance. Notifications and replies use this same local queue; APNs/FCM and a backend are not required. No hop, distance, read or percentage progress is invented. See [security review](../security/CHAT-NOTIFICATIONS-REVIEW.md), [validation](VALIDATION.md) and [EXP-009](../experiments/EXP-009-voice-notifications.md).
