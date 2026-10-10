# Paired prediction comparison

Synthetic experiment only. Whole-frame instantaneous contacts, simplified predictors,
assumed control sizes and honest peers; no native replay, energy measurement,
gateway implementation, Bluetooth timing or physical background qualification.

| Scenario | Seed | Policy | Delivered | Sender confirmed | p95 seconds* | Wire bytes |
| --- | --- | --- | --- | --- | --- | --- |
| routine | 1 | direct | 33/36 | 13 | 615.0 | 104480 |
| routine | 1 | controlled | 35/36 | 27 | 142.0 | 18676224 |
| routine | 1 | spray | 36/36 | 35 | 520.0 | 425984 |
| routine | 1 | prophet | 36/36 | 36 | 200.0 | 1229240 |
| cold | 1 | direct | 28/36 | 18 | 676.0 | 85776 |
| cold | 1 | controlled | 36/36 | 32 | 177.0 | 19015712 |
| cold | 1 | spray | 36/36 | 34 | 458.0 | 415776 |
| cold | 1 | prophet | 36/36 | 36 | 183.0 | 973968 |
| changed | 1 | direct | 33/36 | 11 | 615.0 | 104112 |
| changed | 1 | controlled | 35/36 | 29 | 138.0 | 19090432 |
| changed | 1 | spray | 36/36 | 36 | 509.0 | 433984 |
| changed | 1 | prophet | 36/36 | 36 | 244.0 | 1249832 |
| congested | 1 | direct | 33/36 | 13 | 615.0 | 104480 |
| congested | 1 | controlled | 4/36 | 1 | 142.0 | 1262080 |
| congested | 1 | spray | 27/36 | 9 | 542.0 | 888288 |
| congested | 1 | prophet | 22/36 | 4 | 498.0 | 1113160 |

*Latency percentiles cover delivered messages only. Lower latency with fewer
deliveries does not establish improvement. Compare offered-load rejection and ACK
rates as well as latency. Cold/warm policies use the same post-training traffic
within each paired scenario. Training is generated past contact data, not future
routing knowledge. Changed routines intentionally invalidate the training pattern.

Adoption: not approved. Held-out real traces, privacy/poisoning tests, native
control encoding and energy measurements remain required by the integrated plan.
