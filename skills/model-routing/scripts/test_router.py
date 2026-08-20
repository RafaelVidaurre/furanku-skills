#!/usr/bin/env python3
"""Tests for the model-routing brief and launch gate-check."""

import json
import os
from copy import deepcopy
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import router


SCRIPT = Path(__file__).with_name("router.py")
ROUTE_BASIS = "Principal requested the Worker route for this task."


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

    def test_brief_shows_exact_route_activation_and_candidate_evidence(self):
        brief = self.run_router("brief").stdout
        self.assertIn(router.EXACT_ROUTE_SEMANTICS, brief)
        self.assertIn(
            "| captain | — | codex | gpt-5.6-sol | xhigh | global | ask |",
            brief,
        )
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
        self.assertEqual(router.EXACT_ROUTE_SEMANTICS, payload["routes"]["semantics"])
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

    def test_check_exact_route_requires_and_records_route_basis(self):
        result = self.run_router(
            "check",
            "--exact-route",
            "worker",
            expect_code=1,
        )
        self.assertIn("requires --route-basis", result.stderr)
        decision = self.check(
            "--exact-route",
            "worker",
            "--route-basis",
            ROUTE_BASIS,
            runtime={"harnesses": {"grok": {"quota": {"status": "known"}}}},
        )
        self.assertEqual(ROUTE_BASIS, decision["route_basis"])

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
        self.assertIn("quota exhausted (account unattributed)", decision["reasons"])

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
            "Principal accepted stale quota for a low-risk edit.",
            runtime=runtime,
        )
        self.assertEqual("selected", decision["status"])
        self.assertIn("quota stale (account unattributed)", decision["warnings"])
        self.assertEqual(
            "Principal accepted stale quota for a low-risk edit.",
            decision["quota_acceptance"],
        )

    def test_external_quota_provider_does_not_inherit_launcher_quota(self):
        candidate = "claude/openrouter/auto-beta/high"
        self.write_repo_layer(
            {
                "version": 4,
                "routes": {},
                "candidates": {
                    candidate: {
                        "launch": {
                            "agent": "claude",
                            "model": "openrouter/auto-beta",
                            "effort": "high",
                        },
                        "quota_provider": {
                            "provider": "openrouter",
                            "detail": "quota-axi does not support OpenRouter",
                        },
                    }
                },
            }
        )
        runtime = {
            "harnesses": {
                "claude": {
                    "quota": {
                        "status": "exhausted",
                        "account": {"provider": "claude"},
                    }
                }
            }
        }

        decision = self.check(
            "--candidate",
            candidate,
            "--reason",
            "Task-aware routing is useful for this mixed workload.",
            runtime=runtime,
            expect_code=2,
        )
        self.assertEqual("needs-acceptance", decision["status"])
        self.assertEqual("unknown", decision["quota"]["status"])
        self.assertEqual(
            "openrouter", decision["quota"]["account"]["provider"]
        )
        self.assertIn("quota-axi does not support OpenRouter", decision["pending"][0])

        accepted = self.check(
            "--candidate",
            candidate,
            "--reason",
            "Task-aware routing is useful for this mixed workload.",
            "--accept-quota-unknown",
            "Principal accepted OpenRouter quota being unavailable.",
            runtime=runtime,
        )
        self.assertEqual("selected", accepted["status"])
        self.assertEqual(
            "Principal accepted OpenRouter quota being unavailable.",
            accepted["quota_acceptance"],
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
            "--route-basis",
            ROUTE_BASIS,
            runtime={"harnesses": {"grok": {"quota": {"status": "known"}}}},
        )
        self.assertEqual("exact", decision["status"])
        self.assertEqual("grok", decision["selected"]["agent"])
        self.assertEqual("grok/grok-4.6/high", decision["selected"]["id"])
        self.assertEqual(ROUTE_BASIS, decision["route_basis"])
        self.assertEqual("global", decision["provenance"]["winner"]["scope"])

    def test_check_exact_route_refuses_exhausted_quota(self):
        decision = self.check(
            "--exact-route",
            "worker",
            "--route-basis",
            ROUTE_BASIS,
            runtime={
                "harnesses": {"grok": {"quota": {"status": "exhausted"}}}
            },
            expect_code=1,
        )
        self.assertEqual("refused", decision["status"])
        self.assertIn("quota exhausted (account unattributed)", decision["reasons"])

    def test_check_exact_route_refuses_disabled_candidate_with_provenance(self):
        self.write_repo_layer(
            {
                "version": 4,
                "routes": {},
                "candidates": {"grok/grok-4.6/high": {"enabled": False}},
            }
        )
        decision = self.check(
            "--exact-route",
            "worker",
            "--route-basis",
            ROUTE_BASIS,
            expect_code=1,
        )
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
        brief = self.run_router("brief").stdout
        self.assertIn("| worker.bulk | Bulk edits. |", brief)
        decision = self.check(
            "--exact-route",
            "worker.bulk",
            "--route-basis",
            "Principal requested the worker.bulk route for this task.",
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
            "--route-basis",
            "Principal requested the worker.bulk route for this task.",
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
            "--route-basis",
            ROUTE_BASIS,
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
        self.assertIn("quota exhausted (account unattributed)", decision["reasons"])

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
        self.assertIn("| captain | — | codex | gpt-5.6-sol | xhigh | global | ask |", brief)
        self.assertIn("| worker | — | codex | gpt-5.6-luna | max | builtin | ask |", brief)

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
        self.assertIn("cannot read Kimi Code OAuth quota", opencode["detail"])
        proxy = runtime["candidates"][
            "claude/kimi-k3[1m]/max"
        ]["quota"]
        self.assertEqual("unknown", proxy["status"])
        self.assertIn("cannot read", runtime["notes"][0])

    def codex_snapshot(self, remaining, account=None):
        provider = {
            "provider": "codex",
            "state": {"status": "fresh", "stale": False},
            "quotaSemantics": {
                "status": "known",
                "effectiveAvailability": [
                    {
                        "scope": "all_models",
                        "effectivePercentRemaining": remaining,
                        "boundedBy": ["weekly"],
                        "pace": {"worstReservePercentPoints": 0},
                    }
                ],
            },
        }
        if account is not None:
            provider["account"] = account
        return {
            "schemaVersion": 3,
            "generatedAt": "2026-08-16T12:31:05Z",
            "providers": [provider],
        }

    def codex_candidate(self):
        catalog = router.read_json(router.CATALOG, "routing catalog")
        for candidate_id, candidate in catalog["candidates"].items():
            if candidate["launch"]["agent"] == "codex":
                return candidate_id, candidate
        self.fail("routing catalog has no codex candidate")

    def pooled_codex_proxy_candidate(self, catalog):
        candidate_id = "claude/gpt-5.6-sol-via-claude-code/xhigh"
        candidate = deepcopy(catalog["candidates"][candidate_id])
        candidate.pop("quota_provider", None)
        candidate["quota_pool"] = {
            "provider": "codex",
            "detail": (
                "Rotating proxy credentials are chosen per request; no "
                "single-account reading describes this candidate."
            ),
        }
        catalog["candidates"][candidate_id] = candidate
        return candidate_id, candidate

    def test_quota_axi_carries_the_measured_account_identity(self):
        catalog = router.read_json(router.CATALOG, "routing catalog")
        snapshot = self.codex_snapshot(
            0,
            {"email": "launch-account@example.com", "accountId": "account-1234"},
        )
        runtime = router.quota_axi_runtime(snapshot, catalog["candidates"])
        quota = runtime["harnesses"]["codex"]["quota"]
        self.assertEqual("exhausted", quota["status"])
        self.assertEqual(
            {
                "email": "launch-account@example.com",
                "account_id": "account-1234",
                "provider": "codex",
            },
            quota["account"],
        )

    def test_gate_names_the_account_an_exhausted_verdict_measured(self):
        catalog = router.read_json(router.CATALOG, "routing catalog")
        candidate_id, candidate = self.codex_candidate()
        runtime = router.quota_axi_runtime(
            self.codex_snapshot(0, {"email": "launch-account@example.com"}),
            catalog["candidates"],
        )
        reasons, _warnings = router.gate(candidate_id, candidate, runtime)
        self.assertEqual(
            ["quota exhausted (account launch-account@example.com)"], reasons
        )

    def test_gate_flags_an_exhausted_verdict_it_cannot_attribute(self):
        catalog = router.read_json(router.CATALOG, "routing catalog")
        candidate_id, candidate = self.codex_candidate()
        runtime = router.quota_axi_runtime(
            self.codex_snapshot(0), catalog["candidates"]
        )
        reasons, _warnings = router.gate(candidate_id, candidate, runtime)
        self.assertEqual(["quota exhausted (account unattributed)"], reasons)

    def test_gate_refuses_headroom_measured_on_the_wrong_account(self):
        """The trap: unsetting CODEX_HOME measures an account with quota while
        the launch still bills the configured one."""
        catalog = router.read_json(router.CATALOG, "routing catalog")
        candidate_id, candidate = self.codex_candidate()
        runtime = router.quota_axi_runtime(
            self.codex_snapshot(85, {"email": "measured-account@example.com"}),
            catalog["candidates"],
        )
        reasons, _warnings = router.gate(
            candidate_id,
            candidate,
            runtime,
            expected_accounts={"codex": "launch-account@example.com"},
        )
        self.assertEqual(1, len(reasons))
        self.assertIn("measured for account measured-account@example.com", reasons[0])
        self.assertIn("launch-account@example.com", reasons[0])

    def test_gate_accepts_quota_measured_on_the_configured_account(self):
        catalog = router.read_json(router.CATALOG, "routing catalog")
        candidate_id, candidate = self.codex_candidate()
        runtime = router.quota_axi_runtime(
            self.codex_snapshot(85, {"email": "launch-account@example.com"}),
            catalog["candidates"],
        )
        reasons, warnings = router.gate(
            candidate_id,
            candidate,
            runtime,
            expected_accounts={"codex": "launch-account@example.com"},
        )
        self.assertEqual([], reasons)
        self.assertEqual([], warnings)

    def test_gate_warns_when_an_expected_account_cannot_be_verified(self):
        catalog = router.read_json(router.CATALOG, "routing catalog")
        candidate_id, candidate = self.codex_candidate()
        runtime = router.quota_axi_runtime(
            self.codex_snapshot(85), catalog["candidates"]
        )
        _reasons, warnings = router.gate(
            candidate_id,
            candidate,
            runtime,
            expected_accounts={"codex": "launch-account@example.com"},
        )
        self.assertTrue(
            any("could not name the account" in warning for warning in warnings),
            warnings,
        )

    def test_projected_quota_is_checked_against_its_own_provider(self):
        """A proxy-routed candidate launches through `claude` but bills the
        upstream provider, so its account must be checked against that
        provider's configured account, not the launch harness's."""
        catalog = router.read_json(router.CATALOG, "routing catalog")
        snapshot = {
            "schemaVersion": 3,
            "generatedAt": "2026-08-16T12:31:05Z",
            "providers": [
                {
                    "provider": "grok",
                    "account": {"email": "measured-account@example.com"},
                    "state": {"status": "fresh", "stale": False},
                    "quotaSemantics": {
                        "status": "known",
                        "effectiveAvailability": [
                            {
                                "scope": "all_models",
                                "effectivePercentRemaining": 70,
                                "boundedBy": ["weekly"],
                                "pace": {"worstReservePercentPoints": 0},
                            }
                        ],
                    },
                }
            ],
        }
        runtime = router.quota_axi_runtime(snapshot, catalog["candidates"])
        candidate_id = "claude/grok-4.6-via-claude-code/high"
        candidate = catalog["candidates"][candidate_id]
        quota = runtime["candidates"][candidate_id]["quota"]
        self.assertEqual("grok", quota["account"]["provider"])
        # A claude-account expectation must not be applied to a grok reading.
        reasons, _warnings = router.gate(
            candidate_id,
            candidate,
            runtime,
            expected_accounts={"claude": "someone-else@example.com"},
        )
        self.assertEqual([], reasons)
        # The grok expectation is the one that governs it.
        reasons, _warnings = router.gate(
            candidate_id,
            candidate,
            runtime,
            expected_accounts={"grok": "someone-else@example.com"},
        )
        self.assertEqual(1, len(reasons))
        self.assertIn("measured-account@example.com", reasons[0])

    def test_pooled_candidate_does_not_inherit_its_harness_quota(self):
        """A proxy bills its credential pool, not the launcher account it
        launches through, so an exhausted harness must not refuse it."""
        catalog = router.read_json(router.CATALOG, "routing catalog")
        candidate_id, candidate = self.pooled_codex_proxy_candidate(catalog)
        runtime = {"harnesses": {"claude": {"quota": {"status": "exhausted"}}}}
        reasons, warnings = router.gate(candidate_id, candidate, runtime)
        self.assertEqual([], reasons)
        self.assertTrue(
            any("quota pooled (pooled codex accounts)" in warning for warning in warnings),
            warnings,
        )
        self.assertTrue(
            any("chosen per request" in warning for warning in warnings), warnings
        )

    def test_pooled_candidate_still_gated_by_harness_availability(self):
        """The proxy supplies the account, but the harness still has to run."""
        catalog = router.read_json(router.CATALOG, "routing catalog")
        candidate_id, candidate = self.pooled_codex_proxy_candidate(catalog)
        runtime = {"harnesses": {"claude": {"status": "auth-required"}}}
        reasons, _warnings = router.gate(candidate_id, candidate, runtime)
        self.assertIn("runtime status auth-required", reasons)

    def test_pooled_candidate_ignores_a_single_account_exhaustion(self):
        """The incident: Sol exhausted on the measured Codex account must not
        take the pooled Sol route down with it."""
        catalog = router.read_json(router.CATALOG, "routing catalog")
        pooled, _candidate = self.pooled_codex_proxy_candidate(catalog)
        runtime = router.quota_axi_runtime(
            self.codex_snapshot(0, {"email": "launch-account@example.com"}),
            catalog["candidates"],
        )
        native = "codex/gpt-5.6-sol/xhigh"
        reasons, _warnings = router.gate(
            native, catalog["candidates"][native], runtime
        )
        self.assertEqual(
            ["quota exhausted (account launch-account@example.com)"], reasons
        )
        reasons, _warnings = router.gate(
            pooled, catalog["candidates"][pooled], runtime
        )
        self.assertEqual([], reasons)

    def test_pooled_candidate_passes_without_per_launch_acceptance(self):
        """Pooled quota is settled, not degraded: gating every launch behind a
        sign-off would trade a false refusal for constant friction."""
        catalog = router.read_json(router.CATALOG, "routing catalog")
        candidate_id, candidate = self.pooled_codex_proxy_candidate(catalog)
        state = router.runtime_for(
            {"harnesses": {"claude": {}}}, candidate_id, candidate
        )
        pending, acceptance = router.acceptance_terms(
            router.quota_summary(state), None
        )
        self.assertIsNone(pending)
        self.assertIsNone(acceptance)

    def test_pooled_quota_is_not_flagged_as_unattributed(self):
        """A pooled reading names no account by design; saying it "could not"
        name one misreports a deliberate property as a failure."""
        catalog = router.read_json(router.CATALOG, "routing catalog")
        candidate_id, candidate = self.pooled_codex_proxy_candidate(catalog)
        _reasons, warnings = router.gate(
            candidate_id,
            candidate,
            {"harnesses": {"claude": {}}},
            expected_accounts={"codex": "launch-account@example.com"},
        )
        self.assertFalse(
            any("could not name the account" in warning for warning in warnings),
            warnings,
        )

    def test_quota_pool_requires_a_billed_provider(self):
        with self.assertRaises(router.Error) as caught:
            router.validate_compiled_candidates(
                {
                    "claude/x/high": {
                        "launch": {
                            "agent": "claude",
                            "model": "x",
                            "effort": "high",
                        },
                        "quota_pool": {"detail": "no provider"},
                    }
                }
            )
        self.assertIn("quota_pool requires the billed provider", str(caught.exception))

    def test_quota_summary_reports_the_measured_account(self):
        summary = router.quota_summary(
            {
                "quota": {
                    "status": "exhausted",
                    "account": {"email": "launch-account@example.com"},
                }
            }
        )
        self.assertEqual(
            {"email": "launch-account@example.com"}, summary["account"]
        )

    def test_run_quota_axi_requests_account_attribution(self):
        captured = {}

        def fake_run(command, **kwargs):
            captured["command"] = command
            return SimpleNamespace(
                returncode=0,
                stdout=json.dumps({"schemaVersion": 3, "providers": []}),
                stderr="",
            )

        with mock.patch.object(router.subprocess, "run", fake_run):
            router.run_quota_axi()
        self.assertIn("--full", captured["command"])

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
                            "detail": "quota-axi cannot read Kimi Code OAuth quota",
                        }
                    }
                }
            },
        )
        self.assertEqual("selected", decision["status"])
        self.assertIn(
            "quota unknown (account unattributed): quota-axi cannot read Kimi "
            "Code OAuth quota",
            decision["warnings"],
        )

    def test_quota_axi_stale_carries_recovery_fields(self):
        catalog = router.read_json(router.CATALOG, "routing catalog")
        snapshot = {
            "schemaVersion": 3,
            "generatedAt": "2026-08-13T12:38:00Z",
            "providers": [
                {
                    "provider": "grok",
                    "state": {
                        "status": "stale",
                        "stale": True,
                        "error": "Grok access token expired",
                        "reason": "credentials_expired",
                        "remedyCommand": "grok",
                        "authStatus": "expired_refreshable",
                        "refreshedAt": "2026-08-13T09:12:47.507Z",
                    },
                    "quotaSemantics": {
                        "status": "unknown",
                        "description": "The raw quota windows are stale.",
                    },
                }
            ],
        }
        runtime = router.quota_axi_runtime(snapshot, catalog["candidates"])
        quota = runtime["harnesses"]["grok"]["quota"]
        self.assertEqual("stale", quota["status"])
        self.assertEqual("Grok access token expired", quota["detail"])
        self.assertEqual("credentials_expired", quota["cause"])
        self.assertEqual("grok", quota["remedy"])
        self.assertEqual("expired_refreshable", quota["auth_status"])
        self.assertEqual("2026-08-13T09:12:47.507Z", quota["refreshed_at"])

    def test_check_stale_quota_pending_names_remedy(self):
        candidate = "grok/grok-4.6/high"
        decision = self.check(
            "--candidate",
            candidate,
            "--reason",
            "Low-risk mechanical change.",
            runtime={
                "candidates": {
                    candidate: {
                        "quota": {
                            "status": "stale",
                            "detail": "Grok access token expired",
                            "remedy": "grok",
                            "refreshed_at": "2026-08-13T09:12:47.507Z",
                        }
                    }
                }
            },
            expect_code=2,
        )
        pending = decision["pending"][0]
        self.assertIn("Grok access token expired (last fresh 09:12)", pending)
        self.assertIn("Refresh with `grok`", pending)
        self.assertIn("--accept-quota-unknown", pending)
        self.assertEqual("Grok access token expired", decision["quota"]["detail"])
        self.assertEqual("grok", decision["quota"]["remedy"])

    def test_exact_route_needs_acceptance_exposes_configured_fallback(self):
        self.write_repo_layer(
            {
                "version": 4,
                "routes": {
                    "worker": {
                        "agent": "grok",
                        "model": "grok-4.6",
                        "effort": "high",
                        "on_quota_unusable": {
                            "ask_seconds": 90,
                            "fallback": {
                                "agent": "codex",
                                "model": "gpt-5.6-sol",
                                "effort": "high",
                            },
                        },
                    }
                },
            }
        )
        brief = self.run_router("brief").stdout
        self.assertIn(
            "| worker | — | grok | grok-4.6 | high | repo | "
            "ask 90s → codex/gpt-5.6-sol/high |",
            brief,
        )
        decision = self.check(
            "--exact-route",
            "worker",
            "--route-basis",
            ROUTE_BASIS,
            runtime={"harnesses": {"grok": {"quota": {"status": "stale"}}}},
            expect_code=2,
        )
        self.assertEqual("needs-acceptance", decision["status"])
        self.assertEqual("grok", decision["selected"]["agent"])
        self.assertEqual(90, decision["quota_fallback"]["ask_seconds"])
        self.assertEqual(
            {
                "agent": "codex",
                "model": "gpt-5.6-sol",
                "effort": "high",
            },
            decision["quota_fallback"]["launch"],
        )
        self.assertIn("--use-quota-fallback", decision["quota_fallback"]["next"])

    def test_use_quota_fallback_after_wait_selects_fallback(self):
        self.write_repo_layer(
            {
                "version": 4,
                "routes": {
                    "worker": {
                        "agent": "grok",
                        "model": "grok-4.6",
                        "effort": "high",
                        "on_quota_unusable": {
                            "fallback": {
                                "agent": "codex",
                                "model": "gpt-5.6-sol",
                                "effort": "high",
                            }
                        },
                    }
                },
            }
        )
        decision = self.check(
            "--exact-route",
            "worker",
            "--route-basis",
            ROUTE_BASIS,
            "--use-quota-fallback",
            "principal did not respond within 120s",
            runtime={
                "harnesses": {
                    "grok": {"quota": {"status": "stale"}},
                    "codex": {
                        "quota": {
                            "status": "known",
                            "effective_percent_remaining": 99,
                        }
                    },
                }
            },
        )
        self.assertEqual("exact", decision["status"])
        self.assertEqual("codex", decision["selected"]["agent"])
        self.assertEqual("gpt-5.6-sol", decision["selected"]["model"])
        self.assertEqual("high", decision["selected"]["effort"])
        self.assertTrue(decision["quota_fallback"]["used"])
        self.assertEqual(
            "principal did not respond within 120s",
            decision["quota_fallback"]["basis"],
        )
        self.assertIn("used quota fallback after wait", decision["warnings"][-1])

    def test_use_quota_fallback_keeps_primary_when_quota_is_now_known(self):
        self.write_repo_layer(
            {
                "version": 4,
                "routes": {
                    "worker": {
                        "agent": "grok",
                        "model": "grok-4.6",
                        "effort": "high",
                        "on_quota_unusable": {
                            "fallback": {
                                "agent": "codex",
                                "model": "gpt-5.6-sol",
                                "effort": "high",
                            }
                        },
                    }
                },
            }
        )
        decision = self.check(
            "--exact-route",
            "worker",
            "--route-basis",
            ROUTE_BASIS,
            "--use-quota-fallback",
            "waited 120s",
            runtime={"harnesses": {"grok": {"quota": {"status": "known"}}}},
        )
        self.assertEqual("exact", decision["status"])
        self.assertEqual("grok", decision["selected"]["agent"])
        self.assertNotIn("quota_fallback", decision)

    def test_use_quota_fallback_does_not_bypass_exhausted_primary(self):
        self.write_repo_layer(
            {
                "version": 4,
                "routes": {
                    "worker": {
                        "agent": "grok",
                        "model": "grok-4.6",
                        "effort": "high",
                        "on_quota_unusable": {
                            "fallback": {
                                "agent": "codex",
                                "model": "gpt-5.6-sol",
                                "effort": "high",
                            }
                        },
                    }
                },
            }
        )
        decision = self.check(
            "--exact-route",
            "worker",
            "--route-basis",
            ROUTE_BASIS,
            "--use-quota-fallback",
            "waited 120s",
            runtime={
                "harnesses": {
                    "grok": {"quota": {"status": "exhausted"}},
                    "codex": {"quota": {"status": "known"}},
                }
            },
            expect_code=1,
        )
        self.assertEqual("refused", decision["status"])
        self.assertIn("quota exhausted (account unattributed)", decision["reasons"])
        self.assertEqual("grok/grok-4.6/high", decision["candidate"])

    def test_use_quota_fallback_stays_pending_when_fallback_also_stale(self):
        self.write_repo_layer(
            {
                "version": 4,
                "routes": {
                    "worker": {
                        "agent": "grok",
                        "model": "grok-4.6",
                        "effort": "high",
                        "on_quota_unusable": {
                            "fallback": {
                                "agent": "codex",
                                "model": "gpt-5.6-sol",
                                "effort": "high",
                            }
                        },
                    }
                },
            }
        )
        decision = self.check(
            "--exact-route",
            "worker",
            "--route-basis",
            ROUTE_BASIS,
            "--use-quota-fallback",
            "waited 120s",
            runtime={
                "harnesses": {
                    "grok": {"quota": {"status": "stale"}},
                    "codex": {"quota": {"status": "stale"}},
                }
            },
            expect_code=2,
        )
        self.assertEqual("needs-acceptance", decision["status"])
        self.assertEqual("grok", decision["selected"]["agent"])
        self.assertIn(
            "configured fallback also has unknown or stale quota",
            decision["pending"],
        )

    def test_use_quota_fallback_requires_exact_route_and_basis(self):
        result = self.run_router(
            "check",
            "--candidate",
            "grok/grok-4.6/high",
            "--reason",
            "Cheap pick.",
            "--use-quota-fallback",
            "waited",
            expect_code=1,
        )
        self.assertIn("requires --exact-route", result.stderr)
        result = self.run_router(
            "check",
            "--exact-route",
            "worker",
            "--route-basis",
            ROUTE_BASIS,
            "--use-quota-fallback",
            "   ",
            expect_code=1,
        )
        self.assertIn("requires the wait basis", result.stderr)
        result = self.run_router(
            "check",
            "--exact-route",
            "worker",
            "--route-basis",
            ROUTE_BASIS,
            "--use-quota-fallback",
            "waited 120s",
            runtime={"harnesses": {"grok": {"quota": {"status": "stale"}}}},
            expect_code=1,
        )
        self.assertIn("has no on_quota_unusable fallback", result.stderr)

    def test_load_quota_axi_retries_stale_provider_once(self):
        catalog = router.read_json(router.CATALOG, "routing catalog")
        calls = []

        def fake_run(providers=None):
            calls.append(tuple(providers) if providers else None)
            if providers == ["grok"]:
                return {
                    "schemaVersion": 3,
                    "generatedAt": "2026-08-13T12:47:18Z",
                    "providers": [
                        {
                            "provider": "grok",
                            "state": {"status": "fresh", "stale": False},
                            "quotaSemantics": {
                                "status": "known",
                                "effectiveAvailability": [
                                    {
                                        "scope": "all_products",
                                        "effectivePercentRemaining": 41,
                                        "boundedBy": ["credits"],
                                        "pace": {"worstReservePercentPoints": 0},
                                    }
                                ],
                            },
                        }
                    ],
                }
            return {
                "schemaVersion": 3,
                "generatedAt": "2026-08-13T12:31:48Z",
                "providers": [
                    {
                        "provider": "grok",
                        "state": {
                            "status": "stale",
                            "stale": True,
                            "error": "Grok access token expired",
                            "remedyCommand": "grok",
                        },
                        "quotaSemantics": {"status": "unknown"},
                    },
                    {
                        "provider": "codex",
                        "state": {"status": "fresh", "stale": False},
                        "quotaSemantics": {
                            "status": "known",
                            "effectiveAvailability": [
                                {
                                    "scope": "all_models",
                                    "effectivePercentRemaining": 99,
                                    "boundedBy": ["weekly"],
                                    "pace": {"worstReservePercentPoints": 10},
                                }
                            ],
                        },
                    },
                ],
            }

        original = router.run_quota_axi
        router.run_quota_axi = fake_run
        try:
            runtime = router.load_quota_axi(catalog["candidates"])
        finally:
            router.run_quota_axi = original
        self.assertEqual([None, ("grok",)], calls)
        self.assertEqual("known", runtime["harnesses"]["grok"]["quota"]["status"])
        self.assertEqual(41, runtime["harnesses"]["grok"]["quota"]["effective_percent_remaining"])
        self.assertEqual("known", runtime["harnesses"]["codex"]["quota"]["status"])
        self.assertIn("retried stale provider(s): grok", runtime["notes"][-1])


if __name__ == "__main__":
    unittest.main()
