#!/usr/bin/env python3
"""Tests for the Crew seam resolver and assignment packet builder."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("assignment.py")

ORCA_MANIFEST = {
    "mechanism": "orca",
    "launchers": ["claude", "codex", "opencode", "grok"],
    "isolation": True,
    "communication": "Orca dispatch carries questions and completion.",
    "retire": "Retire the assignment's terminals and worktree via orca-cli.",
    "extras": {"front_key": "^[^/]+/[^/]+$"},
}

HARNESS_MANIFEST = {
    "mechanism": "harness-native",
    "launchers": ["claude"],
    "isolation": False,
    "communication": "Harness task notifications reach the spawning session.",
    "retire": "Stop the agent through the harness; nothing durable remains.",
    "extras": {},
}

SELECTED = {
    "status": "selected",
    "selected": {
        "id": "codex/gpt-5.6-luna/max",
        "agent": "codex",
        "model": "gpt-5.6-luna",
        "effort": "max",
    },
    "reason": "Bounded low-risk edit; cheapest capable candidate.",
    "warnings": ["quota stale"],
    "quota": {"status": "stale"},
    "quota_acceptance": "Principal accepted stale quota for a low-risk edit.",
}

BASE = [
    "packet",
    "--title",
    "Deliver shell palette",
    "--role",
    "worker",
    "--reports-to",
    "captain",
    "--manifest",
    json.dumps(ORCA_MANIFEST),
    "--extra",
    "front_key=run-1/shell",
    "--work-ref",
    "beads:bead-1",
]


def run(*args: str, stdin: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        input=stdin,
        capture_output=True,
        text=True,
        check=False,
    )


def packet_args(decision: dict, base: list[str] | None = None) -> list[str]:
    return [*(base or BASE), "--decision-json", json.dumps(decision)]


class PacketTest(unittest.TestCase):
    def test_worker_packet_carries_work_ref_routing_and_mechanism(self):
        result = run(*packet_args(SELECTED))
        self.assertEqual(0, result.returncode, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual("worker", payload["role"])
        self.assertEqual(
            {"type": "ref", "adapter": "beads", "ref": "bead-1"}, payload["work"]
        )
        self.assertEqual(
            {"id": "orca", "extras": {"front_key": "run-1/shell"}},
            payload["mechanism"],
        )
        self.assertEqual("codex/gpt-5.6-luna/max", payload["routing"]["candidate"])
        self.assertIn("role: worker", payload["spec"])
        self.assertIn("reports_to: captain", payload["spec"])
        self.assertIn("mechanism: orca", payload["spec"])
        self.assertIn("front_key: run-1/shell", payload["spec"])
        self.assertIn("references/worker.md", payload["spec"])
        self.assertIn("work_ref: beads:bead-1", payload["spec"])
        self.assertIn('routing_warnings: ["quota stale"]', payload["spec"])
        self.assertIn("routing_quota_acceptance:", payload["spec"])

    def test_decision_json_reads_stdin(self):
        result = run(*BASE, "--decision-json", "-", stdin=json.dumps(SELECTED))
        self.assertEqual(0, result.returncode, result.stderr)

    def test_refuses_launcher_outside_manifest(self):
        decision = {
            **SELECTED,
            "selected": {**SELECTED["selected"], "agent": "codex"},
        }
        args = packet_args(decision)
        args[args.index(json.dumps(ORCA_MANIFEST))] = json.dumps(HARNESS_MANIFEST)
        front = args.index("front_key=run-1/shell")
        del args[front - 1 : front + 1]
        result = run(*args)
        self.assertNotEqual(0, result.returncode)
        self.assertIn("cannot launch agent 'codex'", result.stderr)
        self.assertIn("--launchable-via claude", result.stderr)

    def test_refuses_needs_acceptance_decision_with_flow_hint(self):
        decision = {
            "status": "needs-acceptance",
            "selected": SELECTED["selected"],
            "pending": ["quota unknown: rerun with --accept-quota-unknown ..."],
        }
        result = run(*packet_args(decision))
        self.assertNotEqual(0, result.returncode)
        self.assertIn("needs acceptance", result.stderr)
        self.assertIn("--accept-quota-unknown", result.stderr)

    def test_exact_decision_records_route_and_provenance(self):
        decision = {
            "status": "exact",
            "selected": {
                "id": None,
                "agent": "grok",
                "model": "grok-4.5",
                "effort": "high",
            },
            "exact_route": "worker",
            "provenance": {"winner": {"scope": "global", "path": "/tmp/config.json"}},
        }
        result = run(*packet_args(decision), "--format", "spec")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("route: worker", result.stdout)
        self.assertIn("routing_status: exact", result.stdout)
        self.assertIn("route_source: global — /tmp/config.json", result.stdout)
        self.assertNotIn("candidate:", result.stdout)

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
            "provenance": {"winner": {"scope": "global", "path": "/tmp/config.json"}},
        }
        result = run(*packet_args(decision))
        self.assertNotEqual(0, result.returncode)
        self.assertIn("does not match role 'worker'", result.stderr)

    def test_rejects_fabricated_decision_payloads(self):
        launchable = {"id": "x/y/z", "agent": "codex", "model": "m", "effort": "e"}
        cases = {
            "non-string launch fields": {
                "status": "selected",
                "selected": {"id": "x", "agent": True, "model": ["m"], "effort": 3},
                "reason": "r",
            },
            "selected without candidate id": {
                "status": "selected",
                "selected": {"agent": "codex", "model": "m", "effort": "e"},
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
            "unlaunchable status": {"status": "refused"},
        }
        for label, decision in cases.items():
            with self.subTest(label=label):
                result = run(*packet_args(decision))
                self.assertNotEqual(0, result.returncode)

    def test_rejects_captain_from_captain(self):
        args = packet_args(SELECTED)
        args[args.index("worker")] = "captain"
        result = run(*args)
        self.assertNotEqual(0, result.returncode)
        self.assertIn("cannot assign another Captain", result.stderr)

    def test_bootstrap_request_names_adapter(self):
        args = packet_args(SELECTED)
        ref = args.index("--work-ref")
        args[ref : ref + 2] = [
            "--request",
            "Fix naïve rendering; keep scope.",
            "--work-record",
            "github",
        ]
        result = run(*args)
        self.assertEqual(0, result.returncode, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual("bootstrap", payload["work"]["type"])
        self.assertIn(
            'bootstrap_request: "Fix naïve rendering; keep scope."', payload["spec"]
        )
        self.assertIn("Create the first github work record", payload["spec"])

    def test_direct_request_without_work_record(self):
        args = packet_args(SELECTED)
        ref = args.index("--work-ref")
        args[ref : ref + 2] = [
            "--request",
            "Rename the palette token.",
            "--work-record",
            "none",
        ]
        result = run(*args)
        self.assertEqual(0, result.returncode, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual("direct", payload["work"]["type"])
        self.assertIn("No work-record adapter is configured", payload["spec"])

    def test_request_requires_work_record_adapter(self):
        args = packet_args(SELECTED)
        ref = args.index("--work-ref")
        args[ref : ref + 2] = ["--request", "Fix it."]
        result = run(*args)
        self.assertNotEqual(0, result.returncode)
        self.assertIn("--work-record", result.stderr)

    def test_rejects_malformed_work_refs(self):
        for ref in ("bead-1", "Beads:bead-1", "none:bead-1", "beads:"):
            with self.subTest(ref=ref):
                args = packet_args(SELECTED)
                args[args.index("beads:bead-1")] = ref
                result = run(*args)
                self.assertNotEqual(0, result.returncode)

    def test_rejects_contradictory_work_record(self):
        result = run(*packet_args(SELECTED), "--work-record", "github")
        self.assertNotEqual(0, result.returncode)
        self.assertIn("contradicts", result.stderr)

    def test_extras_are_gated_by_manifest(self):
        missing = [arg for arg in packet_args(SELECTED) if arg != "--extra"]
        missing.remove("front_key=run-1/shell")
        result = run(*missing)
        self.assertNotEqual(0, result.returncode)
        self.assertIn("requires --extra front_key", result.stderr)

        malformed = packet_args(SELECTED)
        malformed[malformed.index("front_key=run-1/shell")] = "front_key=run-1"
        result = run(*malformed)
        self.assertNotEqual(0, result.returncode)
        self.assertIn("must match", result.stderr)

        undeclared = packet_args(SELECTED) + ["--extra", "tab=x"]
        result = run(*undeclared)
        self.assertNotEqual(0, result.returncode)
        self.assertIn("does not declare extras: tab", result.stderr)

    def test_rejects_invalid_manifest(self):
        for label, patch in (
            ("no launchers", {"launchers": []}),
            ("unknown key", {"surprise": True}),
            ("blank retire", {"retire": " "}),
            ("reserved extra", {"extras": {"role": ""}}),
            ("bad regex", {"extras": {"front_key": "["}}),
        ):
            with self.subTest(label=label):
                manifest = {**ORCA_MANIFEST, **patch}
                args = packet_args(SELECTED)
                args[args.index(json.dumps(ORCA_MANIFEST))] = json.dumps(manifest)
                result = run(*args)
                self.assertNotEqual(0, result.returncode)

    def test_rejects_double_stdin(self):
        args = [arg for arg in BASE]
        args[args.index(json.dumps(ORCA_MANIFEST))] = "-"
        result = run(*args, "--decision-json", "-", stdin=json.dumps(SELECTED))
        self.assertNotEqual(0, result.returncode)
        self.assertIn("stdin", result.stderr)


class SeamsTest(unittest.TestCase):
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

    def tearDown(self):
        self.temporary.cleanup()

    def seams(self, repo=None, expect_code=0):
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "seams",
                "--repo",
                str(repo or self.repo),
            ],
            capture_output=True,
            text=True,
            env=self.env,
            check=False,
        )
        if result.returncode != expect_code:
            raise AssertionError(result.stderr or result.stdout)
        return result

    def write_layer(self, scope, data):
        if scope == "global":
            path = self.home / ".furanku-skills" / "crew" / "config.json"
        elif scope == "repo":
            path = self.repo / ".furanku-skills" / "crew" / "config.json"
        else:
            raise ValueError(scope)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding="utf-8")

    def test_defaults_without_configuration(self):
        payload = json.loads(self.seams().stdout)
        self.assertEqual(
            {"adapter": None, "source": "unset"}, payload["work_record"]
        )
        self.assertEqual(
            {"id": "harness-native", "source": "default"}, payload["mechanism"]
        )
        self.assertEqual(
            ["global", "repo", "machine-repo"],
            [layer["scope"] for layer in payload["layers"]],
        )
        self.assertFalse(any(layer["present"] for layer in payload["layers"]))

    def test_higher_layer_wins_per_seam(self):
        self.write_layer(
            "global",
            {"version": 1, "work_record": {"adapter": "beads"}},
        )
        self.write_layer(
            "repo",
            {"version": 1, "mechanism": {"id": "orca"}},
        )
        payload = json.loads(self.seams().stdout)
        self.assertEqual(
            {"adapter": "beads", "source": "global"}, payload["work_record"]
        )
        self.assertEqual({"id": "orca", "source": "repo"}, payload["mechanism"])

    def test_custom_mechanism_manifest_round_trips(self):
        manifest = {**HARNESS_MANIFEST, "mechanism": "tmux-farm"}
        self.write_layer(
            "repo",
            {"version": 1, "mechanism": {"id": "tmux-farm", "manifest": manifest}},
        )
        payload = json.loads(self.seams().stdout)
        self.assertEqual("tmux-farm", payload["mechanism"]["id"])
        self.assertEqual(manifest, payload["mechanism"]["manifest"])

    def test_rejects_manifest_naming_other_mechanism(self):
        self.write_layer(
            "repo",
            {"version": 1, "mechanism": {"id": "orca", "manifest": HARNESS_MANIFEST}},
        )
        result = self.seams(expect_code=1)
        self.assertIn("names a different mechanism", result.stderr)

    def test_rejects_unknown_version_and_keys(self):
        self.write_layer("repo", {"version": 2, "mechanism": {"id": "orca"}})
        self.assertIn("version 1", self.seams(expect_code=1).stderr)
        self.write_layer("repo", {"version": 1, "tracker": "beads"})
        self.assertIn("unknown keys: tracker", self.seams(expect_code=1).stderr)

    def test_non_git_project_resolves(self):
        plain = self.base / "plain"
        plain.mkdir()
        payload = json.loads(self.seams(repo=plain).stdout)
        self.assertEqual(str(plain.resolve()), payload["repo"])


if __name__ == "__main__":
    unittest.main()
