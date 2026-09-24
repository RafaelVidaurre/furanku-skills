#!/usr/bin/env python3
"""The routing journal records CLI decisions and can be disabled machine-wide."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPTS = Path(__file__).resolve().parent
ROUTER = SCRIPTS / "router.py"
JOURNAL = SCRIPTS / "routing_log.py"
VALIDATOR = SCRIPTS.parent.parent / "agent-readable-logs" / "scripts" / "check_log_shape.py"


class RoutingLogTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.repo = self.root / "repo"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        self.env = {**os.environ, "HOME": str(self.home),
                    "CODEX_HOME": str(self.root / "codex"),
                    "CODEX_SESSION_ID": "parent-123", "PYTHONDONTWRITEBYTECODE": "1"}

    def run_script(self, script, *args):
        return subprocess.run([sys.executable, str(script), *args], env=self.env,
                              capture_output=True, text=True, check=False)

    def route(self):
        return self.run_script(ROUTER, "check", "--repo", str(self.repo),
                               "--candidate", "codex/gpt-6-astra/high",
                               "--reason", "Simple implementation task.",
                               "--launchable-via", "codex")

    def test_decision_link_and_bounded_tail(self):
        result = self.route()
        self.assertIn(result.returncode, (0, 2), result.stderr)
        decision = json.loads(result.stdout)
        self.assertRegex(decision["decision_id"], r"^[0-9a-f]{32}$")
        link = self.run_script(JOURNAL, "link", "--decision-id", decision["decision_id"],
                               "--session-ref", "worker-456")
        self.assertEqual(link.returncode, 0, link.stderr)
        rows = json.loads(self.run_script(JOURNAL, "tail", "--limit", "2",
                                           "--decision-id", decision["decision_id"]).stdout)
        self.assertEqual([row["msg"] for row in rows],
                         ["routing decision", "routing worker linked"])
        self.assertEqual(rows[0]["session.parent"], "parent-123")
        self.assertEqual(rows[1]["session.worker"], "worker-456")
        self.assertNotIn("Simple implementation task.", json.dumps(rows))
        files = list((self.home / ".furanku-skills/model-routing/logs").glob("*.jsonl"))
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].stat().st_mode & 0o777, 0o600)
        checked = self.run_script(VALIDATOR, str(files[0]))
        self.assertEqual(checked.returncode, 0, checked.stdout + checked.stderr)

    def test_opt_out_suppresses_decision_and_link(self):
        disabled = self.run_script(JOURNAL, "off")
        self.assertEqual(disabled.returncode, 0, disabled.stderr)
        decision = json.loads(self.route().stdout)
        linked = self.run_script(JOURNAL, "link", "--decision-id", decision["decision_id"],
                                 "--session-ref", "worker-456")
        self.assertEqual(json.loads(linked.stdout), {"linked": False})
        self.assertFalse((self.home / ".furanku-skills/model-routing/logs").exists())
        self.assertFalse(json.loads(self.run_script(JOURNAL, "status").stdout)["enabled"])

    def test_failed_routing_is_recorded_without_private_error_text(self):
        result = self.run_script(ROUTER, "check", "--repo", str(self.repo),
                                 "--candidate", "missing", "--reason", "private task text")
        self.assertEqual(result.returncode, 1)
        rows = json.loads(self.run_script(JOURNAL, "tail", "--limit", "1").stdout)
        self.assertEqual(rows[0]["msg"], "routing command failed")
        self.assertEqual(rows[0]["exception.type"], "Error")
        self.assertNotIn("private task text", json.dumps(rows))


if __name__ == "__main__":
    unittest.main()
