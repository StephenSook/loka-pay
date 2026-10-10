# Bounded carrier chain v3 — explicit security review

Date: 2026-10-04. Reviewer: implementing Codex agent, manual design/code review. This is not an independent cryptographic audit or production certification.

## Scope and decision

Reviewed `Packet.kt`, `LabCrypto.kt`, `MeshEngine.kt`, `MeshNode.kt`, `LokaProtocol.swift`, and `LokaMesh.swift` changes, plus the proposed capability/receipt application integration. **Proceed with local implementation and automated validation of the experimental v3 protocol.** Installation requires passing the native interoperability and regression checks. Physical reliability remains unproven. Existing AES-GCM/RSA-OAEP/RSA-SHA256 algorithms and key storage remain unchanged; this is a new signed routing authorization format, not a new cipher.

## Security invariants checked

- Original sender signature binds immutable identity, endpoints, deadline, ciphertext and return hints. GCM also authenticates immutable routing header. A relay cannot replace plaintext, extend expiry, or nominate itself as sender.
- A domain-separated RSA-SHA256 delegation signs original signed bytes, original signature, all preceding grants and next recipient fingerprint. Verify every delegator against the preceding holder before accepting. Reject loops, endpoint grants, more than three grants, oversized fields, invalid keys/signatures and trailing bytes.
- The current holder may choose exactly one successor. The updated chain must be saved before any transmission. Queue acceptance does not remove its copy; retries use the same grant. Timeout never restores an allowance. Reopening the archive restores the committed grant and hop position.
- Relay receiver checks the authenticated live profile identity against the claimed current holder and hop index. A grant records authorization, not proof of delivery or physical proximity. Direct shortcuts to the destination remain valid from any holder. Do not display unused grants as actual travelled hops.
- Cooperative retained copies are bounded to origin plus three relay holders per envelope; the destination may separately save plaintext. No global Byzantine bound is claimed: a compromised holder can fork signed grants or erase its own journal. Existing per-device 128-item/512-KiB quotas, 112 ordinary admission threshold, 2048 replay records and one-hour expiry remain essential.
- Relay admission saves before marking seen. Failed storage does not poison retry. Destination duplicates can regenerate receipts but must not append another chat bubble. Receipt payloads remain endpoint authenticated; no carrier can assert Delivered. Return hints guide selection only and do not authorize forwarding.
- v0/v1/v2 bytes remain unchanged. v3 is sent only after verified capability evidence (or a received valid v3 route for a return receipt). Persist capability only for known contacts, use live verified evidence for anonymous carriers, and never downgrade a current profile merely because its compatibility v2 advertisement arrives later.

## Findings / required implementation checks

1. Persisted capability must not become an unbounded list of strangers. Limit persistence to trusted contacts; live relay capability can remain in existing bounded discovery state.
2. Receive-before-profile readiness must fail closed and rely on retry. This may delay delivery; it is not a permanent background guarantee.
3. Encrypted receipts are not relay-readable cancellation tokens. Relay copies can remain until expiry after delivery; duplicate suppression and retry backoff are still required. Do not claim immediate network-wide cleanup.
4. More signed metadata increases frame size (up to three RSA grants). This improves reachability, not necessarily BLE speed. Measured transfer-time routing and compact cryptography are separate work.
5. Initial carrier selection uses verified ready links and backlog/transport preference. No contact prediction, global shortest path, or measured fastest-route guarantee is implemented here.
6. Restoring old v2 envelopes cannot silently turn them into v3; only new eligible messages use the new format.

Validation required: real Kotlin/Swift envelope interchange and handoff signatures; A→B→C→D with origin absent; reverse receipt; restart after delegation; full-store rejection/retry; expiry; signature tamper, wrong holder, loop/limit, duplicate and v2 compatibility. Results recorded separately when executed.

