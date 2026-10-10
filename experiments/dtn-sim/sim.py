"""Deterministic, synthetic contact simulator. No radio, crypto or platform emulation.

All time is seconds; sizes include an assumed envelope. Contacts have one shared
bidirectional byte budget. Authentication is an assumption, not implemented crypto.
See README.md before interpreting results as evidence.
"""
from __future__ import annotations
from collections import Counter, OrderedDict
from dataclasses import dataclass
import math
import random

ALGORITHMS = ('direct', 'controlled', 'epidemic', 'spray', 'prophet', 'loka_v0')


@dataclass(frozen=True)
class Message:
    id: str
    source: int
    destination: int
    created: float
    expires: float
    size: int = 2048
    kind: str = 'text'
    ack_for: str | None = None


@dataclass
class Copy:
    message: Message
    tokens: int
    hops: int
    ingress: int | None
    retained_until: float


def percentile(values, p):
    return sorted(values)[max(0, math.ceil(len(values) * p) - 1)] if values else None


class Simulator:
    def __init__(self, n, algorithm, *, capacity=262144, max_items=128,
                 copies=4, retention=86400, priority=False, durable=True,
                 node_capacities=None):
        assert algorithm in ALGORITHMS
        self.n, self.algorithm = n, algorithm
        self.capacity, self.max_items = capacity, max_items
        self.node_capacities = list(node_capacities) if node_capacities is not None else [capacity] * n
        if len(self.node_capacities) != n or any(c < 0 for c in self.node_capacities):
            raise ValueError("Provide one nonnegative storage capacity per node")
        self.copies, self.retention = copies, retention
        self.priority, self.durable = priority, durable
        self.q = [OrderedDict() for _ in range(n)]
        self.seen = [OrderedDict() for _ in range(n)]
        self.pred = [OrderedDict() for _ in range(n)]
        self.messages, self.delivered, self.acked = {}, {}, {}
        self.c = Counter()
        self.storage = [0] * n
        self.live = Counter()
        self.peak_copies = 0
        self.copy_samples = self.samples = 0
        self.now = 0
        self.offline = set()
        self.refuse = set()
        self.delivered_hops = []
        self.events = []

    def remove(self, node, mid):
        item = self.q[node].pop(mid, None)
        if item:
            self.storage[node] -= item.message.size
            self.live[mid] -= 1

    def prune(self, node):
        for mid, item in list(self.q[node].items()):
            if min(item.message.expires, item.retained_until) <= self.now:
                self.c['expired_copies'] += 1
                self.remove(node, mid)
        for mid, until in list(self.seen[node].items()):
            if until <= self.now:
                del self.seen[node][mid]

    def admit(self, node, message, tokens, hops, ingress):
        self.prune(node)
        if message.expires <= self.now or message.id in self.seen[node]:
            return False
        if (len(self.q[node]) >= self.max_items or
                self.storage[node] + message.size > self.node_capacities[node] or
                len(self.seen[node]) >= 2048):
            self.c['admission_rejections'] += 1
            return False
        self.q[node][message.id] = Copy(message, tokens, hops, ingress,
                                        min(message.expires, self.now + self.retention))
        self.seen[node][message.id] = message.expires
        self.storage[node] += message.size
        self.live[message.id] += 1
        self.peak_copies = max(self.peak_copies, self.live[message.id])
        self.c['peak_node_bytes'] = max(self.c['peak_node_bytes'], self.storage[node])
        self.c['peak_node_queue'] = max(self.c['peak_node_queue'], len(self.q[node]))
        return True

    def originate(self, message):
        self.now = message.created
        self.messages[message.id] = message
        if not self.admit(message.source, message, self.copies, 0, None):
            self.c['source_rejections'] += 1

    def predict(self, node, dest):
        value, when = self.pred[node].get(dest, (0., self.now))
        return value * .98 ** ((self.now - when) / 60)

    def encounter(self, a, b):
        # Original-style PRoPHET heuristic, NOT a complete RFC 6693 implementation.
        for u, v in ((a, b), (b, a)):
            p = self.predict(u, v)
            self.pred[u][v] = (p + (1 - p) * .75, self.now)
            self.pred[u].move_to_end(v)
            for dest in list(self.pred[v]):
                if dest != u:
                    old = self.predict(u, dest)
                    value = old + (1 - old) * self.predict(u, v) * self.predict(v, dest) * .25
                    self.pred[u][dest] = (value, self.now)
            while len(self.pred[u]) > 64:
                self.pred[u].popitem(last=False)

    def reboot(self, node, now):
        self.now = now
        self.prune(node)
        if not self.durable or self.algorithm == 'loka_v0':
            for mid, item in list(self.q[node].items()):
                if item.message.source != node:
                    self.remove(node, mid)
                    self.c['reboot_losses'] += 1
            self.seen[node] = OrderedDict((mid, item.message.expires)
                                          for mid, item in self.q[node].items())

    def contact(self, now, a, b, capacity, fail=False):
        self.now = now
        self.c['encounters'] += 1
        self.c['available_contact_bytes'] += capacity
        if a in self.offline or b in self.offline or fail:
            self.c['wasted_encounters'] += 1
            return
        for node in (a, b):
            self.prune(node)
        if self.algorithm == 'prophet':
            self.encounter(a, b)
        # Exact inventories are a baseline, explicitly not a compact production design.
        overhead = 32
        if self.algorithm in ('epidemic', 'spray', 'prophet', 'direct'):
            overhead += 16 * (len(self.q[a]) + len(self.q[b]))
        if self.algorithm == 'prophet':
            overhead += 12 * (len(self.pred[a]) + len(self.pred[b]))
        spent = min(capacity, overhead)
        self.c['wire_bytes'] += spent
        self.c['control_bytes'] += spent
        remaining = capacity - spent
        used = False
        # Snapshot: newly received items cannot bounce back within the same contact.
        candidates = [(u, v, mid, item) for u, v in ((a, b), (b, a))
                      for mid, item in self.q[u].items()]
        if self.priority:
            candidates.sort(key=lambda x: (x[3].message.kind != 'ack',
                            x[3].message.destination != x[1], x[3].message.size,
                            x[3].message.created, x[2]))
        else:
            candidates.sort(key=lambda x: (x[3].message.created, x[2], x[0]))
        for u, v, mid, item in candidates:
            m = item.message
            if mid not in self.q[u] or m.expires <= now:
                continue
            direct = m.destination == v
            if self.algorithm == 'direct' and not direct:
                continue
            if not direct:
                if item.hops >= 6 and self.algorithm in ('controlled', 'loka_v0'):
                    continue
                if self.algorithm in ('controlled', 'loka_v0') and item.ingress == v:
                    continue
                if self.algorithm == 'spray' and item.tokens < 2:
                    continue
                if self.algorithm == 'prophet' and self.predict(v, m.destination) <= self.predict(u, m.destination):
                    continue
            if mid in self.seen[v] and self.algorithm not in ('controlled', 'loka_v0'):
                continue
            if m.size > remaining:
                self.c['capacity_deferrals'] += 1
                continue
            remaining -= m.size
            self.c['wire_bytes'] += m.size
            self.c['transmissions'] += 1
            if mid in self.seen[v]:
                self.c['duplicate_transmissions'] += 1
                continue
            if not direct and v in self.refuse:
                self.c['uncooperative_drops'] += 1
                continue
            if direct:
                if len(self.seen[v]) >= 2048:
                    self.c['admission_rejections'] += 1
                    continue
                self.seen[v][mid] = m.expires
                if m.ack_for:
                    if m.ack_for not in self.acked:
                        self.acked[m.ack_for] = now
                        self.remove(v, m.ack_for)
                elif mid not in self.delivered:
                    self.delivered[mid] = now
                    self.delivered_hops.append(item.hops + 1)
                    # ACK is authenticated by assumption and routed independently.
                    # No global deletion oracle; relays cannot read endpoint receipts.
                    ack = Message('ack:' + mid, v, m.source, now,
                                  now + (300 if self.algorithm == 'loka_v0' else 86400),
                                  512, 'ack', mid)
                    self.admit(v, ack, self.copies, 0, None)
                used = True
            else:
                tokens = item.tokens // 2 if self.algorithm == 'spray' else self.copies
                if self.admit(v, m, tokens, item.hops + 1, u):
                    if self.algorithm == 'spray':
                        item.tokens -= tokens
                    used = True
        self.c['used_encounters' if used else 'wasted_encounters'] += 1
        self.copy_samples += sum(self.live.values())
        self.samples += 1

    def result(self, horizon):
        self.now = horizon
        for node in range(self.n):
            self.prune(node)
        count = len(self.messages)
        latency = [t - self.messages[mid].created for mid, t in self.delivered.items()]
        ack_delay = [t - self.delivered[mid] for mid, t in self.acked.items()]
        delivered_bytes = sum(self.messages[mid].size for mid in self.delivered)
        return dict(self.c) | {
            'algorithm': self.algorithm, 'priority': self.priority, 'nodes': self.n,
            'offered_messages': count, 'delivered': len(latency), 'sender_confirmed': len(self.acked),
            'delivery_rate': len(latency) / count if count else 0,
            'p50_seconds': percentile(latency, .50), 'p95_seconds': percentile(latency, .95),
            'p99_seconds': percentile(latency, .99),
            'ack_p95_seconds': percentile(ack_delay, .95),
            'tx_per_delivered': self.c['transmissions'] / len(latency) if latency else None,
            'wire_bytes_per_delivered_byte': self.c['wire_bytes'] / delivered_bytes if delivered_bytes else None,
            'duplicate_ratio': self.c['duplicate_transmissions'] / max(1, self.c['transmissions']),
            'peak_copies_per_packet': self.peak_copies,
            'sampled_copies_per_offered_message_including_acks': self.copy_samples / max(1, self.samples * count),
            'undelivered_expired_messages': sum(mid not in self.delivered and m.expires <= horizon
                                                 for mid, m in self.messages.items()),
            'undelivered_pending_messages': sum(mid not in self.delivered and m.expires > horizon
                                                 for mid, m in self.messages.items()),
            'remaining_queue_items': sum(map(len, self.q)),
            'remaining_storage_bytes': sum(self.storage),
            'contact_capacity_utilization': self.c['wire_bytes'] / max(1, self.c['available_contact_bytes']),
            'delivery_hops': self.delivered_hops,
            'battery_joules': None, 'physical_radio_utilization': None,
            'phone_cpu': None, 'phone_memory': None, 'route_changes': None,
            'evictions': 0,
        }


