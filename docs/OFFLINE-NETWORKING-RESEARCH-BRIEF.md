# LOKA Offline Networking Research

We are building **LOKA**, an offline-first communication platform.

The core requirement is:

> LOKA users should be able to discover, message, relay messages, and eventually make voice calls locally without requiring cellular data, an Internet connection, a traditional Wi-Fi router, or a cloud server.

Do not assume a technology works simply because documentation says peer-to-peer communication is supported. We need evidence from current Android/iOS documentation and, where possible, physical-device testing.

## Primary Research Question

Determine the best combination of technologies for building a reliable local communication network between smartphones.

Our target architecture is:

```text
Phone A
   ↓
Phone B
   ↓
Phone C
   ↓
Phone D
```

Phone A may not be able to communicate directly with Phone D.

Intermediate LOKA devices should be capable of forwarding encrypted packets.

Internet connectivity must NOT be required.

---

# Technologies to Investigate

Research and compare:

### Bluetooth

- Bluetooth Low Energy
- BLE advertising
- BLE scanning
- Extended Advertising
- Periodic Advertising
- BLE GATT
- BLE L2CAP Connection-Oriented Channels
- background BLE behavior
- device-to-device communication

Determine:

- practical range
- bandwidth
- latency
- discovery speed
- power consumption
- maximum useful peer count
- background restrictions
- screen-off behavior
- Android limitations
- iOS limitations

---

# Wi-Fi Aware / NAN

Determine whether nearby devices can:

```text
discover
    ↓
connect
    ↓
exchange LOKA packets
```

without:

```text
Internet
router
access point
cellular service
```

Investigate:

- Android device support
- hardware compatibility
- range
- bandwidth
- latency
- background behavior
- peer limits
- battery consumption
- security
- connection lifecycle

Determine whether Wi-Fi Aware could become LOKA's primary high-bandwidth local transport.

---

# Wi-Fi Direct

Investigate:

- discovery
- peer-to-peer connections
- group-owner architecture
- connection establishment time
- automatic/repeated connections
- bandwidth
- range
- background operation
- Android restrictions
- scalability

Determine whether Wi-Fi Direct is appropriate for:

```text
messages
photos
files
voice notes
live audio
```

---

# Bluetooth + Wi-Fi Hybrid

Investigate an architecture where BLE handles:

```text
discovery
presence
route announcements
small control packets
```

while local Wi-Fi handles:

```text
message transfer
photos
files
voice notes
live audio
```

Determine whether LOKA can automatically transition between these transports without requiring users to manually pair devices or change settings.

---

# Delay-Tolerant Networking

Research modern **Delay-Tolerant Networking (DTN)** concepts and protocols.

LOKA should eventually support:

```text
A → B

No route to C currently.

B stores encrypted packet.

B moves.

B encounters C.

B → C

C forwards toward destination.
```

Research:

- store-and-forward
- store-carry-forward
- packet expiration
- duplicate detection
- custody concepts
- delivery receipts
- queue management
- congestion
- TTL
- routing
- security

Determine which DTN concepts should influence LOKA rather than implementing a complete existing DTN stack blindly.

---

# Opportunistic Networking

Research routing algorithms designed for intermittently connected mobile devices.

Investigate concepts/algorithms such as:

- Epidemic routing
- Spray and Wait
- PRoPHET
- encounter-based routing
- contact-history routing
- social-aware routing
- utility-based forwarding

Compare:

```text
delivery probability
latency
battery usage
network traffic
storage usage
privacy
scalability
```

We do NOT want every phone blindly broadcasting every message forever.

Find approaches appropriate for smartphones.

---

# Dynamic Mesh Routing

Research how LOKA could choose:

```text
A → B → C
```

instead of:

```text
A → D → E → F → C
```

when the first route is better.

Potential metrics:

```text
signal quality
latency
packet loss
route stability
battery level
hop count
congestion
historical reliability
bandwidth
```

Investigate how routes can automatically recover when a relay disappears.

Example:

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

B disappears.

LOKA should discover:

```text
A → D → C
```

without user intervention.

---

# Background Operation

This is one of the most important research areas.

Determine what happens when:

```text
screen OFF
app minimized
phone locked
battery saver enabled
Android Doze active
user hasn't opened LOKA recently
```

Can the phone still:

```text
discover peers?
advertise?
receive packets?
relay packets?
maintain Wi-Fi connections?
```

Document Android restrictions by current OS version.

Research manufacturer-specific restrictions where relevant.

Do the same separately for iOS.

Do NOT assume Android behavior applies to iOS.

---

# UWB

Research Ultra-Wideband only as a supporting technology.

Determine whether it can improve:

```text
proximity detection
distance measurement
trusted nearby verification
device discovery
```

Do not assume UWB should transport normal LOKA messages.

---

# NFC / QR

Investigate offline identity verification.

Example:

```text
Pascal
   ↓
scan Mary's QR
   ↓
verify cryptographic identity
   ↓
trusted contact
```

