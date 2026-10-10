# Supplementary local Wi-Fi transport v0

0.6.20 adds a shared-network experiment alongside existing Bluetooth. It is not Wi-Fi Aware, Wi-Fi Direct, autonomous hotspot creation, an Internet delivery service, or a claim of best-route selection.

Android advertises `_loka-v0._tcp.` with a random per-session instance name. Its TCP listener binds to a private IPv4 address belonging to a Wi-Fi network. iPhone browses the same Bonjour service in `local.` and requires a Wi-Fi interface and rejects resolved addresses outside private IPv4 ranges. Both phones must already share a network with multicast discovery and client-to-client traffic permitted; Internet access is unnecessary. Hotspot and multicast compatibility must be tested per device. An Android hotspot host is not guaranteed to appear as a connected Wi-Fi network to this listener.

Client sends the four bytes `4c 57 46 30` (LWF0); server echoes them. This only identifies the framing protocol, not a person or an authenticated radio endpoint. Then each direction sends a four-byte unsigned big-endian length followed by the existing encoded packet-v0, with length 1…16384. No plaintext chat or profile is introduced. TCP boundaries are unrelated to packet boundaries.

Limits: Android four accepted sockets, each with a 32-frame output queue; iPhone one connection, eight discovered endpoints and 32 pending sends. Ingress is paced to at most approximately 16 packets/sec per connection. Android's 30-second read timeout bounds stalled/idle sessions; iPhone setup has a 15-second deadline and retries at five seconds. These initial constants require hardware testing. Discovery and socket failures leave Bluetooth available.

## Routing integration

Android exposes each connection as an opaque `wifi:` mesh neighbor. Its existing bounded flooding can relay between that connection and Bluetooth neighbors. iPhone sends first to available Wi-Fi and also to checked BLE, preserving backup delivery when an untrusted Wi-Fi neighbor is not the recipient. Existing packet identity and duplicate handling prevent a second chat bubble. This is bounded parallel transport use, **not** an authenticated association between radio handles or a latency-scored best-route engine. Destination-save receipts still determine delivery.

Current direction support: iPhone initiates a duplex TCP connection to Android; once connected, either endpoint can send. Android→Android Wi-Fi discovery/client and iPhone Wi-Fi listener are not implemented. Existing Bluetooth continues serving those topologies. iOS background execution remains limited; this adds no new background mode or force-quit exception. The existing local-session start/stop controls govern both transports; radio-independent lifecycle remains follow-up work.

## Validation

Android emulator instrumentation exercised the actual server, preface, deliberately fragmented maximum-size frame, reverse send and oversized-frame disconnect. Android build/lint and core tests passed. Swift validates matching length vectors and rejects malformed/zero/oversized lengths. Existing crypto interoperability tests remain required. Bonjour discovery, real-device cross-platform delivery, path fallback, background operation and performance have not yet been proven physically.
