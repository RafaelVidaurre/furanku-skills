#!/usr/bin/env python3
"""Explicit capture launch, durable session ownership, and live controls."""

import argparse
from contextlib import contextmanager
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import subprocess
import sys
import time
import uuid

import configuration as config

try:
    import fcntl
except ImportError:
    fcntl = None


Error = config.Error
SOURCE = Path(__file__).with_name("capture.swift")


def now():
    return datetime.now().astimezone().isoformat()


@contextmanager
def locked(path):
    if fcntl is None:
        raise Error("Session controls and configuration writes require a Unix host; native capture requires macOS 15+. Configuration read/resolve remain available.")
    config.ensure_directory(Path(path).parent)
    descriptor = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(descriptor, "a") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        yield


def native_binary():
    if sys.platform != "darwin":
        raise Error("Native capture requires macOS 15 or later; no alternate recorder is substituted")
    if int(platform.mac_ver()[0].split(".")[0]) < 15:
        raise Error("Native capture requires macOS 15 or later")
    if not SOURCE.is_file():
        raise Error(f"Native capture source is unavailable: {SOURCE}")
    architecture = platform.machine()
    version = subprocess.run(["xcrun", "swiftc", "--version"], capture_output=True, text=True, timeout=15)
    if version.returncode:
        raise Error(f"Swift compiler unavailable: {version.stderr.strip()}")
    info = plistlib.dumps({
        "CFBundleIdentifier": "io.furanku.skills.human-playtest.capture",
        "CFBundleName": "Human Playtest Capture",
        "NSMicrophoneUsageDescription": "Record your spoken playtest feedback alongside the explicitly selected capture target.",
    })
    source_bytes = SOURCE.read_bytes()
    digest = hashlib.sha256(source_bytes + architecture.encode() + version.stdout.encode() + info).hexdigest()[:20]
    directory = config.home() / "cache" / "native" / digest
    binary = directory / "capture"
    with locked(directory / "build.lock"):
        if not binary.is_file():
            (directory / "Info.plist").write_bytes(info)
            snapshot = directory / "capture.swift"
            snapshot.write_bytes(source_bytes)
            temporary = directory / f"capture-{uuid.uuid4().hex}.tmp"
            command = ["xcrun", "swiftc", "-O", "-parse-as-library", "-target", f"{architecture}-apple-macos15.0", str(snapshot), "-o", str(temporary),
                       "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", str(directory / "Info.plist")]
            result = subprocess.run(command, capture_output=True, text=True, timeout=120)
            if result.returncode:
                temporary.unlink(missing_ok=True)
                raise Error(f"Native capture build failed; no fallback used:\n{result.stderr.strip()}")
            temporary.chmod(0o700)
            temporary.replace(binary)
    return binary


