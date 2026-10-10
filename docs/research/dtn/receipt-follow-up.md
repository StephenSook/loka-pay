# Receipt and congestion follow-up — 2026-10-03

Implemented in this change:

- Android Message info uses a draggable Material bottom sheet with scrolling content.
- Android and Swift retry batches prioritize up to three locally known delivery/read
  receipts and leave one slot for ordinary eligible traffic. Remaining slots can
  be filled when either class is empty. The existing four-packet batch and 15-second
  retry eligibility remain unchanged; this is scheduling, not a delivery deadline.
- Native tests check three receipts plus one ordinary message under contention.
- Synthetic tests cover heterogeneous device byte quotas, refusal without lost copy
  budget, absolute expiry cleanup, and the two-carrier duplicate/return-ACK example.

Current receiver behavior saves one incoming logical message per sender and logical
ID before acknowledging it. Receiving another copy does not create another bubble
or notification. Delivery and read are distinct: arrival alone never means read.
Existing encrypted receipts are authenticated at the original sender; an arbitrary
relay cannot claim delivery or erase its source outbox.

Remaining gaps: native v2 authorizes only one durable carrier, so the simulator's
A/B/C/D replication example is not yet a supported native replication policy.
Relays cannot inspect encrypted receipts to purge their retained copies early;
expiry remains the cleanup boundary. Receipt creation has a five-minute in-memory
logical-ID cooldown, and restored carry frames do not recover urgent classification.
These require a durable receipt obligation/index and a reviewed authenticated
cancellation/replication design, not an unauthenticated 'already received' flag.

Small receipt plaintext still carries the current RSA public key, wrapped AES key,
signature and authenticated envelope. No compression or wire-format change is
introduced here. Ciphertext compression should not be presented as a speed fix.
A compact receipt protocol needs compatibility and security review and actual
encoded-byte measurements before adoption.

Validation: 17 simulator tests; Android core test suite and debug build; full native
Swift/Java messaging checks including the new fairness case. These are software
checks, not new physical/background delivery measurements. No phone installation
is claimed for this change.
