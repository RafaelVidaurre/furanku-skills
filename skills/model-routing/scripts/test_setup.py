#!/usr/bin/env python3
"""Public CLI setup persistence, idempotence, preservation, and conflict contracts."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config
import routing_setup


SCRIPT = Path(__file__).with_name("routing_setup.py")
CONFIG = SCRIPT.with_name("config.py")
ROUTER = SCRIPT.with_name("router.py")


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.home = self.base / "home"
        self.home.mkdir()
        self.repo = self.base / "repo with spaces"
        self.repo.mkdir()
        self.env = {**os.environ, "HOME": str(self.home),
                    "CODEX_HOME": str(self.home / "codex"), "PYTHONDONTWRITEBYTECODE": "1"}
        self.target = self.home / ".furanku-skills/model-routing/config.json"

    def tearDown(self):
        self.temporary.cleanup()

    def command(self, script, *args, document=None, ok=True):
        completed = subprocess.run([sys.executable, str(script), *args],
                                   input=json.dumps(document) if document is not None else None,
                                   text=True, capture_output=True, env=self.env, check=False)
        if ok:
            self.assertEqual(0, completed.returncode, completed.stderr)
            return json.loads(completed.stdout)
        self.assertNotEqual(0, completed.returncode, completed.stdout)
        return completed

    def setup(self, command, *args, **kwargs):
        return self.command(SCRIPT, command, "--repo", str(self.repo), *args, **kwargs)

    def write(self, scope, document):
        return self.command(CONFIG, "write", scope, "--repo", str(self.repo), document=document)

    def test_fresh_status_is_nonblocking_and_only_prompts_unanswered_policy(self):
        result = self.setup("status")
        self.assertEqual("ready", result["status"])
        self.assertFalse(result["setup_complete"])
        self.assertEqual({"on_limit", "on_no_reply"}, {q["field"] for q in result["questions"]})
        self.assertEqual("stop", result["policy"]["on_no_reply"])
        self.assertFalse(self.target.exists())
        self.assertFalse((self.home / "codex").exists())

    def test_router_public_adapter_roundtrip(self):
        inspection = self.command(ROUTER, "setup", "--repo", str(self.repo))
        self.assertEqual("ready", inspection["status"])
        choices = self.base / "choices.json"
        choices.write_text(json.dumps({"on_limit": "ask", "on_no_reply": "stop"}))
        preview = self.command(ROUTER, "setup", "--repo", str(self.repo), "--scope", "global",
                               "--setup-file", str(choices))
        approved = self.base / "approved.json"
        approved.write_text(json.dumps(preview))
        applied = self.command(ROUTER, "setup", "--apply-setup", str(approved))
        self.assertEqual("applied", applied["status"])
        self.assertEqual([], applied["effective"]["questions"])
        rerun = self.command(ROUTER, "status", "--repo", str(self.repo))
        self.assertTrue(rerun["setup_complete"])

    def test_preview_and_apply_preserve_unrelated_config_and_are_idempotent(self):
        original = {"version": 4, "routes": {"review": {"agent": "test", "model": "private-model",
                    "effort": "high"}}, "preferences": ["Keep my ordinary selection preference."],
                    "accounts": {"codex": "test-account"}, "candidates": {"fixture": {"enabled": False}}}
        self.write("global", original)
        before_bytes = self.target.read_bytes()
        preview = self.setup("preview", "--scope", "global", document={"on_limit": "ask", "on_no_reply": "continue"})
        self.assertEqual(before_bytes, self.target.read_bytes(), "preview must not persist choices")
        for field in original:
            self.assertEqual(original[field], preview["after"][field])
        self.assertEqual(600, preview["after"]["recovery"]["response_seconds"])
        applied = self.setup("apply", document=preview)
        self.assertEqual("applied", applied["status"])
        self.assertTrue(applied["effective"]["setup_complete"])
        self.assertEqual([], applied["effective"]["questions"])
        after_bytes, after_mtime = self.target.read_bytes(), self.target.stat().st_mtime_ns
        repeated = self.setup("apply", document=preview)
        self.assertEqual("unchanged", repeated["status"])
        again = self.setup("preview", "--scope", "global", document=preview["choices"])
        self.assertFalse(again["changed"])
        self.assertEqual(after_bytes, self.target.read_bytes())
        self.assertEqual(after_mtime, self.target.stat().st_mtime_ns)

    def test_intervening_target_or_other_layer_changes_require_fresh_preview(self):
        for changed_scope in ("global", "repo"):
            with self.subTest(scope=changed_scope):
                preview = self.setup("preview", "--scope", "global", document={"on_limit": "wait"})
                changed = {"version": 4, "routes": {}, "preferences": [f"Changed in {changed_scope}"]}
                self.write(changed_scope, changed)
                failure = self.setup("apply", document=preview, ok=False)
                self.assertIn("changed since preview", failure.stderr)
                self.assertNotIn("Traceback", failure.stderr)
                if changed_scope == "global":
                    self.assertEqual(changed, json.loads(self.target.read_text()))

    def test_narrower_config_cannot_change_between_approval_check_and_target_write(self):
        narrower = {"version": 4, "routes": {}, "recovery": {"on_no_reply": "continue"}}
        original_write = config._save_unlocked
        attempts = []

        def write_while_contender_runs(*args, **kwargs):
            for scope in ("repo", "machine-repo"):
                attempted = self.command(CONFIG, "write", scope, "--repo", str(self.repo),
                                         document=narrower, ok=False)
                self.assertIn("write lock exists", attempted.stderr)
                attempts.append(attempted.returncode)
            deletion = self.command(CONFIG, "delete", "repo", "--repo", str(self.repo), "--yes", ok=False)
            self.assertIn("write lock exists", deletion.stderr)
            return original_write(*args, **kwargs)

        with mock.patch.dict(os.environ, self.env):
            approved = routing_setup.preview(self.repo, "global", {"on_limit": "ask", "on_no_reply": "stop"})
            with mock.patch.object(config, "_save_unlocked", side_effect=write_while_contender_runs):
                applied = routing_setup.apply(approved)
        self.assertEqual(2, len(attempts))
        self.assertEqual("stop", applied["effective"]["policy"]["on_no_reply"])
        self.assertFalse((self.repo / ".furanku-skills/model-routing/config.json").exists())

    def test_preview_rejects_configuration_changed_while_loading_layers(self):
        original_read = routing_setup.policy.configuration_layers

        def read_then_change(repo):
            layers = original_read(repo)
            self.write("repo", {"version": 4, "routes": {}, "recovery": {"on_no_reply": "continue"}})
            return layers

        with mock.patch.dict(os.environ, self.env):
            with mock.patch.object(routing_setup.policy, "configuration_layers", side_effect=read_then_change):
                with self.assertRaisesRegex(config.Error, "changed during preview"):
                    routing_setup.preview(self.repo, "global", {"on_no_reply": "stop"})
        self.assertFalse(self.target.exists())

    def test_partial_transaction_lock_failure_releases_only_owned_locks(self):
        first, last = self.base / "a.json", self.base / "z.json"
        other_lock = last.with_name(f".{last.name}.lock")
        other_lock.write_text("other owner")
        with self.assertRaisesRegex(config.Error, "write lock exists"):
            with config.lock_paths([last, first]):
                self.fail("transaction entered while another owner held a lock")
        self.assertFalse(first.with_name(f".{first.name}.lock").exists())
        self.assertEqual("other owner", other_lock.read_text())

    def test_role_and_route_setup_preserve_siblings_and_require_explicit_scope(self):
        self.write("repo", {"version": 4, "routes": {"review": {
            "agent": "test", "model": "test", "effort": "high"}},
            "role_recovery": {"captain": {"on_limit": "wait"}}})
        role = self.setup("preview", "--scope", "repo", "--role", "worker",
                          document={"on_no_reply": "stop"})
        self.setup("apply", document=role)
        route = self.setup("preview", "--scope", "repo", "--route", "review",
                           document={"max_replacements": 0})
        self.assertEqual({"on_limit": "wait"}, route["after"]["role_recovery"]["captain"])
        self.assertEqual({"on_no_reply": "stop"}, route["after"]["role_recovery"]["worker"])
        self.assertEqual({"max_replacements": 0}, route["after"]["routes"]["review"]["recovery"])
        missing = self.setup("preview", "--scope", "global", "--route", "review", document={}, ok=False)
        self.assertIn("must already exist", missing.stderr)
        missing_scope = self.setup("preview", document={}, ok=False)
        self.assertIn("explicit", missing_scope.stderr)

    def test_configured_defaults_are_answers_and_missing_duration_is_optional(self):
        self.write("global", {"version": 4, "routes": {},
                              "recovery": {"on_limit": "equivalent", "on_no_reply": "continue"}})
        status = self.setup("status")
        self.assertTrue(status["setup_complete"])
        self.assertEqual(["response_seconds"], [q["field"] for q in status["questions"]])
        self.assertFalse(status["questions"][0]["required"])

    def test_write_lock_is_preserved_and_malformed_preview_fails_cleanly(self):
        preview = self.setup("preview", "--scope", "global", document={"on_limit": "ask"})
        self.target.parent.mkdir(parents=True)
        lock = self.target.with_name(f".{self.target.name}.lock")
        lock.write_text("other writer")
        refused = self.setup("apply", document=preview, ok=False)
        self.assertIn("write lock exists", refused.stderr)
        self.assertEqual("other writer", lock.read_text())
        self.assertFalse(self.target.exists())
        preview["snapshots"] = []
        invalid = self.setup("apply", document=preview, ok=False)
        self.assertIn("invalid setup snapshots", invalid.stderr)
        self.assertNotIn("Traceback", invalid.stderr)


if __name__ == "__main__":
    unittest.main()
