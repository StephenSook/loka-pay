"""Replay process-local anonymous observations with a cold shadow history.
This is not a topology trace or a prediction-routing performance benchmark.
"""
import argparse
import json
import math
from pathlib import Path


def replay(trace):
    if (trace.get('version') != 1 or not isinstance(trace.get('scope'), str)
            or not trace['scope'] or type(trace.get('dropped')) is not int
            or trace['dropped'] < 0 or not isinstance(trace.get('samples'), list)
            or len(trace['samples']) > 512):
        raise ValueError('Invalid trace header')
    active, records, aliases = {}, {}, set()
    last = None
    gaps = 0
    for sample in trace['samples']:
        now, peers = sample.get('time'), sample.get('peers')
        if (type(now) is not int or not 0 <= now <= 2**63 - 1
                or (last is not None and now < last) or (last is None and now != 0)
                or not isinstance(peers, list) or len(peers) > 64
                or any(type(p) is not int or not 1 <= p <= 256 for p in peers)
                or len(set(peers)) != len(peers)):
            raise ValueError('Invalid observation')
        aliases.update(peers)
        if len(aliases) > 256:
            raise ValueError('Too many aliases')
        if last is not None and now - last > 30_000:
            active.clear()
            gaps += 1
        last = now
        records = {p: r for p, r in records.items() if now - r['last'] < 86_400_000}
        active = {p: session for p, session in active.items() if p in peers}
        for p in sorted(peers):
            session = active.setdefault(p, [now, False])
            if session[1] or now - session[0] < 5_000:
                continue
            session[1] = True
            old = records.get(p)
            if old and now - old['last'] < 60_000:
                continue
            if not old and len(records) >= 64:
                del records[min(records, key=lambda x: (records[x]['last'], x))]
            previous = old['estimate'] * math.pow(.98, (now - old['last']) / 60_000) if old else 0
            records[p] = {'encounters': min((old['encounters'] if old else 0) + 1, 1_000_000),
                          'last': now, 'estimate': previous + (1 - previous) * .75}
    return {'scope': trace['scope'], 'observations': len(trace['samples']),
            'durationMs': last or 0, 'suspensionGaps': gaps,
            'droppedObservations': trace['dropped'], 'complete': trace['dropped'] == 0,
            'baseline': 'cold shadow history; no restored records',
            'records': [{'peer': p, **r, 'estimate': r['estimate'] * math.pow(.98, ((last or 0) - r['last']) / 60_000)}
                        for p, r in sorted(records.items())]}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('trace', type=Path)
    args = parser.parse_args()
    if args.trace.stat().st_size > 512_000:
        parser.error('Trace exceeds size limit')
    try:
        print(json.dumps(replay(json.loads(args.trace.read_text())), indent=2))
    except (ValueError, TypeError, AttributeError) as exc:
        parser.error(str(exc))
