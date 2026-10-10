# LOKA AI ENGINEERING INSTRUCTIONS

You are working on **LOKA**, an offline-first communication platform.

Before implementing architectural changes, read the relevant documents under `/docs`.

The primary product principle is:

> Local communication should not depend on Internet access whenever a technically viable local LOKA route exists.

## Core Architecture

LOKA has multiple communication layers:

```text
LOKA
  │
  ├── LOKA LOCAL
  │     └── Device-to-device local communication
  │
  ├── LOKA CLOUD
  │     └── Identity, recovery, encrypted backup
  │
  ├── LOKA GO
  │     └── Internet-based communication
  │
  └── LOKA GATEWAY
        └── External backhaul such as Internet or satellite
```

These systems MUST remain logically separated.

---


# Local Networking

LOKA Local is the core technology.

Potential transports include:

- Bluetooth Low Energy
- Wi-Fi Aware
- Wi-Fi Direct
- Other supported peer-to-peer technologies

Do not assume Wi-Fi means Internet.

Local Wi-Fi radio communication may occur without Internet access.

The networking architecture must use a transport abstraction.

Conceptually:

```text
Application
     ↓
Messaging / Calls / Media
     ↓
Encryption
     ↓
Routing
     ↓
Mesh
     ↓
Transport
     ↓
BLE / Wi-Fi / Future Transport
```

Application code MUST NOT depend directly on one transport technology.

---

# Routing

The routing system must eventually support:

```text
A → B

A → B → C

A → B → C → D
```

Intermediate devices act as relays.

Relays MUST NOT need access to plaintext message content.

Routes may be evaluated using:

- Signal quality
- Latency
- Packet loss
- Hop count
- Stability
- Congestion
- Battery conditions
- Historical reliability

Do not optimize routing prematurely.

First prove basic relay behavior.

---

# Store-and-Forward

LOKA must support delay-tolerant messaging.

Example:

```text
A → B

C unavailable

Later:

B → C
```

Encrypted messages may be temporarily retained by relay nodes.

Relay storage must have:

- Size limits
- Expiration
- Duplicate protection
- Encryption
- Cleanup policies

---

# Internet Independence

Normal local communication MUST NOT require the LOKA backend.

The backend is the control plane.

The mesh is the local communication plane.

Example:

```text
Internet unavailable

A → B → C

Messaging should continue.
```

---

# Loka Identity

Every user receives:

1. Internal immutable account identifier.
2. Public Loka Number.
3. Optional username.
4. Linked recovery methods.

Example:

```text
Internal ID:
UUID

Public identity:
LK-482-918-274

Username:
@pascal
```

The user's telephone number MUST NOT be the primary account identifier.

---

# Phone Numbers

A phone number may be linked to a Loka account for:

- Verification
- Account recovery
- Contact discovery
- Security notifications

Changing phone numbers should NOT change the user's Loka identity.

---

# Devices

Users and devices are separate entities.

```text
LOKA ACCOUNT
     │
     ├── Android Device A
     ├── Android Device B
     └── iOS Device C
```

Each device should have its own cryptographic identity.

Private key material should remain protected by platform security mechanisms.

---

# Account Recovery

Account recovery and message-history recovery are separate security domains.

Recovering a Loka account does NOT automatically grant access to encrypted historical backups.

Do not design recovery around SMS alone.

Architecture should allow:

- Phone verification
- Passkeys
- Recovery codes
- Trusted devices
- Additional identity verification

---

# Backup

LOKA supports optional encrypted backups.

Possible providers:

```text
Google Drive
iCloud
LOKA Cloud
```

LOKA Local MUST function without cloud backup.

Backup pipeline:

```text
Local Data
   ↓
Prepare Backup
   ↓
Encrypt On Device
   ↓
Encrypted Archive
   ↓
Cloud Provider
```

Never intentionally upload plaintext private conversation history as a backup.

---

# Backup Keys

Backup encryption keys must be protected separately from ordinary account authentication.

A compromised phone number should not automatically expose conversation history.

---

# Android

Android is the FIRST implementation platform.

Stack:

```text
Kotlin
Jetpack Compose
Coroutines / Flow
Room
SQLite
Android Keystore
Native Bluetooth APIs
Native Wi-Fi APIs
Native Audio APIs
```

Evaluate Opus for audio.

Do not use React Native for the Android application unless an architectural decision explicitly changes this requirement.

---

# iOS

The repository contains an iOS application structure from the beginning.

Stack:

```text
Swift
SwiftUI
Keychain
Native networking APIs
Native Bluetooth APIs
Native audio APIs
```