def list_targets(binary=None):
    binary = binary or native_binary()
    result = subprocess.run([str(binary), "targets"], capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise Error(f"Target discovery failed; no fallback used: {result.stderr.strip() or result.stdout.strip()}")
    try:
        targets = json.loads(result.stdout)
    except ValueError as error:
        raise Error("Native target discovery returned invalid JSON") from error
    if not isinstance(targets, dict) or not all(isinstance(targets.get(kind), list) for kind in ("windows", "displays")):
        raise Error("Native target discovery omitted windows or displays")
    return targets


def authorize_permission(kind):
    result = subprocess.run([str(native_binary()), f"authorize-{kind}"], capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise Error(f"{kind} permission request did not succeed: {result.stderr.strip() or result.stdout.strip()}")
    try:
        return json.loads(result.stdout)
    except ValueError as error:
        raise Error("Native permission request returned invalid JSON") from error


def exact_target(target, available):
    if target is None:
        raise Error("Choose an exact target with --window ID or --display ID after running targets")
    key = "windows" if target["type"] == "window" else "displays"
    matches = [row for row in available[key] if row.get("id") == target["id"]]
    if len(matches) != 1:
        raise Error(f"Requested {target['type']} {target['id']} is unavailable; capture was not started")
    return {"type": target["type"], **matches[0]}


def process_identity(pid):
    if type(pid) is not int or pid <= 0:
        return None
    env = {**os.environ, "LC_ALL": "C"}
    start = subprocess.run(["ps", "-p", str(pid), "-o", "lstart="], capture_output=True, text=True, env=env, timeout=5)
    command = subprocess.run(["ps", "-p", str(pid), "-o", "command="], capture_output=True, text=True, env=env, timeout=5)
    if start.returncode or command.returncode or not start.stdout.strip() or not command.stdout.strip():
        return None
    return {"pid": pid, "start_token": start.stdout.strip(), "command": command.stdout.strip()}


def owned_process(manifest):
    expected = manifest.get("process") or {}
    actual = process_identity(expected.get("pid"))
    return actual is not None and all(actual.get(field) == expected.get(field) for field in ("pid", "start_token", "command"))


def session_path(identifier):
    candidate = Path(identifier).expanduser()
    if candidate.is_dir():
        path = candidate.resolve()
    else:
        if not re.fullmatch(r"[0-9]{8}T[0-9]{6}-[a-f0-9]{12}", str(identifier)):
            raise Error("Session must be an existing directory or a session ID returned by start")
        entry = config.read_json(config.home() / "session-index" / f"{identifier}.json")
        path = Path(entry["path"]).resolve()
    manifest = config.read_json(path / "manifest.json")
    if manifest.get("version") != 1 or manifest.get("session_path") != str(path):
        raise Error("Session manifest identity does not match its directory")
    if candidate.is_dir() is False and manifest.get("session_id") != str(identifier):
        raise Error("Session registry and manifest IDs differ")
    return path, manifest


def optional_json(path):
    return config.read_json(path) if path.exists() else None


def disk_bytes(path):
    # Native files are written directly beneath the session, including screen.mov.
    # Symlinks are excluded so unrelated evidence is not counted through aliases.
    total = 0
    for child in path.rglob("*"):
        try:
            if child.is_file() and not child.is_symlink():
                total += child.stat().st_size
        except FileNotFoundError:
            # Atomic native metadata replacements may remove a temporary file
            # between listing and stat. Media files are retained in place.
            continue
    return total


def status(identifier):
    path, manifest = session_path(identifier)
    native = optional_json(path / "native-status.json")
    final = optional_json(path / "native-final.json")
    live = owned_process(manifest)
    expected_pid = (manifest.get("process") or {}).get("pid")
    for report in (native, final):
        if report is not None and report.get("pid") != expected_pid:
            raise Error("Native report PID does not match session ownership")
    if final is not None:
        state = final.get("state", "unknown")
    elif live:
        state = (native or {}).get("state", "starting")
    else:
        state = "stale_or_exited_without_finalization"
    return {"session_id": manifest["session_id"], "session_path": str(path), "state": state,
            "process_owned_and_live": live, "process": manifest.get("process"),
            "actual_bytes": disk_bytes(path), "checked_at": now(),
            "control": optional_json(path / "control.json"), "native": native, "final": final}


def start(project, overrides, wait_seconds=30):
    resolved = config.resolve(project, overrides)
    settings = resolved["settings"]
    if settings["target"] is None:
        raise Error("Choose an exact target with --window ID or --display ID after running targets")
    binary = native_binary()
    target = exact_target(settings["target"], list_targets(binary))
    session_id = datetime.now().astimezone().strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:12]
    path = Path(settings["output_root"]) / session_id
    config.ensure_directory(path.parent)
    path.mkdir(mode=0o700)
    created = datetime.now().astimezone()
    manifest = {"version": 1, "session_id": session_id, "session_path": str(path),
                "created_at": created.isoformat(), "timezone": os.environ.get("TZ") or created.tzname(),
                "project_path": resolved["project_path"], "settings": settings,
                "provenance": resolved["provenance"], "target": target,
                "media": {"video": "screen.mov"}, "state": "starting", "process": None}
    config.write_json(path / "manifest.json", manifest)
    config.write_json(path / "control.json", {"stop_reason": None, "max_seconds": settings["max_seconds"], "max_bytes": settings["max_bytes"]})
    config.write_json(config.home() / "session-index" / f"{session_id}.json", {"session_id": session_id, "path": str(path)})
    command = [str(binary), "run", "--session", str(path), "--target-type", settings["target"]["type"],
               "--target-id", str(settings["target"]["id"]), "--interval", str(settings["interval"]), "--audio", settings["audio"]]
    try:
        descriptor = os.open(path / "native.log", os.O_CREAT | os.O_WRONLY | os.O_APPEND, 0o600)
        with os.fdopen(descriptor, "a") as log:
            child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    except OSError as error:
        manifest.update(state="failed", launch_error=str(error))
        config.write_json(path / "manifest.json", manifest)
        raise Error(f"Native launch failed for session {path}: {error}") from error
    try:
        identity = process_identity(child.pid)
    except (OSError, subprocess.TimeoutExpired):
        identity = None
    manifest["process"] = {**(identity or {"pid": child.pid, "start_token": None, "command": None}), "binary": str(binary)}
    config.write_json(path / "manifest.json", manifest)
    deadline = time.monotonic() + wait_seconds
    while time.monotonic() < deadline:
        native = optional_json(path / "native-status.json")
        final = optional_json(path / "native-final.json")
        if child.poll() is not None or final is not None or (native or {}).get("state") == "failed":
            raise Error(f"Capture failed or stopped before readiness; inspect {path / 'native.log'} and native-final.json. Session: {path}")
        if native and native.get("pid") == child.pid and native.get("ready") is True and native.get("state") == "recording" and identity is not None:
            manifest["state"] = "recording"
            manifest["ready_at"] = now()
            config.write_json(path / "manifest.json", manifest)
            return status(str(path))
        time.sleep(0.1)
    # Control-file stop preserves native finalization. Never kill a process to
    # satisfy a readiness deadline or a cap update.
    with locked(path / "control.lock"):
        control = config.read_json(path / "control.json")
        control["stop_reason"] = "startup_readiness_timeout"
        config.write_json(path / "control.json", control)
    raise Error(f"Capture did not become ready within {wait_seconds}s; graceful stop requested. No process killed. Inspect status for session {path}")


def update_control(identifier, patch):
    path, manifest = session_path(identifier)
    unknown = set(patch) - {"max_seconds", "max_bytes", "stop_reason"}
    if unknown:
        raise Error("Only max_seconds, max_bytes and stop_reason can change live")
    config.validate_settings({key: value for key, value in patch.items() if key != "stop_reason"})
    if "stop_reason" in patch and (not isinstance(patch["stop_reason"], str) or not patch["stop_reason"].strip()):
        raise Error("A stop request needs a nonempty reason; it cannot be reset")
    with locked(path / "control.lock"):
        if (path / "native-final.json").exists():
            raise Error("Session is already finalized; its controls were not modified")
        if not owned_process(manifest):
            raise Error("Session process is absent or its ownership token changed; control was not modified and no process was signaled")
        control = config.read_json(path / "control.json")
        if control.get("stop_reason") and "stop_reason" in patch:
            patch = {key: value for key, value in patch.items() if key != "stop_reason"}
        control.update(patch)
        config.write_json(path / "control.json", control)
    return status(str(path))


def stop(identifier, wait_seconds=30):
    current = status(identifier)
    if current["final"] is not None:
        return {**current, "stop_complete": True}
    update_control(identifier, {"stop_reason": "user_requested"})
    deadline = time.monotonic() + wait_seconds
    while time.monotonic() < deadline:
        current = status(identifier)
        if current["final"] is not None:
            return {**current, "stop_complete": True}
        if not current["process_owned_and_live"]:
            break
        time.sleep(0.2)
    return {**status(identifier), "stop_complete": False,
            "message": "Graceful stop requested; finalization is not confirmed. Evidence retained; no forced termination."}


def cap_value(value, integer=False):
    if value.lower() in ("none", "null"):
        return None
    try:
        result = int(value) if integer else float(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("Use a positive number or none") from error
    return result


def setting_arguments(parser):
    target = parser.add_mutually_exclusive_group()
    target.add_argument("--window", type=int)
    target.add_argument("--display", type=int)
    parser.add_argument("--interval", type=float)
    parser.add_argument("--audio", choices=("microphone", "none"))
    parser.add_argument("--max-seconds", type=cap_value, default=argparse.SUPPRESS)
    parser.add_argument("--max-bytes", type=lambda value: cap_value(value, True), default=argparse.SUPPRESS)
    parser.add_argument("--output-root")


def overrides_from(args):
    values = vars(args)
    result = {key: values[key] for key in ("max_seconds", "max_bytes") if key in values}
    result.update({key: values[key] for key in ("interval", "audio", "output_root") if values.get(key) is not None})
    for kind in ("window", "display"):
        if values.get(kind) is not None:
            result["target"] = {"type": kind, "id": values[kind]}
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("targets")
    permission = commands.add_parser("permissions", help="Explicitly request OS permission; does not start recording")
    permission.add_argument("kind", choices=("screen", "microphone"))
    launch = commands.add_parser("start", help="Start only when the user authorized recording the chosen target/audio")
    launch.add_argument("--path", default=".")
    launch.add_argument("--wait-seconds", type=float, default=30)
    setting_arguments(launch)
    for name in ("status", "stop", "limits"):
        command = commands.add_parser(name)
        command.add_argument("session")
        if name == "stop":
            command.add_argument("--wait-seconds", type=float, default=30)
        if name == "limits":
            command.add_argument("--max-seconds", type=cap_value, default=argparse.SUPPRESS)
            command.add_argument("--max-bytes", type=lambda value: cap_value(value, True), default=argparse.SUPPRESS)
    config_parser = commands.add_parser("config")
    config_commands = config_parser.add_subparsers(dest="config_command", required=True)
    for name in ("read", "write"):
        command = config_commands.add_parser(name)
        command.add_argument("--scope")
        if name == "write":
            command.add_argument("--file", default="-")
    resolved = config_commands.add_parser("resolve")
    resolved.add_argument("--path", default=".")
    setting_arguments(resolved)
    args = parser.parse_args(argv)
    try:
        if hasattr(args, "wait_seconds"):
            config.positive_number(args.wait_seconds, "wait_seconds")
            if args.wait_seconds > 60:
                raise Error("wait_seconds must be at most 60")
        if args.command == "targets":
            result = list_targets()
        elif args.command == "permissions":
            result = authorize_permission(args.kind)
        elif args.command == "start":
            result = start(args.path, overrides_from(args), args.wait_seconds)
        elif args.command == "status":
            result = status(args.session)
        elif args.command == "stop":
            result = stop(args.session, args.wait_seconds)
        elif args.command == "limits":
            patch = overrides_from(args)
            if not patch:
                raise Error("limits needs --max-seconds and/or --max-bytes; none disables that cap")
            result = update_control(args.session, patch)
        elif args.config_command == "resolve":
            result = config.resolve(args.path, overrides_from(args))
        elif args.config_command == "read":
            result = config.load()
            if args.scope:
                scope = str(Path(args.scope).expanduser().resolve())
                result = next((entry for entry in result["scopes"] if str(config.scope_path(entry["path"])) == scope), {"path": scope, "settings": {}})
        else:
            settings = json.load(sys.stdin) if args.file == "-" else config.read_json(args.file)
            with locked(config.home() / "config.lock"):
                result = config.write_layer(settings, args.scope)
        print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
        return 2 if result.get("stop_complete") is False else 0
    except (Error, OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
