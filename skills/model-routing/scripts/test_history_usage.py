import unittest

from history_usage import summarize


def snapshot(line, input_tokens, cached, output):
    return (line, {"type": "event_msg", "payload": {"type": "token_count", "info": {
        "total_token_usage": {"input_tokens": input_tokens, "cached_input_tokens": cached,
                              "output_tokens": output, "reasoning_output_tokens": output // 2}}}})


class HistoricalUsageTest(unittest.TestCase):
    def test_cumulative_and_duplicate_snapshots_are_not_summed(self):
        result = summarize([snapshot(1, 100, 50, 10), snapshot(2, 100, 50, 10),
                            snapshot(3, 300, 200, 30)])
        self.assertEqual("recorded_snapshot", result["status"])
        self.assertEqual({"input_tokens": 300, "cached_input_tokens": 200, "output_tokens": 30},
                         result["last_snapshot"]["counters"])
        self.assertIsNone(result["cost"])
        self.assertIsNone(result["quota_percent"])

    def test_reset_cannot_look_like_a_complete_cheap_session(self):
        result = summarize([snapshot(1, 1000, 800, 100), snapshot(4, 10, 0, 1)])
        self.assertEqual("needs_reconciliation", result["status"])
        self.assertEqual(4, result["issues"][0]["line"])

    def test_missing_or_invalid_usage_never_becomes_zero(self):
        self.assertEqual("unavailable", summarize([])["status"])
        for event in (snapshot(1, 5, 6, 1), snapshot(1, True, 0, 1), snapshot(1, 5, 0, -1)):
            result = summarize([event])
            self.assertEqual("needs_reconciliation", result["status"])
            self.assertIsNone(result["last_snapshot"])


if __name__ == "__main__":
    unittest.main()
