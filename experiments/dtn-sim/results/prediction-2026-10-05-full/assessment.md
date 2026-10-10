# Prediction adoption assessment — 2026-10-05

This is a synthetic stress comparison, not measured LOKA phone performance.
Each cell is the arithmetic mean across seeds 1–3. Latency covers delivered
messages only; uncertainty intervals are not computed, so these results cannot
establish a reliable prediction gain. There are 3,000 offered texts per case.

| Scenario | Policy | Delivered % | Sender confirmed % | Delivered-only p95 s | Wire MB |
| --- | --- | --- | --- | --- | --- |
| routine | direct | 5.68 | 2.63 | 1721.3 | 0.96 |
| routine | controlled | 4.40 | 0.28 | 1560.5 | 64.21 |
| routine | spray | 13.76 | 3.30 | 1742.3 | 13.86 |
| routine | prophet | 13.22 | 2.11 | 1888.7 | 32.21 |
| cold | direct | 5.59 | 2.38 | 1665.6 | 0.94 |
| cold | controlled | 4.27 | 0.32 | 1718.8 | 63.94 |
| cold | spray | 13.78 | 2.97 | 1796.3 | 13.80 |
| cold | prophet | 14.27 | 2.18 | 1887.5 | 27.87 |
| changed | direct | 5.69 | 2.48 | 1730.5 | 0.96 |
| changed | controlled | 4.12 | 0.33 | 1647.1 | 63.90 |
| changed | spray | 14.12 | 3.31 | 1760.1 | 13.90 |
| changed | prophet | 13.02 | 1.97 | 1936.0 | 33.05 |
| congested | direct | 1.99 | 0.33 | 1987.5 | 0.37 |
| congested | controlled | 0.23 | 0.06 | 2149.6 | 3.50 |
| congested | spray | 0.73 | 0.12 | 2135.3 | 3.76 |
| congested | prophet | 0.94 | 0.18 | 2030.5 | 4.14 |

Decision: keep native prediction shadow-only. Routine PRoPHET delivered 13.22%
versus 13.76% for spray, with 32.21 MB versus 13.86 MB of traffic. Changed-routine
PRoPHET also had lower delivery/confirmation and higher traffic. Cold-start and
congested cases show some delivery gains over spray, but do not demonstrate the
combined latency/traffic/energy adoption gate. No energy or adversarial behavior
is measured. None of these modes is a replay of current v3 grants and retries.

The very low delivery fractions reflect this intentionally restricted shared contact
schedule and offered load. They are not app reliability estimates and do not establish
that spray should replace the native designated-carrier protocol. Local phone queue
and receipt improvements remain the next production work. A captured trace baseline
and protected/authorized prediction summaries must precede native route selection.

Validation: 19 simulator/unit tests passed; smoke matrix 16 cases and full matrix
48 cases completed. Raw rows and code hashes are stored alongside this assessment.
