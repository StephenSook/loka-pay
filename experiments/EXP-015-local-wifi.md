# EXP-015 — Supplementary local Wi-Fi

Implementation: [wire contract and limits](../protocol/LOCAL-WIFI-V0.md). Security: [review](../security/LOCAL-WIFI-REVIEW.md).

Software evidence: Android emulator actual TCP server test passes fragmented 16384-byte input, reverse transfer, handshake and oversized-length rejection. This does not prove Bonjour, physical radio delivery or Internet independence on hardware. Swift framing and existing packet interoperability tests are recorded separately in the run output.

Physical test pending, build 0.6.20:

1. Connect Android and iPhone to the same Wi-Fi LAN. Disable mobile data and remove the LAN's Internet uplink; keep Wi-Fi on. Allow iPhone Local Network access and LOKA local connections.
2. Send short synthetic texts in both directions. Record time until recipient saves and until sender displays Delivered. Check exactly one bubble despite duplicate paths.
3. Inspect transport diagnostics to prove Wi-Fi actually carried the packets; a successful message alone could have used BLE. No claim of Wi-Fi proof without that evidence.
4. Remove the shared Wi-Fi route while Bluetooth remains available. Send again and record fallback. Restore Wi-Fi and repeat.
5. Repeat for photo/voice queues, Home, lock, local-network permission denial, network change and weak signal. Record failures, not just successes.

Not implemented by this experiment: router-free Wi-Fi Aware/Direct, hotspot creation/join, Android Wi-Fi client discovery, iPhone Wi-Fi listener, authenticated cross-radio identity binding or best-route scoring. Those remain explicit follow-up work, not hidden behind the word automatic.

Validation run: Android build/lint/core tests passed; one emulator instrumentation test passed. Swift framing/private-address vectors and existing JVM↔Swift message interoperability passed. Signed iPhone build succeeded. Physical Android devices were absent at deployment, so their 0.6.20 installation and real cross-platform Wi-Fi validation remain pending.

## 0.6.23 — combined-route status and reconnect regression

A reported “Finding a local connection” stall exposed an iPhone UI bug: chat, connection icon and connection page consulted BLE only, ignoring a ready Wi-Fi route. They now use aggregate checked transport availability. This proves an adjacent transport is usable, not recipient reachability or message delivery.

The app also passed every Wi-Fi/BLE state event to `mesh.link(true)`, which replayed every pending packet even while another route remained up. The coordinator now distinguishes aggregate up/down transitions; additional up events use bounded due retries. LokaMesh independently ignores duplicate link states. Wi-Fi endpoint attempts rotate instead of repeatedly selecting the first entry. Packet identity, cryptography, receipt semantics, retry interval and expiry are unchanged.

Regression checks cover Wi-Fi-only availability, losing either path while retaining the other, full outage/recovery, and repeated link-up without duplicate queue replay. Existing JVM↔Swift protocol tests pass. Physical confirmation of the reported stall remains pending; these fixes do not establish best-route scoring or guarantee a route when neither transport is connected.
