# EXP-005 — Alternate route after failure

Status: procedure only; not executed. Run after repeatable foreground EXP-003 success and before claiming the second technical gate. The current lab requires manual links and has no end-to-end receipt or automatic reconnect; it cannot yet pass the full gate.

Topology: A–B–C and A–D–C. No A–C link. Turn off mobile data and remove Internet uplinks while keeping required local radios enabled (including Wi-Fi for any future local Wi-Fi adapter), and keep apps foregrounded. Only A and C need to trust each other's public keys for endpoint delivery.

1. Record hardware, OS versions, transport, distances, radio state, power state, and allowlists on four phones.
2. Establish A–B and B–C only. Confirm “Hello C” and the reply traverse B.
3. Keep D available for discovery, with A and C permitted as future links, but do not manually establish the alternate path during the measured recovery interval.
4. Send uniquely identifiable messages on a recorded schedule; disable B or break its links. Record failure time and actual delivery outcomes.
5. Observe whether A–D–C is discovered and established automatically, and whether pending/new messages reach C. Record link discovery, connection, recovery time, duplicates, loss, and message latency independently of queued/send log events.
6. For an exploratory control, manually connect A–D and D–C and repeat. Label this result “manual alternate path”; it does not pass automatic route discovery.
7. Optionally repeat with both paths already connected. Bounded flooding over a surviving path is a separate case from discovering a missing path after failure.
8. Export diagnostics from all four phones and complete [the result template](RESULT-TEMPLATE.md), including failures and unmeasured metrics.

Full gate: no A–C shortcut, encrypted delivery initially via B, then delivery via automatically established/recovered D path after B fails, without Internet. Reliability/recovery budgets must be agreed from measured baseline data. Do not mark success solely from a send event, a simulation, or a manually repaired topology.
