import unittest

from history_sample import plan


def row(index, model="common", **changes):
    return {"session_ref": f"codex:{model}-{index}", "provider": "codex", "path": f"/synthetic/{index}",
            "models": [{"model": model, "effort": "high"}], "user_messages": 2,
            "assistant_messages": 3, "mixed": False, "error": None, **changes}


class HistorySampleTest(unittest.TestCase):
    def setUp(self):
        self.routes = {(model, "high"): [{"context_variant_unverified": False}]
                       for model in ("common", "rare")}

    def test_seeded_selection_is_order_independent_and_respects_total_budget(self):
        rows = [row(i) for i in range(100)] + [row(i, "rare") for i in range(3)]
        a = plan(rows, self.routes, "fixed", maximum=10)
        b = plan(list(reversed(rows)), self.routes, "fixed", maximum=10)
        self.assertEqual(a["baseline"], b["baseline"])
        self.assertEqual(10, a["assessment_slots"])
        rare = next(s for s in a["strata"] if s["model"] == "rare")
        self.assertEqual(3, rare["assessment_slots"])
        self.assertEqual(2 / 3, rare["baseline_inclusion_probability"])
        self.assertEqual(len(a["preview_candidates"]), len({r["session_ref"] for r in a["preview_candidates"]}))

    def test_unreadable_mixed_retired_and_empty_work_have_explicit_exclusions(self):
        rows = [row(1, "retired"), row(2, mixed=True), row(3, user_messages=0),
                row(4, error="JSONDecodeError"), row(5)]
        result = plan(rows, self.routes, "fixed")
        self.assertEqual(1, result["assessment_slots"])
        self.assertEqual({"model_effort_not_configured": 1, "mixed_actor_requires_attribution": 1,
                          "no_exchange": 1, "inventory_error": 1}, result["excluded_counts"])
        with self.assertRaises(ValueError):
            plan([row(1), row(1)], self.routes, "fixed")

    def test_preview_pool_does_not_silently_schedule_enrichment_candidates(self):
        result = plan([row(i) for i in range(100)], self.routes, "fixed", per_model=12)
        self.assertEqual(36, len(result["preview_candidates"]))
        self.assertEqual(6, len(result["baseline"]))
        self.assertEqual(6, result["strata"][0]["enrichment_slots"])
        self.assertIn("enrichment_selection", result["pending"])
        self.assertEqual("preview_plan_only", result["status"])


if __name__ == "__main__":
    unittest.main()
