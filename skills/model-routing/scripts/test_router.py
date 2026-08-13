#!/usr/bin/env python3
"""Tests for the model-routing brief and launch gate-check."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import router


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
            "version": 4,
            "routes": {
                "captain": {
                    "agent": "codex",
                    "model": "gpt-5.6-sol",
                    "effort": "xhigh",
                },
                "worker": {
                    "agent": "grok",
                    "model": "grok-4.6",
                    "effort": "high",
                },
            },
            "preferences": [
                "Captains default to gpt-5.6-sol at xhigh.",
                "For the most complex architecture or systems design, use "
                "claude-fable-5[1m] or gpt-5.6-sol at max.",
            ],
        }
        path = self.home / ".furanku-skills" / "model-routing" / "config.json"
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps(config), encoding="utf-8")

    def tearDown(self):
        self.temporary.cleanup()

    def run_router(self, *args, runtime=None, expect_code=0):
        command = [sys.executable, str(SCRIPT), *args, "--repo", str(self.repo)]
        if runtime is not None:
            runtime_path = self.base / "runtime.json"
            runtime_path.write_text(json.dumps(runtime), encoding="utf-8")
            command += ["--runtime-file", str(runtime_path)]
        result = subprocess.run(
            command, capture_output=True, text=True, env=self.env, check=False
        )
        if result.returncode != expect_code:
            self.fail(
                f"{result.args}\nstdout: {result.stdout}\nstderr: {result.stderr}"
            )
        return result

    def check(self, *args, runtime=None, expect_code=0):
        result = self.run_router(
            "check", *args, runtime=runtime, expect_code=expect_code
        )
        return json.loads(result.stdout)

    def write_repo_layer(self, config):
        path = self.repo / ".furanku-skills" / "model-routing" / "config.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(config), encoding="utf-8")

    def test_brief_shows_preferences_with_scope_tags(self):
        brief = self.run_router("brief").stdout
        self.assertIn("## User preferences", brief)
        self.assertIn("- (global) Captains default to gpt-5.6-sol at xhigh.", brief)
        self.assertIn("claude-fable-5[1m] or gpt-5.6-sol at max", brief)

    def test_brief_shows_exact_routes_and_candidate_evidence(self):
        brief = self.run_router("brief").stdout
        self.assertIn("| captain | codex | gpt-5.6-sol | xhigh | global |", brief)
        self.assertIn("claude/claude-fable-5[1m]/high", brief)
        self.assertIn("## Evidence", brief)
        self.assertIn("https://deepswe.datacurve.ai/", brief)
        self.assertIn("## Evidence methodology", brief)

    def test_brief_accumulates_preferences_across_layers(self):
        self.write_repo_layer(
            {
                "version": 4,
                "routes": {},
                "preferences": ["In this repo, prefer terra for bulk edits."],
            }
        )
        brief = self.run_router("brief").stdout
        self.assertIn("- (global) Captains default", brief)
        self.assertIn("- (repo) In this repo, prefer terra for bulk edits.", brief)

    def test_brief_marks_disabled_candidates(self):
        self.write_repo_layer(
            {
                "version": 4,
                "routes": {},
                "candidates": {"codex/gpt-5.6-luna/max": {"enabled": False}},
            }
        )
        brief = self.run_router("brief").stdout
        self.assertIn(
            "Disabled by configuration: codex/gpt-5.6-luna/max", brief
        )
        self.assertNotIn("| codex/gpt-5.6-luna/max |", brief)

    def test_brief_json_carries_candidates_preferences_and_layers(self):
        payload = json.loads(
            self.run_router("brief", "--format", "json").stdout
        )
        self.assertIn("claude/claude-fable-5[1m]/high", payload["candidates"])
        self.assertEqual("global", payload["preferences"][0]["scope"])
        self.assertEqual(
            "xhigh", payload["routes"]["effective"]["captain"]["effort"]
        )
        scopes = [layer["scope"] for layer in payload["layers"]]
        self.assertEqual(["builtin", "global", "repo", "machine-repo"], scopes)

    def test_check_selects_candidate_and_records_reason(self):
        decision = self.check(
            "--candidate",
            "codex/gpt-5.6-sol/max",
            "--reason",
            "Cross-service design; wrong seams are expensive.",
            runtime={"harnesses": {"codex": {"quota": {"status": "known"}}}},
        )
        self.assertEqual("selected", decision["status"])
        self.assertEqual("codex/gpt-5.6-sol/max", decision["selected"]["id"])
        self.assertEqual("max", decision["selected"]["effort"])
        self.assertEqual(
            "Cross-service design; wrong seams are expensive.",
            decision["reason"],
        )
        self.assertEqual(["builtin"], decision["sources"])

    def test_check_requires_reason_for_candidate_picks(self):
        result = self.run_router(
            "check",
            "--candidate",
            "codex/gpt-5.6-sol/max",
            expect_code=1,
        )
        self.assertIn("requires --reason", result.stderr)

    def test_check_refuses_disabled_candidate(self):
        self.write_repo_layer(
            {
                "version": 4,
                "routes": {},
                "candidates": {"codex/gpt-5.6-luna/max": {"enabled": False}},
            }
        )
        decision = self.check(
            "--candidate",
            "codex/gpt-5.6-luna/max",
            "--reason",
            "Cheap bulk edit.",
            expect_code=1,
        )
        self.assertEqual("refused", decision["status"])
        self.assertIn("disabled by configuration", decision["reasons"])

    def test_check_refuses_exhausted_quota(self):
        candidate = "grok/grok-4.6/high"
        decision = self.check(
            "--candidate",
            candidate,
            "--reason",
            "Low-risk mechanical change.",
            runtime={"candidates": {candidate: {"quota": {"status": "exhausted"}}}},
            expect_code=1,
        )
        self.assertEqual("refused", decision["status"])
        self.assertIn("quota exhausted", decision["reasons"])

    def test_check_stale_quota_needs_acceptance_then_records_it(self):
        candidate = "grok/grok-4.6/high"
        runtime = {"candidates": {candidate: {"quota": {"status": "stale"}}}}
        decision = self.check(
            "--candidate",
            candidate,
            "--reason",
            "Low-risk mechanical change.",
            runtime=runtime,
            expect_code=2,
        )
        self.assertEqual("needs-acceptance", decision["status"])
        self.assertIn("--accept-quota-unknown", decision["pending"][0])
        decision = self.check(
            "--candidate",
            candidate,
            "--reason",
            "Low-risk mechanical change.",
            "--accept-quota-unknown",
            "Rafael accepted stale quota for a low-risk edit.",
            runtime=runtime,
        )
        self.assertEqual("selected", decision["status"])
        self.assertIn("quota stale", decision["warnings"])
        self.assertEqual(
            "Rafael accepted stale quota for a low-risk edit.",
            decision["quota_acceptance"],
        )

    def test_check_refuses_launcher_outside_launchable_via(self):
        decision = self.check(
            "--candidate",
            "grok/grok-4.6/high",
            "--reason",
            "Low-risk mechanical change.",
            "--launchable-via",
            "claude,codex",
            expect_code=1,
        )
        self.assertEqual("refused", decision["status"])
        self.assertIn(
            "agent 'grok' is outside the consumer's launchable agents: "
            "claude, codex",
            decision["reasons"],
        )
        decision = self.check(
            "--candidate",
            "grok/grok-4.6/high",
            "--reason",
            "Low-risk mechanical change.",
            "--launchable-via",
            "grok",
            runtime={"harnesses": {"grok": {"quota": {"status": "known"}}}},
        )
        self.assertEqual("selected", decision["status"])

    def test_check_enforces_feature_and_context_gates(self):
        decision = self.check(
            "--candidate",
            "codex/gpt-5.6-luna/max",
            "--reason",
            "Needs the full monorepo in context.",
            "--minimum-context",
            "800000",
            expect_code=1,
        )
        self.assertIn("context capacity unknown", decision["reasons"])
        decision = self.check(
            "--candidate",
            "codex/gpt-5.6-luna/max",
            "--reason",
            "Needs long-context support.",
            "--require-feature",
            "long-context",
            expect_code=1,
        )
        self.assertIn("missing features: long-context", decision["reasons"])

    def test_check_unknown_candidate_lists_launchable_ids(self):
        result = self.run_router(
            "check",
            "--candidate",
            "codex/gpt-9/max",
            "--reason",
            "Guessing.",
            expect_code=1,
        )
        self.assertIn("unknown candidate", result.stderr)
        self.assertIn("claude/claude-fable-5[1m]/high", result.stderr)

    def test_check_exact_route_keeps_provenance(self):
        decision = self.check(
            "--exact-route",
            "worker",
            runtime={"harnesses": {"grok": {"quota": {"status": "known"}}}},
        )
        self.assertEqual("exact", decision["status"])
        self.assertEqual("grok", decision["selected"]["agent"])
        self.assertEqual("grok/grok-4.6/high", decision["selected"]["id"])
        self.assertEqual("global", decision["provenance"]["winner"]["scope"])

    def test_check_exact_route_refuses_exhausted_quota(self):
        decision = self.check(
            "--exact-route",
            "worker",
            runtime={
                "harnesses": {"grok": {"quota": {"status": "exhausted"}}}
            },
            expect_code=1,
        )
        self.assertEqual("refused", decision["status"])
        self.assertIn("quota exhausted", decision["reasons"])

    def test_check_exact_route_refuses_disabled_candidate_with_provenance(self):
        self.write_repo_layer(
            {
                "version": 4,
                "routes": {},
                "candidates": {"grok/grok-4.6/high": {"enabled": False}},
            }
        )
        decision = self.check("--exact-route", "worker", expect_code=1)
        self.assertEqual("refused", decision["status"])
        self.assertIn("disabled by configuration", decision["reasons"])
        self.assertEqual("global", decision["route_provenance"]["winner"]["scope"])
        self.assertEqual("grok/grok-4.6/high", decision["candidate"])
        self.assertEqual(["builtin", "repo"], decision["candidate_sources"])

    def test_check_exact_route_gates_unmatched_routes_by_harness(self):
        self.write_repo_layer(
            {
                "version": 4,
                "routes": {
                    "worker.bulk": {
                        "work": "Bulk edits.",
                        "agent": "codex",
                        "model": "gpt-9-experimental",
                        "effort": "low",
                    }
                },
            }
        )
        decision = self.check(
            "--exact-route",
            "worker.bulk",
            runtime={
                "harnesses": {"codex": {"status": "auth-required"}}
            },
            expect_code=1,
        )
        self.assertEqual("refused", decision["status"])
        self.assertIn("runtime status auth-required", decision["reasons"])
        result = self.run_router(
            "check",
            "--exact-route",
            "worker.bulk",
            "--require-feature",
            "vision",
            expect_code=1,
        )
        self.assertIn("matches no configured candidate", result.stderr)

    def test_builtin_defaults_route_without_persisted_layers(self):
        (self.home / ".furanku-skills" / "model-routing" / "config.json").unlink()
        decision = self.check(
            "--exact-route",
            "worker",
            runtime={"harnesses": {"codex": {"quota": {"status": "known"}}}},
        )
        self.assertEqual("exact", decision["status"])
        self.assertEqual("codex", decision["selected"]["agent"])
        self.assertEqual("gpt-5.6-luna", decision["selected"]["model"])
        self.assertEqual("builtin", decision["provenance"]["winner"]["scope"])

    def test_layer_candidate_patch_merges_over_builtin(self):
        self.write_repo_layer(
            {
                "version": 4,
                "routes": {},
                "candidates": {
                    "codex/gpt-5.6-sol/max": {
                        "capabilities": {
                            "reasoning": {"conservative": 0.6}
                        }
                    }
                },
            }
        )
        payload = json.loads(
            self.run_router("brief", "--format", "json").stdout
        )
        merged = payload["candidates"]["codex/gpt-5.6-sol/max"]
        self.assertEqual(0.6, merged["capabilities"]["reasoning"]["conservative"])
        self.assertEqual(0.59, merged["capabilities"]["reasoning"]["score"])
        self.assertEqual(
            ["builtin", "repo"],
            payload["candidate_sources"]["codex/gpt-5.6-sol/max"],
        )

    def test_harness_exhaustion_dominates_candidate_quota(self):
        candidate = "claude/claude-fable-5[1m]/high"
        decision = self.check(
            "--candidate",
            candidate,
            "--reason",
            "Top design tier.",
            runtime={
                "harnesses": {"claude": {"quota": {"status": "exhausted"}}},
                "candidates": {
                    candidate: {
                        "quota": {
                            "status": "known",
                            "effective_percent_remaining": 80,
                        }
                    }
                },
            },
            expect_code=1,
        )
        self.assertEqual("refused", decision["status"])
        self.assertIn("quota exhausted", decision["reasons"])

    def test_partial_global_layer_briefs_cleanly(self):
        path = self.home / ".furanku-skills" / "model-routing" / "config.json"
        path.write_text(
            json.dumps(
                {
                    "version": 4,
                    "routes": {
                        "captain": {
                            "agent": "codex",
                            "model": "gpt-5.6-sol",
                            "effort": "xhigh",
                        }
                    },
                }
            ),
            encoding="utf-8",
        )
        brief = self.run_router("brief").stdout
        self.assertIn("| captain | codex | gpt-5.6-sol | xhigh | global |", brief)
        self.assertIn("| worker | codex | gpt-5.6-luna | max | builtin |", brief)

    def test_candidate_tombstone_removes_candidate(self):
        self.write_repo_layer(
            {
                "version": 4,
                "routes": {},
                "candidates": {"grok/grok-4.6/high": None},
            }
        )
        payload = json.loads(
            self.run_router("brief", "--format", "json").stdout
        )
        self.assertNotIn("grok/grok-4.6/high", payload["candidates"])
        result = self.run_router(
            "check",
            "--candidate",
            "grok/grok-4.6/high",
            "--reason",
            "Cheap pick.",
            expect_code=1,
        )
        self.assertIn("unknown candidate", result.stderr)

    def test_malformed_economics_override_fails_cleanly(self):
        self.write_repo_layer(
            {
                "version": 4,
                "routes": {},
                "candidates": {"codex/gpt-5.6-sol/max": {"economics": "free"}},
            }
        )
        result = self.run_router("brief", expect_code=1)
        self.assertIn("economics must be an object", result.stderr)

    def test_rendered_field_overrides_are_validated(self):
        cases = {
            "confidence must be a non-empty string": {
                "capabilities": {"reasoning": {"confidence": 0.9}}
            },
            "must be non-negative": {
                "economics": {"task_cost_usd": {"value": -100}}
            },
            "must be positive": {
                "economics": {"output_tokens_per_second": {"value": -5}}
            },
            "string evidence": {
                "capabilities": {"reasoning": {"evidence": [1, 2]}}
            },
            "confidence must be a non-empty str": {
                "capabilities": {"reasoning": {"confidence": None}}
            },
            "must be a finite number": {
                "economics": {"task_cost_usd": {"value": 10**400}}
            },
        }
        for message, patch in cases.items():
            with self.subTest(message=message):
                self.write_repo_layer(
                    {
                        "version": 4,
                        "routes": {},
                        "candidates": {"codex/gpt-5.6-sol/max": patch},
                    }
                )
                result = self.run_router("brief", expect_code=1)
                self.assertIn(message, result.stderr)

    def test_malformed_runtime_state_fails_closed(self):
        candidate = "grok/grok-4.6/high"
        result = self.run_router(
            "check",
            "--candidate",
            candidate,
            "--reason",
            "Cheap pick.",
            runtime={"candidates": {candidate: ["not-a-dict"]}},
            expect_code=1,
        )
        self.assertIn("must be an object", result.stderr)
        for runtime in (
            {
                "harnesses": {"grok": "broken"},
                "candidates": {candidate: {"quota": {"status": "known"}}},
            },
            {
                "harnesses": {"grok": {"quota": "broken"}},
                "candidates": {candidate: {"quota": {"status": "known"}}},
            },
            {"harnesses": ["broken"]},
            {"candidates": "broken"},
        ):
            with self.subTest(runtime=runtime):
                result = self.run_router(
                    "check",
                    "--candidate",
                    candidate,
                    "--reason",
                    "Cheap pick.",
                    runtime=runtime,
                    expect_code=1,
                )
                self.assertIn("must be an object", result.stderr)

    def test_quota_axi_adapter_uses_effective_pace_and_marks_kimi_unknown(self):
        catalog = router.read_json(router.CATALOG, "routing catalog")
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
        runtime = router.quota_axi_runtime(snapshot, catalog["candidates"])
        self.assertEqual(0.5, runtime["harnesses"]["codex"]["quota"]["pressure"])
        self.assertEqual(34, runtime["harnesses"]["codex"]["quota"]["effective_percent_remaining"])
        opencode = runtime["harnesses"]["opencode"]["quota"]
        self.assertEqual("unknown", opencode["status"])
        self.assertIn("same account window", opencode["detail"])
        claudex = runtime["candidates"][
            "claude/kimi-k3[1m]/max"
        ]["quota"]
        self.assertEqual("unknown", claudex["status"])
        self.assertIn("cannot read", runtime["notes"][0])

    def test_quota_axi_projects_grok_quota_to_claudex_candidate(self):
        catalog = router.read_json(router.CATALOG, "routing catalog")
        snapshot = {
            "schemaVersion": 3,
            "generatedAt": "2026-08-12T09:30:00Z",
            "providers": [
                {
                    "provider": "grok",
                    "state": {"status": "fresh", "stale": False},
                    "quotaSemantics": {
                        "status": "known",
                        "effectiveAvailability": [
                            {
                                "scope": "all_products",
                                "effectivePercentRemaining": 57,
                                "boundedBy": ["weekly"],
                                "pace": {"worstReservePercentPoints": -20},
                            }
                        ],
                    },
                }
            ],
        }
        runtime = router.quota_axi_runtime(snapshot, catalog["candidates"])
        candidate = runtime["candidates"][
            "claude/grok-4.6-via-claude-code/high"
        ]["quota"]
        self.assertEqual("known", candidate["status"])
        self.assertEqual(57, candidate["effective_percent_remaining"])
        self.assertEqual(candidate, runtime["harnesses"]["grok"]["quota"])

    def test_check_surfaces_kimi_credential_detail_in_warning(self):
        candidate = "opencode/kimi-for-coding/k3/max"
        decision = self.check(
            "--candidate",
            candidate,
            "--reason",
            "Spatial 3D outcome; kimi leads that evidence.",
            "--accept-quota-unknown",
            "Principal accepted: K3 quota is structurally unreadable here.",
            runtime={
                "harnesses": {
                    "opencode": {
                        "quota": {
                            "status": "unknown",
                            "detail": "quota-axi cannot read Kimi Code OAuth quota; "
                            "OpenCode and Claudex K3 spend the same account window",
                        }
                    }
                }
            },
        )
        self.assertEqual("selected", decision["status"])
        self.assertIn(
            "quota unknown: quota-axi cannot read Kimi Code OAuth quota; "
            "OpenCode and Claudex K3 spend the same account window",
            decision["warnings"],
        )


if __name__ == "__main__":
    unittest.main()
