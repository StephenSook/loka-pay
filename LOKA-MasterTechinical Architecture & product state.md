# LOKA
## Master Technical Architecture & Product State

**Repository:** `loka`  
**Initial Platform:** Android  
**Second Platform:** iOS  
**Product Category:** Offline-first local communication network  
**Document Version:** 1.0

---

# 1. Product Mission

LOKA is an offline-first communication platform designed to allow people to communicate locally without requiring recurring Internet connectivity, mobile data, or traditional cellular airtime.

The long-term experience should provide familiar communication features:

- Direct messaging
- Group messaging
- Voice notes
- Photos
- File sharing
- Voice calls
- Contacts
- Profiles
- Community communication

The primary difference is the underlying network.

When users are reachable through the LOKA local network, communication should travel directly or through participating local devices rather than requiring Internet infrastructure.

The core promise:

> **No data. Still connected.**

---

# 2. Product Modes

LOKA should eventually support two distinct communication modes.

## LOKA Local

The primary free communication system.

```text
📱 → 📱 → 📱 → 📱
```

Characteristics:

- No mobile data required
- No Internet required for normal local communication
- No airtime required
- Peer-to-peer communication
- Multi-hop mesh where technically possible
- Store-and-forward messaging
- End-to-end encryption

## LOKA Go

Future Internet-enabled communication.

```text
📱
 ↓
Internet
 ↓
LOKA infrastructure
 ↓
Internet
 ↓
📱
```

LOKA Go can eventually provide:

- Communication beyond local mesh coverage
- Internet-based messaging
- Internet voice calls
- Cross-community communication
- Cloud synchronization
- Cloud backup
- Additional premium services

LOKA Local should be proven before LOKA Go is built.

---

# 3. Fundamental Architecture

LOKA separates four responsibilities:

```text
IDENTITY
   ↓
LOKA Backend

COMMUNICATION
   ↓
User Devices

TRANSPORT
   ↓
Local Mesh

SECURITY
   ↓
End-to-End Encryption
```

Principle:

> Cloud for identity.  
> Devices for communication.  
> Mesh for transport.  
> Cryptography for trust.

---

# 4. Repository Architecture

LOKA will use a monorepo.

```text
loka/
│
├── android/
│
├── ios/
│
├── backend/
│
├── protocol/
│
├── dashboard/
│
├── infrastructure/
│
├── security/
│
├── experiments/
│
├── tests/
│
├── docs/
│
└── README.md
```

Android and iOS remain separate native applications.

Shared specifications live outside either application.

---

# 5. Android Stack

Location:

```text
loka/android/
```

Technology:

- Kotlin
- Jetpack Compose
- Kotlin Coroutines
- Room
- SQLite
- Android Keystore
- Native Android Bluetooth APIs
- BLE
- Wi-Fi Aware where supported
- Wi-Fi Direct where appropriate
- Native Android audio APIs
- Opus evaluation for audio

Suggested structure:

```text
android/
├── app/
├── core/
│   ├── identity/
│   ├── crypto/
│   ├── protocol/
│   ├── database/
│   └── diagnostics/
│
├── network/
│   ├── discovery/
│   ├── bluetooth/
│   ├── wifi/
│   ├── transport/
│   ├── mesh/
│   └── routing/
│
├── features/
│   ├── onboarding/
│   ├── contacts/
│   ├── chats/
│   ├── groups/
│   ├── calls/
│   ├── communities/
│   ├── profile/
│   └── settings/
│
└── tests/
```

Android is the first engineering platform.

---

# 6. iOS Stack

Location:

```text
loka/ios/
```

Technology:

- Swift
- SwiftUI
- Apple native persistence
- Keychain
- CryptoKit and/or reviewed cryptographic libraries
- Core Bluetooth
- Apple's supported peer-to-peer/local networking technologies
- Native audio APIs

Suggested structure:

