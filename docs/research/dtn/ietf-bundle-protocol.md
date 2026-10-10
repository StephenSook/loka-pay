# IETF DTN standards

[RFC 9171](https://www.rfc-editor.org/rfc/rfc9171.html) defines BPv7, including bundle
lifetime, age, hop-count blocks, retention constraints and convergence-layer
boundaries. Routing algorithm selection is outside its scope. It permits a node
to apply a shorter effective lifetime locally without replacing the source's
asserted lifetime. BPv7 does not retain BPv6's custody-transfer design unchanged;
do not treat a status report as an application delivery guarantee.

[RFC 9172](https://www.rfc-editor.org/rfc/rfc9172.html) defines BPSec integrity and
confidentiality services. It is not automatically an account system, key-discovery
service, metadata anonymity system or a LOKA session ratchet.

LOKA decision: ADAPT lifetime/retention separation and transport-independent
storage; EXPERIMENT with authenticated delivery knowledge; FUTURE full BP
interoperability. Packet v0 is **not BPv7**. Calling the current envelope a bundle
does not provide standards compatibility.

The proposed successor envelope needs a reviewed version negotiation, signed
policy fields and test vectors shared by Android and Swift. Reuse existing
cryptographic primitives; do not add ad hoc signatures or alter authenticated
bytes in transit. Reject unknown critical policy versions explicitly.

Clock proposal: record wall time plus monotonic elapsed time locally; detect large
clock changes, expire conservatively, and never extend the original bound after
restart. Unsynchronized-clock age handling needs its own threat review; a relay
cannot be trusted merely because it advertises a small age.

Evidence: [current signed five-minute limit](current-architecture.md),
[expiry boundary test](../../../experiments/dtn-sim/test_sim.py),
[migration proposal](ttl-lifetime.md). No standards interoperability test was run.
