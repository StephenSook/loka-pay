# Isolated cross-platform Wi-Fi Aware probe

This experiment investigates compatibility without changing production LOKA. Both native apps use the separate identifier `org.loka.awareprobe` and service `_loka-probe._tcp`. They contain no production contacts, identity keys, chat database, backend or BLE/LAN fallback.

**Status:** built and installed on the connected Samsung and iPhone on 2026-10-03. Capability checks and Android publication callbacks passed. Native pairing and data transfer are awaiting physical user interaction; they are not proven. See the [research checkpoint](../../docs/research/wifi-aware/12-architecture-recommendation.md).

## Current guided pairing check (0.5)

The default flow is iPhone publication and Android subscription. On iPhone choose
**Make iPhone discoverable**, keep that native screen open, then choose **Find and
pair with iPhone** on Android and confirm. Android may find the service even while
the iPhone is still waiting for a pairing request. Do not open the iPhone's Android
picker during this flow: that selects the opposite role.

The iPhone's opposite-role picker is now under **Other direction: iPhone finds
Android**. Android labels its publisher action **Other direction: let iPhone find
Android**. Development launches can use iPhone `--publish-test` and Android boolean
extra `reverseTest` to open the matching discovery flow; neither approves native
pairing or bypasses the explicit test confirmation. Logs include UTC timestamps,
iPhone view/lifecycle events and Android API capability information. No PINs are logged.

Physical result on 2026-10-04: the guided flow found the iPhone in 229 ms, but native
bootstrapping failed 20,010 ms after the request. No pairing, socket, message or speed
result exists. See [direct results](../../docs/research/wifi-aware/06-direct-device-results.md).

## Other-direction transfer test

1. Keep both phones unlocked. Turn mobile data off and disconnect from Wi-Fi routers; leave Wi-Fi on. Note distance, OS versions, power mode and whether charging/debugging is connected. Do not treat airplane mode alone as the test condition.
2. Open **LOKA Aware Probe**, not LOKA, on both phones.
3. On Android tap **Other direction: let iPhone find Android**. Allow Nearby devices. The test continues automatically after permission is granted. Start is disabled while the session is active so repeated taps cannot change the code.
The code is displayed on Android and entered only in the iPhone’s native pairing flow. The app does not have a separate code-entry field. After timeout the Android screen removes the expired code.

4. On iPhone enable **Other direction: iPhone finds Android**, tap **Select Android probe**, choose **LOKA test phone**, and enter the six-digit PIN displayed on Android. Approve **Pair** on Android only for this test. Never publish the PIN in a test report.
5. Record whether discovery, bootstrapping, pairing, native network setup or TCP handshake fails. Pairing times out after two minutes. A successful endpoint selection is not a successful data path.
6. Once iPhone shows `aware tcp connected`, immediately tap **30 small round trips**. Idle connections close after 30 seconds. For another run, use the picker again; cached-pair reconnection is itself under investigation.
7. Try **1 KB through 100 MB, both directions** only after the small test succeeds. This transfers 222,222,000 synthetic payload bytes total. Each direction is streamed with 16 KiB buffers. No real image/message is sent.
8. Tap **Stop** on both phones afterward. Do not keep connections active solely to prevent suspension.

The Android app currently publishes; iPhone subscribes and initiates benchmarks. Data flows both ways over that connection. Reverse publication, standalone Android subscriber/iOS publisher, E2EE, BLE-assisted discovery, relay, background service and video are **not implemented in this probe**. Do not label their test matrix rows passed.

## Protocol and measurement boundary

LAP1 TCP wire protocol, separate from production packet-v0:

```text
Client → Server: ASCII LAP1
Server → Client: ASCII LAP1
For each transaction:
  Client → Server: uint32 big-endian payload byte count (1…100,000,000)
  Client → Server: exactly that many synthetic bytes
  Server → Client: SHA-256 digest (32 bytes)
  Server → Client: same number of synthetic return bytes
  Client → Server: SHA-256 digest of the return bytes (32 bytes)
Size zero closes the run; 512 transactions maximum per connection.
```

Hashes check transfer integrity; they are **not authentication or LOKA E2EE**. Link security depends on native NAN pairing. The API-36 paired NetworkSpecifier/security behavior is an explicit unresolved compatibility gate. Do not exchange production/user data or silently enable an unpaired/open-network fallback to make the experiment pass.

Android accepts only after pairing succeeds and an Aware network identifies the expected IPv6 peer. iOS requires a native Aware path after the handshake. These checks rule out an intentional LAN/cloud fallback in this harness, but Internet-off conditions still need operator confirmation. Never infer RF encryption properties solely from `TRANSPORT_WIFI_AWARE`.

Elapsed timing uses each phone's monotonic clock. The benchmark reports upload plus acknowledgment, return transfer plus local acknowledgment send, and combined transaction duration. This includes hashing, buffering and application scheduling; it is not pure network RTT or one-way latency. There is no RF packet-loss measurement. Pairing UI timings require operator annotations where native callbacks do not expose them. Logs contain synthetic run IDs, event names, numeric measurements and capability metadata, not PINs, peer aliases, radio addresses or content.