```text
ios/
├── App/
├── Core/
│   ├── Identity/
│   ├── Crypto/
│   ├── Protocol/
│   ├── Database/
│   └── Diagnostics/
│
├── Network/
│   ├── Discovery/
│   ├── Bluetooth/
│   ├── LocalTransport/
│   ├── Mesh/
│   └── Routing/
│
├── Features/
│   ├── Onboarding/
│   ├── Contacts/
│   ├── Chats/
│   ├── Groups/
│   ├── Calls/
│   ├── Communities/
│   ├── Profile/
│   └── Settings/
│
└── Tests/
```

Do not attempt to force Android networking assumptions onto iOS.

Each operating system gets its own native transport implementation.

---

# 7. Shared Protocol

Location:

```text
loka/protocol/
```

This is extremely important.

Android and iOS can have different implementations while speaking the same LOKA protocol.

Store:

```text
protocol/
├── README.md
├── identity/
├── packets/
├── messages/
├── routing/
├── discovery/
├── encryption/
├── groups/
├── calls/
├── versioning/
└── test-vectors/
```

The specification should define:

- Device identity
- User identity
- Packet structure
- Message structure
- Route advertisements
- Delivery receipts
- Group messages
- Encryption envelopes
- Call signaling
- Protocol versions

---

# 8. LOKA Identity

Every person receives a permanent LOKA identity.

Example:

```text
Name:
Pascal Kollie

LOKA Number:
LK-482-918-274
```

The exact format should be determined later.

The important rule:

> The LOKA Number identifies the LOKA account.

The user's mobile phone number does not become their permanent LOKA identity.

---

# 9. LOKA Number

The LOKA Number should be:

- Unique
- Permanent or very difficult to change
- Human-readable
- Easy to share
- Independent from telecom carriers
- Independent from SIM changes
- Independent from phone replacement

Example:

```text
LOKA

Pascal Kollie
@pascal

LK-482-918-274
```

Internally, use a non-guessable canonical account identifier such as a UUID or equivalent.

The friendly LOKA Number is an external identifier.

---

# 10. Phone Number Linking

A user can link their normal mobile number.

Example:

```text
LOKA ACCOUNT

LOKA Number
LK-482-918-274

Recovery Phone
+231 XXX XXX XXX

Status
✓ Verified
```

The phone number can support:

- Account recovery
- Initial verification
- Contact discovery
- Security notifications
- Device registration

It should not be the database primary key.

---

# 11. Why Separate the Two?

A user may:

- Change SIM cards
- Change carriers
- Lose a phone
- Move countries
- Get a new telephone number

Their LOKA identity should survive those events.

Conceptually:

```text
              LOKA ACCOUNT
                   │
          LK-482-918-274
                   │
        ┌──────────┼──────────┐
        ↓          ↓          ↓
      Phone      Device     Identity
      Number       Keys     Verification
```

The phone number is attached to the account.

It does not define the account.

---

# 12. Account Recovery

Potential recovery process:

```text
New phone
   ↓
Install LOKA
   ↓
Recover Account
   ↓
Enter LOKA Number / Phone
   ↓
Verify linked recovery method
   ↓
Additional security challenge
   ↓
Register new device
   ↓
Revoke lost device if requested
```

Phone/SMS alone should not be considered sufficient for high-value future services because SIM-swap attacks exist.

Stronger recovery can later include:

- Recovery codes
- Trusted devices
- Passkeys
- Email
- Identity reverification

---

# 13. Device Identity

Accounts and devices are separate.

Example:

```text
USER

LK-482-918-274
       │
       ├── Android Phone
       │      Device ID A
       │
       ├── Android Tablet
       │      Device ID B
       │
       └── Future iPhone
              Device ID C
```

Every device gets:

- Device ID
- Public/private key material
- Device credential
- Registration state

---

# 14. Cryptographic Device Identity

When a device is registered:

```text
Device
   ↓
Generate keys locally
   ↓
Private key stays protected
   ↓
Public key registered
   ↓
Backend signs device credential
```

Private keys should not leave the device unnecessarily.

Use platform secure storage:

Android:

```text
Android Keystore
```

iOS:

```text
Keychain / Secure Enclave where appropriate
```

---

# 15. Identity Verification Levels

LOKA should support multiple trust levels.

## Level 0 — Device

Basic local device identity.

## Level 1 — Account

