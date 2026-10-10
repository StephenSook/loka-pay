# LOKA Seamless Contact & Nearby Experience

This is an **additional product requirement**. It does not replace the existing LOKA architecture or networking requirements.

## Core UX Principle

The user should NOT have to understand:

- Bluetooth
- BLE
- Wi-Fi Aware
- Wi-Fi Direct
- Mesh networking
- Routing
- Relays
- Hops
- Store-and-forward

LOKA handles those technologies automatically.

The experience should simply feel like:

```text id="9qg5ln"
Install LOKA
     ↓
Create account
     ↓
Allow Nearby Devices
     ↓
Optionally allow Contacts
     ↓
LOKA finds people
     ↓
Message / Call
```

---

# Bluetooth / Nearby Devices

LOKA should explain this once during onboarding:

### Stay connected locally

Allow Nearby Devices so LOKA can find and communicate with other LOKA users around you without requiring Internet.

**[Allow Nearby Devices]**

After permission is granted, the user should largely be able to forget about it.

Do not repeatedly ask users to configure Bluetooth manually unless the operating system requires user action.

If Bluetooth/local connectivity is disabled and LOKA needs it, provide a simple action:

### Turn on local connection

**[Turn On]**

Do not expose networking terminology unnecessarily.

---

# Contact Discovery

With the user's permission, LOKA should determine which contacts are already registered with LOKA.

Example:

```text id="yhmf8o"
Contacts

Mary          🟢 Local
James         LOKA
Mom           LOKA
Arthur        Invite
Sarah         Invite
```

This creates three useful states.

### Local

The person is currently reachable through a local LOKA route.

### LOKA

The person has a LOKA account but is not currently locally reachable.

### Invite

The contact is not currently matched to a LOKA account.

---

# Nearby People

LOKA can also discover nearby LOKA devices when users have enabled the appropriate permissions and discovery settings.

Example:

### Nearby

```text id="i3sgc5"
Mary
James
Arthur
```

Privacy is critical.

LOKA should NOT automatically expose everyone's identity to every nearby stranger.

Nearby discovery should use privacy-preserving identifiers and appropriate user controls.

A person should only become identifiable according to LOKA's contact/discovery privacy rules.

---

# Adding Someone In Person

If Pascal meets someone who isn't in his contacts:

### Option 1 — QR

```text id="4g8lr6"
Pascal opens:

My LOKA
   ↓
QR Code
```

Other person:

```text id="x2s9dn"
Add Contact
    ↓
Scan LOKA QR
```

Connection established.

This can work as an offline identity exchange.

---

# Share LOKA Link

Users can also share:

**Add me on LOKA**

Example concept:

```text id="usbhmk"
loka.app/pascal
```

Opening the link should:

1. Open LOKA if installed.
2. Show Pascal's profile/contact confirmation.
3. Allow the person to add Pascal.

If LOKA isn't installed, direct them to installation first.

---

# LOKA Number

Every user should also have their permanent LOKA Number.

Example:

```text id="6jv0kl"
Pascal

LK-482-918-274
```

Someone can search:

```text id="o5r2if"
Add Contact
     ↓
LOKA Number
     ↓
LK-482-918-274
```

This provides another way to connect without depending entirely on phone numbers.

---

# Adding Contacts

The Add Contact screen should remain extremely simple:

### Add someone

**Scan QR**

**Search LOKA Number**

**Invite from Contacts**

**Share My LOKA**

No networking configuration should appear here.

---

# Messaging

After a person is added, the experience becomes a normal conversation.

```text id="wj40b1"
Mary

🟢 Local

Hey, where are you?

                    I'm downstairs.
```

The user doesn't choose how the message travels.

LOKA determines that automatically.

---

# Calling

Same principle:

```text id="f1b7p8"
Mary

📞
```

Tap Call.

LOKA determines whether an appropriate route exists.

If a local route can support the call:

**Local Call**

If Internet transport is needed and available:

**LOKA Go**

If the route cannot currently support a call:

### Mary isn't reachable for a call right now.

**[Send Message]**

Do not ask users to choose Bluetooth vs Wi-Fi.

---

# Invitations When Network Density Is Low

If LOKA detects that the user has very few LOKA contacts, don't make the app look broken.

Show something lightweight:

### Bring your people to LOKA

You have 2 friends on LOKA.

Invite people you talk to regularly to build your local network.

**[Invite Friends & Family]**

Then show contacts who aren't yet on LOKA.

The user can select several:

```text id="th8lh2"
☑ Mom
☑ James
☑ Arthur
☑ Sarah

[Invite 4]
```

---

# Important Privacy Rule

Do NOT upload the user's entire address book as plain contact information.

Contact discovery must be designed with privacy in mind.

Nearby discovery must also avoid broadcasting:

```text id="dfruxb"
Pascal Kollie
Phone number
LOKA Number
Profile information
```

in plaintext to every nearby device.

Discovery and identity resolution should be separate security layers.

---

# Desired Experience

The ideal LOKA experience is:

```text id="ilb9ew"
Install
  ↓
Allow Nearby Devices
  ↓
Allow Contacts (optional)
  ↓
LOKA finds friends
  ↓
Add / Invite
  ↓
Message
  ↓
Call
```

Everything underneath:

```text id="2ytg8g"
BLE discovery
Wi-Fi Aware
Wi-Fi Direct
direct routes
multi-hop routes
store-and-forward
encryption
route recovery
Internet fallback
```

should happen automatically.

## Product Rule

> **The user chooses the person. LOKA chooses the network.**

If users have to understand mesh networking to use LOKA, the UX has failed.