Do NOT assume Android networking behavior will work identically on iOS.

Platform-specific limitations must be tested.

Android mesh feasibility comes first.

---

# Backend

Backend stack:

```text
TypeScript
Node.js
NestJS
PostgreSQL
```

Redis may be introduced where justified.

Start as a modular monolith.

Do not prematurely create microservices.

Backend responsibilities include:

- Accounts
- Authentication
- Loka Numbers
- Recovery
- Devices
- Communities
- Membership
- Credential issuance
- Key directory
- Revocation
- Verification
- Backup metadata

Ordinary Loka Local messages should not require backend delivery.

---

# Web Dashboard

Stack:

```text
Next.js
React
TypeScript
```

This dashboard is intended for organizations such as:

- Universities
- Hospitals
- Businesses
- Factories
- Communities

---

# Protocol

The LOKA protocol must remain platform independent.

Android and iOS implementations must follow the same protocol specification.

Evaluate Protocol Buffers for compact binary serialization.

Protocol specifications belong under:

```text
/protocol
```

Do not allow Android-specific implementation details to become the protocol specification.

---

# Security

Never invent cryptographic algorithms.

Use established cryptographic primitives and reviewed protocol designs.

Security architecture must consider:

- End-to-end encryption
- Device identity
- Device compromise
- Lost devices
- Relay attacks
- Replay attacks
- Duplicate packets
- Account takeover
- SIM swapping
- Metadata exposure
- Malicious mesh participants
- Key rotation
- Device revocation
- Backup compromise

Changes affecting cryptography require explicit security review.

---

# Satellite

Satellite is NOT part of the first LOKA implementation.

However, the architecture must not prevent future satellite integration.

Satellite should generally be treated as **backhaul**, not as the core local mesh.

Example:

```text
LOCAL COMMUNITY

📱 → 📱 → 📱
          ↓
     LOKA GATEWAY
          ↓
      Satellite
          ↓
      Internet
          ↓
     LOKA Network
```

A future Loka Gateway may have:

```text
Local mesh interface
+
Internet backhaul
+
Satellite backhaul
```

The application should not care which external backhaul transported a remote message.

---

# Future Routing Model

Eventually:

```text
Message
   ↓
Destination Resolution
   ↓
Can destination be reached locally?

YES
 ↓
LOKA LOCAL

NO
 ↓
External route available?

YES
 ↓
LOKA GO / GATEWAY
   ↓
Internet or Satellite

NO
 ↓
Queue message
   ↓
Store-and-forward
```

---

# Cost Awareness

Future routing should be capable of distinguishing:

```text
Local Mesh
Low/zero infrastructure cost

Internet
External connectivity

Satellite
Potentially expensive backhaul
```

Do not route local traffic through expensive external infrastructure when a suitable local route exists.

---

# Development Priority

Do NOT attempt to build the entire platform immediately.

The first objective is:

```text
A → B → C
```

Three physical Android phones.

No Internet.

A cannot directly communicate with C.

B must relay an encrypted message.

Test message:

```text
A:
Hello C
```

Expected:

```text
B:
Receives ciphertext.
Cannot decrypt.
Forwards packet.

C:
Receives packet.
Decrypts:
Hello C
```

---

# Second Objective

Add another route:

```text
        B
       / \
      A   C
       \ /
        D
```

Initially:

```text
A → B → C
```

Remove B.

System should eventually discover:

```text
A → D → C
```

---

# Third Objective

Repeat tests with:

- Screen off
- Application backgrounded
- Battery saver
- Devices moving
- Different Android versions
- Different manufacturers

Record failures.

Do NOT hide technical failures with UI behavior.

---

# Engineering Experiments

Every important mesh assumption must be proven experimentally.

Store experiments under:

```text
/experiments
```

Record:

- Hardware
- OS
- Transport
- Distance
- Discovery time
- Connection time
- Delivery rate
- Latency
- Hop count
- Packet loss
- Route recovery
- Battery consumption
- Failure conditions

Architecture decisions should reference experimental evidence whenever possible.

---

# Things NOT To Build First

Do not prioritize:

- Blockchain
- Cryptocurrency
- Payments
- Marketplace
- Social feed
- AI features
- Video calls
- Nationwide mesh
- Satellite integration
- Loka Go
- Complex cloud synchronization
- Custom hardware

These may be future capabilities.

They must not distract from proving the local communication system.

---

# First Technical Gate

LOKA should not proceed to large-scale product development until the engineering team can demonstrate:

```text
Internet OFF

A 📱
  ↓
B 📱
  ↓
C 📱

Encrypted message delivered.
```

