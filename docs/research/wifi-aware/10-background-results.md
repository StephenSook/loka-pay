# Background and coexistence results

**NOT RUN on the isolated Aware pair.** Foreground capability reporting and successful installation do not establish background delivery.

Apple permits Aware connections while an app has foreground/background runtime; the framework itself does not grant endless execution. [Framework runtime guidance](https://developer.apple.com/documentation/wifiaware)

Android foreground services have start and type restrictions, and power states still require hardware tests. The probe has no background service; production does. [FGS restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start), [Doze guidance](https://developer.android.com/training/monitoring-device-state/doze-standby)

| State / transition | Android sender / iPhone receiver | iPhone sender / Android receiver | Required distinction |
| --- | --- | --- | --- |
| Both foreground | Not run | Not run | Baseline first |
| Home/background, screens on | Not run | Not run | Background != suspended |
| Receiver locked | Not run | Not run | Radio receipt vs protected-storage receipt |
| Sender locked | Not run | Not run | Queue saved before suspension |
| Both locked | Not run | Not run | No foreground assumption |
| iOS OS suspension | Not run | Not run | Confirm process/runtime state separately |
| iOS user force quit | Not run | Not run | No promise of relaunch for local NAN traffic |
| Android task swipe | Not run | Not run | Not identical to force stop |
| Android force stop | Not run | Not run | User action differs from process reclaim |
| Battery saver / low-power mode | Not run | Not run | Record settings, do not silently alter |
| Idle 5/30/120 minutes | Not run | Not run | No artificial idle keepalive |
| Wi-Fi briefly unavailable / restored | Not run | Not run | Measure reacquisition and expiry |
| Out of range / return | Not run | Not run | Measure native re-pair prompt frequency |
| OS reclaim / relaunch / reboot | Not run | Not run | Persistent trust vs temporary transport |
| Infrastructure Wi-Fi plus Aware | Not run | Not run | Verify both independent paths |
| BLE plus Aware | Not run | Not run | Discovery, CPU/power and interference |
| Hotspot / Direct plus Aware | Not run | Not run | Device-dependent radio resources |

Every cell needs attempted sends, authenticated destination receipts, reconnect time and prompt count. Log elapsed deadlines and expiration, and preserve queued messages. Do not label the remote user “quit the app” merely because a path vanished: range, battery, OS suspension and radio denial can look identical.

Coexistence is a separate **online control**, after the router-free offline test. Record an Aware-native application path while an operator uses infrastructure Internet; do not count Internet-mediated delivery as Aware success. Check that route setup does not disconnect the normal Wi-Fi network. Android's resource availability and Apple runtime must be observed per device.

Useful product wording for an unavailable path remains “Waiting for a nearby connection.” A confirmed foreground recovery can update status immediately; an unverified wakeup notification must never generate a false delivered receipt.
