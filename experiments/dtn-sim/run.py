"""Run reproducible synthetic matrix and explicit counterexamples. Stdlib only."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import sys
import time
from sim import ALGORITHMS, ENVIRONMENTS, POPULATIONS, Message, Simulator, run_case


def evaluate(job):
    n, env, seed, algorithm, priority = job
    return run_case(n, env, seed, algorithm, priority=priority)


def evaluate_subprocess(job):
    result = subprocess.run([sys.executable, str(Path(__file__).with_name('worker.py')),
                             json.dumps(job)], capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def focused():
    rows = []
    for delay in (600, 3600, 21600, 43200, 86400):
        for lifetime in (300, delay + 600):
            for durable in (False, True):
                s = Simulator(3, 'spray', durable=durable, retention=delay + 600)
                s.originate(Message('carry', 0, 2, 0, lifetime))
                s.contact(1, 0, 1, 10000)
                s.reboot(1, 100)
                s.contact(delay, 1, 2, 10000)
                s.contact(delay + 1, 2, 1, 10000)
                s.contact(delay + 2, 1, 0, 10000)
                rows.append(s.result(delay + 3) | {'experiment': 'carry_ablation',
                            'delay': delay, 'lifetime': lifetime, 'durable': durable})
    for priority in (False, True):
        s = Simulator(3, 'spray', priority=priority)
        s.originate(Message('large', 0, 2, 0, 7200, 20000))
        for i in range(5):
            s.originate(Message('text' + str(i), 0, 1, 0, 7200))
        s.contact(1, 0, 1, 21000)
        rows.append(s.result(2) | {'experiment': 'short_contact_priority'})
    # Size-only admission stress. No encoded media / phone performance claims.
    for kind, number, size in (('text', 10000, 2048), ('voice', 1000, 200000),
                               ('photo', 500, 1000000), ('moment', 100, 5000000)):
        s = Simulator(3, 'spray')
        for i in range(number):
            s.originate(Message(str(i), 0, 2, 0, 7200, size, kind))
        rows.append(s.result(1) | {'experiment': 'admission_stress', 'traffic': kind})
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--quick', action='store_true')
    parser.add_argument('--output', default='results')
    parser.add_argument('--resume', action='store_true')
    parser.add_argument('--workers', type=int, default=1)
    args = parser.parse_args()
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    start = time.monotonic()
    if not 1 <= args.workers <= 8:
        parser.error('--workers must be 1..8')
    completed = set()
    if args.resume and (out / 'matrix.jsonl').exists():
        for line in (out / 'matrix.jsonl').read_text().splitlines():
            r = json.loads(line)
            completed.add((r['nodes'], r['environment'], r['seed'], r['algorithm'], r['priority']))
    resumed = len(completed)
    jobs = [(n, env, seed, algorithm, priority)
            for n in ((3, 10, 50) if args.quick else POPULATIONS)
            for env in (('campus', 'sparse', 'congested') if args.quick else ENVIRONMENTS)
            for seed in (1, 2, 3)
            for algorithm, priority in [(a, False) for a in ALGORITHMS] + [('spray', True)]]
    assert completed <= set(jobs), 'Existing output has incompatible matrix dimensions'
    pending = [job for job in jobs if job not in completed]
    cases = resumed
    print('Resuming', resumed, 'cases;', len(pending), 'remaining;', args.workers, 'workers', flush=True)
    with (out / 'matrix.jsonl').open('a' if args.resume else 'w') as f:
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            results = executor.map(evaluate_subprocess if args.workers > 1 else evaluate, pending)
            for row in results:
                f.write(json.dumps(row, sort_keys=True) + '\n')
                f.flush()
                cases += 1
                if cases % 21 == 0:
                    print('Completed', cases, 'of', len(jobs), flush=True)
    (out / 'focused.json').write_text(json.dumps(focused(), indent=2, sort_keys=True) + '\n')
    (out / 'run.json').write_text(json.dumps({'cases': cases, 'seeds': [1, 2, 3],
        'wall_seconds': time.monotonic() - start, 'quick': args.quick,
        'wall_time_scope': 'final runner invocation only', 'resumed_cases': resumed, 'workers': args.workers,
        'model': 'synthetic-contact-v1', 'physical_tests': 'NOT RUN'}, indent=2) + '\n')
    print(cases, 'cases in', round(time.monotonic() - start, 2), 'seconds')


if __name__ == '__main__':
    main()