Verified recovery phone/email.

## Level 2 — Community

Verified by:

- University
- Employer
- Hospital
- Organization

## Level 3 — Identity Verified

Government-issued identity verification.

## Level 4 — Regulated Services

Additional KYC or regulatory verification where legally required.

Do not require Level 3 simply to send a local message unless product/legal requirements justify it.

---

# 16. Government ID Verification

LOKA should be architected to support identity verification without making raw ID images part of normal account data.

Potential process:

```text
User
 ↓
Identity Verification
 ↓
ID document
 ↓
Document validation
 ↓
Optional selfie/liveness
 ↓
Verification result
 ↓
LOKA
```

LOKA should preferably retain only the minimum information necessary.

Example:

```text
verification_status = VERIFIED
verification_level = GOVERNMENT_ID
country = LR
verified_at = ...
provider_reference = ...
```

Sensitive document retention must have explicit security and legal justification.

---

# 17. Communities

LOKA users can belong to communities.

Examples:

```text
University of Liberia

University of Ghana

JFK Medical Center

Liberia Agro Group

Factory XYZ
```

Community membership can be:

- Public
- Invite-only
- Verified
- Private

---

# 18. Community Identity

Example:

```text
Community:
University of Liberia

Community ID:
LR-UL-001
```

Membership credential:

```text
User:
LK-482-918-274

Community:
LR-UL-001

Role:
STUDENT

Status:
VERIFIED
```

---

# 19. Offline Credentials

Once online verification occurs, the backend can issue signed credentials.

Example concept:

```text
Credential

User ID
LOKA Number
Device ID
Community ID
Public Key
Issued At
Expires At
Capabilities
Issuer
Signature
```

Nearby devices can verify the credential without asking the server every time.

---

# 20. Contact Discovery

With user permission, LOKA can check existing contacts.

Example:

```text
CONTACTS

Mary
🟢 LOKA Local

James
🟡 LOKA user — unreachable

Daniel
Not on LOKA
```

Phone numbers used for matching should receive strong privacy protections.

Do not publicly broadcast raw contact lists or phone numbers through the mesh.

---

# 21. Local Discovery

Nearby LOKA devices discover each other.

Possible mechanisms:

```text
BLE
Wi-Fi Aware
Wi-Fi Direct
Other supported local peer technologies
```

The networking layer must hide these behind abstractions.

---

# 22. Transport Interface

Conceptually:

```text
interface LokaTransport {

    discover()

    advertise()

    connect(peer)

    send(packet)

    receive()

    disconnect()
}
```

Implementations might include:

```text
BleTransport

WifiAwareTransport

WifiDirectTransport
```

Platform implementations can differ.

---

# 23. Peer Table

Each device maintains temporary information about nearby peers.

Example:

```text
Peer ID
Device ID
Community
Transport
Signal
Latency
Last Seen
Capabilities
Route Information
```

This information expires.

---

# 24. Direct Messaging

First communication architecture:

```text
Pascal 📱 ←────────→ 📱 Mary
```

No Internet.

The devices establish a local link.

Messages are end-to-end encrypted.

---

# 25. Multi-Hop Messaging

Next:

```text
Pascal 📱
    ↓
   📱 A
    ↓
   📱 B
    ↓
Mary 📱
```

Intermediate devices forward encrypted packets.

They should not be able to read the conversation.

---

# 26. Packet Protocol

Every LOKA packet should include the minimum routing information required.

Conceptually:

```text
version

packet_id

packet_type

source_route_identifier

destination_route_identifier

ttl

sequence

priority

encrypted_payload

authentication_data
```

Avoid exposing unnecessary identity information to relays.

---

# 27. Routing Engine

The routing engine determines how to reach another device.

Possible paths:

```text
A → B → D → F

A → C → E → F
```

Routes should be evaluated using measurements such as:

- Hop count
- Latency
- Signal
- Packet loss
- Link stability
- Congestion
- Historical reliability

---

# 28. Mesh Reliability Score

The network should calculate internal quality scores.

Example:

```text
Mary

Reachable: YES

Messaging:
Excellent

Voice Note:
Excellent

Calling:
Good
```

