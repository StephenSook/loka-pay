# Paired prediction comparison

Synthetic experiment only. Whole-frame instantaneous contacts, simplified predictors,
assumed control sizes and honest peers; no native replay, energy measurement,
gateway implementation, Bluetooth timing or physical background qualification.

| Scenario | Seed | Policy | Delivered | Sender confirmed | p95 seconds* | Wire bytes |
| --- | --- | --- | --- | --- | --- | --- |
| routine | 1 | direct | 160/3000 | 62 | 1632.0 | 936848 |
| routine | 1 | controlled | 123/3000 | 8 | 1473.0 | 63860576 |
| routine | 1 | spray | 409/3000 | 76 | 1751.6 | 13761200 |
| routine | 1 | prophet | 372/3000 | 44 | 1977.6 | 33188744 |
| routine | 2 | direct | 173/3000 | 96 | 1754.4 | 980624 |
| routine | 2 | controlled | 143/3000 | 5 | 1520.4 | 65204704 |
| routine | 2 | spray | 401/3000 | 110 | 1756.2 | 14010256 |
| routine | 2 | prophet | 404/3000 | 74 | 1867.8 | 32498904 |
| routine | 3 | direct | 178/3000 | 79 | 1777.6 | 962432 |
| routine | 3 | controlled | 130/3000 | 12 | 1688.0 | 63557760 |
| routine | 3 | spray | 428/3000 | 111 | 1719.0 | 13810624 |
| routine | 3 | prophet | 414/3000 | 72 | 1820.6 | 30955960 |
| cold | 1 | direct | 160/3000 | 74 | 1556.8 | 937024 |
| cold | 1 | controlled | 126/3000 | 12 | 1688.6 | 63724672 |
| cold | 1 | spray | 400/3000 | 87 | 1678.8 | 13943408 |
| cold | 1 | prophet | 422/3000 | 65 | 1878.4 | 27942672 |
| cold | 2 | direct | 178/3000 | 71 | 1740.0 | 955904 |
| cold | 2 | controlled | 135/3000 | 8 | 1782.4 | 64306848 |
| cold | 2 | spray | 444/3000 | 97 | 1848.6 | 14016736 |
| cold | 2 | prophet | 447/3000 | 73 | 1929.2 | 27720576 |
| cold | 3 | direct | 165/3000 | 69 | 1700.0 | 932928 |
| cold | 3 | controlled | 123/3000 | 9 | 1685.4 | 63787360 |
| cold | 3 | spray | 396/3000 | 83 | 1861.6 | 13428704 |
| cold | 3 | prophet | 415/3000 | 58 | 1855.0 | 27939040 |
| changed | 1 | direct | 171/3000 | 68 | 1632.0 | 952224 |
| changed | 1 | controlled | 129/3000 | 9 | 1450.8 | 63925088 |
| changed | 1 | spray | 439/3000 | 90 | 1694.6 | 14045200 |
| changed | 1 | prophet | 413/3000 | 58 | 1918.8 | 33454040 |
| changed | 2 | direct | 176/3000 | 87 | 1775.2 | 977344 |
| changed | 2 | controlled | 117/3000 | 13 | 1423.8 | 64368096 |
| changed | 2 | spray | 424/3000 | 115 | 1754.4 | 13994512 |
| changed | 2 | prophet | 401/3000 | 68 | 1877.4 | 33415896 |
| changed | 3 | direct | 165/3000 | 68 | 1784.4 | 941072 |
| changed | 3 | controlled | 125/3000 | 8 | 2066.8 | 63421568 |
| changed | 3 | spray | 408/3000 | 93 | 1831.4 | 13656128 |
| changed | 3 | prophet | 358/3000 | 51 | 2011.8 | 32277368 |
| congested | 1 | direct | 57/3000 | 10 | 2073.8 | 371280 |
| congested | 1 | controlled | 7/3000 | 2 | 1836.4 | 3506016 |
| congested | 1 | spray | 23/3000 | 3 | 2059.2 | 3757296 |
| congested | 1 | prophet | 28/3000 | 4 | 1873.0 | 4161464 |
| congested | 2 | direct | 60/3000 | 10 | 2051.2 | 378400 |
| congested | 2 | controlled | 6/3000 | 2 | 2282.8 | 3535840 |
| congested | 2 | spray | 23/3000 | 4 | 2236.8 | 3789536 |
| congested | 2 | prophet | 27/3000 | 4 | 2108.6 | 4191640 |
| congested | 3 | direct | 62/3000 | 10 | 1837.4 | 374864 |
| congested | 3 | controlled | 8/3000 | 1 | 2329.6 | 3468416 |
| congested | 3 | spray | 20/3000 | 4 | 2109.8 | 3743120 |
| congested | 3 | prophet | 30/3000 | 8 | 2109.8 | 4079080 |

*Latency percentiles cover delivered messages only. Lower latency with fewer
deliveries does not establish improvement. Compare offered-load rejection and ACK
rates as well as latency. Cold/warm policies use the same post-training traffic
within each paired scenario. Training is generated past contact data, not future
routing knowledge. Changed routines intentionally invalidate the training pattern.

Adoption: not approved. Held-out real traces, privacy/poisoning tests, native
control encoding and energy measurements remain required by the integrated plan.
