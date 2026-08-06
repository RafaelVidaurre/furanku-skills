#!/usr/bin/env python3
"""Read, write, migrate, resolve, and report Crew routing configuration."""

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
PREFS_VERSION = 4
BASE = ("captain", "worker")
LEGACY_BASE = ("commander", "captain", "worker")
SCOPES = ("global", "repo", "machine-repo")
CATALOG = (
    Path(__file__).resolve().parent.parent / "references" / "routing-catalog.json"
)
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
    routes, require_base, source, base, route_pattern, allow_empty=False
):
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


def validate_preferences(preferences, source):
    if not isinstance(preferences, list):
        raise Error(f"{source} preferences must be an array of strings")
    for index, entry in enumerate(preferences):
        if not isinstance(entry, str) or not entry.strip():
            raise Error(
                f"{source} preferences[{index}] must be a non-empty string"
            )


def validate_candidate_overrides(candidates, source):
    if not isinstance(candidates, dict):
        raise Error(f"{source} candidates must be an object")
    for candidate_id, candidate in candidates.items():
        if candidate is not None and not isinstance(candidate, dict):
            raise Error(
                f"{source} candidate {candidate_id!r} must be an object "
                "or a null tombstone"
            )


def validate_schema(config, require_base, source):
    version = config.get("version")
    if type(version) is not int or version not in {VERSION, PREFS_VERSION}:
        raise Error(
            f"{source} must use routing config version {VERSION} or "
            f"{PREFS_VERSION}"
        )
    if version == VERSION:
        allowed = {"version", "routes"}
    else:
        allowed = {"version", "routes", "preferences", "candidates"}
    unknown = sorted(set(config) - allowed)
    if unknown or "routes" not in config:
        raise Error(
            f"{source} version {version} must contain routes and only: "
            f"{', '.join(sorted(allowed))}"
        )
    validate_rows(
        config["routes"],
        require_base,
        source,
        BASE,
        ROUTE_ID,
        allow_empty=not require_base,
    )
    if version == PREFS_VERSION:
        validate_preferences(config.get("preferences", []), source)
        validate_candidate_overrides(config.get("candidates", {}), source)


def validate_v1_schema(config, require_base, source):
    if (
        set(config) != {"version", "routes"}
        or type(config.get("version")) is not int
        or config.get("version") != 1
    ):
        raise Error(f"{source} must contain only version 1 and routes")
    validate_rows(
        config["routes"], require_base, source, LEGACY_BASE, LEGACY_ROUTE_ID
    )


def validate_v3_schema(config, require_base, source):
    if set(config) != {"version", "routes", "routing"}:
        raise Error(
            f"{source} version 3 must contain only version, routes, and routing"
        )
    validate_rows(
        config["routes"], require_base, source, BASE, ROUTE_ID, allow_empty=True
    )
    routing = config["routing"]
    if not isinstance(routing, dict):
        raise Error(f"{source} routing must be an object")
    allowed = {"candidates", "specializations", "policy"}
    unknown = sorted(set(routing) - allowed)
    if unknown:
        raise Error(
            f"{source} has unknown routing sections: {', '.join(unknown)}"
        )
    # Version 3 used recursive merge-patch, so null sections and null entries
    # are valid legacy tombstones; only null gets deletion treatment.
    specializations = routing.get("specializations")
    if specializations is not None and (
        not isinstance(specializations, dict)
        or any(
            spec is not None and not isinstance(spec, dict)
            for spec in specializations.values()
        )
    ):
        raise Error(f"{source} routing specializations must be an object of objects")
    policy = routing.get("policy")
    if policy is not None and not isinstance(policy, dict):
        raise Error(f"{source} routing policy must be an object")
    candidates = routing.get("candidates")
    if candidates is not None:
        validate_candidate_overrides(candidates, source)


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
        and config.get("version") in {1, 3}
        and scope is not None
    ):
        raise Error(
            f"{path} uses routing config version {config['version']}; "
            f"preview migration with: {migration_command(scope, repo)}"
        )
    validate_schema(config, require_base, str(path))
    return config


def builtin():
    with CATALOG.open(encoding="utf-8") as stream:
        catalog = parse_json(stream, str(CATALOG))
    if (
        catalog.get("version") != 2
        or not {"version", "routes", "methodology", "candidates"} <= set(catalog)
    ):
        raise Error(
            f"{CATALOG} must contain version 2 with routes, methodology, "
            "and candidates"
        )
    validate_rows(catalog["routes"], True, str(CATALOG), BASE, ROUTE_ID)
    validate_candidate_overrides(catalog["candidates"], str(CATALOG))
    if not isinstance(catalog["methodology"], dict):
        raise Error(f"{CATALOG} methodology must be an object")
    return catalog


def ordered(routes):
    keys = [route for route in BASE if route in routes]
    keys += sorted(route for route in routes if route not in BASE)
    return {route: routes[route] for route in keys}