Do not expose complicated routing metrics to normal users.

---

# 29. Dynamic Routing

If:

```text
A → B → C → Mary
```

fails because B disappears, LOKA searches for another route.

For example:

```text
A → D → E → Mary
```

The application should automatically recover whenever possible.

---

# 30. Store-and-Forward

Messages should not always require a complete real-time path.

Example:

```text
A
 ↓
B

[network gap]

C
 ↓
D
```

B can securely retain an encrypted message.

When B later encounters C:

```text
B → C
```

the message continues.

Eventually:

```text
C → D
```

delivers it.

This makes LOKA useful even when the mesh is temporarily fragmented.

---

# 31. Message Expiration

Every relayable item needs expiration.

Examples:

```text
Normal message:
7 days

Temporary network packet:
minutes

Emergency alert:
configured separately
```

Exact policies will be determined through testing.

---

# 32. Messaging Features

LOKA should eventually support:

- One-to-one messages
- Replies
- Reactions
- Delivery status
- Read receipts
- Delete locally
- Group conversations
- Voice notes
- Photos
- Documents
- Location sharing with explicit user consent

---

# 33. Photos

Photos can work locally.

Before transmission:

```text
Original Photo
     ↓
Resize if appropriate
     ↓
Compress
     ↓
Encrypt
     ↓
Chunk
     ↓
Transfer
```

Users should be able to choose whether to download larger media automatically.

---

# 34. Video

Video should come later.

Video creates significant:

- Bandwidth
- Battery
- Storage
- Relay congestion

Short videos may eventually be supported with:

- Compression
- Resolution limits
- Chunking
- Local caching
- Selective downloading

Do not make video part of the first mesh MVP.

---

# 35. Voice Notes

Voice notes should precede live calling.

```text
Record
 ↓
Encode
 ↓
Encrypt
 ↓
Chunk
 ↓
Route
 ↓
Reassemble
 ↓
Decrypt
 ↓
Play
```

Evaluate Opus.

---

# 36. Local Voice Calls

Calling architecture:

```text
Microphone
 ↓
Audio capture
 ↓
Codec
 ↓
Encryption
 ↓
Mesh packets
 ↓
Route
 ↓
Jitter buffer
 ↓
Decryption
 ↓
Decoder
 ↓
Speaker
```

Calling requires significantly stronger network conditions than messaging.

---

# 37. Call Quality Decision

Before starting a local call:

```text
Route to Mary
      ↓
Evaluate
      ↓
Latency
Packet loss
Stability
      ↓
Call capable?
```

UI:

```text
Mary
🟢 Local

📞 Free local call
```

If insufficient:

```text
Mary is reachable for messaging,
but the local network isn't strong
enough for a call.

[Send Voice Note]
```

---

# 38. LOKA Local Status

Users should see something simple.

Example:

```text
LOKA

🟢 Local

No data required
```

Possible states:

```text
🟢 Local
🟡 Limited
⚪ No local network
☁️ Go
```

---

# 39. Background Operation

This is a critical research area.

Test:

- Screen on
- Screen off
- App open
- App backgrounded
- Doze
- Battery saver
- Charging
- Different Android vendors

Measurements must determine what is actually sustainable.

---

# 40. Battery Management

Potential modes:

```text
LOKA Relay

Automatic

Maximum Coverage

Battery Saver

Off
```

The application can adjust:

- Scan frequency
- Advertising
- Relay activity
- Wi-Fi usage

based on battery conditions.

---

# 41. Local Database

Android:

```text
Room + SQLite
```

Store:

```text
Users

Contacts

Conversations

Messages

Groups

Pending packets

Relay queue

Peer cache

Route cache

Communities

Credentials

Settings
```

iOS should maintain an equivalent model using appropriate native persistence.

---

# 42. Backend

Location:

```text
loka/backend/
```

Recommended initial stack:

```text
TypeScript
Node.js
PostgreSQL
```

Backend responsibilities:

```text
Accounts

Authentication

LOKA Numbers

Recovery

Phone verification

Devices

Communities

Membership

Credential issuance

Public-key directory

Revocation
```