Reference: [RFC 9171](https://www.rfc-editor.org/rfc/rfc9171.html) distinguishes forwarding, expiration and delivery. LOKA v3 is not BPv7 wire format or a claim of BP interoperability.

Follow-up review: destination recovery from the sealed locked inbox must work without the old transport handle. Final recipients verify the original signature, grants, valid hop-index range and trusted sender, but do not require a live carrier identity. This cannot authorize another relay or reveal plaintext to carriers. Mutable hop information remains an observation, not cryptographic proof of traversal. Return hints use only the consumed chain prefix, excluding pre-authorized but unused successors.

Privacy: grant chains and reverse hints expose bounded device fingerprints and delegator public keys to participating relays. They contain no profile names, coordinates or plaintext content, but enable route correlation. They must not be described as anonymous metadata. No such chain is uploaded by this change.

## Executed validation / disposition

78 Android core tests passed, including v3 tampering/loop/grant-cap tests, admission failure retry, failed delegation commit, ambiguous transmission followed by restart, ordinary quota and receipt reserve. Complete Swift/Kotlin suite passed, including actual Swift→Kotlin→Swift→Swift retained forwarding, unchanged ciphertext, reverse encrypted receipt, destination duplicate suppression, expiry, and destination locked-inbox recovery without a live handle. Both native apps compiled; version 0.6.38 installed preserving data on two Samsungs and the iPhone. iPad unavailable. Physical multi-carrier/background/range gates remain unpassed. This supports experimental installation, not production certification.

## 2026-10-04 stale-direct-route scheduling review

Implementing-agent review: allow the existing single successor authorization when an envelope remains pending for 15 seconds even if a verified direct destination handle is still listed. This changes scheduling only: no wire, signature, key, trust, expiry, copy allowance or reassignment change. Direct delivery may still be attempted; ordinary duplicate/receipt rules apply. Queue acceptance is not delivery. A delayed/lost receipt can cause the already-authorized extra copy; bounded copies and original expiry constrain it. This threshold is a conservative experiment parameter, not a measured optimum. Tests must simulate a direct writer accepting and silently losing frames while an untrusted carrier can deliver in two hops, for v2 and v3. An existing successor must not be replaced.

## Diagnostic / automated physical test review

2026-10-04: add bounded redacted lifecycle logging of packet prefixes, source/destination fingerprint prefixes, verified ingress role, fixed rejection reason and queue occupancy. No payload, names, keys, radio addresses or message text are exported. Test launch options are development-build-only; synthetic sends accept only an existing trusted contact and `LOKA relay test ` prefix, at most one per process launch, with a 60-second readiness deadline. A development-only excluded-peer option may suppress a direct routing identity for controlled physical tests. It does not add contacts or weaken signatures/admission; reset by launch without the option. Results must label this as software route exclusion, not range proof. Profiles/private data must be preserved. Proceed with diagnostics and authorized synthetic physical tests.

## 2026-10-04 — BLE server subscription admission review

Physical Bluetooth-only diagnosis found repeated valid indication CCCD requests rejected with `peerPresent=false`; Android connection callbacks populated unrelated unready records and did not establish the requesting service session. Peer slots now begin at a valid native subscription request, rather than all physical connection callbacks. Duplicate connected callbacks preserve an existing session. Admission requires the running GATT server, correct CCCD, offset zero, no prepared write, exact enable/disable value, and at most four service peers. This admits a transport session only: the public link probe, existing allow policy, ingress budget, verified profile handshake, signed carrier grants and destination friend validation remain in force. No key, ciphertext, signature or wire-version change. Malicious subscriptions may occupy bounded slots as before; no unbounded allocation or friend auto-acceptance is introduced. Manual implementation review, not an independent audit. Hardware proof follows in the experiment record.

BLE congestion follow-up: verified LP1 capabilities now refresh every 120 seconds with only the supported version, while unconfirmed peers retain 15-second negotiation retries. Completed consent exchanges stop periodic retransmission; reconnect still replays their existing handshake response, and pending approvals/requests keep their retry behavior. Wire strings, cryptography, trust checks and signed carrier bounds are unchanged. The quiet-link and reconnect regression covers retained consent and verified v3 capabilities.

## 2026-10-04 — tokenless BLE service initiation

Android now attempts a bounded outgoing connection when the native scan filter matches the LOKA service UUID and the service advertisement has no Android role-election token, as in the current Apple peripheral. Present malformed tokens and self tokens remain rejected; distinct Android tokens retain one-initiator election. Discovery authorizes no person or message. Existing four-session limit, 32-candidate bound, 30-second per-address retry cooldown, setup/operation deadlines, public link probe, verified LP1 identity binding and packet/grant/destination trust checks remain unchanged. A tokenless advertiser may be malicious and can consume only the existing bounded unverified-session resources. No key, cryptography or packet-schema change. Duplicate incoming/outgoing routes still share per-identity packet retry suppression. This is a manually reviewed fallback; hardware reliability and background behavior must be measured.

The physical retry also uses a development-only `--loka-test-ble-only` iPhone launch restriction: Wi-Fi/Aware start is suppressed, mesh links are filtered to BLE handles, and the packet writer rejects non-BLE handles. This only removes permitted test transports; no identity or cryptographic check is bypassed. Normal launch/release does not enable this restriction; radio preferences and existing messages are preserved.
