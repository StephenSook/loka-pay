# EXP-009 — offline voice, receipts and notification replies

Date: 2026-10-02. Build: 0.6.0 on both platforms. Status: software checks passed; physical outcomes pending. User reports unreliable background/reopen connection; follow-up iPhone build 8 restores the previously checked peripheral, but hardware recovery remains unconfirmed. Use non-sensitive test content.

## Setup

Samsung Android and iPhone SE (3rd generation), both already used for EXP-008. Record actual OS versions, distance, radio state and battery mode with each run. Keep Bluetooth on, mobile data off and remove Internet uplinks. No cloud delivery or push service is used. Add each other by verified QR on both phones, enable local connection using the small icon beside QR or Settings → Local connection, select the Samsung on iPhone and approve the link on Android. Keep local connection on throughout testing. Grant notifications on both phones and microphone access when recording.

## Procedure and results

| Check | Expected observation | Physical result |
| --- | --- | --- |
| Text each direction, apps open | Input clears after queueing; one bubble per send; recipient receives identical text; sender gets two ticks only after recipient save | Pending |
| Rapidly tap Send | One outgoing logical message while submission is in progress | Pending; isolated Android test passed |
| Record 3–5 seconds each direction | Empty composer → microphone → Stop → Preview → Send; recipient can play recognizable audio | Pending |
| Recording limit/cancel | Stops by 12 seconds or 32 KiB; cancel sends nothing; no recording continues after leaving app | Pending |
| Background receiving app, unlocked | Generic New message notification if local transport runs; opening notification opens correct friend | Pending |
| Reply directly from notification | Unlock if required; one queued reply; eventual recipient receipt if route available | Pending |
| Open receiving conversation | No duplicate banner for the conversation currently visible | Pending |
| Lock Android | Foreground connection notification remains; measure actual receipt/latency under manufacturer battery settings | Pending |
| Lock iPhone | Verified arrival may show generic Local activity; decryption/save receipt waits until unlock; packets still expire after five minutes | Pending |
| Disconnect then reconnect within five minutes | Identical retained packets replay; one recipient message; eventual receipt | Pending |
| No route for over five minutes | Not confirmed; no fabricated delivery, distance or percentage; could also mean lost receipt | Pending |
| Restart app before expiry | Encrypted history restored; own unexpired ciphertext reloaded; explicit transport reconnection may still be required | Pending; Android isolated test covers persisted replay |
| Force-quit / battery saver | Record limitations, do not assume delivery; reopen and check remaining lifetime | Pending |

For every direction record sent/received timestamps, delivery latency, audio duration/size, duplicate count, notification appearance, reply result and errors. Do not export private keys or actual conversation databases. Range, throughput, packet loss, alternate route recovery and battery consumption have not been measured here. A two-phone test does not pass the three-Android relay or alternate-route gate. No hop count is shown because no authenticated route trace exists.

## Implementation limits

The experimental AAC-LC recording is 16 kHz mono at 16 kb/s, at most 12 seconds / 32 KiB. BLE fragment throughput can make delivery slow; this requires measurement before increasing the limit. Android and iPhone use native audio encoders/players. Software tests verify bytes and bounds, not microphone quality or native cross-device playback.

Android runs a user-started connected-device foreground service. iPhone restores a previously selected Core Bluetooth connection when the OS permits. Neither guarantees execution after force-quit or under all battery policies. iPhone identity and history keys remain available only when unlocked; cold launch while locked may not recover enough state to retain incoming traffic. Pending packets keep their original five-minute lifetime. A local notification cannot summon a disconnected or suspended peer like an Internet push service.

Two ticks mean an authenticated recipient app saved the complete message, not a person read it. Receipts themselves may be lost; Not confirmed does not prove nondelivery. Own pending ciphertext persists, but intermediary relay queues remain memory-only. Mid-submit process death/storage failure, notification action crash recovery and locked-screen receipt expiry still need fault-injection and hardware tests. No exactly-once guarantee is made.

See [content contract](../protocol/CHAT-CONTENT-V1.md), [security design review](../security/CHAT-NOTIFICATIONS-REVIEW.md) and [validation](../docs/VALIDATION.md).

## Restoration regression — 0.6.3

Approve the connected iPhone once on updated Android. Establish the public link reply and send non-sensitive text both ways. Background/reopen iPhone, then restart Android's app separately: unchanged explicitly approved links should resume without another approval. Confirm destination content and recipient ACK, not just the transport badge. Test Android unavailable, return in range, Bluetooth disable/enable, iPhone lock/unlock and explicit Off separately.

Unavailable setup must stop its spinner after bounded attempts and show Waiting for your nearby phone. Restored active subscriptions must initiate checks without requiring manual reselection. A stalled write must recover rather than leave Sending indefinitely. Address rotation/new radio handle may still require consent; record it as a limitation. User-reported restoration failure is a reproduction report, not a passed physical test.
