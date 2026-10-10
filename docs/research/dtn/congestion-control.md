# Congestion manager proposal

Source inspiration: [HDTN resource separation](nasa-dtn.md),
[RAPID resource allocation](rapid.md). The following thresholds and integration
points are LOKA design proposals, not measured optimal parameters.

Track local relay bytes/items, verification backlog, queue age, write drain rate,
retry/duplicate ratio, available storage, battery/charging, thermal pressure and
active transfers. Keep these counters bounded and mostly local. Do not upload a
mobility graph to operate the network.

Use hysteretic LOW/MODERATE/HIGH/CRITICAL states, with thresholds chosen after
device tests. HIGH reduces new replica admission and media concurrency. CRITICAL
preserves a reserved small-control/destination allowance, stops volunteered bulk
replication and cleans expired records. Resource exhaustion must never refresh TTL
or claim delivery. Queue bytes and count limits both apply.

Peer advertisement proposal: protocol version, coarse admission class, supported
frame/chunk limit and relay willingness. Authenticate it to the established peer
session, expire it quickly and treat it as untrusted advice. Do not broadcast exact
battery percentage, free disk, username or permanent encounter list. A peer's claim
of low congestion cannot override the sending phone's own limits.

Admission order: validate bounded framing → reject invalid/expired/replayed →
identify destination → check resource and policy budget → reserve space atomically
→ persist ciphertext → report admission. Expensive verification needs a bounded
pre-verification queue to resist signature-work flooding. Emergency claims are
rate-limited and do not bypass validation.

Initial simulation uses reject-on-full, not this adaptive controller. Its admission
stress and congestion counters are useful failure examples, not evidence that a
four-state controller is tuned. [Results](simulation-results.md).

Next experiment: add byte-aware reserved control admission only, compare ACK loss
and text p95 without changing routing or lifetime. Then evaluate deterministic
eviction separately. Battery, CPU and thermal cutoffs need actual phone measurements.
