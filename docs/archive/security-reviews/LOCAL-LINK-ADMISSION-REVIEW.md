# Automatic local link admission — internal source review

2026-10-02, app 0.6.5. Reviewer: coding agent (internal review; no independent production audit). Scope: removing the consumer BLE address-approval gate, fresh iPhone service discovery and transport probe ordering. No encryption algorithm, key serialization, packet-v0 wire contract or contact trust changes.

## Boundary and findings

Local connection enabled permits compatible nearby links to carry untrusted ciphertext. A radio advertisement/public probe is not an authenticated person. Android LocalLinkPolicy admits BLE by default, honors explicit blocked handles and preserves manual allowlisting when engineering topology control is enabled. Classic links retain their existing pairing/allowlist requirements. iPhone selects a live service-filtered candidate without importing its key or displaying a contact identity. Explicit Off stops local activity.

Both existing destination paths still verify packet signature/expiry, require the saved sender key and decrypt for the intended recipient. Sender submission still requires a verified recipient; Delivered still requires an authenticated recipient-save receipt. Mesh relay does not decrypt third-party payloads. Unknown senders cannot deliver private conversation plaintext merely by opening a link.

New tests cover automatic/changed-handle admission, manual/block overrides, actual encrypted unknown-sender rejection by MeshEngine, per-link ingress refill/burst limits and probe priority without corrupting in-flight payload. Swift tests cover changed candidates, cooldown/candidate cap and recovery/framing.

Android retains four BLE sessions, 16-KiB frames, 2048 outgoing chunks per peer and 128 queued frame callbacks; new complete-frame/public-probe budget is burst 8 then 4 per second per peer before cryptographic processing. iPhone limits attempts per candidate and bounded active retries; after exhaustion it uses a passive service-filtered scan. A relay may withhold messages, observe existing routing metadata or consume capacity. These are untrusted routes, not authenticated radio sessions. Radio-handle blocking cannot identify a rotating malicious device; global Off remains available. CPU/battery and deliberate connection-slot exhaustion need physical adversarial testing.

## Disposition

Suitable for controlled non-sensitive prototype testing with honest untrusted-route semantics. Not a production security approval. Persistent authorization based on a radio address was insufficient for the promised consumer experience; no new cryptographic handshake is invented to replace it. Verified peer identity/capability negotiation, scalable route selection, stronger admission quotas and production E2EE review remain separate work.

## 0.6.8 automatic Android BLE client — internal incremental review

Adds GATT central discovery to Android while retaining the existing peripheral and Classic adapters. Service-filtered scanning accepts an eight-byte random per-instance token from service data in the scan response. Lexicographic unsigned ordering chooses a single initiator between cooperating Androids. Token equality, absent tokens and malformed lengths do not initiate. A token is public, spoofable, ephemeral and is not an identity, capability proof or trust grant. Older iPhone clients ignore it and retain their existing service/characteristic/probe contract.

Client frames use the existing 19-byte payload chunks, public round-trip probe and unchanged signed encrypted packet format. `ble:out:` handles route through the client but retain the same automatic/manual/blocked policy as other BLE links. Client resource limits: four sessions, 32 remembered scan candidates/cooldowns, 128 pending payload callbacks/submissions, 2048 outgoing chunks/session, 16-KiB assembled frames, 20-second setup and 12-second operation deadlines, 15-second probe window, 30-second reconnect cooldown per candidate. Scan errors allow three delayed 30-second retries; explicit stop invalidates retries. The peripheral's separate four-session cap remains; eight combined is a code limit, not measured useful concurrency.

Main-looper ownership and GATT-object identity checks reject callbacks from replaced sessions; timers carry operation generations. No private content/keys are logged. Invalid or unknown senders cannot deliver private conversation plaintext via a new radio link; destination trust/signature checks remain unchanged. Explicit blocked radio handles do not bind identity across address rotation. Unknown relay admission does not establish authenticated-neighbor reconnection; that Phase 1 gap remains.

Residual risks: scan/power cost and scan-response availability require hardware measurement; unauthenticated candidates can occupy slots or spoof ordering tokens; simultaneous central/peripheral behavior is device dependent; no route quality scoring or identity-based deduplication across Classic/BLE exists. Message IDs suppress duplicate destination delivery across paths. Suitable for controlled prototype testing only; no production authentication or mesh reliability approval.
