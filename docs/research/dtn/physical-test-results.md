# Physical DTN test status

## Message-info and queue selection — 0.6.35 (43)

Installed successfully and launched on Samsung SM-S948U1, iPhone SE 3 and iPad Air 5.
New encrypted history fields capture this phone's local transport observation, signed
carrier identity, observation time and original packet expiry. Message info shows a
vertical route, known names, encryption, expiry and destination-confirmed decryption.
Unknown remote links remain explicitly unreported. Older messages may lack observations.
This is not a signed per-relay custody trail; full remote transport reporting and
relay-wide delivered-copy cancellation are still pending.

The iPhone now orders available handles by queued bytes before the existing per-identity
send suppression. This avoids choosing a busy queue simply because its handle sorts
first; it does not measure/guarantee end-to-end throughput. Code inspection also shows
the central BLE send path uses 19-byte payload chunks with per-write response, a
plausible contributor to asymmetric latency. Hardware latency comparison is pending.

Validation: both builds pass; 68 Android core tests and the native Swift/Java suite
pass. Swift verifies queue-aware selection and encrypted route-history reopen. Android
emulator isolated encrypted-history instrumentation passes (1 test), including legacy
rows and invalid metadata rejection. Android route-dialog layout was visually checked
on the physical Samsung using an existing two-hop received message. Unknown old
transport/relay details remain unreported. Legacy Android incoming expiry is not
inferred from a default lifetime: without new route evidence it displays “Expiry not
recorded.” Final UI correction rebuilt successfully on both platforms.
See security/MESSAGE-ROUTE-EVIDENCE-REVIEW.md.


## Confirmed user outcome — 2026-10-03

After unlocking/opening the iPhone, the user confirmed: “It arrived and shows
Delivered.” Thus the reported waiting message completed and its destination receipt
returned in this setup. Correlated device logs separately confirm iPad relay admission,
onward hop-budget reduction (6→5), and iPhone acceptance for packet e5204647.
The available logs do not bind that packet ID to the user's exact logical chat ID,
so this is a successful user-observed delivery plus observed relay traffic, not a
complete per-message authenticated route/custody proof.

Versions: iPhone/iPad 0.6.34 (42), Samsung remains 0.6.33 (41), pending USB reconnection
for the queue fix. Foreground/protected-data availability changed during the run.
No pass is claimed for locked-screen, force-quit, measured range, every message, or
an isolated sender-disconnected ten-minute carry experiment. Durable relay restore
was observed during the Apple app update; original one-hour expiry was preserved.


## Live failure investigation — 0.6.34 (42)

The user reported no delivery with the iPad in the kitchen between phones. On build
0.6.33, iPhone logs show automatic relay selection and repeated attempts. Subsequent
iPad logs show carrier commits for matching packet IDs 96aa3233 and c4a3d612 and
five-hop-budget onward writes. Thus carrier admission was observed on hardware, but
these IDs may represent encrypted control receipts, not the user's particular text.
No destination-delivery claim is made without receiving-device evidence.

The Samsung was disconnected from ADB and no wireless debugging service was found.
Direction clarification and reconnection were requested. Captured redacted logs are
in `experiments/results/2026-10-03-carry/`.

Code inspection confirmed duplicate v2 sends across multiple handles to one identity
and duplicate complete frames accumulating in BLE queues. 0.6.34 coalesces v2 sends
per packet/verified identity for the retry window and suppresses exact complete frames
already queued for BLE. It preserves distinct messages, active-frame boundaries,
expiry and retries. This addresses verified redundancy; its contribution to the
reported end-to-end delay has not yet been measured.

Validation: 68 Kotlin tests pass; full native Swift/Java suite passes, including new
multiple-radio and 100-duplicate queue regressions and existing framing/receipt tests.
Both app builds passed. 0.6.34 installed on iPhone and iPad; Samsung update remains
pending reconnection. iOS now records bounded rejection/frame events and a redacted
route-state snapshot with protected-data, app-state and negotiated-peer capabilities.
No plaintext messages, names, keys or complete peer identifiers are logged.