The backend should not become mandatory for local message transport.

---

# 43. Suggested Backend Modules

```text
backend/
├── auth/
├── users/
├── loka-numbers/
├── phones/
├── devices/
├── communities/
├── memberships/
├── credentials/
├── keys/
├── recovery/
├── verification/
├── notifications/
└── audit/
```

---

# 44. Core Database Entities

Initial server-side entities:

```text
users

loka_numbers

phone_numbers

devices

communities

memberships

identity_verifications

credentials

public_keys

recovery_methods

revoked_devices
```

---

# 45. User Record

Conceptual model:

```text
User

id
loka_number
display_name
username
created_at
status
verification_level
```

Do not make the telephone number the primary key.

---

# 46. Phone Record

Conceptually:

```text
PhoneNumber

id
user_id
encrypted_or_protected_number
normalized_lookup_value
verified
verified_at
recovery_enabled
```

Phone-number handling requires careful privacy design.

---

# 47. Device Record

```text
Device

id
user_id
platform
public_key
credential_status
created_at
last_online
revoked_at
```

---

# 48. Security

Security is a foundational subsystem.

Location:

```text
loka/security/
```

Document:

- Threat model
- Key management
- Device trust
- Account recovery
- Encryption protocol
- Metadata exposure
- Abuse model
- Relay threats
- Lost-device handling

Do not invent proprietary cryptography.

Use established primitives and independently reviewed designs.

---

# 49. End-to-End Encryption

Private communications should eventually include E2EE for:

```text
Messages

Groups

Voice notes

Photos

Files

Calls
```

A relay should see ciphertext.

Example:

```text
Pascal
  ↓
[ENCRYPT]

████████
   ↓
Relay
   ↓
████████
   ↓
Relay
   ↓
████████
   ↓
Mary
  ↓
[DECRYPT]
```

---

# 50. Dedicated LOKA Nodes

Phone-only networking should be tested first.

Later:

```text
📱 → 📡 → 📱 → 📡 → 📱
```

Dedicated LOKA nodes could improve:

- Coverage
- Reliability
- Route stability
- Building penetration
- Availability

Organizations could deploy these across campuses and facilities.

---

# 51. Organization Dashboard

Location:

```text
loka/dashboard/
```

Technology:

```text
Next.js
React
TypeScript
```

This is where React belongs in the initial architecture.

Organizations can eventually:

- Manage communities
- Verify members
- Create official groups
- Send announcements
- Manage nodes
- Review aggregated network health
- Revoke organizational credentials

---

# 52. LOKA Go

LOKA Go should not be built initially.

Future architecture:

```text
LOCAL

📱 → 📱 → 📱
FREE


GO

📱 → Internet → LOKA → Internet → 📱
```

Potential Go services:

- Long-distance messaging
- Internet calling
- Cloud backup
- Cross-community communication
- Multi-device synchronization
- Premium media transfer

LOKA Local remains the foundation.

---

# 53. Future Services

LOKA's identity system can eventually support additional services.

Potential examples:

```text
LOKA
 │
 ├── Communication
 │
 ├── LOKA ID
 │
 ├── Communities
 │
 ├── Marketplace
 │
 ├── Business accounts
 │
 ├── Tickets
 │
 └── Financial services
```

These are future possibilities, not MVP requirements.

Financial and regulated services require separate legal, compliance and security programs.

---

# 54. Development Stages

## Stage 0

Technical research.

## Stage 1

Android peer discovery.

## Stage 2

Direct offline messaging.

## Stage 3

Encryption.

## Stage 4

Three-device relay.

## Stage 5

Dynamic routing.

## Stage 6

Store-and-forward.

## Stage 7

Background reliability.

## Stage 8

Battery optimization.

## Stage 9

10-device mesh.

## Stage 10

LOKA accounts.

## Stage 11

LOKA Numbers.

## Stage 12

Communities.

## Stage 13

Production messaging UI.

## Stage 14

Groups.

## Stage 15

Voice notes.

## Stage 16

Photos/files.

## Stage 17

Local calling.

## Stage 18

Campus pilot.

