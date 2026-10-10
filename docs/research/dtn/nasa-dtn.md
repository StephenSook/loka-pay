# NASA DTN: useful separation, different contact assumptions

NASA describes disruption-tolerant communication through intermediate storage
rather than requiring a continuous end-to-end path. [NASA overview](https://www.nasa.gov/reference/delay-disruption-tolerant-networking-overview/).
HDTN separates ingress, disk storage, routing, egress and telemetry; its documented
contact-plan machinery is a useful architectural reference. [HDTN source and README](https://github.com/nasa/HDTN).

## LOKA disposition

| Mechanism | Decision | Reason / test |
|---|---|---|
| Durable ciphertext store independent of radio | ADAPT | Needed for reboot carry; [carry ablation](simulation-results.md) isolates the dependency |
| Original expiry independent of local retention | ADOPT principle | See [lifetime design](ttl-lifetime.md); forwarding cannot renew consent |
| Byte and item admission limits | ADAPT | [Size-only stress](simulation-results.md) shows count-only planning is insufficient |
| Separate ingress / scheduler / egress telemetry | ADAPT | Can locate whether current failures are storage, route or return-ACK failures |
| Scheduled spacecraft contact plans | REJECT as default | Pedestrian encounters and OS scheduling are not predictable orbital windows |
| HDTN performance numbers | REJECT as phone estimate | Desktop/network throughput does not establish phone energy or BLE latency |
| Wholesale NASA stack integration | FUTURE | Would require footprint, licensing, API, security and interoperability evaluation |

LOKA proposal: persist a verified immutable envelope plus local scheduling state
before reporting carrier admission. Never describe admission as final delivery or
custody unless a separate durable-responsibility protocol exists. A phone may
refuse custody because the user can delete the app, switch radios off or exhaust
battery. Space-system reliability budgets do not remove those constraints.

Next measurement: injected crashes around journal commit and transfer commit,
followed by offline restart and exactly-once user-visible delivery. No such phone
result is claimed in this research pass. [Physical gate](physical-test-results.md).

## ION and HDTN details that affect the proposal

The [versioned ION design guide](https://ion-dtn.readthedocs.io/en/ion-open-source-4.1.3s/ION-Guide/)
describes persistent protocol state and congestion forecasting from planned
inbound/outbound contacts, with admission limits on storage occupancy. Its custody
discussion also illustrates how retained responsibility can propagate congestion
upstream when downstream acknowledgments cannot return. These are version-specific
design observations, not evidence that BPv7 includes the same custody mechanism.

The [HDTN changelog](https://github.com/nasa/HDTN/blob/main/CHANGELOG.md) documents
pipeline byte/count constraints, optional priority enforcement and buffering to
storage when a live link is saturated. LOKA should distinguish “link up” from
“link has capacity” in the same spirit; immediate enqueue is not guaranteed drain.

ADAPT bounded disk admission and explicit saturation signaling. EXPERIMENT with
short-horizon local occupancy forecasts based on measured arrival/drain rates.
REJECT assuming planned contacts or centralized schedule revision for strangers'
phones. A managed stationary LOKA relay fleet could eventually evaluate contact
plans, but it is a different operating profile from opportunistic user devices.