## Build

From repository root, with the installed JDK/Android SDK configured:

```sh
./android/loka-mesh-lab/gradlew -p experiments/wifi-aware-probe/android :app:assembleDebug :app:lintDebug --offline
xcodebuild -project experiments/wifi-aware-probe/ios/AwareProbe.xcodeproj -scheme AwareProbe -destination 'generic/platform=iOS' -derivedDataPath /tmp/loka-aware-probe -allowProvisioningUpdates build
```

Android min SDK 34, compile/target 36; native pairing hardware required. iOS 26 and runtime Aware support required. The example project uses the current LOKA development team for a distinct bundle. Override `DEVELOPMENT_TEAM` for another developer. Signing and installing a development build do not establish App Store approval.

## Export and analyze

Use iPhone **Export test log** or copy only its generated `Documents/events.jsonl` with devicectl. On Android retrieve only this probe's files:

```sh
adb -s DEVICE_SERIAL exec-out run-as org.loka.awareprobe cat files/capabilities.json
adb -s DEVICE_SERIAL exec-out run-as org.loka.awareprobe cat files/events.jsonl
python3 experiments/wifi-aware-probe/summarize.py iphone-events.jsonl android-events.jsonl
python3 -m unittest discover -s experiments/wifi-aware-probe -p 'test_*.py'
```

Save raw logs alongside operator conditions in `docs/research/wifi-aware/raw/`. Keep unsuccessful attempts. Capability-only logs must yield no transfer groups. The analyzer validates positive finite durations and integrity/path flags, separates sizes/runs, uses nearest-rank percentiles and flags fewer than 100 samples. It never converts missing data into zero loss, zero latency or successful delivery.

## Interpretation and next gate

If the device is not discoverable, inspect matching service, publish status and required pairing metadata. If pairing fails, inspect native bootstrap/setup callbacks before changing datapath code. If pairing succeeds but a network never appears, investigate Android firmware handling of paired keys, group protection and IPv6 path setup against Apple's chapter 56 requirements. No private APIs, reflection or fabricated native pairing state.

Only after a direct result should an isolated encrypted packet-v0 benchmark be added. Then test simultaneous peers, relay durability, realistic lifecycle states and media in the order specified by the research brief. Production integration remains a later architecture/security review.

### Discovery trial 0.2

Following the operator's “No devices found” result, Android now uses unsolicited publication during the two-minute pairing window, returning to solicited mode after pairing. Events identify `unsolicited-v1`. This is one controlled discovery experiment; interoperability is still unproven. The iPhone app and service/PIN configuration are unchanged for this trial.

### Reverse discovery control

On iPhone tap **Make iPhone discoverable** and keep the native pairing view open. On Android tap **Find iPhone — reverse test**. The Android app uses active subscription with PIN-keypad capability advertised but deliberately never initiates bootstrapping, pairing or a socket. It stops after the first matching service or two minutes; the iPhone presentation closes after 150 seconds or manually. A found service is unauthenticated and does not prove identity or delivery. Keep other probe publishers off so the observation can be attributed to the test iPhone. Existing LOKA uses a different service.

Logs use `mode=reverse-discovery-v1` with start, subscription, discovery and failure events. No peer identifiers or metadata are logged. The iPhone logs presentation opening/closing, which does not itself prove successful radio publication. The publisher role is now present for this discovery control only; reverse-direction pairing and transfer remain unimplemented.

### Next stage: reverse native pairing

The current Android reverse button is now **Find and pair with iPhone**. Keep **Make iPhone discoverable** open on iPhone. Android requires explicit confirmation of the test, requests the peer-advertised PIN-display bootstrap method, then opens a six-digit input only after successful bootstrapping. Enter the code shown by the iPhone there. Empty/opportunistic credentials are rejected; codes are not saved or logged. Stop/cancel/timeout closes dialogs and discovery sessions. Native pairing success is recorded separately and allowed a ten-second observation window before cleanup; iPhone completion and persisted pairing still need confirmation. No sockets, LOKA identity exchange or message transfer were added in this step.

Events use `reverse-pairing-v1`. Separate deadlines: discovery 120s, confirmation 30s, bootstrap 30s, PIN input 90s, native pairing 30s. The iPhone pairing presentation is bounded to five minutes. API 36 lacks the API-37 bootstrap metadata overload; this remains a compatibility limitation to observe, not bypass using private APIs.

### PIN request-role correction (0.4)

The first reverse pairing run discovered the service but received a native bootstrap failure. The request now uses the subscriber's PIN_KEYPAD role (32), as specified by Apple chapter 56.3; the peer still advertises PIN_DISPLAY (2). Logs label this `reverse-pairing-v2-keypad`. A successful test is pending. No iPhone rebuild or production LOKA change is needed for this Android-only correction.
