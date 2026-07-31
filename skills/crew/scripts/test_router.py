#!/usr/bin/env python3
"""Tests for research-backed Crew task-fit routing."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from skills.crew.scripts import router


SCRIPT = Path(__file__).with_name("router.py")


class RouterTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.home = self.base / "home"
        self.home.mkdir()
        self.repo = self.base / "repo"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        self.env = os.environ.copy()
        self.env["HOME"] = str(self.home)
        self.env["PYTHONDONTWRITEBYTECODE"] = "1"
        config = {
            "version": 2,
            "routes": {
                "captain": {
                    "agent": "codex",
                    "model": "gpt-5.6-sol",
                    "effort": "max",
                },
                "worker": {
                    "agent": "grok",
                    "model": "grok-4.5",
                    "effort": "high",
                },
            },
        }
        path = self.home / ".furanku-skills" / "commander" / "config.json"
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps(config), encoding="utf-8")

    def tearDown(self):
        self.temporary.cleanup()

    def choose(self, request, runtime=None):
        request_path = self.base / "request.json"
        request_path.write_text(json.dumps(request), encoding="utf-8")
        args = [
            sys.executable,
            str(SCRIPT),
            "choose",
            "--repo",
            str(self.repo),
            "--request-file",
            str(request_path),
        ]
        if runtime is not None:
            runtime_path = self.base / "runtime.json"
            runtime_path.write_text(json.dumps(runtime), encoding="utf-8")
            args += ["--runtime-file", str(runtime_path)]
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            env=self.env,
            check=False,
        )
        if result.returncode:
            self.fail(
                f"{result.args}\nstdout: {result.stdout}\nstderr: {result.stderr}"
            )
        return json.loads(result.stdout)

    def test_selects_cheapest_sufficient_implementation_candidate(self):
        decision = self.choose(
            {"role": "worker", "specialization": "implementation"}
        )
        self.assertEqual("selected", decision["status"])
        self.assertTrue(decision["sufficient"])
        self.assertEqual(
            "codex/gpt-5.6-luna/max", decision["selected"]["id"]
        )
        self.assertEqual(0, decision["quality"]["shortfall"])
        self.assertIn("quota unknown", decision["warnings"])

    def test_role_does_not_change_task_fit_selection(self):
        worker = self.choose(
            {"role": "worker", "specialization": "architecture"}
        )
        captain = self.choose(
            {"role": "captain", "specialization": "architecture"}
        )
        self.assertEqual(worker["selected"]["id"], captain["selected"]["id"])

    def test_best_quality_selects_strongest_sufficient_candidate(self):
        decision = self.choose(
            {
                "role": "worker",
                "specialization": "architecture",
                "selection_mode": "best-quality",
            }
        )
        self.assertEqual(
            "claude/claude-fable-5[1m]/high", decision["selected"]["id"]
        )
        self.assertEqual("best-quality", decision["judgment"]["selection_mode"])
        self.assertEqual(0.764, decision["quality"]["score"])
        self.assertEqual("quality", decision["selected_by"][0])

    def test_cheapest_sufficient_uses_quality_only_after_cost_ties(self):
        decision = self.choose(
            {
                "role": "worker",
                "specialization": "architecture",
                "selection_mode": "cheapest-sufficient",
            }
        )
        self.assertEqual(
            "codex/gpt-5.6-sol/xhigh", decision["selected"]["id"]
        )
        self.assertEqual(
            "cheapest-sufficient", decision["judgment"]["selection_mode"]
        )
        self.assertEqual("cost", decision["selected_by"][0])

    def test_selection_mode_keeps_runtime_hard_gates(self):
        fable = "claude/claude-fable-5[1m]/high"
        decision = self.choose(
            {
                "role": "worker",
                "specialization": "architecture",
                "selection_mode": "best-quality",
            },
            {"candidates": {fable: {"quota": {"status": "exhausted"}}}},
        )
        self.assertNotEqual(fable, decision["selected"]["id"])
        self.assertIn("quota exhausted", decision["rejected"][fable])

    def test_selection_mode_and_custom_priority_are_mutually_exclusive(self):
        routing = router.read_json(router.CATALOG, "routing catalog")["routing"]
        with self.assertRaisesRegex(
            router.Error, "selection_mode cannot be combined with priority"
        ):
            router.task_judgment(
                routing,
                {
                    "role": "worker",
                    "specialization": "implementation",
                    "selection_mode": "best-quality",
                    "priority": ["cost"],
                },
            )

    def test_runtime_quota_exhaustion_is_a_hard_gate(self):
        exhausted = "opencode/kimi-for-coding/k3/max"
        runtime = {
            "candidates": {
                exhausted: {"quota": {"status": "exhausted"}}
            }
        }
        decision = self.choose(
            {"role": "worker", "specialization": "spatial-3d"}, runtime
        )
        self.assertNotEqual(exhausted, decision["selected"]["id"])
        self.assertIn("quota exhausted", decision["rejected"][exhausted])

    def test_minimum_context_hard_gate_uses_only_documented_capacity(self):
        decision = self.choose(
            {
                "role": "worker",
                "specialization": "implementation",
                "requires": {"minimum_context": 800000},
            }
        )
        self.assertEqual(
            "opencode/kimi-for-coding/k3/max", decision["selected"]["id"]
        )
        self.assertIn(
            "context capacity unknown",
            decision["rejected"]["codex/gpt-5.6-luna/max"],
        )

    def test_unknown_required_evidence_returns_no_route_visibly(self):
        decision = self.choose(
            {
                "role": "worker",
                "summary": "Need direct empathy evidence",
                "needs": {
                    "product-empathy": {"minimum": 0.5, "weight": 1}
                },
            }
        )
        self.assertEqual("no-route", decision["status"])
        self.assertIn("no research-proven", decision["reason"])

    def test_v3_repository_patch_augments_catalog(self):
        path = self.repo / ".furanku-skills" / "commander" / "config.json"
        path.parent.mkdir(parents=True)
        path.write_text(
            json.dumps(
                {
                    "version": 3,
                    "routes": {},
                    "routing": {
                        "candidates": {
                            "codex/gpt-5.6-luna/max": {"enabled": False}
                        }
                    },
                }
            ),
            encoding="utf-8",
        )
        decision = self.choose(
            {"role": "worker", "specialization": "implementation"}
        )
        self.assertNotEqual(
            "codex/gpt-5.6-luna/max", decision["selected"]["id"]
        )
        self.assertEqual(
            ["disabled by configuration"],
            decision["rejected"]["codex/gpt-5.6-luna/max"],
        )
        layers = decision["provenance"]["layers"]
        repo_layer = next(layer for layer in layers if layer["scope"] == "repo")
        self.assertEqual(3, repo_layer["version"])

    def test_exact_route_keeps_v2_launch_and_provenance(self):
        decision = self.choose(
            {"role": "worker", "exact_route": "worker"}
        )
        self.assertEqual("exact", decision["status"])
        self.assertEqual("grok", decision["selected"]["agent"])
        self.assertEqual(
            "global", decision["provenance"]["winner"]["scope"]
        )

    def test_exact_route_must_match_declared_role(self):
        request_path = self.base / "request.json"
        request_path.write_text(
            json.dumps({"role": "worker", "exact_route": "captain"}),
            encoding="utf-8",
        )
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "choose",
                "--repo",
                str(self.repo),
                "--request-file",
                str(request_path),
            ],
            capture_output=True,
            text=True,
            env=self.env,
            check=False,
        )
        self.assertNotEqual(0, result.returncode)
        self.assertIn("does not match role 'worker'", result.stderr)

    def test_removed_no_route_policy_remains_fail_closed(self):
        path = self.repo / ".furanku-skills" / "commander" / "config.json"
        path.parent.mkdir(parents=True)
        path.write_text(
            json.dumps(
                {
                    "version": 3,
                    "routes": {},
                    "routing": {"policy": {"on_no_sufficient": None}},
                }
            ),
            encoding="utf-8",
        )
        decision = self.choose(
            {
                "role": "worker",
                "needs": {
                    "product-empathy": {"minimum": 0.5, "weight": 1}
                },
            }
        )
        self.assertEqual("no-route", decision["status"])
        self.assertNotEqual("fallback", decision["status"])

    def test_pin_requires_reason_and_keeps_hard_gates(self):
        candidate = "grok/grok-4.5/high"
        denied = self.choose(
            {
                "role": "worker",
                "pin": {
                    "candidate": candidate,
                    "reason": "User requested Grok",
                },
            },
            {"candidates": {candidate: {"health": "unhealthy"}}},
        )
        self.assertEqual("no-route", denied["status"])
        allowed = self.choose(
            {
                "role": "worker",
                "pin": {
                    "candidate": candidate,
                    "reason": "User requested Grok",
                },
            }
        )
        self.assertEqual("pinned", allowed["status"])
        self.assertEqual("User requested Grok", allowed["reason"])

    def test_quota_axi_adapter_uses_effective_pace_and_skips_kimi(self):
        routing = router.read_json(router.CATALOG, "routing catalog")["routing"]
        snapshot = {
            "schemaVersion": 3,
            "generatedAt": "2026-07-31T11:30:17Z",
            "providers": [
                {
                    "provider": "codex",
                    "state": {"status": "fresh", "stale": False},
                    "quotaSemantics": {
                        "status": "known",
                        "effectiveAvailability": [
                            {
                                "scope": "all_models",
                                "effectivePercentRemaining": 34,
                                "boundedBy": ["weekly"],
                                "pace": {"worstReservePercentPoints": -50},
                            }
                        ],
                    },
                },
                {
                    "provider": "kimi",
                    "state": {"status": "auth_required", "stale": False},
                    "quotaSemantics": {
                        "status": "unknown",
                        "effectiveAvailability": [],
                    },
                },
            ],
        }
        runtime = router.quota_axi_runtime(snapshot, routing)
        self.assertEqual(0.5, runtime["harnesses"]["codex"]["quota"]["pressure"])
        self.assertEqual(34, runtime["harnesses"]["codex"]["quota"]["effective_percent_remaining"])
        self.assertNotIn("opencode", runtime["harnesses"])
        self.assertIn("not assumed", runtime["notes"][0])


if __name__ == "__main__":
    unittest.main()