Then:

```text
Primary route fails.

Alternative route discovered.

Message still delivered.
```

Then:

```text
Screens OFF.

Background operation.

Acceptable reliability and battery usage.
```

---

# Engineering Philosophy

Do not assume something works because documentation says it should.

Test it on physical hardware.

Do not optimize before measuring.

Do not build cloud dependencies into functionality intended to work locally.

Do not expose mesh complexity to ordinary users.

The user should see:

```text
Mary

🟢 Local
No data required

[Message] [Call]
```

not:

```text
BLE RSSI -72
TTL 4
Wi-Fi Aware
3 hops
```

The complexity belongs inside LOKA.

---

# Primary Product Principle

When making an architectural decision, ask:

> Can this continue working locally if the Internet disappears?

If yes, keep that capability in the local architecture.

If Internet is fundamentally required, place it in the cloud, Go, gateway or backup layer.

LOKA's long-term goal is:

> **Local when possible. External connectivity when necessary.**

# Local Radio Engineering Note

Before changing discovery, transport, routing, connectivity status, or offline experiments, read [Wi-Fi Radio vs. Internet Connectivity](docs/WIFI-RADIO-VS-INTERNET.md) and the [implementation audit](docs/LOCAL-NETWORKING-AUDIT.md).

- Wi-Fi radio availability, local peer reachability, and Internet reachability are distinct states. Do not gate local messaging on Internet validation or a backend health check.
- Allow Bluetooth/BLE and local Wi-Fi to cooperate. Their discovery, control, and payload roles must be measured on hardware, not hard-coded as a universal division. The current single-provider lab does not yet implement concurrent radio management.
- Keep the messaging/routing boundary radio independent. Add a local transport manager behind that boundary when introducing multiple providers; keep external Go/Gateway routing logically separate.
- For offline proof, disable mobile data and remove Internet uplinks while preserving the local radios needed for the experiment. A Wi-Fi-off experiment cannot validate local Wi-Fi delivery.
- “No data required” means no cellular/mobile data or Internet connection is needed for a locally deliverable message. Local radios still transmit bytes and consume energy.
- Do not use absence of Android's `INTERNET` permission as a permanent architecture rule or substitute for offline route tests: local Wi-Fi sockets can require that permission. Scope sockets to the intended local network/interface using the chosen API and verify the packet path on hardware.


# Offline Networking Research Gate

Before proposing a production networking architecture or changing discovery, radio selection, background operation, forwarding durability, or route selection, read the [supplied offline research brief](docs/OFFLINE-NETWORKING-RESEARCH-BRIEF.md) and [primary-source assessment](docs/OFFLINE-NETWORKING-RESEARCH.md).

- Separate documented platform facts, software test evidence, physical results, assumptions and proposals. Verify evolving platform APIs against current primary sources.
- Ordinary local discovery/delivery must not require cellular data, Internet, a traditional router or a cloud delivery server. Local radio permissions and first-use system pairing remain platform requirements.
- Preserve Android-first physical relay, automatic alternate-route and background/screen-off gates. UI and simulator success do not pass them. Do not claim reliable multi-hop smartphone mesh before realistic hardware proof.
- Treat BLE/Wi-Fi role division, interoperability, maximum peers, range, throughput and voice hop count as measurements to obtain. Do not promise automatic silent pairing or perpetual background relay from API availability.
- Use bounded storage/replication, expiry and duplicate controls; never broadcast messages indefinitely. Distinguish retained ciphertext, transport acceptance and authenticated destination delivery.
- Keep HaLow, LoRa and Thread dedicated-node research separate from native smartphone capabilities. Cryptography changes still require explicit security review.

# Seamless Contact Experience

Before changing onboarding, contacts, nearby identity, reachability labels or calling, read [the additional product requirement](docs/SEAMLESS-CONTACT-EXPERIENCE.md) and [the implementation status](docs/CONTACTS-AND-DISCOVERY.md). The user chooses the person; LOKA chooses the network. Preserve anonymous discovery, explicit trust verification and honest capability status. Do not upload a plaintext address book or label a discovered radio device as a reachable friend.

# Transport-independent message protocol

Read [the additional protocol/routing note](docs/TRANSPORT-INDEPENDENT-PROTOCOL-NOTE.md) before changing packet schemas, capability negotiation or handoff. Keep message identity, ciphertext and authentication independent of radio/platform. Preserve exact v0 interoperability until a reviewed wire-version migration is specified. Capability/version negotiation, route scoring and authenticated delivery receipts are proposals until implemented and measured. Keep Go/Gateway separate from local delivery.
