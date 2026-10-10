# RAPID: resource allocation, not a universal score

RAPID treats routing as resource allocation using per-packet utility for a chosen
delivery objective rather than one universal best path.
[Balasubramanian, Levine and Venkataramani, UMass paper](https://people.cs.umass.edu/~arun/papers/RAPID.pdf).

ADAPT the question: which transfer buys the most useful delivery within this
encounter's byte and time budget? FUTURE a full RAPID implementation. The simulator
does not implement RAPID's estimates, metadata protocol or original experiments.

The first isolated experiment changes only scheduling in binary spray: ACKs,
destination-bound packets, then small packets. A constructed short-contact case
demonstrates how a large relay transfer can consume capacity needed by destination
texts. The full paired matrix reports whether this also helps outside that example.
[Measurements](simulation-results.md), [code](../../../experiments/dtn-sim/sim.py).

This is evidence to investigate ordering, not proof of optimal marginal utility.
Strict small-first scheduling can starve large media. Before adoption add bounded
fair service and aging, then measure control delay, text delay and completed media
across sustained load. Authentication and priority abuse are separate requirements.
