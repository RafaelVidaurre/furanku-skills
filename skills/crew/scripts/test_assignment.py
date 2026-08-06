#!/usr/bin/env python3
"""Tests for the Crew assignment helper."""

import json
from pathlib import Path
import subprocess
import sys
import unittest


SCRIPT = Path(__file__).with_name("assignment.py")
BASE = [
    "--title",
    "Deliver shell palette",
    "--front-key",
    "run-1/shell",
    "--role",
    "worker",
    "--reports-to",
    "captain",
    "--route",
    "worker",
    "--bead",
    "bead-1",
    "--routes-json",
    '{"worker":{"agent":"codex","model":"gpt-test","effort":"high"}}',
]


def run(*args: str, stdin: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        input=stdin,
        capture_output=True,
        text=True,
        check=False,
    )


def decision_args(decision: dict) -> list[str]:
    """BASE with the routes-json/--route pair swapped for a decision payload."""
    args = list(BASE)
    route_index = args.index("--route")
    del args[route_index:route_index + 2]
    routes_index = args.index("--routes-json")
    args[routes_index:routes_index + 2] = ["--decision-json", json.dumps(decision)]
    return args


class AssignmentTest(unittest.TestCase):
    def test_worker_assignment(self):
        result = run(*BASE)
        self.assertEqual(0, result.returncode, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual("run-1", payload["run_key"])
        self.assertEqual("bead-1", payload["bead"])
        self.assertIn("role: worker", payload["spec"])
        self.assertIn("reports_to: captain", payload["spec"])
        self.assertIn("references/worker.md", payload["spec"])
        self.assertNotIn("checkout:", payload["spec"])
        self.assertNotIn("Worker routes:", payload["spec"])

    def test_captain_assignment_includes_only_worker_routes(self):
        routes = {
            "captain": {"agent": "codex", "model": "c", "effort": "high"},
            "worker": {"agent": "codex", "model": "w", "effort": "medium"},
            "workerish": {"agent": "codex", "model": "x", "effort": "low"},
            "worker.testing": {
                "work": "The outcome explicitly requests tests.",
                "agent": "codex",
                "model": "t",
                "effort": "high",
            },
        }
        args = list(BASE)
        args[args.index("--role") + 1] = "captain"
        args[args.index("--reports-to") + 1] = "commander"
        args[args.index("--route") + 1] = "captain"
        result = run(
            *args,
            "--routes-json",
            "-",
            "--format",
            "spec",
            stdin=json.dumps(routes),
        )
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("role: captain", result.stdout)
        self.assertIn("reports_to: commander", result.stdout)
        self.assertIn("references/captain.md", result.stdout)
        self.assertIn("worker:", result.stdout)
        self.assertIn("worker.testing:", result.stdout)
        self.assertNotIn("workerish:", result.stdout)
        self.assertNotIn("captain: agent=", result.stdout)

    def test_bootstrap_request_is_preserved(self):
        args = list(BASE)
        bead_index = args.index("--bead")
        args[bead_index:bead_index + 2] = [
            "--request",
            "Fix naïve rendering; keep scope.",
        ]
        result = run(*args)
        self.assertEqual(0, result.returncode, result.stderr)
        spec = json.loads(result.stdout)["spec"]
        self.assertIn(
            'bootstrap_request: "Fix naïve rendering; keep scope."',
            spec,
        )
        self.assertIn("Create the first Bead", spec)

    def test_judged_decision_is_launchable_without_fixed_worker_routes(self):
        decision = {
            "status": "selected",
            "selected": {
                "id": "codex/gpt-5.6-luna/max",
                "agent": "codex",
                "model": "gpt-5.6-luna",
                "effort": "max",
            },
            "reason": "Bounded low-risk edit; cheapest capable candidate.",
            "warnings": ["quota stale"],
        }
        result = run(*decision_args(decision), "--format", "spec")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("route: judged", result.stdout)
        self.assertIn("candidate: codex/gpt-5.6-luna/max", result.stdout)
        self.assertIn(
            'routing_reason: "Bounded low-risk edit; cheapest capable candidate."',
            result.stdout,
        )
        self.assertIn('routing_warnings: ["quota stale"]', result.stdout)

    def test_exact_decision_records_route_id_and_provenance(self):
        decision = {
            "status": "exact",
            "selected": {
                "id": None,
                "agent": "grok",
                "model": "grok-4.5",
                "effort": "high",
            },
            "exact_route": "worker",
            "provenance": {
                "winner": {"scope": "global", "path": "/tmp/config.json"}
            },
        }
        result = run(*decision_args(decision), "--format", "spec")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("route: worker", result.stdout)
        self.assertIn("routing_status: exact", result.stdout)
        self.assertIn("route_source: global — /tmp/config.json", result.stdout)
        self.assertNotIn("candidate:", result.stdout)

    def test_rejects_fabricated_decision_payloads(self):
        launchable = {
            "id": "x/y/z",
            "agent": "a",
            "model": "m",
            "effort": "e",
        }
        cases = {
            "non-string launch fields": {
                "status": "selected",
                "selected": {"id": "x", "agent": True, "model": ["m"], "effort": 3},
                "reason": "r",
            },
            "selected without candidate id": {
                "status": "selected",
                "selected": {"agent": "a", "model": "m", "effort": "e"},
                "reason": "r",
            },
            "selected without rationale": {
                "status": "selected",
                "selected": launchable,
            },
            "exact without exact_route": {
                "status": "exact",
                "selected": {**launchable, "id": None},
            },
            "exact without provenance": {
                "status": "exact",
                "selected": {**launchable, "id": None},
                "exact_route": "worker",
            },
            "exact with empty provenance winner": {
                "status": "exact",
                "selected": {**launchable, "id": None},
                "exact_route": "worker",
                "provenance": {"winner": {}},
            },
        }
        for label, decision in cases.items():
            with self.subTest(label=label):
                result = run(*decision_args(decision))
                self.assertNotEqual(0, result.returncode)

    def test_rejects_exact_decision_for_wrong_role(self):
        decision = {
            "status": "exact",
            "selected": {
                "id": None,
                "agent": "codex",
                "model": "gpt-test",
                "effort": "high",
            },
            "exact_route": "captain",
            "provenance": {
                "winner": {"scope": "global", "path": "/tmp/config.json"}
            },
        }
        result = run(*decision_args(decision))
        self.assertNotEqual(0, result.returncode)
        self.assertIn("does not match role 'worker'", result.stderr)

    def test_rejects_unlaunchable_routing_decision(self):
        for status in ("no-route", "refused"):
            with self.subTest(status=status):
                result = run(*decision_args({"status": status}))
                self.assertNotEqual(0, result.returncode)
                self.assertIn("not launchable", result.stderr)

    def test_rejects_captain_from_captain(self):
        args = list(BASE)
        args[args.index("--role") + 1] = "captain"
        result = run(*args)
        self.assertNotEqual(0, result.returncode)
        self.assertIn("cannot assign another Captain", result.stderr)

    def test_rejects_route_for_wrong_role(self):
        args = list(BASE)
        args[args.index("--route") + 1] = "captain"
        result = run(*args)
        self.assertNotEqual(0, result.returncode)
        self.assertIn("does not match role", result.stderr)

    def test_rejects_route_absent_from_resolver_output(self):
        args = list(BASE)
        args[args.index("--route") + 1] = "worker.testing"
        result = run(*args)
        self.assertNotEqual(0, result.returncode)
        self.assertIn("absent from --routes-json", result.stderr)

    def test_rejects_checkout_topology(self):
        result = run(*BASE, "--checkout", "new-worktree")
        self.assertNotEqual(0, result.returncode)
        self.assertIn("unrecognized arguments: --checkout", result.stderr)

    def test_rejects_short_front_key(self):
        args = list(BASE)
        args[args.index("run-1/shell")] = "run-1"
        result = run(*args)
        self.assertNotEqual(0, result.returncode)
        self.assertIn("<run-key>/<front>", result.stderr)

    def test_rejects_malformed_front_keys(self):
        for front_key in ("/run/front", "run//front", "run/front/extra"):
            with self.subTest(front_key=front_key):
                args = list(BASE)
                args[args.index("run-1/shell")] = front_key
                result = run(*args)
                self.assertNotEqual(0, result.returncode)
                self.assertIn("<run-key>/<front>", result.stderr)


if __name__ == "__main__":
    unittest.main()
