#!/usr/bin/env python3
"""Text-contract regression tests for Commander's boundary with Orca."""

from pathlib import Path
import unittest


SKILL = Path(__file__).parents[1] / "SKILL.md"


class SkillBoundaryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = SKILL.read_text(encoding="utf-8")

    def test_commander_owns_only_fronts_and_routes(self):
        self.assertIn("**Fronts:**", self.text)
        self.assertIn("**Routes:**", self.text)
        self.assertIn("Beads is the durable contract", self.text)
        self.assertIn("Orca is the coordination system", self.text)
        self.assertIn("disable-model-invocation: true", self.text)

    def test_orca_native_lifecycle_has_no_commander_overlay(self):
        self.assertIn(
            "Use Orca's native task state, retries, results, and recovery guidance",
            self.text,
        )
        for stale_overlay in (
            "done_with_concerns",
            "needs_context",
            "bounded receipt",
            "circuit breaking",
            "verification-needed",
            "global manager lease",
        ):
            self.assertNotIn(stale_overlay, self.text)

    def test_route_intent_is_applied_by_orca(self):
        self.assertIn("exact `agent`, `model`, and `effort`", self.text)
        self.assertIn("route-aware terminal launch", self.text)
        self.assertIn("dispatch the task to that returned terminal handle", self.text)
        self.assertIn("Use `orchestration run` only when", self.text)
        self.assertNotIn("model_reasoning_effort", self.text)

    def test_front_identity_and_nested_routes_are_explicit(self):
        self.assertIn("One Bead may have several", self.text)
        self.assertIn("unique run key", self.text)
        self.assertIn("globally unique key", self.text)
        self.assertIn("run key, Bead ID, front key, route ID", self.text)
        self.assertIn("Orca task IDs", self.text)
        self.assertIn("self-contained child-routing contract", self.text)
        self.assertIn("coordinates Worker children", self.text)
        self.assertNotIn("dependency-linked child Bead", self.text)

    def test_specialist_ties_are_deterministic(self):
        self.assertIn("sole match when exactly one fits", self.text)
        self.assertIn("lexicographically first route ID", self.text)
        self.assertIn("otherwise obtain a named user decision", self.text)
        self.assertIn("explicitly names the front's stated outcome", self.text)
        self.assertNotIn("deepest route ID", self.text)

    def test_task_provenance_records_exact_route(self):
        self.assertIn("resolved `agent`, `model`, and `effort`", self.text)
        self.assertIn("exact routing provenance are known", self.text)
        self.assertIn("including a single match", self.text)

    def test_worktree_lineage_is_separate_from_management(self):
        self.assertIn("management and dependencies with Orca tasks", self.text)
        self.assertIn("child worktree for work stacked on or dependent", self.text)
        self.assertIn("sidebar lineage does not encode orchestration ownership", self.text)


if __name__ == "__main__":
    unittest.main()
