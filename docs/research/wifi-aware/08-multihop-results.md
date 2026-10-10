# Multi-hop and mixed-transport results

**NOT RUN.** Direct cross-platform Aware, authenticated E2EE and simultaneous-link gates remain unmet. iOS production currently retains foreign packets without forwarding; do not designate it a relay based on the UI switch.

| Topology | Current blocker |
| --- | --- |
| Android → Android → iPhone | Direct gate, relay concurrency and second Android availability |
| Android → iPhone → Android | Direct gate, missing iOS multi-link forwarding in production; isolated implementation required |
| iPhone → Android → iPhone | Second iPhone absent; direct gate |
| iPhone → iPhone → Android | Second iPhone absent; iPhone relay implementation and direct gate |
| Android → iPhone → Android → iPhone | Four nodes including two iPhones unavailable; two-hop gate first |
| Android BLE → Android Aware → iPhone LAN → destination | Additional node and mixed-link relay experiment; LAN control must be labeled |

## Required proof after earlier gates pass

Use synthetic identities and existing packet-v0 ciphertext unchanged. A and C may decrypt their intended messages; B only forwards ciphertext. Record ingress/egress transport, message ID, duplicate handling, authenticated destination ACK and hop counters without content/private keys. Verify that endpoint keys are absent from relay storage; application policy alone is not non-decryption evidence.

Exclude the A↔C shortcut physically and confirm it remains unavailable throughout; merely preferring B in UI is insufficient. Send in both directions. Remove B while A has queued work, introduce an independently discovered D, then verify A→D→C and recovery duration. A preconnected duplicate flood is not newly discovered route repair.

For store-and-forward: C offline, B retains encrypted bounded/expiring data, restart B, later connect C and verify delivery once. The current in-memory relay queue will not meet that durability requirement; do not invent custody success. Record expiry, quota eviction, reboot, clock skew and malicious duplicate cases. Preserve endpoint receipt semantics: relay acceptance is not delivery.

Only after those tests should a reviewed protocol change introduce authenticated path evidence or capability/routing announcements. Unsigned remaining-hop counters are not a trustworthy full route trace.
