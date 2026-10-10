# Initial simulation results

These are synthetic contact-model measurements, not phone results. Run date: 2026-10-03. No production routing or packet format changed.

Executed **2079 cases**, with three deterministic seeds per population/environment/policy. Final runner invocation wall time: 111.5 seconds (1975 earlier cases resumed). Population values: 3, 10, 20, 50, 100, 500, 1000, 5000, 10000. 11 synthetic environment labels; six baselines plus one paired scheduling variant.

## Aggregate smoke matrix

Delivery is pooled delivered/offered. Tx/delivery and bytes/delivered-byte are pooled cost ratios; zero-delivery cases still contribute cost. Duplicate ratio is pooled duplicate transmissions/all payload transmissions. Peak storage and copies are maxima, not averages. Pooling disparate environments does **not** select a winner; use raw per-case rows for scenario decisions.

| Algorithm | Delivered/offered | Delivery | Tx/delivered | Wire bytes/delivered byte | Duplicate tx | Peak copies/packet | Peak node bytes | Rejected admissions |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| direct | 2895/26598 | 10.88% | 1.42 | 18.71 | 0.00% | 1 | 223584 | 268 |
| controlled | 8416/26598 | 31.64% | 4676.46 | 4665.48 | 59.87% | 9964 | 262016 | 142581 |
| epidemic | 14115/26598 | 53.07% | 2825.12 | 2773.27 | 0.00% | 9999 | 262016 | 11638986 |
| spray | 5215/26598 | 19.61% | 17.50 | 24.69 | 0.00% | 4 | 262016 | 475 |
| prophet | 6435/26598 | 24.19% | 46.19 | 310.49 | 0.00% | 98 | 262016 | 45110 |
| loka_v0 | 135/26598 | 0.51% | 48.11 | 327.51 | 1.77% | 6 | 230240 | 266 |
| spray + priority | 5248/26598 | 19.73% | 17.38 | 24.60 | 0.00% | 4 | 262016 | 465 |

## One-variable scheduling experiment

The same spray tokens, contacts, offered messages, lifetime and storage are used in each pair. Only transfer order changes (ACK, destination, small size).

Across 297 pairs: **20 improved, 2 worsened, 275 tied** on delivered-message count; net difference +33 messages. Three seeds are not enough for a general statistical claim. Negative cases must remain in evaluation; priority is not declared universally better.

Selected extremes (not a representative sample):

| Nodes / environment / seed | Creation-order delivered | Priority delivered |
|---|---:|---:|
| 20 / disaster / 1 | 34 | 33 |
| 50 / congested / 3 | 69 | 68 |
| 20 / sparse / 2 | 17 | 21 |
| 50 / sparse / 1 | 22 | 26 |

The direction can reverse because scheduling changes which finite opportunities are consumed. The table alone does not identify a causal mechanism for each case; packet-level trace analysis remains necessary.

The constructed 21 KB contact offers one 20 KB relay payload first and five 2 KB texts for the encountered destination. Results:

| Ordering | Delivered out of six offered | Wire bytes |
|---|---:|---:|
| Creation order | 0 | 20128 |
| Priority | 5 | 10368 |

This proves the model contains a short-contact scheduling failure; it does not establish a fair production scheduler. Starvation, chunking and real write callbacks are not represented.

## Lifetime / restart ablation

| Carry interval | Hard lifetime | Durable relay assumption | Delivered | Sender ACK returned |
|---|---:|---|---:|---:|
| 600 s | 300 s | False | 0 | 0 |
| 600 s | 300 s | True | 0 | 0 |
| 600 s | 1200 s | False | 0 | 0 |
| 600 s | 1200 s | True | 1 | 1 |
| 3600 s | 300 s | False | 0 | 0 |
| 3600 s | 300 s | True | 0 | 0 |
| 3600 s | 4200 s | False | 0 | 0 |
| 3600 s | 4200 s | True | 1 | 1 |
| 21600 s | 300 s | False | 0 | 0 |
| 21600 s | 300 s | True | 0 | 0 |
| 21600 s | 22200 s | False | 0 | 0 |
| 21600 s | 22200 s | True | 1 | 1 |
| 43200 s | 300 s | False | 0 | 0 |
| 43200 s | 300 s | True | 0 | 0 |
| 43200 s | 43800 s | False | 0 | 0 |
| 43200 s | 43800 s | True | 1 | 1 |
| 86400 s | 300 s | False | 0 | 0 |
| 86400 s | 300 s | True | 0 | 0 |
| 86400 s | 87000 s | False | 0 | 0 |
| 86400 s | 87000 s | True | 1 | 1 |