ENVIRONMENTS = ('campus', 'hospital', 'factory', 'village', 'dense_city', 'rural',
                'festival', 'disaster', 'vehicles', 'sparse', 'congested')
POPULATIONS = (3, 10, 20, 50, 100, 500, 1000, 5000, 10000)


def trace(n, environment, seed):
    """Synthetic contact generators; labels are scenarios, NOT calibrated geography."""
    rng = random.Random(seed)
    horizon = 21600
    count = n * (3 if environment in ('sparse', 'rural') else 12)
    contacts = []
    for _ in range(count):
        t = rng.randrange(horizon)
        a = rng.randrange(n)
        if environment in ('campus', 'hospital', 'factory', 'village') and rng.random() < .85:
            # Repeated small communities; periodic shift changes allow bridging.
            width = min(n, 10)
            shift = (t // 3600) % n if environment == 'campus' else 0
            b = (a // width * width + rng.randrange(width) + shift) % n
        elif environment == 'vehicles':
            b = (a + 1 + t // 600) % n
        else:
            b = rng.randrange(n)
        if a == b:
            b = (b + 1) % n
        if environment == 'disaster' and t < horizon / 2 and (a < n // 2) != (b < n // 2):
            continue
        capacity = 8192 if environment in ('sparse', 'congested') else 65536
        failure = rng.random() < (.25 if environment == 'disaster' else .05)
        contacts.append((t, a, b, capacity, failure))
    return sorted(contacts)


def run_case(n, environment, seed, algorithm, *, priority=False, copies=4):
    rng = random.Random(seed + 10000)
    sim = Simulator(n, algorithm, priority=priority, copies=copies,
                    capacity=32768 if environment == 'congested' else 262144)
    # Capped probe traffic: scaling population is not an offered-load capacity test.
    for i in range(min(128, n * 2)):
        src = rng.randrange(n)
        dst = (src + rng.randrange(1, n)) % n
        size = rng.choices((2048, 20000, 100000), (8, 1, 1))[0]
        sim.originate(Message(str(i), src, dst, 0,
                              300 if algorithm == 'loka_v0' else 21600, size))
    for contact in trace(n, environment, seed):
        sim.contact(*contact)
    return sim.result(21600) | {'environment': environment, 'seed': seed,
                               'copy_budget': copies, 'horizon_seconds': 21600}
