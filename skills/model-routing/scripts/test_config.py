#!/usr/bin/env python3
"""Standard-library tests for the model-routing configuration helper."""

import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("config.py")
CATALOG = SCRIPT.parent.parent / "references" / "routing-catalog.json"


def builtin_routes():
    return json.loads(CATALOG.read_text(encoding="utf-8"))["routes"]


def row(agent, model, effort):
    return {"agent": agent, "model": model, "effort": effort}


def specialist(work, agent, model, effort):
    return {
        "work": work,
        "agent": agent,
        "model": model,
        "effort": effort,
    }


class ConfigTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.home = self.base / "home"
        self.home.mkdir()
        self.repo = self.base / "repo with spaces"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        subprocess.run(
            ["git", "-C", str(self.repo), "config", "user.email", "test@example.com"],
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(self.repo), "config", "user.name", "Test"],
            check=True,
        )
        self.env = os.environ.copy()
        self.env["HOME"] = str(self.home)
        self.env["PYTHONDONTWRITEBYTECODE"] = "1"

    def tearDown(self):
        self.temporary.cleanup()

    def run_config(self, *args, input_value=None, ok=True):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            input=(json.dumps(input_value) if input_value is not None else None),
            capture_output=True,
            text=True,
            env=self.env,
            check=False,
        )
        if ok and result.returncode:
            self.fail(f"{result.args}\nstdout: {result.stdout}\nstderr: {result.stderr}")
        if not ok and not result.returncode:
            self.fail(f"command unexpectedly succeeded: {result.args}")
        return result

    def base_config(self):
        return {
            "version": 4,
            "routes": {
                "captain": row("captain-agent", "captain-model", "high"),
                "worker": row("worker-agent", "worker-model", "medium"),
            },
        }

    def write(self, scope, config, repo=None):
        args = ["write", scope]
        if repo is not None:
            args += ["--repo", str(repo)]
        return json.loads(self.run_config(*args, input_value=config).stdout)

    def test_template_and_partial_global_override(self):
        template = json.loads(self.run_config("template").stdout)
        self.assertEqual(4, template["version"])
        self.assertEqual({}, template["routes"])
        self.assertEqual([], template["preferences"])
        self.assertEqual({}, template["candidates"])

        partial = {"version": 4, "routes": {"captain": row("a", "m", "e")}}
        self.write("global", partial)
        result = json.loads(
            self.run_config("resolve", "--repo", str(self.repo)).stdout
        )
        self.assertEqual(row("a", "m", "e"), result["config"]["routes"]["captain"])
        self.assertEqual(
            "builtin", result["route_sources"]["worker"]["scope"]
        )

        with_commander = self.base_config()
        with_commander["routes"]["commander"] = row("a", "m", "e")
        result = self.run_config(
            "write", "global", input_value=with_commander, ok=False
        )
        self.assertIn("route 'commander' in - requires: agent, effort, model, work", result.stderr)

        extra = self.base_config()
        extra["unexpected"] = True
        result = self.run_config("write", "global", input_value=extra, ok=False)
        self.assertIn(
            "must contain routes and only: candidates, preferences, routes, version",
            result.stderr,
        )

    def test_fresh_install_resolves_builtin_defaults(self):
        result = json.loads(
            self.run_config("resolve", "--repo", str(self.repo)).stdout
        )
        routes = result["config"]["routes"]
        self.assertEqual(["captain", "worker"], list(routes))
        self.assertEqual(builtin_routes(), routes)
        for route in routes:
            self.assertEqual(
                "builtin", result["route_sources"][route]["scope"]
            )
        self.assertEqual(
            "builtin", result["layers_low_to_high"][0]["scope"]
        )

    def test_v4_preserves_exact_routes_and_exposes_sections(self):
        config = {
            "version": 4,
            "routes": self.base_config()["routes"],
            "preferences": [
                "Captains default to gpt-5.6-sol at xhigh.",
                "For the hardest design work, use fable or sol at max.",
            ],
            "candidates": {"grok/grok-4.5/high": {"enabled": False}},
        }
        self.write("global", config)

        result = json.loads(
            self.run_config("resolve", "--repo", str(self.repo)).stdout
        )
        self.assertEqual(self.base_config()["routes"], result["config"]["routes"])
        layers = result["layers_low_to_high"]
        self.assertEqual("builtin", layers[0]["scope"])
        global_layer = layers[1]
        self.assertEqual("global", global_layer["scope"])
        self.assertEqual(4, global_layer["version"])
        self.assertEqual(2, global_layer["preferences"])
        self.assertEqual(
            ["grok/grok-4.5/high"], global_layer["candidates_defined"]
        )

        config["surprise"] = {}
        invalid = self.run_config(
            "write", "global", input_value=config, ok=False
        )
        self.assertIn(
            "must contain routes and only: candidates, preferences, routes, version",
            invalid.stderr,
        )
        del config["surprise"]
        config["preferences"] = ["fine", ""]
        invalid = self.run_config(
            "write", "global", input_value=config, ok=False
        )
        self.assertIn("preferences[1] must be a non-empty string", invalid.stderr)

    def test_non_current_versions_are_refused(self):
        path = self.home / ".furanku-skills" / "model-routing" / "config.json"
        path.parent.mkdir(parents=True)
        for version in (1, 2, 3):
            with self.subTest(version=version):
                config = {"version": version, "routes": {}}
                refused = self.run_config(
                    "write", "global", input_value=config, ok=False
                )
                self.assertIn(
                    "must use routing config version 4", refused.stderr
                )
                path.write_text(json.dumps(config), encoding="utf-8")
                result = self.run_config(
                    "resolve", "--repo", str(self.repo), "--compact", ok=False
                )
                self.assertIn(
                    "must use routing config version 4", result.stderr
                )
                path.unlink()

    def test_legacy_commander_location_is_ignored(self):
        legacy = self.home / ".furanku-skills" / "commander" / "config.json"
        legacy.parent.mkdir(parents=True)
        legacy.write_text(json.dumps(self.base_config()), encoding="utf-8")

        result = json.loads(
            self.run_config("resolve", "--repo", str(self.repo)).stdout
        )
        self.assertEqual(builtin_routes(), result["config"]["routes"])

        record = self.write("global", self.base_config())
        self.assertEqual(
            str(self.home / ".furanku-skills" / "model-routing" / "config.json"),
            record["path"],
        )

    def test_v4_write_accepts_candidate_tombstones(self):
        config = {
            "version": 4,
            "routes": {},
            "candidates": {"grok/grok-4.5/high": None},
        }
        record = self.write("global", config)
        self.assertEqual(
            {"grok/grok-4.5/high": None}, record["config"]["candidates"]
        )

    def test_specialist_validation(self):
        config = self.base_config()
        config["routes"]["worker.testing"] = specialist(
            "Focused verification.", "test-agent", "test-model", "high"
        )
        self.write("global", config)

        missing_work = self.base_config()
        missing_work["routes"]["worker.testing"] = row("a", "m", "e")
        result = self.run_config(
            "write", "global", input_value=missing_work, ok=False
        )
        self.assertIn("requires: agent, effort, model, work", result.stderr)

        nested = self.base_config()
        nested["routes"]["captain.api.design"] = specialist(
            "API design.", "a", "m", "e"
        )
        self.write("global", nested)

        malformed = self.base_config()
        malformed["routes"]["captain..design"] = specialist(
            "API design.", "a", "m", "e"
        )
        result = self.run_config(
            "write", "global", input_value=malformed, ok=False
        )
        self.assertIn("invalid route 'captain..design'", result.stderr)

    def test_layer_precedence_replaces_whole_rows(self):
        global_config = self.base_config()
        global_config["routes"]["worker.testing"] = specialist(
            "Tests.", "global-agent", "global-model", "medium"
        )
        self.write("global", global_config)

        repo_config = {
            "version": 4,
            "routes": {
                "worker": row("repo-agent", "repo-model", "high"),
                "worker.testing": specialist(
                    "Tests.", "repo-test-agent", "repo-test-model", "high"
                ),
            },
        }
        self.write("repo", repo_config, self.repo)

        machine_config = {
            "version": 4,
            "routes": {
                "worker": row("machine-agent", "machine-model", "ultra")
            },
        }
        self.write("machine-repo", machine_config, self.repo)

        result = json.loads(
            self.run_config("resolve", "--repo", str(self.repo)).stdout
        )
        routes = result["config"]["routes"]
        self.assertEqual(machine_config["routes"]["worker"], routes["worker"])
        self.assertEqual(
            repo_config["routes"]["worker.testing"], routes["worker.testing"]
        )
        self.assertEqual("machine-repo", result["route_sources"]["worker"]["scope"])
        self.assertEqual(
            ["builtin", "global", "repo", "machine-repo"],
            [layer["scope"] for layer in result["layers_low_to_high"]],
        )
        provenance = result["route_provenance"]["worker"]
        self.assertEqual(machine_config["routes"]["worker"], provenance["effective"])
        self.assertEqual("machine-repo", provenance["winner"]["scope"])
        self.assertEqual(
            ["builtin", "global", "repo"],
            [item["scope"] for item in provenance["replaced"]],
        )
        self.assertEqual(
            builtin_routes()["worker"],
            provenance["replaced"][0]["row"],
        )
        self.assertEqual(
            global_config["routes"]["worker"],
            provenance["replaced"][1]["row"],
        )
        self.assertEqual(
            repo_config["routes"]["worker"],
            provenance["replaced"][2]["row"],
        )

    def test_resolve_lists_absent_layers(self):
        self.write("global", self.base_config())

        result = json.loads(
            self.run_config("resolve", "--repo", str(self.repo)).stdout
        )
        layers = result["layers_low_to_high"]
        self.assertEqual(
            list(("builtin", "global", "repo", "machine-repo")),
            [layer["scope"] for layer in layers],
        )
        self.assertEqual([True, True, False, False], [
            layer["exists"] for layer in layers
        ])
        self.assertEqual(["captain", "worker"], layers[0]["routes_defined"])
        self.assertEqual(["captain", "worker"], layers[1]["routes_defined"])
        self.assertEqual([], layers[2]["routes_defined"])
        self.assertEqual([], layers[3]["routes_defined"])

    def test_report_json_filters_routes_and_shows_override_chain(self):
        global_config = self.base_config()
        global_config["routes"]["worker.testing"] = specialist(
            "Tests.", "global-test", "global-test-model", "medium"
        )
        self.write("global", global_config)
        repo_worker = row("repo-agent", "repo-model", "high")
        self.write(
            "repo",
            {"version": 4, "routes": {"worker": repo_worker}},
            self.repo,
        )
        machine_worker = row("machine-agent", "machine-model", "ultra")
        self.write(
            "machine-repo",
            {"version": 4, "routes": {"worker": machine_worker}},
            self.repo,
        )

        report = json.loads(
            self.run_config(
                "report",
                "--repo",
                str(self.repo),
                "--route",
                "worker",
                "--format",
                "json",
            ).stdout
        )
        self.assertEqual(str(self.repo.resolve()), report["repo"])
        self.assertEqual({"worker": machine_worker}, report["config"]["routes"])
        self.assertEqual(["worker"], list(report["route_provenance"]))
        provenance = report["route_provenance"]["worker"]
        self.assertEqual(machine_worker, provenance["effective"])
        self.assertEqual("machine-repo", provenance["winner"]["scope"])
        self.assertEqual(
            ["builtin", "global", "repo"],
            [item["scope"] for item in provenance["replaced"]],
        )
        self.assertEqual(
            global_config["routes"]["worker"],
            provenance["replaced"][1]["row"],
        )
        self.assertEqual(repo_worker, provenance["replaced"][2]["row"])

    def test_report_markdown_uses_fixed_sections(self):
        self.write("global", self.base_config())
        repo_worker = row("repo-agent", "repo-model", "high")
        self.write(
            "repo",
            {
                "version": 4,
                "routes": {"worker": repo_worker},
                "preferences": ["Prefer repo-agent for repo work."],
            },
            self.repo,
        )

        report = self.run_config(
            "report",
            "--repo",
            str(self.repo),
            "--route",
            "worker",
        ).stdout
        self.assertIn("# Routing report", report)
        self.assertIn(f"**Repo:** {self.repo.resolve()}", report)
        self.assertIn(
            "**Layers (low → high):** `builtin` → `global` → `repo` → `machine-repo`",
            report,
        )
        self.assertIn(
            "| Scope | Path | Present | Routes defined | Preferences | Candidate overrides |",
            report,
        )
        self.assertRegex(
            report,
            r"\| machine-repo \| .* \| no \| — \| 0 \| — \|",
        )
        self.assertRegex(
            report,
            r"\| repo \| .* \| yes \| worker \| 1 \| — \|",
        )
        self.assertIn(
            "| worker | repo-agent | repo-model | high | repo | builtin, global |",
            report,
        )
        self.assertIn("## Detail — worker", report)
        self.assertIn("- Wins from: repo — ", report)
        self.assertIn("- Replaced:\n  - builtin — ", report)
        self.assertIn("\n  - global — ", report)
        self.assertNotIn("## Detail — captain", report)

    def test_compact_and_route_filtered_output(self):
        config = self.base_config()
        config["routes"]["worker.testing"] = specialist(
            "Tests.", "test-agent", "test-model", "high"
        )
        self.write("global", config)

        result = self.run_config(
            "resolve",
            "--repo",
            str(self.repo),
            "--compact",
            "--route",
            "worker",
            "--route",
            "worker.testing",
        )
        self.assertEqual(1, len(result.stdout.splitlines()))
        self.assertEqual(
            {
                "worker": config["routes"]["worker"],
                "worker.testing": config["routes"]["worker.testing"],
            },
            json.loads(result.stdout),
        )
        self.assertNotIn("route_sources", result.stdout)

        missing = self.run_config(
            "resolve",
            "--repo",
            str(self.repo),
            "--compact",
            "--route",
            "captain.unknown",
            ok=False,
        )
        self.assertIn("configured routes not found: captain.unknown", missing.stderr)

    def test_permissions_and_invalid_write_preserves_file(self):
        valid = self.base_config()
        global_record = self.write("global", valid)
        global_path = Path(global_record["path"])
        before = global_path.read_bytes()
        self.assertEqual(0o600, stat.S_IMODE(global_path.stat().st_mode))

        invalid = self.base_config()
        invalid["routes"]["worker"]["extra"] = "invalid"
        self.run_config("write", "global", input_value=invalid, ok=False)
        self.assertEqual(before, global_path.read_bytes())

        repo_record = self.write(
            "repo",
            {"version": 4, "routes": {"worker": row("a", "m", "e")}},
            self.repo,
        )
        self.assertEqual(
            0o644, stat.S_IMODE(Path(repo_record["path"]).stat().st_mode)
        )
        machine_record = self.write(
            "machine-repo",
            {"version": 4, "routes": {"worker": row("a", "m", "e")}},
            self.repo,
        )
        self.assertEqual(
            0o600, stat.S_IMODE(Path(machine_record["path"]).stat().st_mode)
        )

    def test_linked_worktrees_share_machine_repository_identity(self):
        tracked = self.repo / "tracked.txt"
        tracked.write_text("tracked\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(self.repo), "add", "tracked.txt"], check=True)
        subprocess.run(
            ["git", "-C", str(self.repo), "commit", "-q", "-m", "initial"],
            check=True,
        )
        linked = self.base / "linked"
        subprocess.run(
            [
                "git",
                "-C",
                str(self.repo),
                "worktree",
                "add",
                "-q",
                "-b",
                "linked-test",
                str(linked),
            ],
            check=True,
        )

        primary = json.loads(
            self.run_config(
                "read", "machine-repo", "--repo", str(self.repo)
            ).stdout
        )
        secondary = json.loads(
            self.run_config(
                "read", "machine-repo", "--repo", str(linked)
            ).stdout
        )
        self.assertEqual(primary["path"], secondary["path"])


if __name__ == "__main__":
    unittest.main()