Each trace is A→B at 1 s, carrier reboot at 100 s, B→C at the stated delay, then two later return contacts. The long lifetime is sender-authorized at creation and ends 600 s after the encounter. These are fast simulations of long intervals, **not elapsed-time phone tests**. Only the combination of adequate hard lifetime and retained carrier state can pass this constructed disconnected path.

## Size-only admission stress

| Offered class | Offered items | Accepted source items | Source rejections | Peak bytes |
|---|---:|---:|---:|---:|
| text | 10000 | 128 | 9872 | 262144 |
| voice | 1000 | 1 | 999 | 200000 |
| photo | 500 | 0 | 500 | 0 |
| moment | 100 | 0 | 100 | 0 |

This intentionally uses one atomic object per item with 128 slots / 256 KiB. Photos/Moments can exceed the entire cap. It demonstrates modeled admission boundaries; actual LOKA media chunking and phone memory are not benchmarked. No media bytes or cryptography were generated.

## Reproduction, interpretation and gaps

- [Simulator and model definitions](../../../experiments/dtn-sim/README.md).
- [Every matrix case](../../../experiments/dtn-sim/results/matrix.jsonl), [focused cases](../../../experiments/dtn-sim/results/focused.json), [run metadata](../../../experiments/dtn-sim/results/run.json).
- [Model hash and 13 passing invariant/runner tests](../../../experiments/dtn-sim/results/model-manifest.json). The complete matrix also passed unique-case, capacity and copy-bound checks.
- Per-case p50/p95/p99 and ACK p95 are recorded; `null` means no observation. A p99 from few deliveries is not a stable tail estimate.
- `loka_v0` is a structural approximation with five-minute expiry. The other policies use six hours. Compare `controlled` for the equal-lifetime flooding baseline; do not call the difference from v0 a pure routing improvement.
- Offered traffic is capped at 128 messages even at 10000 nodes. Population coverage is not a user-load or device-count failure threshold.
- Battery, phone CPU/memory, radio airtime and physical range remain unmeasured. No calibrated mobility trace, exact production engine replay, utility eviction, adaptive budget, cancellation or authenticated public tombstone is implemented.
- Simulated durable state is an assumption, not crash-safe disk implementation. Background flags do not emulate iOS or an Android OEM.
- [Physical tests](physical-test-results.md) remain gated. [Recommendations](recommendations.md) specify the smallest next changes.

## Budget sensitivity and controlled failures

At 50 nodes, three environments and three seeds (900 offered messages per budget), only the token parameter changes. This is a sensitivity sample, not enough to tune an adaptive controller.

| Tokens | Delivered / 900 | Total wire bytes |
|---:|---:|---:|
| 1 | 218 | 912912 |
| 2 | 318 | 3757120 |
| 4 | 414 | 9246784 |
| 8 | 490 | 20067664 |
| 16 | 452 | 36528384 |

More replication does not necessarily improve delivery under finite queues and contacts. Do not choose a fixed production budget from this small sweep.

| Controlled failure trace | Delivered |
|---|---:|
| none | 1 |
| suspended_carrier | 0 |
| reboot_volatile | 0 |
| reboot_durable | 1 |
| relay_delete | 0 |
| battery_dead | 0 |
| transport_failure | 0 |
| uncooperative | 0 |

Each fault trace has one possible carrier and no alternative route. Suspension/death is modeled as unavailability, not OS emulation. These counterexamples expose dependence on the carrier; they do not validate recovery, adversarial security or background scheduling.

[All 53 sensitivity/failure cases](../../../experiments/dtn-sim/results/sensitivity.json).