16:38 local snapshot after both Apple apps launched: iPad ready, protected data
available, active app, Android profile negotiated v2, iPhone profile still v0/unknown.
iPhone snapshot: ready, protected data unavailable, background app, zero verified
nearby profiles. This establishes a missing usable iPhone route at that instant,
not the complete cause of the earlier report. Requested unlocking/opening iPhone
to isolate delivery from lifecycle restrictions. Samsung remained disconnected.



## Automatic normal-chat update — 0.6.33 (41)

The manual carry screen has been removed at the user's request. New ordinary messages
use packet v2: source queues offline, selects one verified compatible relay internally
when needed, persists that authorization, and retains direct delivery as an option.
No recipient/carrier setup beyond ordinary messaging is required. The selected relay
can retain ciphertext across restart and later deliver to the destination.

Android automatic-selection, failed-storage, failed-direct-write and restart tests pass.
Swift/Kotlin v2 payload/receipt tests use real encryption and simulated ten-minute
clock advancement; they are not elapsed-time phone evidence. See the
[protocol](../../../protocol/PACKET-V2-AUTOMATIC-CARRY.md) and
[security review](../../../security/AUTOMATIC-CARRY-REVIEW.md).
Deployment: 0.6.33 (41) installed successfully on Samsung SM-S948U1, iPhone SE 3
and iPad Air 5, preserving app data. All three launched successfully; the previous
iPad launch refusal did not recur. Android package version verified as 0.6.33/41.
Both Apple installations used the same signed 0.6.33/41 artifact.

Final validation: 66 Android core tests, zero failures; full native Swift/Java suite
passed, including negotiated v2 capability in both directions, automatic carrier
selection and failed-direct-link fallback. Android and signed iOS builds passed.

Physical message delivery after this update: **NOT OBSERVED YET**. Send a new ordinary
message with an intermediate device available; there is no carry-test screen or
carrier choice. Old expired messages are not revived. The one-carrier policy supports
A→B→C, not an arbitrary chain or replacement carrier after durable authorization.
Force-quit/background behavior is not qualified by this deployment.

Update after user unlocked iPhone: both Apple snapshots negotiated v2 with each other,
and iPad also had Android v2. The captured iPad log shows e5204647 received at source
hop budget 6, then forwarded at 5 toward iPhone. iPhone records that same packet at 5
and `destination saved` at epoch 1791059921. This is correlated physical relay packet
arrival, not yet confirmation of the user's exact chat message or its returning ACK:
the diagnostic currently does not distinguish encrypted payload from receipt content.
Asked whether the waiting message appeared and whether sender now shows Delivered.


## Previous 0.6.32 experiment record (historical)

2026-10-03: **Experimental build deployed; physical carry test NOT RUN yet.**
Version 0.6.32 (40) installed successfully, preserving app data, on connected Samsung
SM-S948U1, iPhone SE 3 and iPad Air 5. The second Samsung was not connected. Samsung and iPhone launched successfully.
iPad launch was denied with a signing/entitlement/trust error despite its UDID being
included in the embedded provisioning profile and Developer Mode being enabled.
Awaiting the on-device launch message; iPad runtime is not yet verified.

Native Kotlin carry tests: 3 passed, zero failures. Full native Swift/Java messaging
suite passed, including a real encrypted archive reopen with a simulated ten-minute
clock advance, Kotlin payload decryption and receipt returning through the Swift carrier.
Android debug and signed iOS builds passed. Simulated time is not elapsed phone evidence.

