# EXP-006 — Local Wi-Fi and radio coexistence feasibility

Status: planned, not executed. There is no Wi-Fi adapter or concurrent transport manager in the current APK. This procedure guides implementation behind the existing transport boundary; it does not imply hardware feasibility.

Purpose: test the [engineering note](../docs/WIFI-RADIO-VS-INTERNET.md) that Wi-Fi is a local radio independent of Internet, and measure useful combinations of discovery/control and payload transports.

## Setup and observations

Use physical Android devices. Record manufacturer/model, Android/API version, transport capability support/availability, app permissions, distance/obstructions, radio state, and battery state. Turn mobile data off; remove Internet uplinks while keeping required Wi-Fi and Bluetooth radios enabled. Record how upstream access was excluded, not merely whether an Internet probe failed.

Investigate Wi-Fi Aware and Wi-Fi Direct separately; record unsupported APIs and concurrent-session restrictions as results. Implement each investigated adapter behind `LokaTransport`. Android's [Wi-Fi Direct guide](https://developer.android.com/develop/connectivity/wifi/wifi-direct) and [Wi-Fi Aware guide](https://developer.android.com/develop/connectivity/wifi/wifi-aware) describe the local APIs and their permissions. Socket permissions do not establish Internet usage. For the selected API, scope traffic to the intended local network/interface and inspect the actual path.

## Cases

1. **Two-phone local Wi-Fi:** discover/connect A–B without ISP, backend, or cellular service. Send encrypted text and reply; measure discovery, connection, payload throughput, latency, failures, and energy. Establish a usable text baseline before isolated synthetic larger-payload measurements; these measurements are not product media support.
2. **Complementary radios:** compare Wi-Fi-provided discovery against BLE discovery/control plus local Wi-Fi payload links. Record handoff time, supported simultaneous sessions, link loss, and battery usage. Do not assume either division is best. Authenticate endpoint binding before treating any new radio handoff as trusted; cryptographic changes require explicit review.
3. **Relay concurrency:** attempt A–B–C with A–C excluded. Test whether B can sustain both intended local links, including different local transports per hop when the manager exists. Confirm ciphertext at B, plaintext at C, and the return path. Single-link success is insufficient.
4. **Capability and loss behavior:** disable one radio or remove one local link. Record the remaining provider/link state and whether communication can continue or must queue. Unsupported capabilities and failures must be visible; no cloud fallback may mask them.
5. **Isolated LAN control, if useful:** repeat a direct transfer using a router with its WAN physically disconnected. Label this infrastructure-LAN result separately; it is not proof of phone-only P2P or multi-hop relay.

## Evidence and pass criteria

Complete [RESULT-TEMPLATE.md](RESULT-TEMPLATE.md) for each case. Record local interfaces/peers, upstream isolation, payload path, delivery outcomes, connection/route recovery, packet loss, CPU method, and battery measurement duration. Use “not measured” where appropriate.

Direct-local success requires observed encrypted delivery with Internet unavailable and no server in the path. Relay success additionally requires physical A–B–C delivery with B unable to decrypt and no A–C shortcut. Multi-radio success requires actual coexistence/handoff measurements, not a simulated provider or OS capability flag. Decide the roles and limits of BLE/Wi-Fi from those results before optimizing or adding media/calls.
