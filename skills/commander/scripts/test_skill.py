#!/usr/bin/env python3
"""Text-contract regression tests for Commander's boundary with Orca."""

from pathlib import Path
import unittest


SKILL = Path(__file__).parents[1] / "SKILL.md"
CAPTAIN = Path(__file__).parents[1] / "references" / "captain.md"


class SkillBoundaryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = SKILL.read_text(encoding="utf-8")
        cls.captain = CAPTAIN.read_text(encoding="utf-8")

    def test_commander_owns_only_fronts_and_routes(self):
        self.assertIn("**Fronts:**", self.text)
        self.assertIn("**Routes:**", self.text)
        self.assertIn("Beads is the durable contract", self.text)
        self.assertIn("Orca is the coordination system", self.text)

    def test_skill_is_agent_triggerable(self):
        self.assertNotIn("disable-model-invocation", self.text)
        description = self.text.split("description:", 1)[1].split("\n", 1)[0]
        for trigger in ("orchestrate", "parallelize", "subagents", "Commander"):
            self.assertIn(trigger, description)

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

    def test_worktrees_are_conditional_on_concurrent_writers(self):
        self.assertIn("management and dependencies with Orca tasks", self.text)
        self.assertIn("judge write concurrency across the whole run", self.text)
        self.assertIn("fresh agent terminals in the existing checkout", self.text)
        self.assertIn("Each Captain owns its own worktree only when", self.text)
        self.assertIn("child worktrees of that checkout", self.text)
        self.assertIn("reconciled in the Captain's worktree", self.text)
        self.assertIn("Take a worktree only when", self.captain)
        self.assertIn("no worktree of your own, the checkout you run in", self.captain)

    def test_contract_is_created_when_no_bead_exists(self):
        self.assertIn("A Bead need not exist when the user asks", self.text)
        self.assertIn("create the top-level Bead yourself", self.text)
        self.assertIn("user's request in their own words", self.text)

    def test_beads_carry_the_work_and_dispatch_stays_a_pointer(self):
        self.assertIn("dispatch text stays a pointer to the Bead", self.text)
        self.assertIn("never restated in the message", self.text)
        self.assertIn("a Bead that completely describes its work", self.captain)
        self.assertIn("do not mirror task topology in Beads", self.captain)

    def test_captain_defines_requirements_before_orchestrating(self):
        for clause in (
            "scope, what is out of scope, and how it will be judged done",
            "only those that change what gets built",
            "high-level acceptance criteria",
            "would be overkill",
        ):
            self.assertIn(clause, self.captain)

    def test_human_escalation_paths_are_explicit(self):
        self.assertIn("name the thread that raised it", self.text)
        self.assertIn("forward the reply verbatim", self.text)
        self.assertIn("route through you instead by saying so", self.text)
        self.assertIn("Never open a blocking interactive question flow", self.text)

    def test_autonomous_runs_resolve_against_a_peer(self):
        self.assertIn("autonomous run or said they will be unavailable", self.text)
        self.assertIn("peer launched on the Captain's own resolved route row", self.text)
        self.assertIn("Launch a peer on your own resolved route row", self.captain)

    def test_handover_asks_to_merge_and_reports_cost(self):
        for clause in (
            "ask whether to merge it or review it first",
            "do not merge before they answer",
            "tests, gates, or tooling added or changed",
            "would prevent a repeat",
            "one row per front and per mechanical check",
            "marked unknown where Orca did not record it",
        ):
            self.assertIn(clause, self.text)


if __name__ == "__main__":
    unittest.main()
