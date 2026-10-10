# MIT and academic mobility evidence

MIT's Reality Mining study collected longitudinal mobile-device interaction data
from a bounded participant population. Its dataset documentation also describes
missing observations and collection constraints. [MIT project](https://realitycommons.media.mit.edu/realitymining.html),
[dataset notes](https://www.media.mit.edu/ventures/EPROM/data/RealityMining_ReadMe.pdf).

LOKA inference: repeated daily contacts may be useful, but an absent observation
is not proof that two people could not communicate. Historical phone logs do not
calibrate modern BLE, Aware, locked-device execution or radio coexistence.

EXPERIMENT: compare encounter prediction on routine, community and shuffled-contact
traces with identical event counts and traffic. Keep a held-out period; do not train
and assess a predictor on the same future contacts. Baseline direct and bounded
spray must remain in the comparison. Report cold-start performance separately.

The current simulator generates synthetic communities and periodic contact shifts;
it **does not replay MIT data or simulate pedestrian geometry**. Access conditions,
participant privacy, trace cleaning and radio calibration remain pending. Do not
infer physical range from synthetic node counts. [Results and limits](simulation-results.md).

RAPID is UMass work; Spray-and-Wait is associated with its USC authors; PRoPHET
has its own authorship and experimental RFC. None is relabeled “MIT research.”
Their mechanisms are assessed in separate reports.
