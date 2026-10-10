# LOKA optional Internet gateway — implementation requirements

Status: proposed specification, 2026-10-04. No Internet gateway is implemented by this document. Local radio and relay reliability gates remain required independently.

The [integrated routing implementation plan](research/dtn/recommendations.md#integrated-implementation-plan--2026-10-05) combines these gateway requirements with local reliability, congestion controls and bounded PRoPHET-style carrier prediction. Its phase order and evidence gates govern integration; Internet sharing does not replace the offline baseline.

## Outcome and scope

A user without Internet can send an end-to-end encrypted LOKA message through nearby consenting carriers to an Internet-connected gateway. The destination receives it through its own Internet connection or through another gateway and local carriers. Authenticated receipts travel back, including when the originating device remains offline.

```text
Offline sender → local carriers → consenting gateway
                                      ↓ Internet
                         encrypted remote delivery service
                                      ↓ Internet
                 recipient OR gateway → local carriers → recipient
```

An Internet-connected gateway cannot reach an arbitrary offline recipient without a local route or a later encounter near that recipient. Directory lookup does not establish reachability. This feature provides LOKA messaging, not general Internet access, a tethering workaround, or a guarantee of permanent background operation.

MVP: one-to-one text and delivery/read receipts on Android and iOS. Defer gateway media, groups, paid sharing, arbitrary web traffic, satellite and decentralized directory federation until separate specifications and tests exist. Preserve existing local messaging when every external service is unavailable.

## Components and boundaries

| Component | Required responsibility |
| --- | --- |
| Existing local transports and routing engine | Discover verified peer capabilities; move ciphertext locally; retain ordinary offline behavior |
| Gateway policy and scheduler on each platform | Consent, budgets, admission, durable queue, upload/download, retry and local handoff |
| Device directory | Device-key bindings and short-lived authenticated remote reachability records |
| Remote delivery service | Bounded opaque-envelope mailbox storage, authenticated device access and idempotent transfer |
| Recipient application | Verify source, decrypt, save once and issue authenticated receipts |
| Metrics | Measure timing, traffic and rejection without recording message bodies |

Use the repository's TypeScript/NestJS/PostgreSQL modular backend direction. Keep directory/control functions distinct from remote ciphertext delivery responsibilities; expose the delivery service through the external Go/Gateway boundary. The MVP can share a deployment but must have separately enforceable quotas and authorization. Redis and libp2p are optional subsequent decisions, not MVP dependencies.

## Identity, discovery and access

1. Device identities remain distinct from account identity. Neither phone numbers, display names nor IP addresses are authoritative delivery identifiers. Do not silently replace existing device keys during cloud enrollment.
2. Existing friends retain their verified keys. Central directory responses must not silently override pinned keys; changed bindings require a reviewed key-change/recovery procedure.
3. Device enrollment uses a server challenge and proof of key possession. Do not upload private keys, address books or chat plaintext. Offline enrollment is deferred without blocking local onboarding.
4. Nearby gateways advertise a versioned, authenticated capability with policy and availability expiry. A capability advertises possible service, not successful Internet connectivity or destination reachability.
5. A recipient must explicitly authorize a gateway to retrieve its remote envelopes. Use destination-bound, gateway-bound, short-lived credentials with scope, nonce and revocation; possession of a destination ID is insufficient. Never trust a gateway's unsigned claim that a recipient is nearby.
6. Refresh reachability records only while a verified local session or destination Internet session exists. Proposed lease: 60 seconds, refresh at 30 seconds; stale records expire automatically. Test battery and control overhead before finalizing these values.
7. Authenticate directory and mailbox requests over TLS. Limit lookups and prevent unrestricted phone-number/name enumeration. Document unavoidable metadata exposure: destination identifiers, gateway associations, timing and envelope size are not hidden by payload encryption.

## Packet and security gate

The current v2/v3 designated-carrier rules, grant chains and hop authentication remain enforced. An Internet gateway may not bypass them, expand a grant, impersonate the origin or rewrite the signed destination/lifetime.

Before coding transport ingress, specify a reviewed extension for external forwarding authority, capability negotiation and a versioned gateway transfer envelope. Define exactly who may accept, store, download and locally forward each envelope. Include cross-platform vectors, replay binding and old-client behavior. Unsupported clients continue local messaging and do not advertise external gateway support.

Retain immutable logical message IDs and packet IDs across retries/transports. Proposed transfer metadata includes envelope version, packet ID, opaque mailbox address, original expiration, ciphertext digest, bounded size and authorization reference. Additional wrappers must not silently change the authenticated inner packet. Never extend expiry at a gateway or server.

Keep end-to-end message encryption independent of TLS/libp2p session encryption. A compromised gateway or directory must not produce a valid destination delivery/read receipt. Use established primitives; cryptographic changes require explicit security review under AGENTS.md. No new wire protocol is approved by this requirements document.

## Routing and receipt behavior

- Prefer a suitable local route. Consider an external route when no useful local route exists or a measured local transfer stalls; respect sender and gateway data policies. Decide using measured queue load, failures, latency and payload size, rather than signal bars alone.
- Require an authenticated external capability before sending to a gateway. Friendship with the gateway is not required; authorization to deliver a chat remains between source and destination.
- Check actual delivery-service reachability separately from Wi-Fi radio availability. Never disable local delivery because Internet validation fails.
- Keep hop and copy budgets explicit across local/external boundaries. MVP admits one selected gateway copy per transfer, with replacement/retry by immutable ID; do not flood all gateways.
- Retry with exponential backoff, jitter and server retry hints. Stop admission immediately on sharing-off or budget exhaustion. Avoid repeatedly uploading the same envelope following ambiguous timeouts.
- Persist accepted ciphertext before returning a storage ACK. Define separate ACKs for gateway storage, remote service storage and destination delivery. Only the recipient's verified receipt marks a message Delivered; only its read action marks Read.
- Recipient durable inbox uses a unique source-device/logical-message key. Repeated envelopes do not duplicate bubbles, notifications or read side effects. Maintain a bounded receipt cache to return an existing receipt when a duplicate arrives.
- Return receipts to the source's mailbox and/or a source-authorized gateway. The source being offline is not a reason to discard them. Give small receipts priority while reserving progress for ordinary text.
- Relay-readable delivery tombstones require a separate authenticated/privacy-reviewed design. Until then, do not let an untrusted server ACK delete unrelated local carrier copies or claim final delivery.

## Proposed remote API contracts

| Operation | Contract |
| --- | --- |
| Device challenge/enrollment | Proof of possession; idempotent device registration; reviewed account binding |
| Publish/withdraw gateway availability | Gateway-authenticated expiring record, bounded capabilities and sequence |
| Publish destination route | Destination-authorized gateway lease; revocation and expiry |
| Resolve permitted destination | Authenticated, rate-limited lookup; return signed bindings and expiry or unavailable |
| Upload envelope | Immutable idempotency key; validate authorization, expiry and size; return durable-storage ACK or explicit rejection |
| Fetch authorized mailbox | Cursor-based bounded batch; require destination/gateway delegation; exclusive leases expire after interruption |
| Commit mailbox consumption | Remove only after durable next-stage storage; end-to-end Delivered remains receipt-driven |
| Upload/fetch receipt | Original-message binding, destination authentication and idempotent storage |

Specify exact schemas, error codes, authentication tokens and replay rules before implementation. Upload body streaming must have a hard size limit. Never follow arbitrary relay-provided URLs; destination resolution selects approved service endpoints, not an open proxy.

## Consent, data, congestion and storage

The original proposed gateway policy defaults Off and uses daily caps. The October 5, 2026 community-sharing UX requirement supersedes those **product defaults** with an ON draft, Wi-Fi enabled/Unlimited, mobile disabled/100 MB when enabled, explicit Save consent, and device-local calendar-month caps. The native onboarding and Settings controls now save these preferences only; no Internet transport, usage meter, quota enforcement or gateway activation is implemented. The draft must never start traffic. Monthly cap enforcement and bounded traffic reservations remain requirements for the future gateway integration. See [community sharing implementation](COMMUNITY-SHARING-UI.md).

Original proposal (retained for engineering context): Enable from an optional onboarding step or Settings → Help deliver messages. Explain: “Help nearby people send messages using your connection.” Offer Wi-Fi only (default), allow mobile data, a daily limit, usage today, and immediate pause. Enabling Wi-Fi-only sharing is still Internet use and may consume a metered Wi-Fi allowance. Turning sharing off preserves the user's own local messaging.

Proposed MVP defaults, configurable only within reviewed hard caps:

| Resource | Initial limit |
| --- | --- |
| Volunteer gateway storage | 128 packets / 512 KiB shared with existing carry budget; no second unrestricted queue |
| Internet transfer concurrency | Two active requests per gateway; receipt capacity reserved within that limit |
| Daily sharing budget | 10 MiB; mobile data requires explicit opt-in |
| Envelope size | Existing 16 KiB packet bound; text/receipts only for MVP |
| Message TTL | Preserve originating packet expiry; no longer-lifetime default in this change |
| Remote mailbox | 128 envelopes / 1 MiB per destination, plus per-source and deployment-wide quotas |
| Receipt/replay entries | Bounded by admitted volume and message expiry; never indefinite |

Count uploads, downloads, receipts, retries and framing overhead in the sharing budget. Atomically reserve bytes before sending; reconcile completion and release unused reservations. State whether TLS/OS overhead is estimated: application byte accounting is not an exact carrier billing measurement. Shared budgets must survive app restart and concurrent requests. Quota exhaustion returns an explicit error; never acknowledge then silently drop unexpired data.

Remove expired data first. Apply per-source fairness, reserved receipt capacity, circuit breaking and bounded retry. An accepted offline queue persists through interruption. Service operators need storage/cost limits and abuse controls independently of volunteer quotas. Handle revocation, account deletion and backup separately; deleting a local profile must not publish credentials that remain valid remotely.

## Platform and user experience

Implement Kotlin and Swift adapters behind the external routing boundary. Reuse platform-secured identity/storage and existing notification flows. Android background service/work scheduling and iOS permitted task/session APIs need separate current-API review and physical tests; neither libp2p nor notifications establish continuous background relay. Never promise delivery after force-stop/force-quit.

Use normal message status: Waiting, Sending, Delivered, Read. Optional message info shows Local/Internet path and available authenticated hop evidence. A missing route cannot justify saying the other user force-quit their app. Show budget or sharing errors to the gateway owner, without exposing another person's conversation. A recipient's own optional Internet mode must be independent from volunteering mobile data for others.

## Implementation phases and acceptance

1. Security/protocol specification: define remote authority, device enrollment, pinned identity behavior, transfer and receipt schemas; obtain explicit security review before changing signed wire behavior.
2. Backend prototype: challenge/enrollment, directory leases, opaque mailboxes, quotas and idempotency. Integration tests include expiry, replay, wrong-device fetch, revoked delegation, concurrent upload and lost responses.
3. Android gateway and direct Internet client: durable handoff, consent/budget enforcement and local fallback. Use controlled service endpoints in experiments.
4. Swift parity: same transfer/receipt vectors and policies; foreground proof precedes independent background gates.
5. Physical mixed-route proof: offline A → local B with Internet → service → connected D; then service → connected C → offline D. Disable mobile data on offline endpoints and capture verified ingress/egress paths.
6. Reliability/load gates: sender offline on receipt return, gateway movement/restart, service outage, expired route, quota full, duplicate gateways, revoked gateway, duplicate fetch, and new/old client combinations. Simulate 100 users at one text/minute for 30 minutes, then a simultaneous burst; test reduced storage and budget exhaustion.

Acceptance requires one visible destination message and one notification despite repeated transfers; verified receipts eventually reach the source before expiry; offline local messaging works with the directory/service blocked; no plaintext exposure in server/gateway diagnostics; mobile-data sharing cannot occur when disabled. Measure p50/p95 delivery and receipt latency, bytes per delivered text, duplicate-transfer ratio, queue depth, energy and fairness. Proposed healthy foreground direct-Internet target is p95 under 5 seconds excluding local discovery; report local multi-hop/background results separately. Do not claim this target is achieved without physical measurements.

## libp2p decision and sources

Evaluate libp2p later behind the external transport adapter, comparing direct Internet and relay connectivity, bootstrap dependence, mobile packaging, handshake overhead, energy and recovery. It is not a substitute for the directory authorization, offline mailbox or durable local carry protocol. Circuit Relay v2 provides live relayed connections with reservations and data/time limits, rather than this complete disconnected store-carry-forward application. [Official circuit relay documentation](https://libp2p.io/docs/circuit-relay/), [Circuit Relay v2 specification](https://github.com/libp2p/specs/blob/master/relay/circuit-v2.md).

Legal/carrier/campus deployment approval remains unresolved for the intended jurisdiction and plan. This specification does not approve paid resale or promise that forwarded app traffic avoids hotspot classification. Begin any campus pilot with an approved connection; obtain carrier guidance for mobile sharing before a public rollout.

Repository references: [architecture boundaries](ARCHITECTURE.md), [radio versus Internet](WIFI-RADIO-VS-INTERNET.md), [transport-independent protocol note](TRANSPORT-INDEPENDENT-PROTOCOL-NOTE.md), [current networking audit](LOCAL-NETWORKING-AUDIT.md), [DTN recommendations](research/dtn/recommendations.md).
