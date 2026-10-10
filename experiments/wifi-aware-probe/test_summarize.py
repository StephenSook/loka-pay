import unittest
from summarize import summarize, distribution


class MetricsTest(unittest.TestCase):
    def sample(self, size=1000, run="synthetic", ms=10):
        return dict(event="transfer", run=run, mode="rtt_30", bytes_each_direction=size,
                    integrity_verified=True, native_aware_path=True, upload_with_ack_ms=ms,
                    download_with_ack_ms=ms, round_trip_transfer_ms=ms*2)

    def test_missing_is_unknown(self):
        result = summarize([])
        self.assertEqual(result["groups"], [])
        self.assertIsNone(result["rf_packet_loss"])
        self.assertIsNone(distribution([])["p99"])

    def test_no_mixing_runs_or_sizes(self):
        self.assertEqual(len(summarize([self.sample(), self.sample(10000), self.sample(run="other")])["groups"]), 3)

    def test_units_and_nearest_rank(self):
        result = summarize([self.sample(ms=n) for n in range(1,101)])["groups"][0]
        self.assertEqual(result["round_trip_transfer_ms"]["p99"], 198)
        self.assertAlmostEqual(summarize([self.sample()])["groups"][0]["upload_with_ack_mbps"]["p50"], .8)

    def test_reject_invalid_evidence(self):
        for patch in ({"native_aware_path": False}, {"integrity_verified": False}, {"upload_with_ack_ms": 0}, {"download_with_ack_ms": float("nan")}):
            with self.assertRaises(ValueError): summarize([self.sample() | patch])

    def test_failures_remain_visible(self):
        result = summarize([{"event": "pairing_failed", "run": "synthetic", "elapsed_ms": 100}])
        self.assertEqual(len(result["failures"]), 1)
        self.assertEqual(result["groups"], [])


if __name__ == "__main__": unittest.main()
