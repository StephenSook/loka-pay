"""Paired synthetic carrier-policy comparison, not native latency or gateway proof."""
import argparse
import hashlib
import json
from pathlib import Path
import random
from sim import Message, Simulator

POLICIES = ('direct', 'controlled', 'spray', 'prophet')
SCENARIOS = ('routine', 'cold', 'changed', 'congested')


def events(n, minutes, seed, scenario):
    """Identical chronological offers/contacts for every policy; no future lookups."""
    rng = random.Random(seed)
    result = []
    start = 600
    def contact(t, shifted=False):
        a = rng.randrange(n)
        # Routine groups of four, with occasional cross-group encounters.
        shift = 2 if shifted else 0
        group = [(a + d) % n for d in range(-3, 4)
                 if d and ((a + d + shift) % n) // 4 == ((a + shift) % n) // 4]
        b = rng.choice(group) if group and rng.random() < .8 else (a + rng.randrange(1, n)) % n
        return (t, 'contact', (a, b, 4096 if scenario == 'congested' else 65536, rng.random() < .05))
    if scenario != 'cold':
        for t in range(0, start, 2):
            result.append(contact(t))
    for minute in range(minutes):
        for source in range(n):
            destination = (source + rng.randrange(1, n)) % n
            # Each user offers one small text/minute, staggered deterministically.
            created = start + minute * 60 + source * 60 / n
            result.append((created, 'offer', Message(f'{minute}:{source}', source,
                          destination, created, created + 3600, 1024)))
    for t in range(start, start + minutes * 60, 2):
        result.append(contact(t, scenario == 'changed'))
    # Fixed drain window is identical across policies, not selected by success.
    for t in range(start + minutes * 60, start + minutes * 60 + 600, 2):
        result.append(contact(t, scenario == 'changed'))
    return sorted(result, key=lambda e: (e[0], e[1]))


def evaluate(n, minutes, seed, scenario, policy, offered_events=None):
    trace = offered_events if offered_events is not None else events(n, minutes, seed, scenario)
    sim = Simulator(n, policy, capacity=8192 if scenario == 'congested' else 262144,
                    copies=4, priority=False)
    for when, kind, payload in trace:
        if kind == 'offer':
            sim.originate(payload)
        else:
            sim.contact(when, *payload)
    result = sim.result(600 + minutes * 60 + 600)
    return result | {'scenario': scenario, 'seed': seed, 'policy': policy,
                     'users': n, 'offered_minutes': minutes,
                     'training_seconds': 0 if scenario == 'cold' else 600}


def summarize(rows):
    lines = ['# Paired prediction comparison', '',
             'Synthetic experiment only. Whole-frame instantaneous contacts, simplified predictors,',
             'assumed control sizes and honest peers; no native replay, energy measurement,',
             'gateway implementation, Bluetooth timing or physical background qualification.', '',
             '| Scenario | Seed | Policy | Delivered | Sender confirmed | p95 seconds* | Wire bytes |',
             '| --- | --- | --- | --- | --- | --- | --- |']
    for r in rows:
        lines.append(f"| {r['scenario']} | {r['seed']} | {r['policy']} | {r['delivered']}/{r['offered_messages']} | {r['sender_confirmed']} | {r['p95_seconds']} | {r.get('wire_bytes', 0)} |")
    lines += ['', '*Latency percentiles cover delivered messages only. Lower latency with fewer',
              'deliveries does not establish improvement. Compare offered-load rejection and ACK',
              'rates as well as latency. Cold/warm policies use the same post-training traffic',
              'within each paired scenario. Training is generated past contact data, not future',
              'routing knowledge. Changed routines intentionally invalidate the training pattern.', '',
              'Adoption: not approved. Held-out real traces, privacy/poisoning tests, native',
              'control encoding and energy measurements remain required by the integrated plan.']
    return '\n'.join(lines) + '\n'


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--full', action='store_true', help='100 users, 30 offered minutes, seeds 1–3')
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    n, minutes, seeds = (100, 30, (1, 2, 3)) if args.full else (12, 3, (1,))
    rows = []
    for scenario in SCENARIOS:
        for seed in seeds:
            trace = events(n, minutes, seed, scenario)
            for policy in POLICIES:
                rows.append(evaluate(n, minutes, seed, scenario, policy, trace))
                print(f'{scenario} seed={seed} policy={policy} finished', flush=True)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'results.json').write_text(json.dumps(rows, indent=2) + '\n')
    (args.output / 'summary.md').write_text(summarize(rows))
    (args.output / 'manifest.json').write_text(json.dumps({
        'kind': 'synthetic', 'full': args.full, 'users': n, 'minutes': minutes,
        'seeds': seeds, 'policies': POLICIES,
        'code_sha256': {name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
                        for name in ('sim.py', 'prediction_comparison.py')},
        'adoption_approved': False,
    }, indent=2) + '\n')


if __name__ == '__main__':
    main()
