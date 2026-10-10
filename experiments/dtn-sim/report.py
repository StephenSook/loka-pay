"""Produce the research table from raw cases; never infer physical measurements."""
from collections import defaultdict
import json
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent
    rows = [json.loads(line) for line in (root / 'results/matrix.jsonl').read_text().splitlines()]
    run = json.loads((root / 'results/run.json').read_text())
    assert len(rows) == run['cases']
    groups = defaultdict(list)
    for row in rows:
        groups[(row['algorithm'], row['priority'])].append(row)
    output = ['# Initial simulation results', '',
        'These are synthetic contact-model measurements, not phone results. '
        'Run date: 2026-10-03. No production routing or packet format changed.', '',
        f"Executed **{len(rows)} cases**, with three deterministic seeds per population/environment/policy. "
        f"Final runner invocation wall time: {run['wall_seconds']:.1f} seconds "
        f"({run.get('resumed_cases', 0)} earlier cases resumed). "
        f"Population values: {', '.join(str(n) for n in sorted({r['nodes'] for r in rows}))}. "
        f"{len({r['environment'] for r in rows})} synthetic environment labels; "
        'six baselines plus one paired scheduling variant.', '',
        '## Aggregate smoke matrix', '',
        'Delivery is pooled delivered/offered. Tx/delivery and bytes/delivered-byte are '
        'pooled cost ratios; zero-delivery cases still contribute cost. Duplicate ratio '
        'is pooled duplicate transmissions/all payload transmissions. Peak storage '
        'and copies are maxima, not averages. Pooling disparate environments does '
        '**not** select a winner; use raw per-case rows for scenario decisions.', '',
        '| Algorithm | Delivered/offered | Delivery | Tx/delivered | Wire bytes/delivered byte | Duplicate tx | Peak copies/packet | Peak node bytes | Rejected admissions |',
        '|---|---:|---:|---:|---:|---:|---:|---:|---:|']
    for (alg, priority), rr in groups.items():
        delivered = sum(r['delivered'] for r in rr)
        offered = sum(r['offered_messages'] for r in rr)
        tx = sum(r.get('transmissions', 0) for r in rr)
        wire = sum(r['wire_bytes'] for r in rr)
        # Recover denominator from stored exact ratio; avoid averages of ratios.
        db = sum(r['wire_bytes'] / r['wire_bytes_per_delivered_byte'] for r in rr
                 if r['wire_bytes_per_delivered_byte'])
        dup = sum(r.get('duplicate_transmissions', 0) for r in rr)
        output.append(f"| {alg}{' + priority' if priority else ''} | {delivered}/{offered} | "
            f"{100 * delivered / offered:.2f}% | {tx / delivered if delivered else float('nan'):.2f} | "
            f"{wire / db if db else float('nan'):.2f} | {100 * dup / max(1, tx):.2f}% | "
            f"{max(r['peak_copies_per_packet'] for r in rr)} | {max(r.get('peak_node_bytes', 0) for r in rr)} | "
            f"{sum(r.get('admission_rejections', 0) for r in rr)} |")
    base = {(r['nodes'], r['environment'], r['seed']): r for r in groups[('spray', False)]}
    deltas = [r['delivered'] - base[(r['nodes'], r['environment'], r['seed'])]['delivered']
              for r in groups[('spray', True)]]
    output += ['', '## One-variable scheduling experiment', '',
        'The same spray tokens, contacts, offered messages, lifetime and storage are '
        'used in each pair. Only transfer order changes (ACK, destination, small size).', '',
        f"Across {len(deltas)} pairs: **{sum(d > 0 for d in deltas)} improved, "
        f"{sum(d < 0 for d in deltas)} worsened, {sum(d == 0 for d in deltas)} tied** "
        f"on delivered-message count; net difference {sum(deltas):+d} messages. "
        'Three seeds are not enough for a general statistical claim. Negative cases '
        'must remain in evaluation; priority is not declared universally better.', '']
    pairs = []
    for row in groups[('spray', True)]:
        key = row['nodes'], row['environment'], row['seed']
        original = base[key]
        pairs.append((row['delivered'] - original['delivered'], key, original, row))
    pairs.sort(key=lambda p: (p[0], p[1]))
    output += ['Selected extremes (not a representative sample):', '',
        '| Nodes / environment / seed | Creation-order delivered | Priority delivered |',
        '|---|---:|---:|']
    for _, key, before, after in pairs[:2] + pairs[-2:]:
        output.append(f"| {key[0]} / {key[1]} / {key[2]} | {before['delivered']} | {after['delivered']} |")
    output += ['', 'The direction can reverse because scheduling changes which finite '
        'opportunities are consumed. The table alone does not identify a causal '
        'mechanism for each case; packet-level trace analysis remains necessary.', '']
    focused = json.loads((root / 'results/focused.json').read_text())
    output += ['The constructed 21 KB contact offers one 20 KB relay payload first and '
        'five 2 KB texts for the encountered destination. Results:', '',
        '| Ordering | Delivered out of six offered | Wire bytes |', '|---|---:|---:|']
    for r in focused:
        if r['experiment'] == 'short_contact_priority':
            output.append(f"| {'Priority' if r['priority'] else 'Creation order'} | {r['delivered']} | {r['wire_bytes']} |")
    output += ['', 'This proves the model contains a short-contact scheduling failure; '
        'it does not establish a fair production scheduler. Starvation, chunking and '
        'real write callbacks are not represented.', '', '## Lifetime / restart ablation', '',
        '| Carry interval | Hard lifetime | Durable relay assumption | Delivered | Sender ACK returned |',
        '|---|---:|---|---:|---:|']
    for r in focused:
        if r['experiment'] == 'carry_ablation':
            output.append(f"| {r['delay']} s | {r['lifetime']} s | {r['durable']} | {r['delivered']} | {r['sender_confirmed']} |")
    output += ['', 'Each trace is A→B at 1 s, carrier reboot at 100 s, '
        'B→C at the stated delay, then two later return contacts. The long lifetime '
        'is sender-authorized at creation and ends 600 s after the encounter. '
        'These are fast simulations of long intervals, **not elapsed-time phone tests**. '
        'Only the combination of adequate hard lifetime and retained carrier state '
        'can pass this constructed disconnected path.', '', '## Size-only admission stress', '',
        '| Offered class | Offered items | Accepted source items | Source rejections | Peak bytes |',
        '|---|---:|---:|---:|---:|']
    for r in focused:
        if r['experiment'] == 'admission_stress':
            output.append(f"| {r['traffic']} | {r['offered_messages']} | {r['remaining_queue_items']} | "
                f"{r.get('source_rejections', 0)} | {r.get('peak_node_bytes', 0)} |")
    output += ['', 'This intentionally uses one atomic object per item with 128 slots / '
        '256 KiB. Photos/Moments can exceed the entire cap. It demonstrates modeled '
        'admission boundaries; actual LOKA media chunking and phone memory are not '
        'benchmarked. No media bytes or cryptography were generated.', '',
        '## Reproduction, interpretation and gaps', '',
        '- [Simulator and model definitions](../../../experiments/dtn-sim/README.md).',
        '- [Every matrix case](../../../experiments/dtn-sim/results/matrix.jsonl), '
        '[focused cases](../../../experiments/dtn-sim/results/focused.json), '
        '[run metadata](../../../experiments/dtn-sim/results/run.json).',
        '- [Model hash and 13 passing invariant/runner tests](../../../experiments/dtn-sim/results/model-manifest.json). '
        'The complete matrix also passed unique-case, capacity and copy-bound checks.',
        '- Per-case p50/p95/p99 and ACK p95 are recorded; `null` means no observation. '
        'A p99 from few deliveries is not a stable tail estimate.',
        '- `loka_v0` is a structural approximation with five-minute expiry. The other '
        'policies use six hours. Compare `controlled` for the equal-lifetime flooding '
        'baseline; do not call the difference from v0 a pure routing improvement.',
        '- Offered traffic is capped at 128 messages even at 10000 nodes. Population '
        'coverage is not a user-load or device-count failure threshold.',
        '- Battery, phone CPU/memory, radio airtime and physical range remain unmeasured. '
        'No calibrated mobility trace, exact production engine replay, utility eviction, '
        'adaptive budget, cancellation or authenticated public tombstone is implemented.',
        '- Simulated durable state is an assumption, not crash-safe disk implementation. '
        'Background flags do not emulate iOS or an Android OEM.',
        '- [Physical tests](physical-test-results.md) remain gated. '
        '[Recommendations](recommendations.md) specify the smallest next changes.', '']
    sensitivity = json.loads((root / 'results/sensitivity.json').read_text())
    budget_groups = defaultdict(list)
    for row in sensitivity:
        if row['experiment'] == 'budget_sensitivity':
            budget_groups[row['copy_budget']].append(row)
    output += ['## Budget sensitivity and controlled failures', '',
        'At 50 nodes, three environments and three seeds (900 offered messages per '
        'budget), only the token parameter changes. This is a sensitivity sample, '
        'not enough to tune an adaptive controller.', '',
        '| Tokens | Delivered / 900 | Total wire bytes |', '|---:|---:|---:|']
    for tokens, rr in sorted(budget_groups.items()):
        output.append(f"| {tokens} | {sum(r['delivered'] for r in rr)} | {sum(r['wire_bytes'] for r in rr)} |")
    output += ['', 'More replication does not necessarily improve delivery under finite '
        'queues and contacts. Do not choose a fixed production budget from this small sweep.', '',
        '| Controlled failure trace | Delivered |', '|---|---:|']
    for r in sensitivity:
        if r['experiment'] == 'failure_trace':
            output.append(f"| {r['fault']} | {r['delivered']} |")
    output += ['', 'Each fault trace has one possible carrier and no alternative route. '
        'Suspension/death is modeled as unavailability, not OS emulation. These '
        'counterexamples expose dependence on the carrier; they do not validate '
        'recovery, adversarial security or background scheduling.', '',
        '[All 53 sensitivity/failure cases](../../../experiments/dtn-sim/results/sensitivity.json).', '']
    (root.parent.parent / 'docs/research/dtn/simulation-results.md').write_text('\n'.join(output))


if __name__ == '__main__':
    main()
