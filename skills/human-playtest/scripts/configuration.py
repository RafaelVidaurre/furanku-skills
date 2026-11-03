#!/usr/bin/env python3
"""Machine-local, path-scoped configuration for human-playtest."""

import json
import math
import os
from pathlib import Path
import tempfile


class Error(Exception):
    pass


FIELDS = {"interval", "max_seconds", "max_bytes", "audio", "target", "output_root"}


def home():
    base = os.environ.get("FURANKU_SKILLS_HOME")
    return (Path(base).expanduser() if base else Path.home() / ".furanku-skills").resolve() / "human-playtest"


def defaults():
    return {
        "interval": 0.25,
        "max_seconds": 3600,
        "max_bytes": 2147483648,
        "audio": "microphone",
        "target": None,
        "output_root": str(home() / "sessions"),
    }


def ensure_directory(path):
    path = Path(path)
    missing = []
    current = path
    while not current.exists():
        missing.append(current)
        current = current.parent
    for directory in reversed(missing):
        directory.mkdir(mode=0o700, exist_ok=True)
    return path


def write_json(path, value):
    path = Path(path)
    ensure_directory(path.parent)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(value, stream, indent=2, ensure_ascii=False, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def read_json(path):
    try:
        with Path(path).open(encoding="utf-8") as stream:
            return json.load(stream)
    except (ValueError, OSError) as error:
        raise Error(f"Cannot read JSON at {path}: {error}") from error


def positive_number(value, label):
    try:
        finite = type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        finite = False
    if not finite or value <= 0:
        raise Error(f"{label} must be a positive finite number")


def validate_settings(settings):
    if not isinstance(settings, dict):
        raise Error("Settings must be an object")
    unknown = set(settings) - FIELDS
    if unknown:
        raise Error(f"Unknown settings fields: {', '.join(sorted(unknown))}")
    for field in ("interval", "max_seconds"):
        if field in settings:
            if field == "max_seconds" and settings[field] is None:
                continue
            positive_number(settings[field], field)
    if "max_bytes" in settings and settings["max_bytes"] is not None:
        value = settings["max_bytes"]
        if type(value) is not int or not 0 < value <= 9223372036854775807:
            raise Error("max_bytes must be a positive signed 64-bit integer or null")
    if "audio" in settings and settings["audio"] not in ("microphone", "none"):
        raise Error("audio must be microphone or none")
    if "output_root" in settings:
        value = settings["output_root"]
        if not isinstance(value, str) or not value or not Path(value).expanduser().is_absolute():
            raise Error("output_root must be an absolute path")
    target = settings.get("target")
    if target is not None:
        if not isinstance(target, dict) or set(target) != {"type", "id"}:
            raise Error("target must contain only type and id, or be null")
        if target["type"] not in ("window", "display") or type(target["id"]) is not int or target["id"] <= 0:
            raise Error("target requires type window|display and a positive integer id")
    return settings


def scope_path(value):
    value = Path(value).expanduser()
    if not value.is_absolute():
        raise Error("Stored scope paths must be absolute")
    return value.resolve()


def validate_document(document):
    if not isinstance(document, dict) or set(document) != {"version", "settings", "scopes"}:
        raise Error("Configuration requires only version, settings and scopes")
    if type(document["version"]) is not int or document["version"] != 1:
        raise Error("Configuration version must be 1")
    validate_settings(document["settings"])
    if not isinstance(document["scopes"], list):
        raise Error("scopes must be an array")
    seen = set()
    for entry in document["scopes"]:
        if not isinstance(entry, dict) or set(entry) != {"path", "settings"} or not isinstance(entry["path"], str):
            raise Error("Each scope requires only path and settings")
        path = str(scope_path(entry["path"]))
        if path in seen:
            raise Error(f"Duplicate scope path: {path}")
        seen.add(path)
        validate_settings(entry["settings"])
    return document


def load():
    path = home() / "config.json"
    if not path.exists():
        return {"version": 1, "settings": {}, "scopes": []}
    return validate_document(read_json(path))


def write_layer(settings, scope=None):
    validate_settings(settings)
    document = load()
    if scope is None:
        document["settings"] = dict(settings)
    else:
        path = str(Path(scope).expanduser().resolve())
        document["scopes"] = [entry for entry in document["scopes"] if str(scope_path(entry["path"])) != path]
        document["scopes"].append({"path": path, "settings": dict(settings)})
        document["scopes"].sort(key=lambda entry: entry["path"])
    validate_document(document)
    write_json(home() / "config.json", document)
    return document


def resolve(path=".", overrides=None):
    project = Path(path).expanduser().resolve()
    if not project.is_dir():
        raise Error(f"Project path must be an existing directory: {project}")
    document = load()
    overrides = validate_settings(overrides or {})
    layers = [("defaults", None, defaults()), ("global", str(home() / "config.json"), document["settings"])]
    matching = [entry for entry in document["scopes"] if project.is_relative_to(scope_path(entry["path"]))]
    for entry in sorted(matching, key=lambda entry: len(scope_path(entry["path"]).parts)):
        layers.append(("path", str(scope_path(entry["path"])), entry["settings"]))
    layers.append(("invocation", None, overrides))
    effective, provenance = {}, {}
    for kind, source, settings in layers:
        for field, value in settings.items():
            effective[field] = value
            provenance.setdefault(field, []).append({"layer": kind, "source": source, "value": value})
    effective["output_root"] = str(Path(effective["output_root"]).expanduser().resolve())
    return {"project_path": str(project), "settings": effective, "provenance": provenance,
            "config_path": str(home() / "config.json")}
