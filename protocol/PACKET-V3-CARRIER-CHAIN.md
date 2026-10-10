# Packet v3: bounded carrier-to-carrier forwarding

Update 2026-10-04, 0.6.39 (47): a listed direct destination no longer suppresses the existing bounded carrier authorization indefinitely. Pending envelopes become eligible for their one successor after 15 seconds from creation, even if the direct transport still reports ready. Direct routes remain usable; grants are not reassigned and copy limits/expiry/signatures remain unchanged. This addresses a reproduced stale-ready-link failure, not a confirmed diagnosis of every reported physical failure.

Implementation date: 2026-10-04. Experimental; native test results are distinct from physical-radio proof. See `security/MULTI-CARRIER-V3-REVIEW.md` for explicit security review and limitations.

## Behaviour

New ordinary messages to a verified v3-capable contact can follow A → B → C → D without A remaining connected. B and C retain encrypted packets in the existing sealed carry journal. Every holder first tries an available direct destination link. Otherwise, the current chain tail may authorize one new compatible carrier, up to three carrier grants. Earlier holders may retry their selected successor or deliver directly; they cannot choose a different successor after committing a grant. User-facing relay selection is unnecessary.

Limits remain one hour, 128 pending envelopes, 512 KiB sealed-journal plaintext input, 112 ordinary admissions (16 reserved for locally generated urgent receipts), and 2048 replay records. Full storage rejects admission without marking the message seen. Expiry is not extended by a relay. Existing legacy v0/v1/v2 packets keep their original rules.

This is a **linear bounded delegation chain**, not epidemic flooding or transactional binary spray-and-wait. Cooperative retained copies are origin + up to three carriers. A compromised holder can fork signatures, and reset/rollback of device storage is outside the cooperative copy-bound assumption. Relay-readable delivered tombstones and global deletion acknowledgements are not implemented.

## Exact encoding

All integers are big endian. Strings use the existing canonical ASCII two-byte length representation; byte arrays have signed int32 nonnegative length followed by bytes. Maximum frame remains 16384 bytes. RSA key format, OAEP parameters and AES-GCM are unchanged.

Header / AES associated data:

1. int32 version = 3
2. UUID string, source fingerprint string, destination fingerprint string
3. int64 creation time, int64 expiry time, milliseconds
4. int32 return-hint count 0…3; that many fingerprint strings

Original sender signature input = header + blobs(sender public key, wrapped AES key, nonce, ciphertext). The signature uses the existing RSA-SHA256 primitive.

Wire frame = header + int32 remaining hops + blobs(sender public key, wrapped AES key, nonce, ciphertext, original signature) + int32 grant count 0…3 + grants.

Each grant = target fingerprint string + delegator public-key blob + delegation-signature blob.

Delegation signature input = string `LOKA-CARRY-V3` + blob(original sender signature input) + blob(original signature) + int32 preceding-grant count + preceding grants in wire format + next-target string. The first delegator must match the source fingerprint; each later delegator must match the preceding grant target. Targets are unique, distinct from both endpoints. Keys are validated RSA-3072 SPKI with exponent 65537. Verify the entire chain before admission. Truncating the chain to a valid prefix does not create authority for another identity; only the authorized tail's private key can extend it.

Hop position: source sends with 6; first carrier retains/sends with 5; next with 4; third with 3. A relay receiver verifies the incoming authenticated discovery identity is `holders[6-hops]` and itself is the next authorized holder. A final recipient verifies the original envelope, chain, trust and valid index; its sealed inbox can recover without a live link. Hops remain mutable transport observations, not signed evidence that every authorized carrier physically received the payload.

## Durability and receipts

Save the extended chain atomically before transmitting. If saving fails, keep the previous packet and do not send the new grant. Restarts restore the extended chain, never reassign a timed-out grant. A transport enqueue is not custody or delivery. The sender's original encrypted payload, ID, deadline and signature stay stable as grants are appended.

Delivery receipts are separate end-to-end encrypted messages using existing application receipt content. The destination supplies authenticated reverse hints from the consumed carrier prefix (excluding unused pre-authorized successors). Each receipt holder still signs its own next grant; hints do not confer authority. A direct destination route wins. Otherwise reachable reverse hints are preferred over another eligible carrier. Destination duplicate packets can regenerate a receipt under existing bounded suppression; they do not append duplicate chat messages. Relays cannot set Delivered and can retain expired-later copies even after destination delivery.

## Negotiation and routes

Verified nearby profile sessions advertise both `LP1|V|2` for older peers and `LP1|V|3`. Receipt of v2 must not lower a currently verified v3 capability. Known contact capability is remembered locally; strangers only use live bounded profile state. Unknown/older endpoints continue to originate v2. Upgrade both endpoints and let them discover each other before expecting new v3 messages. Saved v2 messages are not silently converted.

At each hop selection uses existing ready verified routes ordered by queued bytes, then local-Wi-Fi preference, then stable handle. Retry cooldown and duplicate suppression apply to logical peer identity across transports. It does not wait for unavailable Wi-Fi or require Internet. This is backlog-aware selection, not measured end-to-end fastest routing. No Wi-Fi technology is newly enabled by v3, and platform background suspension remains unchanged.
