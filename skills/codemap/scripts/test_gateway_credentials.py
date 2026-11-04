"""Real filesystem and CLI credential compatibility, isolated from user config and providers."""

import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gateway_credentials as credentials
import jev_client


class GatewayCredentialsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        environment = mock.patch.dict(os.environ, {"HOME": str(self.home), "CODEX_HOME": str(self.home / "codex")}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)

    def legacy_key(self, key="legacy-secret"):
        path = credentials.legacy_credential_path()
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({"AI_GATEWAY_API_KEY": key}))
        path.chmod(0o600)
        return path

    def cli(self, *args, input=None):
        return subprocess.run([sys.executable, credentials.__file__, *args], input=input, text=True,
                              capture_output=True, env=dict(os.environ), cwd=self.home)

    def test_legacy_key_is_read_without_migration_or_model_routing_install(self):
        path = self.legacy_key()
        original = path.read_bytes()
        self.assertEqual(jev_client.load_key(), "legacy-secret")
        result = self.cli("status")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["source"], "legacy-machine")
        self.assertNotIn("legacy-secret", result.stdout + result.stderr)
        self.assertFalse(credentials.credential_path().exists())
        self.assertEqual(path.read_bytes(), original)

    def test_setup_repeats_safely_in_codemap_and_preserves_legacy_key(self):
        legacy = self.legacy_key()
        original = legacy.read_bytes()
        for _ in range(2):
            result = self.cli("setup", "--stdin", input="codemap-secret\n")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["authentication"], "not-tested")
            self.assertNotIn("codemap-secret", result.stdout + result.stderr)
        self.assertEqual(jev_client.load_key(), "codemap-secret")
        self.assertEqual(credentials.key_source(), "machine")
        path = credentials.credential_path()
        self.assertEqual(list(path.parent.iterdir()), [path])
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)
        self.assertEqual(legacy.read_bytes(), original)
        with mock.patch.dict(os.environ, {"AI_GATEWAY_API_KEY": "process-secret"}):
            self.assertEqual(jev_client.load_key(), "process-secret")
            self.assertEqual(credentials.key_source(), "environment")

    def test_invalid_input_preserves_previous_key_without_echoing_input(self):
        credentials.store_key("previous-secret")
        before = credentials.credential_path().read_bytes()
        for invalid in ("", "secret with-whitespace", "x" * 8193):
            result = self.cli("setup", "--stdin", input=invalid)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(result.stderr)["status"], "error")
            if invalid:
                self.assertNotIn(invalid, result.stdout + result.stderr)
            self.assertEqual(credentials.credential_path().read_bytes(), before)

    def test_broken_codemap_credential_is_reported_instead_of_using_legacy(self):
        self.legacy_key()
        path = credentials.store_key("codemap-secret")
        path.write_text("malformed-secret")
        with self.assertRaises(credentials.Error) as caught:
            jev_client.load_key()
        self.assertNotIn("malformed-secret", str(caught.exception))
        path.chmod(0o644)
        with self.assertRaisesRegex(credentials.Error, "mode 600"):
            jev_client.load_key()

    def test_legacy_compatibility_keeps_permission_and_link_guards(self):
        path = self.legacy_key()
        path.chmod(0o644)
        with self.assertRaisesRegex(credentials.Error, "mode 600"):
            jev_client.load_key()
        path.chmod(0o600)
        path.rename(path.with_suffix(".original"))
        path.symlink_to(path.with_suffix(".original"))
        with self.assertRaisesRegex(credentials.Error, "regular file"):
            jev_client.load_key()

    def test_failed_atomic_replace_preserves_key_and_removes_temporary_secret(self):
        path = credentials.store_key("previous-secret")
        before = path.read_bytes()
        with mock.patch.object(credentials.os, "replace", side_effect=OSError("synthetic failure")):
            with self.assertRaises(OSError):
                credentials.store_key("replacement-secret")
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(list(path.parent.iterdir()), [path])

    def test_linked_storage_is_refused_without_modifying_target(self):
        target = self.home / "target"
        target.mkdir()
        path = credentials.credential_path()
        path.parent.parent.mkdir(parents=True)
        path.parent.symlink_to(target)
        result = self.cli("setup", "--stdin", input="secret\n")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(list(target.iterdir()), [])
        with self.assertRaises(credentials.Error):
            jev_client.load_key()

    def test_hidden_prompt_failure_preserves_credential_and_noninteractive_requires_stdin_flag(self):
        credentials.store_key("previous-secret")
        with mock.patch.object(credentials.sys.stdin, "isatty", return_value=True), \
                mock.patch.object(credentials.getpass, "getpass", side_effect=credentials.getpass.GetPassWarning):
            with self.assertRaisesRegex(credentials.Error, "Hidden key entry is unavailable"):
                credentials.setup()
        with mock.patch.object(credentials.sys, "stdin", io.StringIO("secret")):
            with self.assertRaisesRegex(credentials.Error, "hidden prompt"):
                credentials.setup()
        self.assertEqual(credentials.load_key(), "previous-secret")


if __name__ == "__main__":
    unittest.main()
