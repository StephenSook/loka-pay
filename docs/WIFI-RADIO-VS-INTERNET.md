# LOKA Engineering Note
## Wi-Fi Radio vs. Internet Connectivity

One of the most important architectural concepts for LOKA is:

> **Wi-Fi does not automatically mean Internet.**

LOKA Local should use the phone's Wi-Fi and Bluetooth radios as **local communication technologies**, without requiring an Internet connection.

---

## 1. Normal Wi-Fi

Most applications use Wi-Fi like this:

```text id="yb5e6q"
Phone
  │
  │ Wi-Fi
  ▼
Router
  │
  ▼
ISP
  │
  ▼
Internet
  │
  ▼
Server
```

In this scenario, Wi-Fi is simply how the phone reaches the Internet.

This is **not** what we mean by LOKA Local.

---

# 2. LOKA Local Wi-Fi

LOKA should investigate supported peer-to-peer/local Wi-Fi technologies that allow nearby devices to communicate without Internet access.

Conceptually:

```text id="ux12ss"
Phone A
   │
   │ Local Wi-Fi radio connection
   │
   ▼
Phone B
```

There is:

- No cellular data
- No Internet requirement
- No ISP requirement
- No cloud server required for local delivery

The Wi-Fi hardware is being used as a **radio between local devices**.

---

# 3. Multi-Hop LOKA

LOKA extends this concept:

```text id="7o2xka"
Phone A
   │
   │ Local radio
   ▼
Phone B
   │
   │ Local radio
   ▼
Phone C
```

If A cannot directly reach C, B may act as a relay.

Example:

```text id="5ozt87"
A → B → C

Internet: OFF
Cellular data: OFF
```

A sends:

```text id="8r7ypj"
Hello C
```

B receives an encrypted LOKA packet.

B should not need to decrypt the private message.

B forwards the packet.

C receives and decrypts:

```text id="4z1cm8"
Hello C
```

This is the core technical concept we need to prove.

---

# 4. Bluetooth + Wi-Fi

LOKA should not treat this as:

```text id="4ay5xg"
Bluetooth OR Wi-Fi
```

The architecture should allow different local radios to serve different purposes.

For example:

```text id="wjhmb3"
Bluetooth / BLE
        ↓
Discovery
Presence
Handshake
Control


Wi-Fi local transport
        ↓
Messages
Photos
Files
Voice notes
Potential calls
```

The exact division must be determined through physical testing rather than assumed.

---

# 5. Why Wi-Fi Matters

Bluetooth is useful, but LOKA will eventually need to move:

```text id="j1ls77"
Text
Voice notes
Photos
Files
Audio streams
```

Local Wi-Fi technologies may provide significantly more useful bandwidth for those workloads.

Therefore the architecture should support multiple transports.

---

# 6. Transport Architecture

Do NOT build messaging directly against a particular Wi-Fi API.

Build:

```text id="unylss"
LOKA APPLICATION
       │
       ▼
MESSAGING / CALLS / MEDIA
       │
       ▼
ENCRYPTION
       │
       ▼
ROUTING ENGINE
       │
       ▼
TRANSPORT MANAGER
       │
 ┌─────┼────────────┐
 ▼     ▼            ▼
BLE   Wi-Fi       Future
```

Possible Android transport implementations can be investigated behind this abstraction.

The important architectural rule is:

> The routing and messaging layers should not care which radio delivered a packet.

---

# 7. Internet Is Another Transport

Eventually LOKA may have:

```text id="xubjsr"
LOKA TRANSPORTS

Local:
├── BLE
├── Local Wi-Fi
└── Mesh relay

External:
├── Internet
├── Satellite
└── Satellite gateway
```

Internet connectivity should not be confused with local Wi-Fi connectivity.

---

# 8. Example

Pascal and Mary are in the same building.

Their phones can establish an appropriate local LOKA route.

```text id="yq1a92"
Pascal 📱
     │
     │ Local Wi-Fi
     ▼
Mary 📱
```

Message delivery does NOT need:

```text id="x6owrm"
AWS
LOKA backend
Cell tower
Mobile data
Internet
Satellite
```

