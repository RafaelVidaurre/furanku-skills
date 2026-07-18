#!/usr/bin/env python3
"""Read, write, delete, and resolve Commander routing configuration."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


BASE = ("commander", "captain", "worker")
SCOPES = ("global", "repo", "machine-repo")
ROUTE_ID = re.compile(r"^(commander|captain|worker)(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$")


class Error(Exception):
    pass


def git(repo, *args):
    result = subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, check=False
    )
    if result.returncode:
        raise Error(result.stderr.strip() or result.stdout.strip() or "git failed")
    return result.stdout.strip()


def repo_info(repo):
    root = Path(git(Path(repo).expanduser().resolve(), "rev-parse", "--show-toplevel"))
    raw = Path(git(root, "rev-parse", "--git-common-dir"))
    common = (root / raw).resolve() if not raw.is_absolute() else raw.resolve()
    return root.resolve(), common


def locations(repo=None):
    home = Path.home()
    base = home / ".furanku-skills" / "commander"
    paths = {"global": base / "config.json"}
    if repo is not None:
        root, common = repo_info(repo)
        digest = hashlib.sha256(str(common).encode()).hexdigest()
        label_from = common.parent.name if common.name == ".git" else common.name
        label = re.sub(r"[^a-z0-9]+", "-", label_from.lower()).strip("-") or "repo"
        paths.update(
            {
                "repo": root / ".furanku-skills" / "commander" / "config.json",
                "machine-repo": base / "repos" / f"{label}-{digest[:16]}.json",
            }
        )
    return paths


def parse_json(stream, source):
    try:
        config = json.load(stream)
    except json.JSONDecodeError as error:
        raise Error(f"invalid JSON in {source}: {error}") from error
    if not isinstance(config, dict):
        raise Error(f"{source} must contain a JSON object")
    return config


def validate_schema(config, require_base, source):
    if set(config) != {"version", "routes"} or config.get("version") != 1:
        raise Error(f"{source} must contain only version 1 and routes")
    routes = config.get("routes")
    if not isinstance(routes, dict) or not routes:
        raise Error(f"{source} routes must be a non-empty object")
    missing = [route for route in BASE if route not in routes]
    if require_base and missing:
        raise Error(f"{source} is missing base routes: {', '.join(missing)}")
    for route_id, row in routes.items():
        if not ROUTE_ID.fullmatch(route_id) or not isinstance(row, dict):
            raise Error(f"invalid route {route_id!r} in {source}")
        fields = {"agent", "model", "effort"}
        if route_id not in BASE:
            fields.add("work")
        if set(row) != fields:
            raise Error(
                f"route {route_id!r} in {source} requires: {', '.join(sorted(fields))}"
            )
        if any(
            not isinstance(value, str) or not value.strip() for value in row.values()
        ):
            raise Error(f"route {route_id!r} in {source} has an empty value")


def load(path, require_base=False):
    with path.open(encoding="utf-8") as stream:
        config = parse_json(stream, str(path))
    validate_schema(config, require_base, str(path))
    return config


def ordered(routes):
    keys = [route for route in BASE if route in routes]
    keys += sorted(route for route in routes if route not in BASE)
    return {route: routes[route] for route in keys}


def record(scope, path):
    return {
        "scope": scope,
        "path": str(path),
        "exists": path.exists(),
        "config": load(path, scope == "global") if path.exists() else None,
    }


def resolve(paths):
    if not paths["global"].exists():
        raise Error(f"required global config is missing: {paths['global']}")
    routes, sources, layers = {}, {}, []
    for scope in SCOPES:
        path = paths[scope]
        if not path.exists():
            continue
        config = load(path, scope == "global")
        layers.append({"scope": scope, "path": str(path)})
        for route, row in config["routes"].items():
            routes[route] = row
            sources[route] = {"scope": scope, "path": str(path)}
    config = {"version": 1, "routes": ordered(routes)}
    validate_schema(config, True, "resolved configuration")
    return {
        "config": config,
        "route_sources": {route: sources[route] for route in config["routes"]},
        "layers_low_to_high": layers,
    }


def save(path, config, private):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(descriptor, 0o600 if private else 0o644)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(config, stream, indent=2, ensure_ascii=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def emit(value):
    json.dump(value, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command", choices=("template", "read", "resolve", "write", "delete")
    )
    parser.add_argument("scope", nargs="?", choices=(*SCOPES, "all"))
    parser.add_argument("--repo", default=".")
    parser.add_argument("--file", default="-", help="JSON file, or - for stdin")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()
    if args.command in {"read", "write", "delete"} and args.scope is None:
        parser.error(f"{args.command} requires a scope")
    if args.command != "read" and args.scope == "all":
        parser.error("scope 'all' is valid only for read")
    if args.command in {"template", "resolve"} and args.scope is not None:
        parser.error(f"{args.command} does not take a scope")
    return args


def main():
    args = arguments()
    try:
        if args.command == "template":
            emit(
                {
                    "version": 1,
                    "routes": {
                        route: {"agent": None, "model": None, "effort": None}
                        for route in BASE
                    },
                }
            )
            return

        needs_repo = args.command == "resolve" or args.scope in {
            "repo",
            "machine-repo",
            "all",
        }
        paths = locations(args.repo if needs_repo else None)
        if args.command == "read":
            if args.scope == "all":
                emit({"layers": [record(scope, paths[scope]) for scope in SCOPES]})
            else:
                emit(record(args.scope, paths[args.scope]))
        elif args.command == "resolve":
            emit(resolve(paths))
        elif args.command == "write":
            if args.file == "-":
                config = parse_json(sys.stdin, "stdin")
            else:
                with Path(args.file).expanduser().open(encoding="utf-8") as stream:
                    config = parse_json(stream, args.file)
            validate_schema(config, args.scope == "global", args.file)
            config["routes"] = ordered(config["routes"])
            save(paths[args.scope], config, args.scope != "repo")
            emit(record(args.scope, paths[args.scope]))
        elif args.command == "delete":
            if not args.yes:
                raise Error("delete requires --yes after user confirmation")
            path = paths[args.scope]
            existed = path.exists()
            if existed:
                path.unlink()
            emit({"scope": args.scope, "path": str(path), "deleted": existed})
    except (Error, OSError) as error:
        print(f"commander-config: {error}", file=sys.stderr)
        raise SystemExit(2 if "required global config is missing" in str(error) else 1)


if __name__ == "__main__":
    main()
