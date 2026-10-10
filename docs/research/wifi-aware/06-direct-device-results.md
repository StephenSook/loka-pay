# Direct-device results

Date: 2026-10-03. **No Wi-Fi Aware transfer result is available yet.** Successful build/install and capability reports do not count as delivery.

| Device | Status this session |
| --- | --- |
| Samsung SM-S948U1, Android 16/API 36 | Separate capability and pairing probe built, linted, installed and opened; Aware and pairing report true. |
| iPhone SE3, iOS 26.3 build 23D5103d | Separate entitled subscriber probe signed, installed and opened; earlier production capability report true. |
| Second Samsung SM-S926U | Not visible in the current ADB inventory; do not reuse an earlier connected state as present evidence. |
| Second iPhone | Not available. An attached iPad does not satisfy an iPhone↔iPhone test. |

[Android raw capability report](raw/samsung-capabilities.json), [iPhone capability report](raw/iphone-capabilities.json), [source snapshot](raw/source-snapshot.json).

## Observed publication attempts

[Android event log](raw/android-events.jsonl) contains eight starts and eight successful publish callbacks (58–76 ms from each run start, including attachment). Seven runs stopped before the full pairing window; the last reached its 120-second pairing timeout. Stop reasons are not distinguished by this probe and must not be guessed. No bootstrap, pairing-success, Aware-network or TCP-connected event appears in the collected log. The [iPhone log](raw/iphone-events.jsonl) contains capability startup only, with no endpoint-selected event.

These are **publication callback measurements**, not peer discovery times, successful pairings or a controlled eight-attempt connection-success denominator. We do not know from these logs whether the iPhone picker was opened, whether the device appeared, or whether offline conditions were established. Operator confirmation is pending. [Analyzer output](raw/transfer-summary.json) correctly contains no transfer samples and null loss/one-way-latency values.

## Required directions

| Direction | Discovery/pairing | Native data path | Transfer |
| --- | --- | --- | --- |
| Android → iPhone | Pending user-run native pairing | Unproven | Not run; responder sends return payload after upload |
| iPhone → Android | Pending user-run native pairing | Unproven | Not run; probe initiator supports upload |
| Android → Android | Missing second currently connected phone and subscriber probe role | Not run | Not run |
| iPhone → iPhone | Missing second iPhone and publisher probe role | Not run | Not run |

| Decimal payload each direction | Successful runs | Goodput | Round-trip duration | Integrity |
| --- | --- | --- | --- | --- |
| 1 KB = 1,000 bytes | Not run | Unknown | Unknown | Unknown |
| 10 KB | Not run | Unknown | Unknown | Unknown |
| 100 KB | Not run | Unknown | Unknown | Unknown |
| 1 MB | Not run | Unknown | Unknown | Unknown |
| 10 MB | Not run | Unknown | Unknown | Unknown |
| 100 MB | Not run | Unknown | Unknown | Unknown |

The sweep transfers 222,222,000 payload bytes total including both directions, plus headers/ACKs. Each payload is streamed, never a 100 MB chat message or allocation.

## Measurement protocol

Before each run the operator records: phones/OS/build hashes, distance and obstacles, start roles, cold versus cached pairing, app/lock/power state, radio state and competing apps. Explicitly disable mobile data and disconnect infrastructure Wi-Fi/other uplinks while leaving local radios on. The agent has not changed these device settings. Record that offline condition separately; a native Aware path does not prove absence of every Internet uplink.

Start with 30 connection attempts and 30 reconnect attempts with declared 30-second setup deadlines; log every failure and denominator. User PIN-entry time is separate from native setup. After a link passes, run each payload at least five times, and at least 100 small transactions for interpretable tail percentiles (30 is a smoke test only). Alternate transport/mode order to limit thermal/interference bias. Measure current BLE and LAN controls with equivalent synthetic payloads, without relabeling a router-based LAN control as phone-only Aware.

The current probe logs lifecycle timestamps, integrity-checked transfer times and explicit failures; the iOS picker does not expose every discovery/pairing timestamp. Those unavailable timings require operator annotation or additional native diagnostics and must stay unknown. Host timestamps from different phones are not synchronized one-way timing evidence.

