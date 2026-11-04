#!/usr/bin/env python3
"""Set up Codemap's Gateway credential without contacting the provider."""

from __future__ import annotations

import argparse
import getpass
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import warnings


SETUP_HINT = "set AI_GATEWAY_API_KEY or run python3 <codemap skill dir>/scripts/gateway_credentials.py setup"


class Error(Exception):
    """An actionable diagnostic containing no credential content."""


def credential_path():
    return Path.home() / ".furanku-skills/codemap/secrets/gateway.json"


def legacy_credential_path():
    """Read compatibility for credentials saved before Codemap owned setup."""
    return Path.home() / ".furanku-skills/model-routing/secrets/gateway.json"


def valid_key(value):
    if not isinstance(value, str) or not value or len(value) > 8192:
        raise Error("The AI Gateway API key is empty or malformed; " + SETUP_HINT + ".")
    if any(ord(c) < 33 or ord(c) > 126 for c in value):
        raise Error("The AI Gateway API key must be a single token without whitespace; " + SETUP_HINT + ".")
    return value


def _check_storage(path):
    for directory in (path.parent, path.parent.parent, path.parent.parent.parent):
        if directory.is_symlink() or (directory.exists() and not directory.is_dir()):
            raise Error("Gateway credential storage must be a regular file and directory; " + SETUP_HINT + ".")
    if path.is_symlink():
        raise Error("Gateway credential storage must be a regular file and directory; " + SETUP_HINT + ".")


def _saved_path():
    path = credential_path()
    _check_storage(path)
    return path if path.exists() else legacy_credential_path()


def saved_key():
    path = _saved_path()
    _check_storage(path)
    try:
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > 16384:
            raise Error("Invalid Gateway credential file; " + SETUP_HINT + ".")
        if os.name == "posix" and (info.st_mode & 0o077 or info.st_uid != os.getuid()):
            raise Error("Gateway credential must be owned by you with mode 600; " + SETUP_HINT + ".")
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise Error("Gateway key is missing; " + SETUP_HINT + ".") from None
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise Error("Cannot read the Gateway credential; " + SETUP_HINT + ".") from None
    if not isinstance(data, dict):
        raise Error("Invalid Gateway credential file; " + SETUP_HINT + ".")
    return valid_key(data.get("AI_GATEWAY_API_KEY"))


def key_source():
    if "AI_GATEWAY_API_KEY" in os.environ:
        return "environment"
    return "machine" if _saved_path() == credential_path() else "legacy-machine"


def load_key():
    if "AI_GATEWAY_API_KEY" in os.environ:
        return valid_key(os.environ["AI_GATEWAY_API_KEY"])
    return saved_key()


def store_key(key):
    key = valid_key(key)
    path = credential_path()
    _check_storage(path)
    if path.exists() and not path.is_file():
        raise Error("Gateway credential storage must be a regular file and directory; " + SETUP_HINT + ".")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.parent.chmod(0o700)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            os.fchmod(stream.fileno(), 0o600)
            json.dump({"AI_GATEWAY_API_KEY": key}, stream)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return path


def setup(from_stdin=False):
    if from_stdin:
        key = sys.stdin.read(8194).rstrip("\r\n")
    else:
        if not sys.stdin.isatty():
            raise Error("Run setup in your terminal to paste the key at a hidden prompt; secret managers can use setup --stdin.")
        print(f"Save your Vercel AI Gateway key for Codemap at {credential_path()}", file=sys.stderr)
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            try:
                key = getpass.getpass("AI Gateway API key: ")
            except (getpass.GetPassWarning, EOFError):
                raise Error("Hidden key entry is unavailable; use an interactive terminal or setup --stdin.") from None
    return {"status": "saved", "path": str(store_key(key)), "authentication": "not-tested"}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    setup_parser = commands.add_parser("setup", help="save a user-provided Codemap key")
    setup_parser.add_argument("--stdin", action="store_true", help="read a key from a secret-manager pipe")
    commands.add_parser("status", help="report credential readiness without a provider request")
    args = parser.parse_args(argv)
    try:
        if args.command == "setup":
            result = setup(args.stdin)
        else:
            load_key()
            result = {"status": "configured", "source": key_source(), "authentication": "not-tested"}
        print(json.dumps(result, indent=2))
        return 0
    except Error as exc:
        print(json.dumps({"status": "error", "error": str(exc)}), file=sys.stderr)
        return 1
    except (OSError, ValueError, UnicodeError):
        print('{"status":"error","error":"Cannot read or write the credential file."}', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('{"status":"cancelled"}', file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
