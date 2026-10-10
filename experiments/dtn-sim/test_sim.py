import unittest
from sim import Message, Simulator, run_case


class Invariants(unittest.TestCase):
    def test_carry_and_delayed_ack(self):
        s = Simulator(3, 'spray')
        s.originate(Message('m', 0, 2, 0, 7200))
        s.contact(1, 0, 1, 10000)
        s.reboot(1, 100)
        s.contact(3600, 1, 2, 10000)
        self.assertEqual(s.delivered, {'m': 3600})
        self.assertEqual(s.acked, {})
        s.contact(3601, 2, 1, 10000)
        s.contact(4000, 1, 0, 10000)
        self.assertEqual(s.acked, {'m': 4000})

    def test_hard_expiry_never_resets(self):
        s = Simulator(3, 'spray')
        s.originate(Message('m', 0, 2, 0, 300))
        s.contact(299, 0, 1, 10000)
        self.assertEqual(s.q[1]['m'].message.expires, 300)
        s.contact(300, 1, 2, 10000)
        self.assertFalse(s.delivered)

    def test_retention_and_reboot_are_independent(self):
        for kwargs in ({'retention': 60}, {'durable': False}):
            s = Simulator(3, 'spray', **kwargs)
            s.originate(Message('m', 0, 2, 0, 7200))
            s.contact(1, 0, 1, 10000)
            s.reboot(1, 100)
            s.contact(3600, 1, 2, 10000)
            self.assertFalse(s.delivered)

    def test_budget_conserved_on_split_and_rejection(self):
        s = Simulator(10, 'spray', copies=8)
        s.originate(Message('m', 0, 9, 0, 7200))
        for t in range(1, 8):
            for a in range(8):
                s.contact(t, a, (a + t) % 9, 10000)
        self.assertEqual(sum(q['m'].tokens for q in s.q if 'm' in q), 8)
        self.assertLessEqual(sum('m' in q for q in s.q), 8)
        r = Simulator(3, 'spray', capacity=2048)
        r.originate(Message('m', 0, 2, 0, 7200))
        r.originate(Message('full', 1, 2, 0, 7200))
        r.contact(1, 0, 1, 10000)
        self.assertEqual(r.q[0]['m'].tokens, 4)

    def test_no_global_ack_or_duplicate_delivery(self):
        s = Simulator(3, 'controlled')
        s.originate(Message('m', 0, 2, 0, 7200))
        s.contact(1, 0, 1, 10000)
        s.contact(2, 1, 2, 10000)
        s.contact(3, 1, 2, 10000)
        self.assertEqual(len(s.delivered), 1)
        self.assertIn('m', s.q[0])
        self.assertIn('m', s.q[1])
        self.assertFalse(s.acked)

    def test_offline_and_failed_contact(self):
        s = Simulator(2, 'direct')
        s.originate(Message('m', 0, 1, 0, 7200))
        s.offline.add(1)
        s.contact(1, 0, 1, 10000)
        s.offline.clear()
        s.contact(2, 0, 1, 10000, True)
        self.assertFalse(s.delivered)
        s.contact(3, 0, 1, 10000)
        self.assertTrue(s.delivered)

    def test_priority_single_variable_short_contact(self):
        delivered = []
        for priority in (False, True):
            s = Simulator(3, 'spray', priority=priority)
            s.originate(Message('large', 0, 2, 0, 7200, 20000))
            for i in range(5):
                s.originate(Message('text' + str(i), 0, 1, 0, 7200))
            s.contact(1, 0, 1, 21000)
            delivered.append(len(s.delivered))
        self.assertEqual(delivered, [0, 5])

    def test_reproducible_and_bounded_tables(self):
        self.assertEqual(run_case(10, 'campus', 1, 'spray'), run_case(10, 'campus', 1, 'spray'))
        s = Simulator(100, 'prophet')
        for i in range(1, 100):
            s.contact(i, 0, i, 10000)
        self.assertLessEqual(len(s.pred[0]), 64)

    def test_control_overhead_can_exhaust_contact(self):
        s = Simulator(2, 'spray')
        s.originate(Message('m', 0, 1, 0, 7200))
        s.contact(1, 0, 1, 16)
        self.assertFalse(s.delivered)
        self.assertEqual(s.c['wire_bytes'], 16)
        self.assertEqual(s.c['transmissions'], 0)

    def test_capacity_and_source_rejection_count(self):
        s = Simulator(2, 'spray', capacity=2048)
        s.originate(Message('a', 0, 1, 0, 7200))
        s.originate(Message('b', 0, 1, 0, 7200))
        s.contact(1, 0, 1, 2200)
        result = s.result(2)
        self.assertEqual(result['delivery_rate'], .5)
        self.assertEqual(result['source_rejections'], 1)
        self.assertLessEqual(result['wire_bytes'], 2200)

    def test_five_nodes_and_alternate_carrier(self):
        s = Simulator(5, 'spray', copies=8)
        s.originate(Message('m', 0, 4, 0, 7200))
        for node in range(4):
            s.contact(node + 1, node, node + 1, 10000)
        self.assertEqual(s.delivered_hops, [4])
        a = Simulator(4, 'spray', copies=8)
        a.originate(Message('m', 0, 3, 0, 7200))
        a.contact(1, 0, 1, 10000)
        a.contact(2, 0, 2, 10000)
        a.offline.add(1)
        a.contact(3, 1, 3, 10000)
        a.contact(4, 2, 3, 10000)
        self.assertEqual(a.delivered, {'m': 4})

    def test_full_destination_queue_can_lose_ack(self):
        s = Simulator(3, 'spray', capacity=2048)
        s.originate(Message('m', 0, 2, 0, 7200))
        s.originate(Message('occupied', 2, 1, 0, 7200))
        s.contact(1, 0, 2, 10000)
        self.assertIn('m', s.delivered)
        self.assertNotIn('ack:m', s.q[2])
        self.assertFalse(s.acked)
        self.assertGreater(s.c['admission_rejections'], 0)

    def test_parallel_worker_matches_serial_case(self):
        from run import evaluate, evaluate_subprocess
        job = (10, 'campus', 2, 'spray', True)
        self.assertEqual(evaluate(job), evaluate_subprocess(job))


