#!/usr/bin/env python3
"""Read, write, migrate, resolve, and report Commander routing configuration."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile


VERSION = 2
BASE = ("captain", "worker")
LEGACY_BASE = ("commander", "captain", "worker")
SCOPES = ("global", "repo", "machine-repo")
ROUTE_ID = re.compile(
    r"^(?:captain|worker)(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$"
)
LEGACY_ROUTE_ID = re.compile(
    r"^(?:commander|captain|worker)(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$"
)


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


def validate_rows(
    config, require_base, source, version, base, route_pattern, allow_empty=False
):
    if (
        set(config) != {"version", "routes"}
        or type(config.get("version")) is not int
        or config.get("version") != version
    ):
        raise Error(f"{source} must contain only version {version} and routes")
    routes = config.get("routes")
    if not isinstance(routes, dict) or (not routes and not allow_empty):
        raise Error(f"{source} routes must be a non-empty object")
    missing = [route for route in base if route not in routes]
    if require_base and missing:
        raise Error(f"{source} is missing base routes: {', '.join(missing)}")
    for route_id, row in routes.items():
        if not route_pattern.fullmatch(route_id) or not isinstance(row, dict):
            raise Error(f"invalid route {route_id!r} in {source}")
        fields = {"agent", "model", "effort"}
        if route_id not in base:
            fields.add("work")
        if set(row) != fields:
            raise Error(
                f"route {route_id!r} in {source} requires: "
                f"{', '.join(sorted(fields))}"
            )
        if any(
            not isinstance(value, str) or not value.strip() for value in row.values()
        ):
            raise Error(f"route {route_id!r} in {source} has an empty value")


def validate_schema(config, require_base, source):
    validate_rows(
        config,
        require_base,
        source,
        VERSION,
        BASE,
        ROUTE_ID,
        allow_empty=not require_base,
    )


def validate_v1_schema(config, require_base, source):
    validate_rows(
        config, require_base, source, 1, LEGACY_BASE, LEGACY_ROUTE_ID
    )


def migration_command(scope, repo):
    command = ["python3", str(Path(__file__).resolve()), "migrate", scope]
    if scope != "global":
        command += ["--repo", str(Path(repo).expanduser().resolve())]
    return shlex.join(command)


def load(path, require_base=False, scope=None, repo="."):
    with path.open(encoding="utf-8") as stream:
        config = parse_json(stream, str(path))
    if (
        type(config.get("version")) is int
        and config.get("version") == 1
        and scope is not None
    ):
        raise Error(
            f"{path} uses Commander config version 1; preview migration with: "
            f"{migration_command(scope, repo)}"
        )
    validate_schema(config, require_base, str(path))
    return config


def ordered(routes):
    keys = [route for route in BASE if route in routes]
    keys += sorted(route for route in routes if route not in BASE)
    return {route: routes[route] for route in keys}


def record(scope, path, repo="."):
    return {
        "scope": scope,
        "path": str(path),
        "exists": path.exists(),
        "config": (
            load(path, scope == "global", scope, repo) if path.exists() else None
        ),
    }


def selected(routes, route_ids):
    if not route_ids:
        return ordered(routes)
    unknown = sorted(set(route_ids) - set(routes))
    if unknown:
        raise Error(f"configured routes not found: {', '.join(unknown)}")
    wanted = set(route_ids)
    return {route: row for route, row in ordered(routes).items() if route in wanted}


def resolve(paths, repo=".", route_ids=None):
    if not paths["global"].exists():
        raise Error(f"required global config is missing: {paths['global']}")
    routes, definitions, layers = {}, {}, []
    for scope in SCOPES:
        path = paths[scope]
        exists = path.exists()
        config = load(path, scope == "global", scope, repo) if exists else None
        routes_defined = list(ordered(config["routes"])) if config else []
        layers.append(
            {
                "scope": scope,
                "path": str(path),
                "exists": exists,
                "routes_defined": routes_defined,
            }
        )
        if config is None:
            continue
        for route, row in config["routes"].items():
            routes[route] = row
            definitions.setdefault(route, []).append(
                {"scope": scope, "path": str(path), "row": row}
            )
    config = {"version": VERSION, "routes": ordered(routes)}
    validate_schema(config, True, "resolved configuration")
    config["routes"] = selected(config["routes"], route_ids or [])
    route_provenance = {}
    for route, row in config["routes"].items():
        chain = definitions[route]
        winner = chain[-1]
        route_provenance[route] = {
            "effective": row,
            "winner": {
                "scope": winner["scope"],
                "path": winner["path"],
            },
            "replaced": chain[:-1],
        }
    return {
        "config": config,
        "route_sources": {
            route: route_provenance[route]["winner"] for route in config["routes"]
        },
        "route_provenance": route_provenance,
        "layers_low_to_high": layers,
    }


def markdown_cell(value):
    return str(value).replace("\\", "\\\\").replace("|", "\\|").replace("\n", " ")


def routing_report(paths, repo=".", route_ids=None):
    result = resolve(paths, repo, route_ids)
    root, _common = repo_info(repo)
    return {"repo": str(root), **result}


def report_markdown(report):
    lines = [
        "# Commander routing report",
        "",
        f"**Repo:** {report['repo']}",
        "**Layers (low → high):** "
        + " → ".join(f"`{layer['scope']}`" for layer in report["layers_low_to_high"]),
        "",
        "## Layers",
        "",
        "| Scope | Path | Present | Routes defined |",
        "| --- | --- | --- | --- |",
    ]
    for layer in report["layers_low_to_high"]:
        defined = ", ".join(layer["routes_defined"]) or "—"
        lines.append(
            f"| {markdown_cell(layer['scope'])} | {markdown_cell(layer['path'])} "
            f"| {'yes' if layer['exists'] else 'no'} | {markdown_cell(defined)} |"
        )

    lines += [
        "",
        "## Effective routes",
        "",
        "| Route | Agent | Model | Effort | Source | Overrides |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for route, row in report["config"]["routes"].items():
        provenance = report["route_provenance"][route]
        replaced = ", ".join(item["scope"] for item in provenance["replaced"]) or "—"
        lines.append(
            f"| {markdown_cell(route)} | {markdown_cell(row['agent'])} "
            f"| {markdown_cell(row['model'])} | {markdown_cell(row['effort'])} "
            f"| {markdown_cell(provenance['winner']['scope'])} "
            f"| {markdown_cell(replaced)} |"
        )

    for route, row in report["config"]["routes"].items():
        provenance = report["route_provenance"][route]
        winner = provenance["winner"]
        lines += [
            "",
            f"## Detail — {route}",
            "",
            f"- Effective: {json.dumps(row, ensure_ascii=False, sort_keys=True)}",
            f"- Wins from: {winner['scope']} — {winner['path']}",
            "- Replaced:",
        ]
        if provenance["replaced"]:
            for item in provenance["replaced"]:
                lines.append(
                    f"  - {item['scope']} — {item['path']}: "
                    f"{json.dumps(item['row'], ensure_ascii=False, sort_keys=True)}"
                )
        else:
            lines.append("  - none")
    return "\n".join(lines) + "\n"


def mode_for(scope):
    return 0o644 if scope == "repo" else 0o600


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


def save_once(path, content, mode):
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    except FileExistsError as error:
        raise Error(f"migration backup already exists: {path}") from error
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(descriptor, mode)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
    except Exception:
        if path.exists():
            path.unlink()
        raise


def ensure_backup(path, content, mode):
    if path.exists():
        if path.read_bytes() != content:
            raise Error(f"migration backup conflicts with source: {path}")
        return False
    save_once(path, content, mode)
    return True


def migration_preview(scope, path):
    if not path.exists():
        raise Error(f"config does not exist: {path}")
    try:
        raw = path.read_bytes()
        config = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise Error(f"invalid JSON in {path}: {error}") from error
    if not isinstance(config, dict):
        raise Error(f"{path} must contain a JSON object")
    if type(config.get("version")) is not int or config.get("version") != 1:
        raise Error(f"{path} is not a version 1 config")
    validate_v1_schema(config, scope == "global", str(path))
    conflicts = sorted(
        route for route in config["routes"] if route.startswith("commander.")
    )
    if conflicts:
        raise Error(
            "automatic migration requires explicit disposition of Commander "
            f"specialists: {', '.join(conflicts)}"
        )
    routes = {
        route: row
        for route, row in config["routes"].items()
        if route != "commander"
    }
    migrated = {"version": VERSION, "routes": ordered(routes)}
    validate_schema(migrated, scope == "global", "migrated configuration")
    backup = path.with_name(f"{path.stem}.v1{path.suffix}")
    return raw, {
        "scope": scope,
        "path": str(path),
        "backup_path": str(backup),
        "backup_exists": backup.exists(),
        "from_version": 1,
        "to_version": VERSION,
        "removed_routes": (
            ["commander"] if "commander" in config["routes"] else []
        ),
        "preserved_routes": list(migrated["routes"]),
        "config": migrated,
    }


def emit(value, compact=False):
    if compact:
        json.dump(value, sys.stdout, separators=(",", ":"), ensure_ascii=False)
    else:
        json.dump(value, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=(
            "template",
            "read",
            "resolve",
            "report",
            "write",
            "delete",
            "migrate",
        ),
    )
    parser.add_argument("scope", nargs="?", choices=(*SCOPES, "all"))
    parser.add_argument("--repo", default=".")
    parser.add_argument("--file", default="-", help="JSON file, or - for stdin")
    parser.add_argument("--yes", action="store_true")
    parser.add_argument("--compact", action="store_true")
    parser.add_argument("--route", action="append", default=[])
    parser.add_argument("--format", choices=("markdown", "json"))
    args = parser.parse_args()
    if args.command in {"read", "write", "delete", "migrate"} and args.scope is None:
        parser.error(f"{args.command} requires a scope")
    if args.scope == "all" and args.command != "read":
        parser.error("scope 'all' is valid only for read")
    if args.command in {"template", "resolve", "report"} and args.scope is not None:
        parser.error(f"{args.command} does not take a scope")
    if args.command != "resolve" and args.compact:
        parser.error("--compact is valid only for resolve")
    if args.command not in {"resolve", "report"} and args.route:
        parser.error("--route is valid only for resolve and report")
    if args.command != "report" and args.format is not None:
        parser.error("--format is valid only for report")
    if args.yes and args.command not in {"delete", "migrate"}:
        parser.error("--yes is valid only for delete and migrate")
    return args


def main():
    args = arguments()
    try:
        if args.command == "template":
            emit(
                {
                    "version": VERSION,
                    "routes": {
                        route: {"agent": None, "model": None, "effort": None}
                        for route in BASE
                    },
                }
            )
            return

        needs_repo = args.command in {"resolve", "report"} or args.scope in {
            "repo",
            "machine-repo",
            "all",
        }
        paths = locations(args.repo if needs_repo else None)
        if args.command == "read":
            if args.scope == "all":
                emit(
                    {
                        "layers": [
                            record(scope, paths[scope], args.repo)
                            for scope in SCOPES
                        ]
                    }
                )
            else:
                emit(record(args.scope, paths[args.scope], args.repo))
        elif args.command == "resolve":
            result = resolve(paths, args.repo, args.route)
            emit(result["config"]["routes"] if args.compact else result, args.compact)
        elif args.command == "report":
            report = routing_report(paths, args.repo, args.route)
            if args.format == "json":
                emit(report)
            else:
                sys.stdout.write(report_markdown(report))
        elif args.command == "write":
            if args.file == "-":
                config = parse_json(sys.stdin, "stdin")
            else:
                with Path(args.file).expanduser().open(encoding="utf-8") as stream:
                    config = parse_json(stream, args.file)
            validate_schema(config, args.scope == "global", args.file)
            config["routes"] = ordered(config["routes"])
            save(paths[args.scope], config, args.scope != "repo")
            emit(record(args.scope, paths[args.scope], args.repo))
        elif args.command == "delete":
            if not args.yes:
                raise Error("delete requires --yes after user confirmation")
            path = paths[args.scope]
            existed = path.exists()
            if existed:
                path.unlink()
            emit({"scope": args.scope, "path": str(path), "deleted": existed})
        elif args.command == "migrate":
            raw, preview = migration_preview(args.scope, paths[args.scope])
            if args.yes:
                backup = Path(preview["backup_path"])
                preview["backup_created"] = ensure_backup(
                    backup, raw, mode_for(args.scope)
                )
                save(
                    paths[args.scope],
                    preview["config"],
                    args.scope != "repo",
                )
                preview["migrated"] = True
            else:
                preview["migrated"] = False
            emit(preview)
    except (Error, OSError) as error:
        print(f"commander-config: {error}", file=sys.stderr)
        raise SystemExit(2 if "required global config is missing" in str(error) else 1)


if __name__ == "__main__":
    main()
