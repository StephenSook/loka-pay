# NIST D2D and public safety

NIST studies device discovery, direct communications and relay/resource behavior
for public safety, including cellular sidelink systems. [D2D program](https://www.nist.gov/programs-projects/network-modeling-public-safety-communications/device-device-d2d-communications),
[discovery study](https://nvlpubs.nist.gov/nistpubs/TechnicalNotes/NIST.TN.2149.pdf).
These are not proof that an ordinary app can access a phone's LTE/NR sidelink.

ADAPT the experimental method: measure discovery separately from link setup,
payload transfer, relay availability and congestion. Test partitioning and
repeated joins instead of only stationary pairs. FUTURE cellular sidelink as a
transport, contingent on actual public APIs and supported hardware. REJECT
using NIST radio simulation results as LOKA phone measurements.

LOKA emergency policy proposal: an arbitrary peer's “emergency” bit cannot bypass
byte budgets or preempt all other traffic. Reserve bounded control capacity,
rate-limit each admitted peer and retain fair service for ordinary messages.
An organization-specific emergency credential would be a separately reviewed
feature, not an excuse to trust anonymous priority claims.

No public-safety reliability claim is supported by the current simulator. It
models partitions and bounded admission, not cellular scheduling or emergency
certification. [Congestion design](congestion-control.md), [physical tests](physical-test-results.md).