if __name__ == '__main__':
    unittest.main()


class HeterogeneousStorage(unittest.TestCase):
    def test_full_small_relay_does_not_consume_copy_budget(self):
        s = Simulator(4, 'spray', node_capacities=[8192, 0, 4096, 4096])
        s.originate(Message('m', 0, 3, 0, 60))
        s.contact(1, 0, 1, 10000)
        self.assertEqual(s.q[0]['m'].tokens, 4)
        self.assertFalse(s.q[1])
        s.contact(2, 0, 2, 10000)
        s.contact(3, 2, 3, 10000)
        self.assertEqual(s.delivered, {'m': 3})
        for node in range(4):
            self.assertLessEqual(s.storage[node], s.node_capacities[node])

    def test_congestion_expiry_releases_each_nodes_storage(self):
        s = Simulator(4, 'spray', node_capacities=[8192, 2048, 4096, 0])
        for i in range(4):
            s.originate(Message(str(i), 0, 3, 0, 10))
        for node in (1, 2):
            s.contact(1, 0, node, 100000)
        self.assertGreater(s.c['admission_rejections'], 0)
        self.assertEqual(s.storage[1], 2048)
        self.assertEqual(s.storage[2], 4096)
        s.now = 10
        for node in range(4):
            s.prune(node)
        self.assertEqual(s.storage, [0, 0, 0, 0])
        self.assertFalse(s.delivered)

    def test_two_carriers_do_not_duplicate_destination_delivery(self):
        # Model evidence only: native v2 still authorizes one carrier.
        s = Simulator(4, 'controlled', priority=True,
                      node_capacities=[8192, 4096, 4096, 4096])
        s.originate(Message('m', 0, 3, 0, 60))
        s.contact(1, 0, 1, 10000)
        s.contact(2, 0, 2, 10000)
        s.contact(3, 2, 3, 10000)
        s.contact(4, 1, 3, 10000)
        self.assertEqual(s.delivered, {'m': 3})
        self.assertIn('ack:m', s.q[1])
        s.contact(5, 1, 0, 10000)
        self.assertEqual(s.acked, {'m': 5})
        self.assertNotIn('m', s.q[0])

    def test_capacity_vector_validation(self):
        for capacities in ([1], [1, -1]):
            with self.assertRaises(ValueError):
                Simulator(2, 'spray', node_capacities=capacities)
