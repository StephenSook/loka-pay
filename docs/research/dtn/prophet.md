# PRoPHET-style baseline

2026-10-05 paired follow-up: [raw comparison and assessment](../../../experiments/dtn-sim/results/prediction-2026-10-05-full/assessment.md) covers 100 users, 3,000 offered texts, three seeds and routine/cold/changed/congested fixtures. Simplified PRoPHET did not consistently beat bounded spray within the delivery/latency/traffic gate. Native estimates remain shadow-only; this does not select spray as a replacement for current signed carrier grants. These are synthetic stress results, not captured campus traces or app reliability/energy measurements.

The [integrated implementation plan](recommendations.md#integrated-implementation-plan--2026-10-05) now places bounded encounter recording and shadow predictions before native carrier-selection adoption, then combines validated prediction with optional authorized Internet gateways. Destination encounter estimates, radio performance and actual remote reachability remain separate. This is planned work, not production PRoPHET support.

[Experimental RFC 6693](https://www.rfc-editor.org/rfc/rfc6693.html) describes
encounter history, aging and transitivity to guide forwarding, including protocol
exchange and attack considerations. Characteristic encounter timing matters;
repeated scan callbacks must not be treated as independent meaningful encounters.

The simulator uses a deliberately simplified predictor: increment .75, transitive
factor .25, decay .98 per minute, 64 entries, higher-score forwarding. It is
**PRoPHET-style, not RFC-compliant PRoPHET**, and is not a benchmark of a complete
reference implementation. Its table exchange costs bytes in the model.

EXPERIMENT: compare against bounded spray on held-out routine traces, cold starts,
rotating pseudonyms and uncooperative carriers. Reject a predictor that gains a
few deliveries by exposing persistent contact relationships or spending too much
of a short encounter exchanging tables. [Encounter design](encounter-prediction.md).

No production prediction is adopted from the initial synthetic matrix. It lacks
real encounter calibration, poisoning resistance and a privacy-preserving peer
binding design. [Results](simulation-results.md).
