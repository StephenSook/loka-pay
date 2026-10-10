"""Small sensitivity and failure traces; not OS/radio simulations."""
import json
from pathlib import Path
from sim import Message, Simulator, run_case


def main():
    rows = []
    for env in ('campus', 'sparse', 'congested'):
        for seed in (1, 2, 3):
            for copies in (1, 2, 4, 8, 16):
                rows.append(run_case(50, env, seed, 'spray', copies=copies) |
                            {'experiment': 'budget_sensitivity'})
    for fault in ('none', 'suspended_carrier', 'reboot_volatile', 'reboot_durable',
                  'relay_delete', 'battery_dead', 'transport_failure', 'uncooperative'):
        s = Simulator(3, 'spray', durable=fault != 'reboot_volatile')
        s.originate(Message('m', 0, 2, 0, 7200))
        if fault == 'uncooperative':
            s.refuse.add(1)
        s.contact(1, 0, 1, 10000)
        if fault.startswith('reboot'):
            s.reboot(1, 100)
        if fault == 'relay_delete':
            s.remove(1, 'm')
        if fault in ('suspended_carrier', 'battery_dead'):
            s.offline.add(1)
        s.contact(3600, 1, 2, 10000, fault == 'transport_failure')
        rows.append(s.result(3601) | {'experiment': 'failure_trace', 'fault': fault})
    Path('results/sensitivity.json').write_text(json.dumps(rows, sort_keys=True, indent=2) + '\n')
    print(len(rows), 'sensitivity/failure cases')


if __name__ == '__main__':
    main()
