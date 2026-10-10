import unittest
from prediction_comparison import events, evaluate, POLICIES


class PairedPredictionComparison(unittest.TestCase):
    def test_reproducible_offers_and_no_future_training(self):
        warm = events(12, 3, 1, 'routine')
        self.assertEqual(warm, events(12, 3, 1, 'routine'))
        self.assertEqual(36, sum(kind == 'offer' for _, kind, _ in warm))
        self.assertTrue(all(t >= 600 for t, k, _ in warm if k == 'offer'))
        self.assertTrue(all(t >= 600 for t, _, _ in events(12, 3, 1, 'cold')))
        self.assertEqual(sorted(t for t, _, _ in warm), [t for t, _, _ in warm])

    def test_same_offered_load_for_every_policy(self):
        trace = events(8, 1, 1, 'congested')
        for policy in POLICIES:
            row = evaluate(8, 1, 1, 'congested', policy, trace)
            self.assertEqual(8, row['offered_messages'])
            self.assertLessEqual(row['delivered'], row['offered_messages'])
            self.assertLessEqual(row['sender_confirmed'], row['delivered'])


if __name__ == '__main__':
    unittest.main()