Determine how QR/NFC could protect users against impersonation and spoofing.

---

# Wi-Fi HaLow

Research IEEE 802.11ah / Wi-Fi HaLow for **future dedicated LOKA hardware**.

Determine:

- realistic range
- bandwidth
- power requirements
- hardware availability
- phone compatibility
- gateway possibilities
- regulatory considerations

Do NOT assume ordinary smartphones currently contain HaLow radios.

---

# LoRa

Research LoRa for future LOKA Nodes.

Potential architecture:

```text
Phones
 ↓
LOKA Node
 ↓
LoRa
 ↓
LOKA Node
 ↓
Phones
```

Determine whether this could provide long-range transport for:

```text
text
emergency messages
presence
network signaling
```

Do not design LoRa for high-bandwidth photos/video/normal voice.

---

# Thread / Matter

Research the networking concepts rather than assuming LOKA should adopt Matter.

Determine whether Thread concepts could help future dedicated LOKA Nodes with:

```text
low power
self-healing mesh
routing
fixed infrastructure
```

Clearly separate smartphone capabilities from dedicated-node capabilities.

---

# Local Voice Calls

Research whether an encrypted audio stream can reliably travel:

```text
Phone A
   ↓
Phone B
   ↓
Phone C
```

without Internet.

Investigate:

- Opus
- bitrate
- packet size
- jitter
- latency
- packet loss
- jitter buffers
- route changes
- Bluetooth vs Wi-Fi transport

Determine the maximum practical hop count before call quality becomes unacceptable.

Do not guess. Eventually measure it.

---

# Security

All private communication must be designed around established cryptographic protocols/primitives.

Do NOT invent custom cryptography.

Research appropriate established approaches for:

```text
identity authentication
end-to-end encryption
forward secrecy
post-compromise security
anti-replay
packet authentication
device verification
device revocation
group encryption
key rotation
```

Intermediate LOKA relays must not need plaintext access to private messages.

Architecture:

```text
Pascal
   ↓
ENCRYPT
   ↓
Relay
   ↓
Relay
   ↓
Mary
   ↓
DECRYPT
```

---

# Internet Independence Test

Every proposed local technology must answer:

**Can this function when the phone has no usable Internet connection?**

Test conditions should eventually include:

```text
Cellular data: OFF

Internet Wi-Fi:
UNAVAILABLE

Cloud:
UNAVAILABLE

LOKA backend:
UNREACHABLE
```

LOKA Local should continue operating.

---

# Required Research Matrix

Produce a comparison containing at least:

| Technology | Internet Required | Range | Bandwidth | Latency | Battery | Background Support | Android | iOS | Extra Hardware | LOKA Use |
|---|---|---|---|---|---|---|---|---|---|---|

Do not mark something as supported unless documentation or testing supports the conclusion.

---

# Physical Proof of Concept

After research, recommend the smallest experiment.

The first major target is:

```text
A 📱 → B 📱 → C 📱
```

Requirements:

- 3 physical Android phones
- Internet unavailable
- cellular data disabled
- no LOKA cloud/backend involved in delivery
- A cannot directly communicate with C
- B relays A's encrypted packet
- B cannot decrypt the private message
- C successfully receives and decrypts it

Message:

```text
Hello C
```

Then test:

```text
    B
   / \
  A   C
   \ /
    D
```

Start with:

```text
A → B → C
```

Remove B.

LOKA should discover:

```text
A → D → C
```

---

# Measurements

Record:

```text
peer discovery time
connection establishment time
delivery success rate
message latency
average hop count
packet loss
route lifetime
route recovery time
battery consumption/hour
CPU usage
memory usage
device temperature
background survival time
screen-off behavior
```

Also record:

```text
device manufacturer
device model
Android version
radio technology used
distance between nodes
indoor/outdoor environment
```

---

# Important Engineering Rule

Do not optimize for:

> "How do we connect to Bluetooth?"

Optimize for:

> **"How does LOKA find and maintain the best available route to another LOKA identity without requiring Internet connectivity?"**

Bluetooth, BLE, Wi-Fi Aware, Wi-Fi Direct, future LOKA Nodes, Internet and satellite should eventually be transports behind a routing architecture.

The application layer should not need to know which physical transport delivered the message.

---

# Deliverables

Before proposing a production architecture, provide:

1. Current technology research with primary-source documentation.
2. Android vs iOS capability comparison.
3. Internet-independent technology matrix.
4. Recommended Android-first transport architecture.
5. Background-operation findings.
6. DTN/opportunistic-routing recommendation.
7. Security/threat-model considerations.
8. Proposed three-device experiment.
9. Proposed ten-device experiment.
10. Known technical risks and OS limitations.
11. Technologies we should reject and why.
12. Questions that can only be answered through physical-device testing.

Most importantly:

**Separate documented facts, experimental results, assumptions, and proposed designs.**

Do not claim that LOKA can create a reliable multi-hop smartphone mesh until we have demonstrated it on physical devices under realistic background and screen-off conditions.