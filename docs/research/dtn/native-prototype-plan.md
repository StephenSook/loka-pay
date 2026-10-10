# Next native experiment: durable carry, behind a version gate

Update 2026-10-03: the user requested automatic routing in ordinary chats instead of
a manual carry experiment. Build 0.6.33 implements [automatic single-carrier v2](../../../protocol/PACKET-V2-AUTOMATIC-CARRY.md)
with delayed source authorization, encrypted persistence and capability-gated writes.
The original research/gates below are retained as context. Native evidence is recorded
in the physical-status document; physical/background qualification remains outstanding.


Status: proposed, not implemented or approved as a cryptographic design. This is
the smallest next experiment after the [audit](current-architecture.md) and
[simulator](simulation-results.md). It extends the existing LOKA cores and providers;
it does not replace the applications or introduce an online delivery dependency.

## Interfaces

Keep immutable authenticated envelope bytes separate from locally mutable state.
The mesh asks a `RelayStore` to admit, enumerate eligible offers, commit a transfer,
expire and delete. A scheduler consumes authenticated peer capabilities and
transport drain events. Neither the store nor a radio adapter decrypts chat content.

Conceptual storage records (not a finalized wire schema):

| Record | Required meaning |
|---|---|
| Envelope | Exact versioned bytes, stable ID/digest, validated sender policy and immutable expiry |
| Local copy | Local receipt/retention deadline, byte cost, owned replication allowance, admission class |
| Transfer journal | Peer binding, transfer ID, reserved allowance, commit/abort state and retry deadline |
| Duplicate state | Exact status and bounded expiry; temporary rejection distinct from durable acceptance |
| Receipt/cancel record | Authenticated proof where supported, original message binding, bounded retention |

Record identifiers exposed to logs must be distinct from permanent user identities.
Do not store plaintext profile/contact graphs in the relay journal.

## Admission and restart sequence

1. Bound frame length and concurrent verification work before parsing large input.
2. Verify signature, identity binding, supported policy and current expiry.
3. Check duplicate state, destination handling, byte/count quotas and resource policy.
4. Reserve space; atomically store ciphertext and local state using native durable storage.
5. Only after commit report durable **carrier admission**, never final delivery.
6. On restart, open protected store, expire invalid records, validate bounded metadata,
   recover incomplete transactions and enumerate eligible copies when a real link appears.

A destination needs a transaction that preserves received content and the obligation
to produce a receipt. A full ordinary queue must not silently lose that obligation.
The [full-queue test](../../../experiments/dtn-sim/test_sim.py) demonstrates this failure
in the baseline model; a reserved bounded receipt journal is the next test candidate.

## Replica transaction failure cases

Do not decrement allowance merely when an asynchronous transport accepts a buffer.
Also do not restore allowance blindly after a timeout: the receiver might already
have committed. Use idempotent transfer IDs and a reviewed recoverable protocol.
Resolve which party owns ambiguous tokens without minting copies; accepting fewer
copies is safer than violating the bound, but measure the delivery cost. Packet v0
has no such exchange, so this cannot be added as an invisible local counter.

## Compatibility and locked devices

Specify negotiation before introducing a longer lifetime or new authenticated policy.
Old peers must not receive a packet they will reject while the UI claims carriage.
Do not change v0 validation to accept hours-old signatures without corresponding
replay, storage, resource and security analysis. Maintain shared Kotlin/Swift vectors.

On iOS, decide which relay data and verification keys may be accessible after first
unlock and while locked; preserve the user's security expectations. If access is
unavailable, report paused capability and retain state until supported execution.
On Android, test foreground service recreation, process restart and force-stop
separately. Persistence survives only supported lifecycle/storage conditions;
uninstall, explicit delete-all-data and inaccessible keys are not recoverable promises.

## Required native tests before phones

- Kill around every store/transfer transaction boundary; no false durable admission.
- Duplicate arrivals through two radios; one stored copy and conserved allowance.
- Capacity rejection followed by space recovery; temporary rejection does not poison retries.
- Exact expiration boundary, forward without expiry reset, clock rollback/forward,
  process restart and corrupted/unsupported records.
- Destination save with receipt queue full; eventual authenticated receipt retry.
- Cancel/receipt forgery and replay tests only once those control formats are reviewed.
- File protection and at-rest confidentiality review; no relay plaintext or key logging.

Then run the foreground three-phone carry test before extending duration or testing
background. A successful simulation is not grounds to skip that order.
