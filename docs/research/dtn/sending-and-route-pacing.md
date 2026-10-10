# Sending feedback and route pacing — 0.6.37 (45)

## Changes

The iOS saved outgoing bubble gets a render opportunity before packet encryption.
Preparation is tracked per logical message, and packet IDs are recorded after each
fragment commit instead of only after all fragments. Preparing/waiting feedback
appears inside text/media bubbles. The composer keeps its send icon; the bubble
uses a clock after the initial 15-second animation window. Delivery confirmation
still requires the authenticated destination receipt; animation is not a transfer
percentage. Expired messages explicitly say delivery was not confirmed.

When backgrounded with a live unsent message and no local connection, iOS schedules
one silent waiting alert per conversation after 20 seconds. Ready-link, foreground,
delivery and expiry reconciliation cancels it. It does not grant background runtime
or identify that a recipient force-quit. Android's existing silent foreground-service
notification now shows pending message count and updates when that count changes.

Both mesh cores order ready candidate handles by known queued bytes, then an
injected transport preference and stable handle. App policy breaks equal-load ties
in favor of established Wi-Fi/Aware over Bluetooth. Initial single-carrier selection
uses this order; existing signed carrier commitments are never reassigned. Failed
writes retain the existing cooldown/fallback behavior and per-identity suppression.
No unavailable transport is invented and no Internet gate is added. On Android,
providers now report app-queue bytes for BLE, LAN Wi-Fi and Aware, including TCP
writes in progress. Classic reports its existing unknown/default-zero queue load.
Swift Aware now includes the in-flight frame in its load.

For packet v2, ordinary frames wait until a transport's app queue is empty; urgent
locally known receipts retain admission below 16 KiB. Retry batches reserve one
ordinary slot and up to three receipt slots, with ordinary admission first so it
can claim the idle route; transport receipt insertion still prioritizes receipts
without splitting an active frame. Drain callbacks provide retry opportunities.
Successful repeated v2 admissions back off at 15, 30, 60 then 120 seconds; fresh
packets and newly ready links can attempt immediately. Failure does not count as
successful admission. Original expiry, ciphertext, IDs, quotas and signatures remain
unchanged. v0/v1 keep their earlier retry eligibility. OS suspension can delay every
retry; none of these intervals is a destination delivery promise.

## Evidence and limits

74 Kotlin core tests and full Swift/Java native suite pass, including equal-load
Wi-Fi choice, busy-route fallback, all-busy retention/drain, retry backoff, immediate
fresh-message/new-link attempts, unchanged expiry and the existing crypto/carry tests.
Signed iOS and Android debug builds pass. Device logs before this update showed BLE
routes, repeated pending traffic and Android destination-save events. They do not
prove rejection of the user's specific chat message or identify payload versus receipt.

This is an initial queue-based policy, not a measured fastest-route engine: queued
bytes are not equivalent to link drain time, and accepted OS writes may still be in
an internal radio buffer. Throughput/latency and normal-versus-receipt fairness need
phone measurements. Backoff reduces repeated traffic but can delay a lost receipt
when no new link event occurs. Native v2 still has one designated durable carrier.
Cross-platform Aware pairing is not established by these changes; same-network LAN
and Android Wi-Fi Direct group usage are distinct from Apple Aware support. A route
must actually be connected and identity/capability verified before carrying v2.

Additional receipt/scheduling fix: the bounded in-memory receipt window now keys
by sender identity plus logical message ID and lasts until the admitted receipt's
own expiry (five minutes for v0, one hour for carry). A duplicate no longer creates
another envelope simply because five minutes passed while the existing carry ACK
was still live. Existing pending ciphertext keeps retrying. Failed admission does
not remember/suppress creation; expiry releases bounded slots. This window is not
persisted, so restart can still generate another ACK for a saved message; persistent
receipt indexing and relay-readable cancellation remain separate work. Hop-report
admission failure is also still distinct from delivery-ACK success.

Never-attempted normal messages use newest-created order within their first-attempt
class to get a fresh message onto a draining route; older never-attempted messages
then get a turn before retrying that message. Conversation display still uses
sender timestamp order. Tests check fresh-first drain followed by old-data progress,
receipt sender separation, a duplicate after five minutes, exact expiry boundaries,
bounded slots and failure without suppressing retry.

Rollout: signed 0.6.37 installed on iPhone SE3 and iPad Air5 with profiles/history
preserved. Android's outgoing BLE load includes both queued chunks and frames posted
but not yet processed by its callback handler. Reservation/release uses atomic
per-key map updates so concurrent posts cannot lose queue accounting. This avoids
initial/restored link replay bypassing pacing while its callback is still running.
These admission counters do not mean physical destination delivery.

Final rollout evidence: the final APK installed successfully on Samsung SM-S948U1
and MainActivity launched. Both signed Apple apps installed and process-launch
commands succeeded. Subsequent Apple snapshots showed protected data unavailable,
ready=false and no verified profiles: installation restarted the processes while
locked, and existing WhenUnlocked identity/archive-key policy prevents cold setup.
Unlock/open once is required before this test can exercise the updated routes.
A fresh iPhone→Android payload/receipt test has been requested; no physical speed
improvement or successful post-update chat delivery is claimed yet.
