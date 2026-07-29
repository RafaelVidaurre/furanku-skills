#!/usr/bin/env python3
"""Tests for compact dispatch helper."""

import json
import subprocess
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("dispatch.py")


def run(*args: str, stdin: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        input=stdin,
        capture_output=True,
        text=True,
        check=False,
    )


BASE = [
    "--title",
    "Implement shell palette",
    "--front-key",
    "run-1/bead-1/shell",
    "--route",
    "worker",
    "--agent",
    "codex",
    "--model",
    "gpt-test",
    "--effort",
    "high",
    "--checkout",
    "existing",
    "--autonomy",
    "supervised",
]


class DispatchTest(unittest.TestCase):
    def test_worker_json_default(self):
        result = run(*BASE)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["title"], "Implement shell palette")
        self.assertEqual(payload["bead"], "bead-1")
        self.assertEqual(payload["run_key"], "run-1")
        spec = payload["spec"]
        self.assertIn("front_key: run-1/bead-1/shell", spec)
        self.assertIn("bead: bead-1", spec)
        self.assertNotIn("run_key:", spec)
        self.assertNotIn("owner_tier", spec)
        self.assertIn("Read Bead bead-1", spec)
        self.assertNotIn("COMMANDER RUN PROVENANCE", spec)
        self.assertNotIn("Child routes", spec)

    def test_rejects_provenance_title(self):
        args = list(BASE)
        args[args.index("Implement shell palette")] = "COMMANDER RUN PROVENANCE"
        result = run(*args)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("human outcome", result.stderr)

    def test_rejects_bad_front_key(self):
        args = list(BASE)
        args[args.index("run-1/bead-1/shell")] = "only-two/parts"
        result = run(*args)
        self.assertNotEqual(result.returncode, 0)

    def test_captain_routes_from_stdin(self):
        routes = {
            "routes": {
                "worker": {"agent": "codex", "model": "m", "effort": "max"},
                "worker.testing": {
                    "work": "Front explicitly requests tests.",
                    "agent": "codex",
                    "model": "m",
                    "effort": "high",
                },
            }
        }
        result = run(
            *BASE,
            "--captain-contract",
            "/tmp/captain.md",
            "--routes-json",
            "-",
            "--format",
            "spec",
            stdin=json.dumps(routes),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Captain contract: /tmp/captain.md", result.stdout)
        self.assertIn("worker:", result.stdout)
        self.assertIn("worker.testing:", result.stdout)
        self.assertIn("work=Front explicitly requests tests.", result.stdout)
        self.assertNotIn("lexicographically", result.stdout)

    def test_bead_with_dots(self):
        args = list(BASE)
        args[args.index("run-1/bead-1/shell")] = "r/the-beacon-7wh.6.2.5/shell"
        result = run(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["bead"], "the-beacon-7wh.6.2.5")


if __name__ == "__main__":
    unittest.main()
