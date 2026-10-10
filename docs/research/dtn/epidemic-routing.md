# Epidemic and controlled flooding baselines

Epidemic routing exchanges summary information and propagates missing messages
through encounters. Resource limits change its behavior materially.
[Vahdat and Becker, author-hosted paper](https://cseweb.ucsd.edu/~vahdat/papers/epidemic.pdf).

The experiment distinguishes receiver-side duplicate suppression (controlled
flooding) from an exact inventory before payload transfer (epidemic). Both use
the same finite storage and contact budgets in the six-hour comparison. Epidemic
has no fixed replication token cap; storage and population bound it in this model.

ADOPT as a diagnostic baseline; REJECT uncontrolled epidemic replication as the
default phone policy. It can spend bandwidth on copies while starving useful
traffic. In the experiment, exact inventories themselves consume capacity, so
they are not free magic. See [measured costs](simulation-results.md).

Next experiment: salted compact inventories with reconciliation fallbacks and
measured false-positive losses. Bloom positives must not permanently suppress a
message; periodic exact reconciliation and direct-destination checks need separate
budgets. Presence leakage and linkability require review. No Bloom-filter protocol
was shipped here. [Queue/inventory proposal](queue-management.md).
