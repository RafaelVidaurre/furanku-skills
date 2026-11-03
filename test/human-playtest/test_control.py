#!/usr/bin/env python3
"""Hermetic config and lifecycle tests. Never opens a capture or microphone."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "skills/human-playtest/scripts"))

import configuration as config
import playtest


class ControlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.environment = patch.dict(os.environ, {
            "HOME": str(self.root / "home"),
            "CODEX_HOME": str(self.root / "codex"),
            "FURANKU_SKILLS_HOME": str(self.root / "machine"),
        })
        self.environment.start()
        self.project = self.root / "projects" / "app"
        self.project.mkdir(parents=True)

    def tearDown(self):
        self.environment.stop()
        self.temp.cleanup()

    def fixture_session(self):
        path = self.root / "session"
        path.mkdir()
        identity = {"pid": 424242, "start_token": "fixture-start", "command": "fixture capture run --session fixture"}
        manifest = {"version": 1, "session_id": "20260101T000000-abcdef123456", "session_path": str(path), "process": identity}
        config.write_json(path / "manifest.json", manifest)
        config.write_json(path / "control.json", {"max_seconds": 3600, "max_bytes": 2147483648, "stop_reason": None})
        config.write_json(path / "native-status.json", {"pid": identity["pid"], "state": "recording", "ready": True})
        return path, identity

    def test_scopes_inherit_broad_to_specific_and_invocation_wins(self):
        nested = self.project / "subproject"
        nested.mkdir()
        config.write_layer({"interval": 1, "max_seconds": 120, "audio": "none"})
        config.write_layer({"max_bytes": 10000, "max_seconds": None}, self.root / "projects")
        config.write_layer({"interval": 0.5}, self.project)
        config.write_layer({"audio": "microphone"}, nested)
        config.write_layer({"interval": 99}, self.root / "project")
        result = config.resolve(nested, {"interval": 0.25})
        self.assertEqual(result["settings"]["interval"], 0.25)
        self.assertIsNone(result["settings"]["max_seconds"])
        self.assertEqual(result["settings"]["max_bytes"], 10000)
        self.assertEqual(result["settings"]["audio"], "microphone")
        self.assertEqual([row["layer"] for row in result["provenance"]["interval"]], ["defaults", "global", "path", "invocation"])
        self.assertFalse((self.project / ".furanku-skills").exists())

    def test_absent_inherits_but_null_disables_only_its_cap(self):
        config.write_layer({"max_seconds": 90, "max_bytes": 1234})
        inherited = config.resolve(self.project, {"interval": 1})["settings"]
        disabled = config.resolve(self.project, {"max_bytes": None})["settings"]
        self.assertEqual(inherited["max_bytes"], 1234)
        self.assertEqual(disabled["max_seconds"], 90)
        self.assertIsNone(disabled["max_bytes"])

    def test_invalid_settings_are_rejected_without_replacing_config(self):
        config.write_layer({"audio": "none"})
        path = config.home() / "config.json"
        before = path.read_bytes()
        invalid = [
            {"interval": 0}, {"interval": float("nan")}, {"interval": float("inf")},
            {"interval": True}, {"interval": None}, {"max_seconds": -1}, {"max_seconds": 10 ** 500},
            {"max_bytes": 1.5}, {"max_bytes": False}, {"max_bytes": 2 ** 63}, {"audio": "system"},
            {"unexpected": 1}, {"target": {"type": "window", "id": True}},
            {"target": {"type": "window", "id": 1, "fallback": "display"}},
            {"output_root": "relative"},
        ]
        for settings in invalid:
            with self.subTest(settings=settings), self.assertRaises(config.Error):
                config.write_layer(settings)
            self.assertEqual(before, path.read_bytes())

    def test_document_rejects_unknown_duplicate_and_relative_scopes(self):
        base = {"version": 1, "settings": {}, "scopes": []}
        invalid = [
            {**base, "unknown": 1},
            {**base, "scopes": [{"path": "relative", "settings": {}}]},
            {**base, "scopes": [{"path": str(self.project), "settings": {}}] * 2},
        ]
        for document in invalid:
            with self.assertRaises(config.Error):
                config.validate_document(document)

    def test_cli_config_round_trip_is_machine_local(self):
        command = [sys.executable, str(Path(playtest.__file__)), "config"]
        written = subprocess.run(command + ["write", "--scope", str(self.project)], input='{"max_bytes": null, "audio": "none"}', text=True, capture_output=True, check=True)
        self.assertEqual(json.loads(written.stdout)["scopes"][0]["path"], str(self.project))
        resolved = subprocess.run(command + ["resolve", "--path", str(self.project), "--max-seconds", "none"], text=True, capture_output=True, check=True)
        settings = json.loads(resolved.stdout)["settings"]
        self.assertIsNone(settings["max_bytes"])
        self.assertIsNone(settings["max_seconds"])
        self.assertEqual(settings["audio"], "none")

    def test_stale_pid_refuses_controls_without_signaling(self):
        path, identity = self.fixture_session()
        before = (path / "control.json").read_bytes()
        reused = {**identity, "start_token": "another-process-start"}
        with patch.object(playtest, "process_identity", return_value=reused), patch.object(os, "kill") as signal:
            with self.assertRaisesRegex(config.Error, "ownership token"):
                playtest.update_control(str(path), {"max_bytes": None})
            state = playtest.status(str(path))
            self.assertEqual(state["state"], "stale_or_exited_without_finalization")
            signal.assert_not_called()
        self.assertEqual(before, (path / "control.json").read_bytes())

    def test_live_cap_change_preserves_process_and_other_cap(self):
        path, identity = self.fixture_session()
        before = (path / "manifest.json").read_bytes()
        with patch.object(playtest, "process_identity", return_value=identity), patch.object(subprocess, "Popen") as launch, patch.object(os, "kill") as signal:
            state = playtest.update_control(str(path), {"max_bytes": None})
            self.assertIsNone(state["control"]["max_bytes"])
            self.assertEqual(state["control"]["max_seconds"], 3600)
            self.assertEqual(state["process"], identity)
            launch.assert_not_called()
            signal.assert_not_called()
        self.assertEqual(before, (path / "manifest.json").read_bytes())

    def test_graceful_stop_timeout_retains_media_and_request(self):
        path, identity = self.fixture_session()
        (path / "screen.mov").write_bytes(b"owned evidence")
        with patch.object(playtest, "process_identity", return_value=identity), patch.object(os, "kill") as signal:
            state = playtest.stop(str(path), wait_seconds=0)
            self.assertFalse(state["stop_complete"])
            self.assertEqual(state["control"]["stop_reason"], "user_requested")
            signal.assert_not_called()
        self.assertEqual((path / "screen.mov").read_bytes(), b"owned evidence")

    def test_finalized_session_stop_is_idempotent_even_after_process_exit(self):
        path, identity = self.fixture_session()
        config.write_json(path / "native-final.json", {"pid": identity["pid"], "state": "stopped"})
        with patch.object(playtest, "process_identity", return_value=None):
            self.assertTrue(playtest.stop(str(path))["stop_complete"])

    def test_start_requires_available_exact_target_before_launch(self):
        with patch.object(playtest, "native_binary", return_value=self.root / "capture"), patch.object(playtest, "list_targets", return_value={"windows": [{"id": 9}], "displays": [{"id": 1}]}), patch.object(subprocess, "Popen") as launch:
            with self.assertRaisesRegex(config.Error, "unavailable"):
                playtest.start(self.project, {"target": {"type": "window", "id": 10}})
            launch.assert_not_called()

    def test_start_records_owned_process_and_only_returns_after_native_ready(self):
        binary = self.root / "capture"
        identity = {"pid": 424242, "start_token": "fixture-start", "command": "fixture-owned-command"}
        child = Mock(pid=identity["pid"])
        child.poll.return_value = None

        def launched(command, **kwargs):
            self.assertTrue(kwargs["start_new_session"])
            session = Path(command[command.index("--session") + 1])
            config.write_json(session / "native-status.json", {"pid": identity["pid"], "state": "recording", "ready": True})
            (session / "screen.mov").write_bytes(b"native-owned-file")
            return child

        with patch.object(playtest, "native_binary", return_value=binary), patch.object(playtest, "list_targets", return_value={"windows": [{"id": 9, "title": "Fixture"}], "displays": []}), patch.object(subprocess, "Popen", side_effect=launched), patch.object(playtest, "process_identity", return_value=identity):
            result = playtest.start(self.project, {"target": {"type": "window", "id": 9}, "audio": "none"})
            self.assertEqual(result["state"], "recording")
            self.assertTrue(result["process_owned_and_live"])
            self.assertGreater(result["actual_bytes"], len(b"native-owned-file"))
            resolved_path, manifest = playtest.session_path(result["session_id"])
            self.assertEqual(str(resolved_path), result["session_path"])
            self.assertEqual(manifest["settings"]["audio"], "none")
            self.assertEqual(manifest["process"]["start_token"], "fixture-start")

    def test_start_readiness_timeout_requests_stop_without_killing(self):
        identity = {"pid": 424242, "start_token": "fixture-start", "command": "fixture-owned-command"}
        child = Mock(pid=identity["pid"])
        child.poll.return_value = None
        with patch.object(playtest, "native_binary", return_value=self.root / "capture"), patch.object(playtest, "list_targets", return_value={"windows": [{"id": 9}], "displays": []}), patch.object(subprocess, "Popen", return_value=child), patch.object(playtest, "process_identity", return_value=identity), patch.object(os, "kill") as signal:
            with self.assertRaisesRegex(config.Error, "graceful stop requested"):
                playtest.start(self.project, {"target": {"type": "window", "id": 9}, "audio": "none"}, wait_seconds=0)
            session = next((config.home() / "sessions").iterdir())
            self.assertEqual(config.read_json(session / "control.json")["stop_reason"], "startup_readiness_timeout")
            child.kill.assert_not_called()
            child.terminate.assert_not_called()
            signal.assert_not_called()

    def test_unsupported_locking_reports_a_clear_error(self):
        with patch.object(playtest, "fcntl", None):
            with self.assertRaisesRegex(config.Error, "require a Unix host"):
                with playtest.locked(self.root / "unused.lock"):
                    self.fail("unsupported locking should not enter")


if __name__ == "__main__":
    unittest.main()
