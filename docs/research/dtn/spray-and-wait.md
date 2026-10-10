# Spray-and-Wait baseline

The multiple-copy routing work distinguishes a bounded spray phase from a wait
phase; binary spraying divides a finite copy allowance between carriers.
[Author-hosted paper](https://ee.usc.edu/netpd/assets/001/51985.pdf).

EXPERIMENT, not a selected default: the harness implements honest-node binary
tokens. Admission failure leaves the sender's tokens unchanged. A one-token
carrier transfers only to the destination. Direct delivery does not create another
forwarding replica. [Invariant tests](../../../experiments/dtn-sim/test_sim.py).

This bounds cooperative copies but does not make a malicious node obey a budget.
Disjoint carriers also cannot know the true current global replica count. Do not
display a local estimate as an exact global count. Cross-radio concurrency and
crash recovery require durable transaction/transfer IDs to avoid double allocation.

Four tokens in the initial matrix are a test parameter. A small 1/2/4/8/16 sweep
is recorded separately; a production choice requires broader sensitivity across mobility, load, message sizes, battery and
measured contact duration. Increasing copies near expiry is not automatically
efficient. [Replication proposal](replication.md), [matrix measurements](simulation-results.md).

The model is an algorithm baseline; its inventory format and ACK policy are LOKA
experiment choices, not claims that they reproduce the paper's entire system.
