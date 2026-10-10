# EXP-016 — Android Wi-Fi Aware transport

## Physical foreground result — 2026-10-04

**Bidirectional Android chat payload delivery over Wi-Fi Aware observed.** Tested
SM-S948U1 and SM-S926U, both Android 16, with production LOKA 0.6.37 (45).
The second phone was updated from 0.6.29 without clearing its profile/history.
Both report Aware hardware support and granted Nearby Wi-Fi/Bluetooth permissions.
The separate Android pairing probe was stopped before this test.

Native Aware dumps reported a LOKA data-path setup and the `aware_data0` interface.
One clearly labelled synthetic message was sent in each direction using the normal
chat UI. Each receiver's Message Info explicitly showed **Wi-Fi Aware · received
here**, not merely an outgoing attempt. Both senders subsequently displayed Read;
Delivered was separately observed on the first sender before its chat was opened
on the recipient. Both incoming messages reported one hop (the existing estimate).
Nearby displayed the existing profile names and allowed the established friends to
open their chats without a new contact exchange or native pairing dialog.

The [redacted result](results/2026-10-04-android-aware/result.json) records observations
from UI hierarchies. Neither private messages, profile names, radio addresses nor
hotspot credentials are included. Receipt return is proven by the chat indicators;
the receipt packets' own transport was not separately measured. Bluetooth remained
enabled, but the first saved incoming payload on both phones was attributed to Aware.

Scope: one message each way, apps in foreground, phones nearby and USB-connected.
This does not measure throughput, exact latency, offline conditions, reconnection,
range, screen-off/background behavior, multi-hop relaying or Android–iPhone Aware.
The older implementation notes below describe the original integration checkpoint;
this result advances only its direct Android foreground gate.

October 3, 2026; Android build 0.6.24. Experimental integration in the existing LOKA transport manager, not a separate app.

## Implemented

Android API 29+ publishes/subscribes to `loka-aware-v0`, elects an initiator using random session tokens, negotiates a bounded native Aware data path, and carries unchanged packet-v0 over duplex length-prefixed TCP. It does not require a router, shared LAN, Internet validation or a backend. Subscriber sockets are bound using the OS-provided Aware Network. Publisher accepts only the expected peer IPv6 address. No network is bound process-wide.

The connected SM_S948U1 reports `android.hardware.wifi.aware`. That is hardware evidence, not proof of a successful data path. Unsupported hardware, temporary Aware unavailability or denied optional Wi-Fi permission leaves the existing Bluetooth and shared-LAN transports available. Settings → Router-free Wi-Fi and the optional onboarding card request Nearby Wi-Fi on Android 13+, or fine/coarse location on older supported Android. Aware may additionally depend on system Location on older releases.

Two simultaneous Aware links maximum, 32-frame queues, 16-KiB frame cap, 25-second setup bound, 20-second native network request timeout, 30-second socket read timeout and paced ingress. Discovery request has two retries; matching server replies are bounded. A failed setup can be attempted again on a later discovery event after cooldown. Sustained recovery without new discovery events is not proven. Session loss, stop and network loss release sockets/queues/native network requests. Automatic local-link admission now includes Wi-Fi and Aware; previously it accidentally allowed only BLE, rejecting the shared Wi-Fi server's real app connections.

Android Nearby now includes connected/observed Aware/shared-Wi-Fi handles with a transport label. RSSI remains unavailable for these handles; Bluetooth bars are not reused as Wi-Fi signal strength. Radio handles are not friend identities; one physical phone may appear via more than one transport until authenticated identity binding is implemented.

## Not implemented / not claimed

This is Android Aware's PSK data-path flow. It is not Apple's system pairing flow or proof of Android–iPhone Aware compatibility. Wi-Fi Direct is a distinct unimplemented transport. iPhone Aware support, pairing, entitlement/signing and interoperability remain separate work. No automatic best-route scoring, range gain, battery improvement, background reliability or measured throughput is claimed. Bluetooth remains in parallel under the existing bounded flooding policy.

## Required physical test

1. Install on two compatible Android phones. In LOKA, enable local connections and allow Router-free Wi-Fi access. Keep Wi-Fi radio on, remove shared LAN access and turn off mobile data. Record OS/build and Aware availability.
2. Exchange/verify contact codes as usual. Send short synthetic messages both ways. Confirm `Wi-Fi Aware: first packet written/received` diagnostics; connection or a Delivered tick alone could be from Bluetooth.
3. Record discovery/setup, send/save/receipt latency, exact-once chat display, failures and battery state. Repeat with a voice/photo queue.
4. Remove one peer, restore it, toggle the Wi-Fi radio and deny/regrant permission. Record whether rediscovery resumes without foreground intervention. Test Home, screen lock and power saving separately.
5. With a third phone, test Android Aware → Android relay → iPhone BLE, preventing the direct sender–recipient path. This is an outstanding physical gate, not a claimed working mesh.

Software tests cover untrusted discovery input bounds, wrong message kind, malformed fields, local Wi-Fi/Aware admission with opt-out/block rules and existing packet/relay/encryption regressions. Native radio behavior cannot be proven by those tests or an emulator.

Sources: [Android Aware](https://developer.android.com/develop/connectivity/wifi/wifi-aware), [native network specifier](https://developer.android.com/reference/android/net/wifi/aware/WifiAwareNetworkSpecifier.Builder), [Apple paired-device connection model](https://developer.apple.com/documentation/wifiaware/connecting-paired-devices).
