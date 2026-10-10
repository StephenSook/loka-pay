"""Check completeness and accounting invariants in the recorded matrix."""
import json
from pathlib import Path
from sim import ALGORITHMS, ENVIRONMENTS, POPULATIONS


def main():
    root = Path(__file__).resolve().parent / 'results'
    metadata = json.loads((root / 'run.json').read_text())
    rows = [json.loads(line) for line in (root / 'matrix.jsonl').read_text().splitlines()]
    populations = (3, 10, 50) if metadata['quick'] else POPULATIONS
    environments = ('campus', 'sparse', 'congested') if metadata['quick'] else ENVIRONMENTS
    expected = {(n, e, s, a, p) for n in populations for e in environments for s in (1, 2, 3)
                for a, p in [(a, False) for a in ALGORITHMS] + [('spray', True)]}
    actual = {(r['nodes'], r['environment'], r['seed'], r['algorithm'], r['priority']) for r in rows}
    assert expected == actual and len(actual) == len(rows) == metadata['cases']
    for r in rows:
        assert 0 <= r['sender_confirmed'] <= r['delivered'] <= r['offered_messages']
        assert r['wire_bytes'] <= r['available_contact_bytes']
        assert r.get('control_bytes', 0) <= r['wire_bytes']
        assert r.get('peak_node_queue', 0) <= 128
        assert r.get('peak_node_bytes', 0) <= (32768 if r['environment'] == 'congested' else 262144)
        assert r.get('used_encounters', 0) + r.get('wasted_encounters', 0) == r['encounters']
        assert r['delivered'] + r['undelivered_expired_messages'] + r['undelivered_pending_messages'] == r['offered_messages']
        if r['algorithm'] == 'spray':
            assert r['peak_copies_per_packet'] <= r['copy_budget']
        if r['algorithm'] in ('controlled', 'loka_v0'):
            assert all(h <= 7 for h in r['delivery_hops'])
        for field in ('battery_joules', 'physical_radio_utilization', 'phone_cpu', 'phone_memory'):
            assert r[field] is None
    print(f'{len(rows)} complete, unique matrix rows; accounting and bounded-state checks passed')


if __name__ == '__main__':
    main()
