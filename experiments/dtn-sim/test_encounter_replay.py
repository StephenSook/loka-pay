import unittest
from encounter_replay import replay


class ReplayTests(unittest.TestCase):
    def trace(self, samples, dropped=0):
        return dict(version=1, scope='local-test', dropped=dropped,
                    samples=[dict(time=t, peers=p) for t, p in samples])

    def test_churn_and_suspension(self):
        result = replay(self.trace([(0, [1]), (6000, [1]), (9000, []),
                                   (10000, [1]), (16000, [1]), (67000, [1]), (73000, [1])]))
        self.assertEqual(result['records'][0]['encounters'], 2)
        self.assertEqual(result['suspensionGaps'], 1)
        self.assertAlmostEqual(result['records'][0]['estimate'], .75 * .98 ** (67000 / 60000) * .25 + .75)

    def test_gap_cannot_qualify_and_truncation_is_visible(self):
        result = replay(self.trace([(0, [1]), (31000, [1])], dropped=1))
        self.assertEqual(result['records'], [])
        self.assertFalse(result['complete'])

    def test_reject_invalid_trace(self):
        for samples in [[(1, [])], [(0, [1, 1])], [(0, [True])], [(0, [257])], [(0, []), (-1, [])]]:
            with self.assertRaises(ValueError):
                replay(self.trace(samples))
