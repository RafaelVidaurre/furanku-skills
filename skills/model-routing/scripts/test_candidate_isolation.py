#!/usr/bin/env python3
"""CLI isolation for malformed compiled routing candidates.

A broken overlay entry must not abort unrelated checks. Selecting that
entry, or an exact route whose only launch match is that entry, fails
closed. Layer JSON, schema, and route-row errors stay document-hard.
"""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("router.py")
CONFIG = Path(__file__).with_name("config.py")
VALID_CANDIDATE = "grok/grok-4.6/high"
MALFORMED_ID = "synthetic/malformed/high"
ROUTE_BASIS = "Principal requested the Worker route for this task."


class CandidateIsolationTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.home = self.base / "home"
        self.home.mkdir()
        self.codex_home = self.base / "codex"
        self.codex_home.mkdir()
        self.repo = self.base / "repo"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        self.env = os.environ.copy()
        self.env["HOME"] = str(self.home)
        self.env["CODEX_HOME"] = str(self.codex_home)
        self.env["PYTHONDONTWRITEBYTECODE"] = "1"
        self.write_global(
            {
                "version": 4,
                "routes": {
                    "captain": {
                        "agent": "codex",
                        "model": "gpt-6-astra",
                        "effort": "high",
                    },
                    "worker": {
                        "agent": "grok",
                        "model": "grok-4.6",
                        "effort": "high",
                    },
                },
            }
        )

    def tearDown(self):
        self.temporary.cleanup()

    def write_global(self, config):
        path = self.home / ".furanku-skills" / "model-routing" / "config.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(config), encoding="utf-8")

    def write_repo_layer(self, config):
        path = self.repo / ".furanku-skills" / "model-routing" / "config.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(config), encoding="utf-8")

    def run_script(self, script, *args, expect_code=0):
        result = subprocess.run(
            [sys.executable, str(script), *args, "--repo", str(self.repo)],
            capture_output=True,
            text=True,
            env=self.env,
            check=False,
        )
        if result.returncode != expect_code:
            self.fail(
                f"{result.args}\nstdout: {result.stdout}\nstderr: {result.stderr}"
            )
        return result

    def run_router(self, *args, runtime=None, expect_code=0):
        command = [*args]
        if runtime is not None:
            runtime_path = self.base / "runtime.json"
            runtime_path.write_text(json.dumps(runtime), encoding="utf-8")
            command += ["--runtime-file", str(runtime_path)]
        return self.run_script(SCRIPT, *command, expect_code=expect_code)

    def check(self, *args, runtime=None, expect_code=0):
        result = self.run_router(
            "check", *args, runtime=runtime, expect_code=expect_code
        )
        if expect_code == 0:
            return json.loads(result.stdout)
        return result

    def add_unrelated_malformed_candidate(self):
        self.write_repo_layer(
            {
                "version": 4,
                "routes": {},
                "candidates": {
                    MALFORMED_ID: {
                        "launch": {
                            "agent": "synthetic",
                            "model": "malformed",
                            "effort": "high",
                            "extra": "nope",
                        }
                    }
                },
            }
        )

    def grok_runtime(self):
        return {"harnesses": {"grok": {"quota": {"status": "known"}}}}

    def test_valid_candidate_check_survives_unrelated_malformed_entry(self):
        self.add_unrelated_malformed_candidate()
        decision = self.check(
            "--candidate",
            VALID_CANDIDATE,
            "--reason",
            "Valid pick beside an unrelated malformed overlay.",
            runtime=self.grok_runtime(),
        )
        self.assertEqual("selected", decision["status"])
        self.assertEqual(VALID_CANDIDATE, decision["selected"]["id"])

    def test_brief_and_report_name_excluded_malformed_candidate(self):
        self.add_unrelated_malformed_candidate()
        brief = self.run_router("brief").stdout
        self.assertIn("Excluded malformed candidates:", brief)
        self.assertIn(MALFORMED_ID, brief)
        self.assertIn("launch requires only agent, model, and effort", brief)
        self.assertIn(f"| {VALID_CANDIDATE} |", brief)
        payload = json.loads(self.run_router("brief", "--format", "json").stdout)
        self.assertNotIn(MALFORMED_ID, payload["candidates"])
        self.assertIn(MALFORMED_ID, payload["malformed_candidates"])
        self.assertIn(
            "launch requires only agent, model, and effort",
            payload["malformed_candidates"][MALFORMED_ID]["error"],
        )
        report = self.run_script(CONFIG, "report").stdout
        self.assertIn("## Excluded malformed candidates", report)
        self.assertIn(MALFORMED_ID, report)
        report_json = json.loads(
            self.run_script(CONFIG, "report", "--format", "json").stdout
        )
        self.assertIn(MALFORMED_ID, report_json["malformed_candidates"])

    def test_malformed_field_types_are_isolated_before_launch(self):
        for patch in [
            {"capabilities": {"reasoning": {"status": []}}},
            {"quota_pool": {"provider": {"unexpected": "object"}}},
        ]:
            with self.subTest(patch=patch):
                self.write_repo_layer({
                    "version": 4, "routes": {}, "candidates": {
                        MALFORMED_ID: {
                            "launch": {"agent": "synthetic", "model": "malformed", "effort": "high"},
                            **patch,
                        },
                    },
                })
                decision = self.check(
                    "--candidate", VALID_CANDIDATE, "--reason", "Valid unrelated selection.",
                    runtime=self.grok_runtime(),
                )
                self.assertEqual("selected", decision["status"])
                result = self.check(
                    "--candidate", MALFORMED_ID, "--reason", "Reject malformed field types.",
                    expect_code=1,
                )
                self.assertIn(MALFORMED_ID, result.stderr)
                self.assertNotIn("Traceback", result.stderr)
                self.assertFalse(result.stdout.strip())

    def test_explicitly_chosen_malformed_candidate_fails_closed(self):
        self.add_unrelated_malformed_candidate()
        result = self.check(
            "--candidate",
            MALFORMED_ID,
            "--reason",
            "Choosing the malformed overlay.",
            expect_code=1,
        )
        self.assertIn(MALFORMED_ID, result.stderr)
        self.assertIn("launch requires only agent, model, and effort", result.stderr)
        self.assertFalse(result.stdout.strip())

    def test_exact_route_to_malformed_target_fails_closed(self):
        self.write_repo_layer(
            {
                "version": 4,
                "routes": {},
                "candidates": {
                    VALID_CANDIDATE: {
                        "launch": {
                            "agent": "grok",
                            "model": "grok-4.6",
                            "effort": "high",
                            "extra": "nope",
                        }
                    }
                },
            }
        )
        result = self.run_router(
            "check",
            "--exact-route",
            "worker",
            "--route-basis",
            ROUTE_BASIS,
            expect_code=1,
        )
        self.assertIn("route 'worker' target candidate", result.stderr)
        self.assertIn(VALID_CANDIDATE, result.stderr)
        self.assertIn("launch requires only agent, model, and effort", result.stderr)
        self.assertFalse(result.stdout.strip())
        decision = self.check(
            "--candidate",
            "codex/gpt-6-astra/high",
            "--reason",
            "Unrelated valid candidate stays checkable.",
            runtime={"harnesses": {"codex": {"quota": {"status": "known"}}}},
        )
        self.assertEqual("selected", decision["status"])

    def test_exact_route_rejects_candidate_with_erased_launch_identity(self):
        for patch in [
            {"launch": {key: None}} for key in ("agent", "model", "effort")
        ] + [{"launch": None}, {"launch": "invalid"}]:
            with self.subTest(patch=patch):
                self.write_repo_layer({
                    "version": 4, "routes": {},
                    "candidates": {VALID_CANDIDATE: patch},
                })
                result = self.check(
                    "--exact-route", "worker", "--route-basis", ROUTE_BASIS,
                    runtime=self.grok_runtime(), expect_code=1,
                )
                self.assertIn(VALID_CANDIDATE, result.stderr)
                self.assertIn("malformed", result.stderr)
                self.assertFalse(result.stdout.strip())

    def test_quota_fallback_rejects_erased_candidate_launch(self):
        fallback_id = "codex/gpt-6-astra/high"
        self.write_repo_layer({
            "version": 4, "routes": {"worker": {
                "agent": "grok", "model": "grok-4.6", "effort": "high",
                "on_quota_unusable": {"fallback": {
                    "agent": "codex", "model": "gpt-6-astra", "effort": "high",
                }},
            }},
            "candidates": {fallback_id: {"launch": {"effort": None}}},
        })
        result = self.check(
            "--exact-route", "worker", "--route-basis", ROUTE_BASIS,
            "--use-quota-fallback", "Principal did not respond within 120s.",
            runtime={"harnesses": {
                "grok": {"quota": {"status": "stale"}},
                "codex": {"quota": {"status": "known"}},
            }}, expect_code=1,
        )
        self.assertIn(fallback_id, result.stderr)
        self.assertIn("malformed", result.stderr)
        self.assertFalse(result.stdout.strip())

    def test_valid_same_launch_candidate_still_serves_exact_route(self):
        self.write_repo_layer({
            "version": 4, "routes": {}, "candidates": {
                VALID_CANDIDATE: {"launch": {"effort": None}},
                "synthetic/valid-alias": {
                    "launch": {"agent": "grok", "model": "grok-4.6", "effort": "high"},
                },
            },
        })
        decision = self.check(
            "--exact-route", "worker", "--route-basis", ROUTE_BASIS,
            runtime=self.grok_runtime(),
        )
        self.assertEqual("synthetic/valid-alias", decision["selected"]["id"])

    def test_new_layer_candidate_retains_identity_when_narrower_layer_erases_it(self):
        global_path = self.home / ".furanku-skills" / "model-routing" / "config.json"
        config = json.loads(global_path.read_text())
        launch = {"agent": "grok", "model": "synthetic-model", "effort": "high"}
        config["routes"]["worker"] = launch
        config["candidates"] = {MALFORMED_ID: {"launch": launch}}
        self.write_global(config)
        self.write_repo_layer({
            "version": 4, "routes": {},
            "candidates": {MALFORMED_ID: {"launch": None}},
        })
        result = self.check(
            "--exact-route", "worker", "--route-basis", ROUTE_BASIS,
            runtime=self.grok_runtime(), expect_code=1,
        )
        self.assertIn(MALFORMED_ID, result.stderr)
        self.assertIn("malformed", result.stderr)

    def test_candidate_tombstone_clears_diagnostic_launch_identity(self):
        self.write_repo_layer({
            "version": 4, "routes": {}, "candidates": {VALID_CANDIDATE: None},
        })
        decision = self.check(
            "--exact-route", "worker", "--route-basis", ROUTE_BASIS,
            runtime=self.grok_runtime(),
        )
        self.assertIsNone(decision["selected"]["id"])

    def test_malformed_overlay_does_not_restore_builtin_candidate(self):
        self.write_repo_layer(
            {
                "version": 4,
                "routes": {},
                "candidates": {VALID_CANDIDATE: {"economics": "free"}},
            }
        )
        payload = json.loads(self.run_router("brief", "--format", "json").stdout)
        self.assertNotIn(VALID_CANDIDATE, payload["candidates"])
        self.assertIn(VALID_CANDIDATE, payload["malformed_candidates"])
        result = self.check(
            "--candidate",
            VALID_CANDIDATE,
            "--reason",
            "Broken overlay must not fall back to builtin.",
            expect_code=1,
        )
        self.assertIn("economics must be an object", result.stderr)

    def test_malformed_json_remains_a_hard_document_error(self):
        path = self.repo / ".furanku-skills" / "model-routing" / "config.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{not json", encoding="utf-8")
        result = self.run_router("brief", expect_code=1)
        self.assertIn("invalid JSON", result.stderr)
        result = self.check(
            "--candidate",
            VALID_CANDIDATE,
            "--reason",
            "Document JSON is unusable.",
            expect_code=1,
        )
        self.assertIn("invalid JSON", result.stderr)

    def test_malformed_route_row_remains_a_hard_document_error(self):
        self.write_repo_layer(
            {
                "version": 4,
                "routes": {
                    "captain..bad": {
                        "work": "Invalid id.",
                        "agent": "codex",
                        "model": "gpt-6-astra",
                        "effort": "high",
                    }
                },
            }
        )
        result = self.run_router("brief", expect_code=1)
        self.assertIn("invalid route 'captain..bad'", result.stderr)
        result = self.check(
            "--candidate",
            VALID_CANDIDATE,
            "--reason",
            "Document routes are unusable.",
            expect_code=1,
        )
        self.assertIn("invalid route 'captain..bad'", result.stderr)

    def test_malformed_schema_remains_a_hard_document_error(self):
        self.write_repo_layer({"version": 3, "routes": {}})
        result = self.run_router("brief", expect_code=1)
        self.assertIn("must use routing config version 4", result.stderr)


if __name__ == "__main__":
    unittest.main()