Those systems should not be in the local message-delivery path.

---

# 9. Mesh Example

Pascal cannot directly reach Mary.

John's phone is between them.

```text id="khzyv1"
Pascal
  📱
   │
   │ local radio
   ▼
John
  📱
   │
   │ local radio
   ▼
Mary
  📱
```

LOKA determines:

```text id="0i9tdz"
Pascal → John → Mary
```

John becomes a relay.

John should see only the routing information required to forward the packet and encrypted payload—not Mary's private message content.

---

# 10. What "No Data" Means

Product language needs to be precise.

When we say:

> No data required.

We mean that **LOKA Local does not require cellular/mobile data or an Internet connection for a locally deliverable communication**.

The radios still transmit bytes and consume battery.

Technically, information is obviously still being transmitted.

Therefore engineering documentation should distinguish:

```text id="irv14y"
LOCAL NETWORK TRAFFIC
≠
CELLULAR DATA
≠
INTERNET TRAFFIC
```

---

# 11. Internet Wi-Fi Is Different

If the user connects to a normal Wi-Fi router:

```text id="4cp4va"
Phone
 ↓
Wi-Fi
 ↓
Router
 ↓
Internet
```

then LOKA may have Internet connectivity.

That is different from:

```text id="rq9lqm"
Phone
 ↓
Local Wi-Fi
 ↓
Phone
```

LOKA must distinguish these conditions.

---

# 12. Routing Decision

Eventually:

```text id="aqn41b"
User sends message
       ↓
Can recipient be reached locally?
       │
    YES│
       ↓
LOKA LOCAL
       ↓
Direct / Mesh
```

No Internet should be involved.

If not:

```text id="8phxpm"
Local route?
   │
   NO
   ↓
External connectivity available?
   │
   ├── Internet
   │
   ├── Satellite
   │
   └── Gateway
```

Then a future external LOKA transport can be considered.

---

# 13. Cost-Aware Routing

Long term, LOKA's route manager should understand that transports have different characteristics.

Conceptually:

```text id="n7bmrz"
LOCAL MESH
Cost: very low
Internet requirement: No


INTERNET
Cost: depends on user's connectivity
Internet requirement: Yes


SATELLITE
Cost: potentially high
Availability: limited
```

For locally reachable users, we should generally prefer an appropriate local route rather than unnecessarily sending traffic through external infrastructure.

---

# 14. Engineering Requirement

The first LOKA proof must NOT be tested using normal Internet delivery.

Use physical Android devices.

Disable/avoid Internet connectivity for the experiment.

Test:

```text id="un1yja"
Phone A
   ↓
Phone B
   ↓
Phone C
```

Requirements:

```text id="2wm8nq"
Cellular data:
OFF

Internet:
UNAVAILABLE

LOKA backend required:
NO
```

Send:

```text id="rcc4z6"
A → C

"Hello C"
```

B must relay the encrypted packet.

C must receive it.

---

# 15. Why This Test Matters

If we accidentally build:

```text id="sf0ae3"
A
 ↓
Wi-Fi
 ↓
Internet
 ↓
LOKA Server
 ↓
Internet
 ↓
C
```

we have built another Internet messenger.

That is NOT the core LOKA Local technology.

We need to prove:

```text id="qxxuyd"
       INTERNET
          ✕

A 📱 → B 📱 → C 📱
```

That distinction should remain one of the fundamental engineering principles of the entire project.

---

# 16. Definition

For all future LOKA engineering discussions:

**LOKA Local**

> Communication transported through locally available device/node connections without requiring Internet connectivity for message delivery.

**LOKA Go**

> Future communication using Internet infrastructure when the destination cannot be reached through an appropriate local LOKA route.

**LOKA Satellite**

> Future constrained external transport or gateway backhaul using supported satellite infrastructure.

These are separate transport environments behind the same LOKA user experience.

---

# 17. Core Engineering Rule

Do not ask:

> "Does the phone have Wi-Fi?"

Ask:

> **"Does LOKA have a route to the destination, and what transport can provide that route?"**

That distinction is fundamental to the LOKA networking architecture.