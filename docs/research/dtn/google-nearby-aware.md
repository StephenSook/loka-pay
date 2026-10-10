# Google / Android transport and execution

Wi-Fi Aware offers discovery and data paths on supported devices; availability
can change and must be checked at runtime. [Android Wi-Fi Aware](https://developer.android.com/develop/connectivity/wifi/wifi-aware).
Nearby Connections exposes different connection topologies and throughput
tradeoffs. It does not provide LOKA's durable routing policy.
[Nearby strategies](https://developers.google.com/nearby/connections/strategies).

Wi-Fi Direct group formation and sockets are another transport option; local
sockets can require INTERNET permission without using the Internet.
[Wi-Fi Direct](https://developer.android.com/develop/connectivity/wifi/wifip2p).
Background BLE has lifecycle-specific approaches including companion-device and
foreground-service mechanisms; a connection cannot survive arbitrary process loss
merely because a setting is on. [Background BLE](https://developer.android.com/develop/connectivity/bluetooth/ble/background).

ADAPT: providers report authenticated peer binding, writable state, estimated
available bytes, failure reason and drain opportunities to one radio-independent
scheduler. Preserve the exact encrypted envelope when selecting another provider.
EXPERIMENT: prefer measured useful throughput and stability, with hysteresis;
retain a control-capable fallback without duplicating every payload on every radio.

Do not ship speculative scoring weights. Instrument queue-to-write, write-to-peer,
and destination-to-receipt delays first. Existing Android FGS and Aware code do
not prove alternate-path or background reliability. Native Wi-Fi Direct is an
audited implementation gap, not supplied by changing a label.

Required physical matrix: both Samsung models, screen on/off, battery saver,
background/recents dismissal/force-stop separately, BLE-only, Aware lost mid-transfer,
reboot, concurrent peers and no Internet. [Status](physical-test-results.md).