See [v1 experiment](../../../protocol/PACKET-V1-CARRY-EXPERIMENT.md) and
[security review](../../../security/CARRY-EXPERIMENT-REVIEW.md). Settings → Carry test
opts into the designated-carrier protocol; ordinary chats remain v0. The experiment
adds bounded encrypted persistence, one-hour original expiry and local commit/restore/
destination events. It does not implement general adaptive DTN, five-hop carry, or
24-hour policy. Physical radio/lifecycle reliability remains unproven.

Next: select iPhone recipient and iPad carrier on Samsung, send one test, correlate
carrier commit, disconnect sender, wait ten real minutes and restart carrier, then
bring it to recipient and collect destination plus receipt evidence. Preserve radios
but remove Internet uplinks. Repeat in reverse before background tests.

Earlier user observations in this thread: the kitchen iPad could discover endpoints,
some message information displayed one hop, and a later message remained undelivered.
These are useful failure reports, not controlled successful relay evidence. A mutable
hop field alone cannot prove which device carried a message.

## Gates before testing

1. Freeze build IDs, protocol version and device/OS inventory; preserve current baseline.
2. Implement and security-review encrypted foreign relay persistence and compatible
   sender-authorized lifetime policy. Current five-minute v0 cannot pass ten-minute carry.
3. Instrument test-ID admission, persisted commit, chosen peer/transport, write completion,
   destination authentication/save and receipt return. Redact permanent identities.
4. Prove disk recovery, expiry, duplicate and transfer-budget invariants in both native cores.
5. Then install the experimental build without erasing user profiles/history.

## Required test matrix

| Test | Setup / evidence required | Status |
|---|---|---|
| A→B→C | Disable A↔C path; prove B admission and C delivery plus returned ACK | NOT RUN |
| A→B→C→D→E | Five controlled devices, correlated per-hop events | NOT RUN; five-device availability unconfirmed |
| Moving carrier | A gives B ciphertext; B leaves; after 30 min meets C/destination | NOT RUN; opt-in v1 supports this duration |
| 10 min / 1 h / 6 h / 12 h / 24 h | Real elapsed time, valid original policy, restart/lock variants, no renewed expiry | NOT RUN |
| Alternate route | Remove current carrier/link; another eligible carrier delivers | NOT RUN |
| Overload | 10000 texts, 1000 notes, 500 photos, 100 manifests; control/text latency and cleanup | NOT RUN on phones |
| Background | Foreground, screen-off, ordinary background, OS termination, user force-quit separately | NOT RUN for durable DTN |
| Failure recovery | Reboot, battery death, relay data deletion, radio loss, full storage | NOT RUN |
| Radio coexistence | BLE, local LAN, supported Aware paths, loss and fallback | NOT RUN as DTN matrix |

Known earlier hardware: iPhone SE 3, iPad Air 5, Samsung SM-S948U1 and SM-S926U.
Re-read connected inventory and OS versions at execution; those observations are
not an assertion that all four are connected now.

## Procedure and pass/fail record

Keep Bluetooth/Wi-Fi radios enabled as required; disable mobile data and remove
Internet uplinks. A shared LAN test and a router-free test are separate rows.
Record wall/monotonic clocks, contact windows, app lifecycle callbacks and interface
used. First test all apps foreground to isolate routing; then vary one lifecycle
state at a time. Discovery does not count as a payload contact.

For each message record created/expiry, admission/rejection per carrier, retention
deadline, first destination save, receipt creation and first receipt arrival. Delivery
requires valid destination receipt at sender; also retain destination evidence to
distinguish “data arrived, ACK delayed.” Check plaintext is unavailable to relays.

Log failures explicitly: no discovery, no pairing, no authenticated binding, no writable
path, no queue admission, process/lock restriction, expired, no return route. Never
replace an unknown cause with “recipient quit.” Lack of connectivity cannot reveal
that state reliably.

Measure battery against idle/control runs on each device; count transmitted bytes,
duplicate attempts, queue peaks and text/control tail latency. Distance needs measured
positions and obstacles, not a hop icon. Keep raw redacted logs with the test record.