## Stage 19

Fixed nodes.

## Stage 20

iOS feasibility and implementation.

## Stage 21

LOKA Go.

---

# 55. FIRST DEVELOPMENT MILESTONE

Do not begin with the complete application.

Create:

```text
loka/android/
```

Build a developer application called:

**LOKA Mesh Lab**

Use three physical Android devices.

Configure:

```text
PHONE A
   ↓
PHONE B
   ↓
PHONE C
```

A must not have a direct route to C.

Disable:

```text
Mobile Data
Internet connectivity
```

Keep the required local radios enabled.

A sends:

```text
Hello C
```

B receives ciphertext.

B cannot decrypt it.

B forwards it.

C receives and decrypts:

```text
Hello C
```

C responds:

```text
Hello A
```

through B.

---

# 56. SECOND DEVELOPMENT MILESTONE

Introduce another device:

```text
        B
       / \
      A   C
       \ /
        D
```

Initial:

```text
A → B → C
```

Disable B.

LOKA should discover:

```text
A → D → C
```

and continue delivering messages.

---

# 57. THIRD DEVELOPMENT MILESTONE

Repeat while:

```text
Screens OFF

Apps backgrounded

Devices moving

Battery optimization active
```

Measure what breaks.

Do not hide failures.

Document them.

---

# 58. Engineering Metrics

Every experiment should record:

```text
Discovery time

Connection time

Signal

Transport

Message delivery

Delivery latency

Hop count

Packet loss

Route lifetime

Route recovery

Battery usage

CPU

Device model

Android version
```

This dataset will guide the actual network architecture.

---

# 59. Definition of Technical Success

LOKA has proven its foundational concept when:

1. Android phones discover one another without Internet.
2. Two devices exchange encrypted data.
3. Three devices successfully relay encrypted messages.
4. Intermediate devices cannot read message contents.
5. Messages survive temporary network fragmentation.
6. Alternate routes can be discovered.
7. The system operates acceptably with screens off.
8. Battery consumption is reasonable.
9. The network remains useful with multiple devices.
10. Real-world testing confirms the assumptions.

Only then should major resources move toward polishing calling, iOS and large-scale deployment.

---

# 60. Product UX

The final user should never see:

```text
BLE

RSSI

TTL

Wi-Fi Aware

Route table

Packet loss

Mesh hop
```

They should see:

```text
LOKA

Mary
🟢 Local

No data required

[Message]

[Call]
```

The technology should disappear behind the experience.

---

# 61. Core Product Promise

LOKA should ultimately make this possible:

```text
Pascal
  📱
   │
   ▼
  📱
   │
   ▼
  📡
   │
   ▼
  📱
   │
   ▼
Mary
  📱
```

No mobile data.

No traditional Internet connection.

No airtime charge for the local communication itself.

Encrypted end-to-end.

The user simply sees:

> **Mary — Local**

and communicates.

---

# 62. Engineering Rule

The team must follow one rule throughout development:

> **Prove the network before building the ecosystem.**

LOKA does not become valuable because it has another beautiful messaging interface.

Its fundamental innovation must be the ability to provide useful communication when conventional Internet connectivity is unavailable or undesirable.

Everything else builds on top of that foundation.

---

# 63. Immediate Repository State

The initial repository should therefore begin as:

```text
loka/
│
├── android/
│   └── loka-mesh-lab/
│
├── ios/
│   └── README.md
│
├── backend/
│   └── README.md
│
├── protocol/
│   ├── README.md
│   ├── packet-v0.md
│   └── identity-v0.md
│
├── security/
│   └── threat-model.md
│
├── experiments/
│   ├── EXP-001-direct-discovery.md
│   ├── EXP-002-direct-message.md
│   ├── EXP-003-three-node-relay.md
│   └── EXP-004-background-relay.md
│
├── docs/
│   ├── PRODUCT.md
│   ├── ARCHITECTURE.md
│   └── ROADMAP.md
│
└── README.md
```

The first code written should be inside:

```text
android/loka-mesh-lab/
```

The first major engineering target is:

# A → B → C

Everything else follows from proving that architecture.