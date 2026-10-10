# Apple transports and supported lifecycle

Apple's Wi-Fi Aware framework and DeviceDiscoveryUI must be evaluated through
runtime support, entitlements, pairing and actual data-path tests.
[Wi-Fi Aware](https://developer.apple.com/documentation/wifiaware).
A Wi-Fi Aware “background” access category is not a promise of indefinite app
execution. [Access category](https://developer.apple.com/documentation/wifiaware/waaccesscategory/background).

CoreBluetooth supports selected background events and opt-in state restoration;
background scanning/advertising differs from foreground behavior.
[Apple background guide (archived)](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html).
UIKit background tasks provide limited completion time, not a perpetual mesh
worker. [Background execution](https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time).

LOKA audit: there is a primary restored central, additional Apple BLE paths, LAN
client and Aware adapter. Foreign-frame forwarding additionally checks protected
data availability. That application gate can prevent locked-device relay even
when a transport callback occurs. It must not be removed without deciding which
at-rest data is accessible while locked and reviewing the security implications.

ADAPT: durable encrypted relay storage with explicit file-protection policy,
bounded callback-driven drain, expiry cleanup and restoration of supported links.
REJECT: claiming a timer, notification, QoS label or background entitlement guarantees
offline relay after force-quit. No unsupported keepalive workaround is proposed.

EXPERIMENT: compare iPhone↔iPad and Android↔Apple separately, with exact OS/build,
transport, lock state, callback trace and packet admission evidence. A successful
service discovery is not pairing, peer identity or message delivery proof.
See [existing Aware research](../wifi-aware/12-architecture-recommendation.md) and
[uncompleted DTN physical gates](physical-test-results.md).
