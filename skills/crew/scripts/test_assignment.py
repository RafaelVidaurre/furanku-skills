#!/usr/bin/env python3
"""Tests for the Crew seam resolver and assignment packet builder."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest


SCRIPT = Path(__file__).with_name("assignment.py")
PACKET_HOME = tempfile.TemporaryDirectory()
PACKET_ENV = os.environ.copy()
PACKET_ENV["HOME"] = PACKET_HOME.name
PACKET_ENV["CODEX_HOME"] = str(Path(PACKET_HOME.name) / "codex")

ORCA_MANIFEST = {
    "mechanism": "orca",
    "launchable_agents": ["claude", "codex", "opencode", "grok"],
    "isolation": True,
    "communication": "Orca dispatch carries questions and completion.",
    "retire": "Retire the assignment's terminals and worktree via orca-cli.",
    "extras": {"front_key": "^[^/]+/[^/]+$"},
}

HARNESS_MANIFEST = {
    "mechanism": "harness-native",
    "launchable_agents": ["claude"],
    "isolation": False,
    "communication": "Harness task notifications reach the spawning session.",
    "retire": "Stop the agent through the harness; nothing durable remains.",
    "extras": {},
}

ROUTE_BASIS = "Principal requested the Worker route for this task."

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

GROK_SELECTED = {
    "status": "selected",
    "selected": {
        "id": "grok/grok-4.6/high",
        "agent": "grok",
        "model": "grok-4.6",
        "effort": "high",
    },
    "reason": "Bounded independent audit; use the configured Worker default.",
    "warnings": [],
    "quota": {"status": "available"},
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
        env=PACKET_ENV,
        check=False,
    )


def packet_args(decision: dict, base: list[str] | None = None) -> list[str]:
    return [*(base or BASE), "--decision-json", json.dumps(decision)]


def fake_router(
    directory: Path, expected: list[str], decision: dict, exit_code: int = 0
) -> Path:
    script = directory / "router.py"
    script.write_text(
        textwrap.dedent(
            f"""\
            import json
            import sys

            expected = {expected!r}
            missing = [item for item in expected if item not in sys.argv[1:]]
            if missing:
                print("missing routing arguments: " + ", ".join(missing), file=sys.stderr)
                raise SystemExit(1)
            print(json.dumps({decision!r}))
            raise SystemExit({exit_code})
            """
        ),
        encoding="utf-8",
    )
    return script


class PacketTest(unittest.TestCase):
    def test_brief_derives_launchers_from_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            router = fake_router(
                Path(directory),
                ["brief", "--launchable-via", "claude", "--quota-axi"],
                {"brief": "filtered"},
            )
            result = run(
                "brief",
                "--manifest",
                json.dumps(HARNESS_MANIFEST),
                "--router",
                str(router),
                "--format",
                "json",
            )
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual({"brief": "filtered"}, json.loads(result.stdout))

    def test_packet_routes_candidate_and_derives_manifest_constraints(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = str(Path(directory) / "runtime.json")
            decision_out = Path(directory) / "decision.json"
            router = fake_router(
                Path(directory),
                [
                    "check",
                    "--candidate",
                    "claude/sonnet/high",
                    "--reason",
                    "Small but judgment-heavy review.",
                    "--launchable-via",
                    "claude",
                    "--quota-axi",
                    "--max-effort-basis",
                    "xhigh is materially insufficient.",
                    "--minimum-context",
                    "200000",
                    "--accept-quota-unknown",
                    "Principal accepted unknown quota.",
                    "--runtime-file",
                    runtime,
                    "--require-feature",
                    "vision",
                ],
                {
                    "status": "selected",
                    "selected": {
                        "id": "claude/sonnet/high",
                        "agent": "claude",
                        "model": "sonnet",
                        "effort": "high",
                    },
                    "reason": "Small but judgment-heavy review.",
                    "warnings": [],
                    "quota": {"status": "available"},
                },
            )
            base = [
                "packet",
                "--title",
                "Review the change",
                "--role",
                "worker",
                "--reports-to",
                "captain",
                "--manifest",
                json.dumps(HARNESS_MANIFEST),
                "--work-ref",
                "beads:review-1",
            ]
            result = run(
                *base,
                "--candidate",
                "claude/sonnet/high",
                "--reason",
                "Small but judgment-heavy review.",
                "--router",
                str(router),
                "--max-effort-basis",
                "xhigh is materially insufficient.",
                "--minimum-context",
                "200000",
                "--accept-quota-unknown",
                "Principal accepted unknown quota.",
                "--runtime-file",
                runtime,
                "--require-feature",
                "vision",
                "--decision-out",
                str(decision_out),
            )
            saved = json.loads(decision_out.read_text(encoding="utf-8"))
        self.assertEqual(0, result.returncode, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual("claude/sonnet/high", payload["routing"]["candidate"])
        self.assertEqual("available", payload["routing"]["quota"]["status"])
        self.assertEqual("selected", saved["status"])
        self.assertIn("selected", saved)

    def test_packet_routes_exact_route_without_manual_gate_arguments(self):
        with tempfile.TemporaryDirectory() as directory:
            router = fake_router(
                Path(directory),
                [
                    "--exact-route",
                    "worker",
                    "--route-basis",
                    ROUTE_BASIS,
                    "--launchable-via",
                    "claude",
                    "--quota-axi",
                    "--use-quota-fallback",
                    "Principal did not answer within 120s.",
                    "--minimum-context",
                    "100000",
                    "--require-feature",
                    "tools",
                ],
                {
                    "status": "exact",
                    "selected": {
                        "id": "claude/sonnet/high",
                        "agent": "claude",
                        "model": "sonnet",
                        "effort": "high",
                    },
                    "exact_route": "worker",
                    "route_basis": ROUTE_BASIS,
                    "provenance": {
                        "winner": {"scope": "global", "path": "/tmp/config.json"}
                    },
                    "warnings": [],
                    "quota": {"status": "available"},
                },
            )
            base = [
                "packet",
                "--title",
                "Review the change",
                "--role",
                "worker",
                "--reports-to",
                "captain",
                "--manifest",
                json.dumps(HARNESS_MANIFEST),
                "--work-ref",
                "beads:review-1",
            ]
            result = run(
                *base,
                "--exact-route",
                "worker",
                "--route-basis",
                ROUTE_BASIS,
                "--router",
                str(router),
                "--use-quota-fallback",
                "Principal did not answer within 120s.",
                "--minimum-context",
                "100000",
                "--require-feature",
                "tools",
            )
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual("worker", json.loads(result.stdout)["routing"]["route"])

    def test_packet_rejects_failed_router_even_with_launchable_json(self):
        with tempfile.TemporaryDirectory() as directory:
            router = fake_router(Path(directory), ["check"], SELECTED, exit_code=9)
            result = run(
                *BASE,
                "--candidate",
                SELECTED["selected"]["id"],
                "--reason",
                SELECTED["reason"],
                "--router",
                str(router),
            )
        self.assertNotEqual(0, result.returncode)
        self.assertIn("inconsistent result", result.stderr)

    def test_packet_rejects_router_response_for_another_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            router = fake_router(Path(directory), ["check"], SELECTED)
            result = run(
                *BASE,
                "--candidate",
                "codex/gpt-5.6-sol/high",
                "--reason",
                SELECTED["reason"],
                "--router",
                str(router),
            )
        self.assertNotEqual(0, result.returncode)
        self.assertIn("different candidate than requested", result.stderr)

    def test_packet_rejects_router_response_with_changed_route_basis(self):
        decision = {
            "status": "exact",
            "selected": {
                "id": "claude/sonnet/high",
                "agent": "claude",
                "model": "sonnet",
                "effort": "high",
            },
            "exact_route": "worker",
            "route_basis": "A different request.",
            "provenance": {"winner": {"scope": "global", "path": "/tmp/config.json"}},
        }
        with tempfile.TemporaryDirectory() as directory:
            router = fake_router(Path(directory), ["check"], decision)
            result = run(
                *BASE,
                "--exact-route",
                "worker",
                "--route-basis",
                ROUTE_BASIS,
                "--router",
                str(router),
            )
        self.assertNotEqual(0, result.returncode)
        self.assertIn("different exact route or route basis", result.stderr)

    def test_packet_routing_choice_is_exclusive(self):
        result = run(
            *packet_args(SELECTED),
            "--candidate",
            "codex/gpt-5.6-sol/high",
            "--reason",
            "A reason.",
        )
        self.assertNotEqual(0, result.returncode)
        self.assertIn("not allowed with argument", result.stderr)

    def test_packet_rejects_mode_specific_routing_options(self):
        candidate = run(
            *BASE,
            "--candidate",
            "codex/gpt-5.6-sol/high",
            "--reason",
            "A reason.",
            "--route-basis",
            ROUTE_BASIS,
        )
        self.assertNotEqual(0, candidate.returncode)
        self.assertIn("apply only to --exact-route", candidate.stderr)

        exact = run(
            *BASE,
            "--exact-route",
            "worker",
            "--route-basis",
            ROUTE_BASIS,
            "--max-effort-basis",
            "xhigh is insufficient.",
        )
        self.assertNotEqual(0, exact.returncode)
        self.assertIn("apply only to --candidate", exact.stderr)

    def test_saved_decision_ignores_router_location(self):
        result = run(
            *packet_args(SELECTED),
            "--router",
            "/path/that/is/not/used/router.py",
        )
        self.assertEqual(0, result.returncode, result.stderr)

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
        self.assertIn('outcome: "Deliver shell palette"', payload["spec"])
        self.assertIn("role: worker", payload["spec"])
        self.assertIn("reports_to: captain", payload["spec"])
        self.assertIn("mechanism: orca", payload["spec"])
        self.assertIn("isolation: true", payload["spec"])
        self.assertIn(
            'coordination: "Orca dispatch carries questions and completion."',
            payload["spec"],
        )
        self.assertIn("front_key: run-1/shell", payload["spec"])
        self.assertIn("skills/crew/SKILL.md", payload["spec"])
        self.assertIn("references/worker.md", payload["spec"])
        self.assertIn("work_ref: beads:bead-1", payload["spec"])
        self.assertIn('routing_warnings: ["quota stale"]', payload["spec"])
        self.assertIn("routing_quota_acceptance:", payload["spec"])

    def test_builtin_orca_grok_packet_carries_custom_launch_mapping(self):
        args = packet_args(GROK_SELECTED)
        args[args.index(json.dumps(ORCA_MANIFEST))] = "orca"
        result = run(*args)
        self.assertEqual(0, result.returncode, result.stderr)
        payload = json.loads(result.stdout)
        note = payload["launch_note"]
        self.assertIn(
            "grok --model <packet model> --reasoning-effort <packet effort>", note
        )
        self.assertIn("worker-start --task <task> --terminal <handle>", note)
        self.assertIn("mis-mapped invocation", note)
        self.assertIn("launch_note:", payload["spec"])

    def test_existing_work_ref_preserves_launch_constraints_for_descendants(self):
        result = run(
            *packet_args(SELECTED),
            "--launch-constraint",
            "Use claudex for every thread spawned.",
        )
        self.assertEqual(0, result.returncode, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(
            ["Use claudex for every thread spawned."],
            payload["launch_constraints"],
        )
        self.assertIn(
            'launch_constraint: "Use claudex for every thread spawned."',
            payload["spec"],
        )
        self.assertEqual(
            "beads:bead-1",
            f"{payload['work']['adapter']}:{payload['work']['ref']}",
        )

    def test_rejects_blank_launch_constraint(self):
        result = run(*packet_args(SELECTED), "--launch-constraint", "   ")
        self.assertNotEqual(0, result.returncode)
        self.assertIn("--launch-constraint must be non-empty", result.stderr)

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
        self.assertIn(
            "saved decision was checked for a different launch surface", result.stderr
        )

    def test_exact_manifest_mismatch_preserves_route_and_launch_constraints(self):
        decision = {
            "status": "exact",
            "selected": {
                "id": None,
                "agent": "grok",
                "model": "grok-4.6",
                "effort": "high",
            },
            "exact_route": "worker",
            "route_basis": ROUTE_BASIS,
            "provenance": {"winner": {"scope": "global", "path": "/tmp/config.json"}},
        }
        args = packet_args(decision)
        args[args.index(json.dumps(ORCA_MANIFEST))] = json.dumps(HARNESS_MANIFEST)
        front = args.index("front_key=run-1/shell")
        del args[front - 1 : front + 1]
        result = run(
            *args,
            "--launch-constraint",
            "Use harness-native for every thread.",
        )
        self.assertNotEqual(0, result.returncode)
        self.assertIn("preserve exact route 'worker'", result.stderr)
        self.assertIn("unchanged launch constraints", result.stderr)
        self.assertNotIn("re-judge", result.stderr)

    def test_refused_exact_decision_preserves_route_and_reasons(self):
        decision = {
            "status": "refused",
            "exact_route": "worker",
            "route_basis": ROUTE_BASIS,
            "reasons": ["agent 'grok' is outside launchable agents: claude"],
            "warnings": [],
        }
        result = run(*packet_args(decision))
        self.assertNotEqual(0, result.returncode)
        self.assertIn("exact route 'worker' was refused", result.stderr)
        self.assertIn("agent 'grok' is outside launchable agents", result.stderr)
        self.assertIn("Preserve the route", result.stderr)

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

    def test_needs_acceptance_mentions_configured_quota_fallback(self):
        decision = {
            "status": "needs-acceptance",
            "selected": SELECTED["selected"],
            "pending": ["Grok access token expired. Refresh with `grok`."],
            "quota_fallback": {
                "ask_seconds": 120,
                "launch": {
                    "agent": "codex",
                    "model": "gpt-5.6-sol",
                    "effort": "high",
                },
            },
        }
        result = run(*packet_args(decision))
        self.assertNotEqual(0, result.returncode)
        self.assertIn("--accept-quota-unknown", result.stderr)
        self.assertIn("120s → codex/gpt-5.6-sol/high", result.stderr)
        self.assertIn("--use-quota-fallback", result.stderr)

    def test_needs_acceptance_runs_runtime_remedy_before_asking(self):
        decision = {
            "status": "needs-acceptance",
            "candidate": SELECTED["selected"]["id"],
            "selected": SELECTED["selected"],
            "reason": SELECTED["reason"],
            "pending": ["Refresh or accept unknown quota."],
            "quota": {
                "status": "stale",
                "detail": "The session expired",
                "remedy": "grok",
            },
        }
        result = run(*packet_args(decision))
        self.assertNotEqual(0, result.returncode)
        self.assertIn("Run `grok`", result.stderr)
        self.assertIn("re-check the same candidate", result.stderr)
        self.assertNotIn("principal's acceptance", result.stderr)
        self.assertNotIn("--accept-quota-unknown", result.stderr)

    def test_exact_decision_records_route_and_provenance(self):
        decision = {
            "status": "exact",
            "selected": {
                "id": None,
                "agent": "grok",
                "model": "grok-4.6",
                "effort": "high",
            },
            "exact_route": "worker",
            "route_basis": ROUTE_BASIS,
            "provenance": {"winner": {"scope": "global", "path": "/tmp/config.json"}},
        }
        result = run(*packet_args(decision))
        self.assertEqual(0, result.returncode, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(ROUTE_BASIS, payload["routing"]["route_basis"])
        self.assertIn("route: worker", payload["spec"])
        self.assertIn("routing_status: exact", payload["spec"])
        self.assertIn(f'route_basis: "{ROUTE_BASIS}"', payload["spec"])
        self.assertIn("route_source: global — /tmp/config.json", payload["spec"])
        self.assertNotIn("candidate:", payload["spec"])

    def test_exact_decision_records_used_quota_fallback(self):
        decision = {
            "status": "exact",
            "selected": {
                "id": "codex/gpt-5.6-sol/high",
                "agent": "codex",
                "model": "gpt-5.6-sol",
                "effort": "high",
            },
            "exact_route": "worker",
            "route_basis": ROUTE_BASIS,
            "provenance": {"winner": {"scope": "global", "path": "/tmp/config.json"}},
            "quota_fallback": {
                "used": True,
                "from": {"agent": "grok", "model": "grok-4.6", "effort": "high"},
                "to": {"agent": "codex", "model": "gpt-5.6-sol", "effort": "high"},
                "ask_seconds": 120,
                "basis": "principal did not respond within 120s",
            },
        }
        result = run(*packet_args(decision), "--format", "spec")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("routing_quota_fallback:", result.stdout)
        self.assertIn("principal did not respond within 120s", result.stdout)

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
            "route_basis": "Principal requested the Captain route for this task.",
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
            "exact without route basis": {
                "status": "exact",
                "selected": {**launchable, "id": None},
                "exact_route": "worker",
                "provenance": {
                    "winner": {"scope": "global", "path": "/tmp/config.json"}
                },
            },
            "exact without provenance": {
                "status": "exact",
                "selected": {**launchable, "id": None},
                "exact_route": "worker",
                "route_basis": ROUTE_BASIS,
            },
            "exact with empty provenance winner": {
                "status": "exact",
                "selected": {**launchable, "id": None},
                "exact_route": "worker",
                "route_basis": ROUTE_BASIS,
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
        with tempfile.TemporaryDirectory() as directory:
            args = packet_args(SELECTED)
            ref = args.index("--work-ref")
            args[ref : ref + 2] = ["--request", "Fix it."]
            args += ["--repo", directory]
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
            ("no launchable agents", {"launchable_agents": []}),
            ("unknown key", {"surprise": True}),
            ("blank retire", {"retire": " "}),
            ("blank launch note", {"launch_notes": {"grok": " "}}),
            ("launch note for another agent", {"launch_notes": {"cursor": "x"}}),
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
        self.assertEqual({"adapter": None, "source": "unset"}, payload["work_record"])
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
        self.assertEqual("orca", payload["mechanism"]["id"])
        self.assertEqual("repo", payload["mechanism"]["source"])
        self.assertEqual("orca", payload["mechanism"]["manifest"]["mechanism"])

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

    def registry_layer(self, disabled):
        manifest = {**HARNESS_MANIFEST, "mechanism": "claudex-workflow"}
        return {
            "version": 1,
            "mechanism": {"id": "orca"},
            "mechanisms": {
                "claudex-workflow": {"disabled": disabled, "manifest": manifest}
            },
        }

    def test_disabled_registry_entry_keeps_manifest_but_blocks_selection(self):
        self.write_layer("global", self.registry_layer(disabled=True))
        payload = json.loads(self.seams().stdout)
        self.assertEqual("orca", payload["mechanism"]["id"])
        self.assertTrue(payload["mechanisms"]["claudex-workflow"]["disabled"])
        self.write_layer(
            "repo", {"version": 1, "mechanism": {"id": "claudex-workflow"}}
        )
        result = self.seams(expect_code=1)
        self.assertIn("'claudex-workflow' is disabled", result.stderr)

    def test_enabled_registry_entry_supplies_active_manifest(self):
        layer = self.registry_layer(disabled=False)
        layer["mechanism"] = {"id": "claudex-workflow"}
        self.write_layer("global", layer)
        payload = json.loads(self.seams().stdout)
        self.assertEqual(
            "claudex-workflow", payload["mechanism"]["manifest"]["mechanism"]
        )

    def test_rejects_registry_entry_with_unknown_keys(self):
        self.write_layer(
            "global",
            {"version": 1, "mechanisms": {"claudex-workflow": {"paused": True}}},
        )
        result = self.seams(expect_code=1)
        self.assertIn("allows only: disabled, manifest", result.stderr)

    def packet_via(self, manifest_arg, extra=None):
        args = [
            sys.executable,
            str(SCRIPT),
            "packet",
            "--title",
            "Deliver shell palette",
            "--role",
            "worker",
            "--reports-to",
            "captain",
            "--manifest",
            manifest_arg,
            "--repo",
            str(self.repo),
            "--work-ref",
            "beads:bead-1",
            "--decision-json",
            json.dumps(SELECTED),
        ]
        if extra:
            args += ["--extra", extra]
        return subprocess.run(
            args, capture_output=True, text=True, env=self.env, check=False
        )

    def test_packet_resolves_manifest_by_known_mechanism_id(self):
        result = self.packet_via("orca", extra="front_key=run-1/shell")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual("orca", json.loads(result.stdout)["mechanism"]["id"])

    def test_packet_infers_configured_manifest_and_work_record(self):
        self.write_layer(
            "repo",
            {
                "version": 1,
                "mechanism": {"id": "orca"},
                "work_record": {"adapter": "beads"},
            },
        )
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "packet",
                "--repo",
                str(self.repo),
                "--title",
                "Deliver shell palette",
                "--role",
                "worker",
                "--reports-to",
                "captain",
                "--extra",
                "front_key=run-1/shell",
                "--request",
                "Deliver the shell palette.",
                "--decision-json",
                json.dumps(SELECTED),
            ],
            capture_output=True,
            text=True,
            env=self.env,
            check=False,
        )
        self.assertEqual(0, result.returncode, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual("orca", payload["mechanism"]["id"])
        self.assertEqual("bootstrap", payload["work"]["type"])
        self.assertEqual("beads", payload["work"]["adapter"])

    def test_packet_resolves_manifest_from_registry_and_refuses_disabled(self):
        manifest = {
            **HARNESS_MANIFEST,
            "mechanism": "claudex-workflow",
            "launchable_agents": ["claude", "codex"],
        }
        self.write_layer(
            "global",
            {
                "version": 1,
                "mechanism": {"id": "orca"},
                "mechanisms": {"claudex-workflow": {"manifest": manifest}},
            },
        )
        result = self.packet_via("claudex-workflow")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(
            "claudex-workflow", json.loads(result.stdout)["mechanism"]["id"]
        )
        self.write_layer("global", self.registry_layer(disabled=True))
        refused = self.packet_via("claudex-workflow")
        self.assertEqual(1, refused.returncode)
        self.assertIn("'claudex-workflow' is disabled", refused.stderr)

    def test_packet_unresolvable_manifest_id_names_options(self):
        result = self.packet_via("tmux-farm")
        self.assertEqual(1, result.returncode)
        self.assertIn("no manifest for mechanism id 'tmux-farm'", result.stderr)
        self.assertIn("orca", result.stderr)


if __name__ == "__main__":
    unittest.main()