Run `summarize.py` on exported JSONL; nearest-rank p50/p95/p99 are grouped by run, mode and payload. Application round-trip transfer includes hashing and acknowledgments. TCP retransmissions hide RF packet loss; report failed/deadline transactions separately. No RF-loss/jitter claim from missing TCP bytes.

Next physical action: follow the [probe runbook](../../../experiments/wifi-aware-probe/README.md), confirm discovery/pairing and collect the generated logs. Do not change production based on capability-only results.

## Discovery failure follow-up — 2026-10-03

Operator reports the iPhone picker displays **No devices found**. Android logs show publication callbacks but no native bootstrap/pairing events. This establishes an observed discovery failure; it does not establish a PIN-entry defect or prove that either platform universally cannot interoperate. Radio/offline conditions and exact overlap of the pairing windows were not independently verified.

The iOS `userSpecifiedDevices` filter matches [Apple's app sample](https://developer.apple.com/documentation/wifiaware/building-peer-to-peer-apps). The next isolated Android build changes only initial publication from solicited to unsolicited for the existing two-minute pairing window. After pairing it uses solicited publication. Events label this `unsolicited-v1`; retain earlier runs as the baseline. This investigates discovery-mode compatibility, **not a confirmed root cause or fix**. [Android publish modes](https://developer.android.com/reference/android/net/wifi/aware/PublishConfig)

If this trial still finds nothing, the next discriminator is native Android subscriber discovery against an iPhone publisher, plus a second Android discovery control. Do not weaken pairing security or change production LOKA to hide this failure.

## Reverse discovery control prepared

An isolated iPhone DevicePairingView publisher and Android active subscriber now implement the next discovery-only control. Android logs `reverse_service_found` only from the native service-discovery callback and stops the session immediately. A matching service remains unauthenticated. Native pairing and transfer are intentionally not attempted. Physical outcome is pending; follow the reverse control in the probe runbook.

## Reverse discovery confirmed; native pairing next

The operator reported **Test service found**. Retrieved [native events](raw/reverse-discovery-events.jsonl) confirm `reverse_service_found` after Android subscription. The latest two logged runs reached discovery 66 ms and 112 ms after start; these are warm smoke-test observations, not reliable performance percentiles, authenticated identity proof, or offline transfer proof.

The next isolated build adds explicit confirmation, native PIN-display bootstrapping, an Android six-digit code field, and native pairing callbacks with bounded deadlines. Native pairing on both devices, persisted pairing, identity exchange and transfer remain pending. Production LOKA is unchanged.

## Native bootstrap failure and request-role correction

The user reports no code on iPhone. [Captured v1 events](raw/reverse-pairing-v1-events.jsonl) show service discovery at 107 ms, bootstrap request at 2449 ms, and native `onBootstrappingFailed` at 22496 ms. This is a native failure after roughly 20 seconds, not a missing Android text field or successful pairing.

Code inspection found v1 requested PIN_DISPLAY (2), matching the publisher advertisement. Apple's [Accessory Design Guidelines](https://developer.apple.com/accessories/Accessory-Design-Guidelines.pdf), §56.3, specify PIN_KEYPAD for the initiating subscriber's bootstrap request. The new `reverse-pairing-v2-keypad` trial sends PIN_KEYPAD (32), retaining the requirement that the publisher advertise PIN_DISPLAY, and preserves every other pairing setting. This corrects a role mismatch; it does not yet prove successful bootstrapping. The API-36 bootstrap call also cannot supply the metadata accepted by the newer API-37 overload, so other interoperability issues remain possible.

## PIN-keypad trial also fails — 2026-10-03

[Two captured v2 runs](raw/reverse-pairing-v2-events.jsonl) both discover the service, issue bootstrap method 32, and receive `onBootstrappingFailed`. Request-to-failure times are 20,009 ms and 20,018 ms. Neither run reaches bootstrap success, code entry, native pair setup or a data path. The user reports Apple's system pairing view remains waiting for a request. That does not prove no RF frame reached the iPhone: the request may be missing, rejected, unparsed, or unanswered at a lower layer.

Changing DISPLAY to KEYPAD did not resolve the failure. Do not repeat unchanged trials or count this as successful pairing. No new application deployment was made for this research follow-up.

The public Android 16 AIDL implementation's `createNanBootstrappingRequest` passes the method through unchanged and populates peer/session/cookie/comeback fields. It has no application metadata argument in this implementation. [AOSP source](https://android.googlesource.com/platform/packages/modules/Wifi/+/refs/heads/android16-release/service/java/com/android/server/wifi/hal/WifiNanIfaceAidlImpl.java)

Apple chapter 56.3 requires TXT device metadata in the bootstrap SDEA. Android's public three-argument `initiateBootstrappingRequest(peer, method, message)` supporting SDEA metadata is documented from API 37, whereas this phone reports API 36 and the installed SDK has only the two-argument method. This is an actionable API gap to investigate with vendor diagnostics, **not proof of a universal API-36 impossibility or a guarantee that an OS upgrade fixes it**. [Android API](https://developer.android.com/reference/android/net/wifi/aware/DiscoverySession), [Apple requirements](https://developer.apple.com/accessories/Accessory-Design-Guidelines.pdf)

The earlier Android-publisher short-SSI/SDEA concern and this subscriber-bootstrap metadata concern are separate wire stages. Neither has been verified by an over-the-air capture on this Samsung.

Other developers report cross-platform failures in [Apple's developer forum](https://developer.apple.com/forums/thread/796446), including failures after authentication and peer-database persistence. These are first-hand developer reports, not an Apple-confirmed diagnosis of our earlier bootstrap failure. Apple DTS recommends using the detailed interoperability requirements and platform/vendor investigation. No public remedy verified for our exact pair was established by this research.


## Apple-to-Apple preparation — 2026-10-03

Installed and launched the signed Wi-Fi Aware-enabled LOKA 0.6.31 build on the connected iPad Air (5th generation), iPadOS 26.5 (23F77). Device-targeted Xcode build succeeded. The app-generated capability report returned `supported: true` and `enabledInBuild: true`; see [raw report](raw/ipad-air5-capability.json). No production networking code changed. Native pairing and iPhone–iPad message delivery remain **not yet tested**; installation/capability alone do not prove an Aware data path. User must complete onboarding and native pairing, then verify both-direction fresh-message delivery and route information.
# Guided retest — 2026-10-04

Probe 0.5 installed on Samsung SM-S948U1 / Android 16 API 36 and iPhone SE3 /
iOS 26.3 (23D5103d). Android assembly and lint passed; iOS device build passed.
Production LOKA was not modified in this retest.

The initial new Android attempt timed out at discovery; the corresponding latest
iPhone process had no publisher-open event. The probe exposed opposing publisher
and subscriber flows together. The guided UI now separates those roles, checks
pairing support on Android, timestamps events, and records Apple publisher-view
presentation and app lifecycle. This is a usability/diagnostic correction, not a
native interoperability fix.

With the iPhone publisher view confirmed active, the controlled Android run found
the service in **229 ms**. After user confirmation it called bootstrap at 1,808 ms;
the native failure callback arrived at 21,818 ms: **20,010 ms after the request**.
There was no bootstrap-success, pairing-success, native data path or transfer event.
No speed result or Internet-off qualification is claimed.

Evidence: [Android events](raw/2026-10-04-guided-android.jsonl),
[iPhone events](raw/2026-10-04-guided-iphone.jsonl). A publisher view event proves UI
presentation, not that iOS received the bootstrap frame. Android discovery proves
a matching service was found, not authenticated peer identity. The probe has no
BLE/LAN data fallback.

The known compatibility hypothesis remains: Apple chapter 56.3 requires TXT device
metadata in the bootstrap SDEA; the public Android overload accepting those bytes
is documented at API 37, while this phone runs API 36. This test cannot establish
which field/firmware behavior caused rejection or guarantee an OS upgrade fixes it.
Next evidence needs native/vendor frame diagnostics or a controlled compatible
reference, rather than asking the user to repeat this unchanged flow.
