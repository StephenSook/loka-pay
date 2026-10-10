# Native encounter trace capture — 2026-10-05

Android and iOS development builds now automatically sample authenticated,
connected nearby identities alongside shadow history. Production builds do not
capture this trace. Capture does not change carrier authorization, packet formats,
receipts or route selection.

The app writes `loka-encounter-trace.json` in its private cache. It contains a
random process scope, relative milliseconds, integer peer aliases, and a dropped
observation count. It contains no names, phone numbers, public keys, stable device
fingerprints, messages or precise wall-clock timestamps. Several radio handles
for the same verified identity become one alias. This is still contact-pattern
metadata: collect only from consenting test devices, keep it private, and delete
exported copies after analysis. Nothing is uploaded automatically.

Bounds: first 512 observations and at most 256 aliases; each observation includes
at most 64 identities. Once a bound is reached, subsequent observations are
counted as dropped rather than overwriting earlier evidence. At a two-second
cadence this covers approximately 17 minutes; connection-change callbacks can
shorten the iOS window. Relaunching starts another scope. Clock reversal clears
the trace and starts a new scope. Android stores it in app-private cache; iOS
uses complete file protection. These debug exports are deliberately separate
from encrypted persistent history and are not an encrypted backup.

For Android, collect using authorized USB diagnostics:

```sh
adb -s DEVICE_SERIAL exec-out run-as org.loka.meshlab cat cache/loka-encounter-trace.json > /tmp/android-encounters.json
python3 experiments/dtn-sim/encounter_replay.py /tmp/android-encounters.json
```

For iOS, copy `Library/Caches/loka-encounter-trace.json` from the development app's
container using Xcode Devices and Simulators or the existing devicectl workflow,
then pass that file to the same replay command. Collection is an engineering
operation; ordinary users have no routing test controls to configure.

Replay validates bounds and chronology, applies five-second qualification,
60-second reconnect suppression, suspension reset, decay, 64-record capacity
and 24-hour expiry. It reports incomplete capture explicitly. Replay starts with
cold history, rather than copying the device's persisted private history. Tied
capacity eviction uses alias order; native eviction uses identity order, so
results at tied capacity boundaries are not exact native parity.

This is a single-device observation replay, **not** a full mesh performance
comparison. Aliases intentionally cannot be joined across phone exports.
Global topology, transport latency, transfer bytes, custody/receipt outcomes,
energy and prediction poisoning still need separately reviewed instrumentation
and controlled experiment mapping. The earlier paired policy comparison remains
synthetic. Do not enable prediction-based routing based on this trace alone.

Verification: Kotlin and Swift cover identity redaction, alias stability, bounded
capture, dropped counts and clock reset. Python covers reconnect churn,
suspension, truncation and malformed traces. Real phone capture is a separate
pending gate.