def record(scope, path, repo="."):
    return {
        "scope": scope,
        "path": str(path),
        "exists": path.exists(),
        "config": (load(path, False, scope, repo) if path.exists() else None),
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
    catalog = builtin()
    routes, definitions, layers = {}, {}, []
    layers.append(
        {
            "scope": "builtin",
            "path": str(CATALOG),
            "exists": True,
            "version": catalog["version"],
            "routes_defined": list(ordered(catalog["routes"])),
            "preferences": 0,
            "candidates_defined": sorted(catalog["candidates"]),
        }
    )
    for route, row in catalog["routes"].items():
        routes[route] = row
        definitions.setdefault(route, []).append(
            {"scope": "builtin", "path": str(CATALOG), "row": row}
        )
    for scope in SCOPES:
        path = paths[scope]
        exists = path.exists()
        config = load(path, False, scope, repo) if exists else None
        layers.append(
            {
                "scope": scope,
                "path": str(path),
                "exists": exists,
                "version": config["version"] if config else None,
                "routes_defined": (
                    list(ordered(config["routes"])) if config else []
                ),
                "preferences": (
                    len(config.get("preferences", [])) if config else 0
                ),
                "candidates_defined": (
                    sorted(config.get("candidates", {})) if config else []
                ),
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
        "# Crew routing report",
        "",
        f"**Repo:** {report['repo']}",
        "**Layers (low → high):** "
        + " → ".join(f"`{layer['scope']}`" for layer in report["layers_low_to_high"]),
        "",
        "## Layers",
        "",
        "| Scope | Path | Present | Routes defined | Preferences | Candidate overrides |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for layer in report["layers_low_to_high"]:
        defined = ", ".join(layer["routes_defined"]) or "—"
        overrides = ", ".join(layer["candidates_defined"]) or "—"
        lines.append(
            f"| {markdown_cell(layer['scope'])} | {markdown_cell(layer['path'])} "
            f"| {'yes' if layer['exists'] else 'no'} | {markdown_cell(defined)} "
            f"| {layer['preferences']} | {markdown_cell(overrides)} |"
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


def read_versioned(path):
    if not path.exists():
        raise Error(f"config does not exist: {path}")
    try:
        raw = path.read_bytes()
        config = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise Error(f"invalid JSON in {path}: {error}") from error
    if not isinstance(config, dict):
        raise Error(f"{path} must contain a JSON object")
    if type(config.get("version")) is not int:
        raise Error(f"{path} lacks an integer version")
    return raw, config


def migration_result(scope, path, from_version, to_version, migrated, **extra):
    validate_schema(migrated, False, "migrated configuration")
    backup = path.with_name(f"{path.stem}.v{from_version}{path.suffix}")
    return {
        "scope": scope,
        "path": str(path),
        "backup_path": str(backup),
        "backup_exists": backup.exists(),
        "from_version": from_version,
        "to_version": to_version,
        "preserved_routes": list(migrated["routes"]),
        "config": migrated,
        **extra,
    }


def migrate_v1(scope, path, raw, config):
    validate_v1_schema(config, scope == "global", str(path))
    conflicts = sorted(
        route for route in config["routes"] if route.startswith("commander.")
    )
    if conflicts:
        raise Error(
            "automatic migration requires explicit disposition of legacy Commander "
            f"specialists: {', '.join(conflicts)}"
        )
    routes = {
        route: row
        for route, row in config["routes"].items()
        if route != "commander"
    }
    migrated = {"version": VERSION, "routes": ordered(routes)}
    return raw, migration_result(
        scope,
        path,
        1,
        VERSION,
        migrated,
        removed_routes=(
            ["commander"] if "commander" in config["routes"] else []
        ),
    )


def migrate_v3(scope, path, raw, config):
    validate_v3_schema(config, False, str(path))
    routing = config["routing"]
    preferences = []
    for name, spec in (routing.get("specializations") or {}).items():
        if spec is None:
            continue
        description = spec.get("description")
        if isinstance(description, str) and description.strip():
            preferences.append(
                f"{description.strip()} (migrated from specialization {name!r}; "
                "its numeric needs and priority were dropped)"
            )
        else:
            preferences.append(
                f"Specialization {name!r} was configured without a description; "
                "restate its routing intent in plain language or delete this line."
            )
    migrated = {
        "version": PREFS_VERSION,
        "routes": ordered(config["routes"]),
    }
    if preferences:
        migrated["preferences"] = preferences
    if routing.get("candidates"):
        migrated["candidates"] = routing["candidates"]
    return raw, migration_result(
        scope,
        path,
        3,
        PREFS_VERSION,
        migrated,
        dropped_sections=sorted(
            section
            for section in ("specializations", "policy")
            if routing.get(section)
        ),
        generated_preferences=preferences,
    )


def migration_preview(scope, path):
    raw, config = read_versioned(path)
    if config["version"] == 1:
        return migrate_v1(scope, path, raw, config)
    if config["version"] == 3:
        return migrate_v3(scope, path, raw, config)
    raise Error(f"{path} version {config['version']} does not need migration")


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
                    "version": PREFS_VERSION,
                    "routes": {},
                    "preferences": [],
                    "candidates": {},
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
            validate_schema(config, False, args.file)
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
        print(f"crew-config: {error}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
