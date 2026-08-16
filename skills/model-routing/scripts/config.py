#!/usr/bin/env python3
"""Read, write, resolve, and report model-routing configuration."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


VERSION = 4
BASE = ("captain", "worker")
SCOPES = ("global", "repo", "machine-repo")
NAMESPACE = "model-routing"
CATALOG = (
    Path(__file__).resolve().parent.parent / "references" / "routing-catalog.json"
)
TOKEN = r"[a-z0-9]+(?:-[a-z0-9]+)*"
ROUTE_ID = re.compile(rf"^{TOKEN}(?:\.{TOKEN})*$")
LAUNCH_FIELDS = ("agent", "model", "effort")
PROVIDERS = ("claude", "codex", "grok")
OPTIONAL_ROUTE_FIELDS = {"on_quota_unusable"}
DEFAULT_ASK_SECONDS = 120


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
    target = Path(repo).expanduser().resolve()
    try:
        root = Path(git(target, "rev-parse", "--show-toplevel"))
        raw = Path(git(root, "rev-parse", "--git-common-dir"))
        common = (root / raw).resolve() if not raw.is_absolute() else raw.resolve()
        return root.resolve(), common
    except (Error, FileNotFoundError):
        # Non-git projects key machine-local configuration by resolved path.
        if not target.is_dir():
            raise Error(f"--repo must be an existing directory: {target}")
        return target, target


def locations(repo=None):
    home = Path.home()
    base = home / ".furanku-skills" / NAMESPACE
    paths = {"global": base / "config.json"}
    if repo is not None:
        root, common = repo_info(repo)
        digest = hashlib.sha256(str(common).encode()).hexdigest()
        label_from = common.parent.name if common.name == ".git" else common.name
        label = re.sub(r"[^a-z0-9]+", "-", label_from.lower()).strip("-") or "repo"
        paths.update(
            {
                "repo": root / ".furanku-skills" / NAMESPACE / "config.json",
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


def launch_of(row):
    return {key: row[key] for key in LAUNCH_FIELDS}


def validate_launch_tuple(row, label):
    if not isinstance(row, dict) or set(row) != set(LAUNCH_FIELDS):
        raise Error(f"{label} requires only agent, model, and effort")
    if any(not isinstance(row[key], str) or not row[key].strip() for key in LAUNCH_FIELDS):
        raise Error(f"{label} has an empty value")


def quota_unusable_policy(row):
    """Return the ask-then-fallback policy, or None when the route only asks."""
    policy = row.get("on_quota_unusable", "ask")
    if policy == "ask":
        return None
    return {
        "ask_seconds": policy.get("ask_seconds", DEFAULT_ASK_SECONDS),
        "launch": dict(policy["fallback"]),
    }


def validate_on_quota_unusable(value, row, source, route_id):
    label = f"route {route_id!r} on_quota_unusable in {source}"
    if value == "ask":
        return
    if not isinstance(value, dict):
        raise Error(f"{label} must be \"ask\" or an object")
    allowed = {"ask_seconds", "fallback"}
    unknown = sorted(set(value) - allowed)
    if "fallback" not in value or unknown:
        raise Error(f"{label} requires fallback and only: ask_seconds, fallback")
    validate_launch_tuple(value["fallback"], f"{label}.fallback")
    if launch_of(value["fallback"]) == launch_of(row):
        raise Error(f"{label}.fallback must differ from the route")
    if "ask_seconds" in value:
        seconds = value["ask_seconds"]
        if type(seconds) is not int or isinstance(seconds, bool) or seconds < 1:
            raise Error(f"{label}.ask_seconds must be a positive integer")


def validate_rows(routes, require_base, source, allow_empty=False):
    if not isinstance(routes, dict) or (not routes and not allow_empty):
        raise Error(f"{source} routes must be a non-empty object")
    missing = [route for route in BASE if route not in routes]
    if require_base and missing:
        raise Error(f"{source} is missing base routes: {', '.join(missing)}")
    for route_id, row in routes.items():
        if not ROUTE_ID.fullmatch(route_id) or not isinstance(row, dict):
            raise Error(f"invalid route {route_id!r} in {source}")
        required = set(LAUNCH_FIELDS)
        if route_id not in BASE:
            required.add("work")
        allowed = required | OPTIONAL_ROUTE_FIELDS
        absent = sorted(required - set(row))
        unknown = sorted(set(row) - allowed)
        if absent:
            raise Error(
                f"route {route_id!r} in {source} requires: "
                f"{', '.join(sorted(required))}"
            )
        if unknown:
            raise Error(
                f"route {route_id!r} in {source} has unknown fields: "
                f"{', '.join(unknown)}"
            )
        for key in required:
            if not isinstance(row[key], str) or not row[key].strip():
                raise Error(f"route {route_id!r} in {source} has an empty value")
        if "on_quota_unusable" in row:
            validate_on_quota_unusable(
                row["on_quota_unusable"], row, source, route_id
            )


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


def validate_accounts(accounts, source):
    """Provider → the account that provider's launches bill.

    Quota tools measure whichever account the ambient environment selects, so
    the router needs the intended account stated to detect a reading taken
    against a different one.
    """
    if not isinstance(accounts, dict):
        raise Error(f"{source} accounts must be an object of provider: account")
    for provider, account in accounts.items():
        if provider not in PROVIDERS:
            raise Error(
                f"{source} accounts has unknown provider {provider!r}; "
                f"known providers: {', '.join(sorted(PROVIDERS))}"
            )
        if not isinstance(account, str) or not account.strip():
            raise Error(
                f"{source} accounts[{provider!r}] must be a non-empty account "
                "identifier"
            )


def validate_schema(config, require_base, source):
    if type(config.get("version")) is not int or config["version"] != VERSION:
        raise Error(f"{source} must use routing config version {VERSION}")
    allowed = {"version", "routes", "preferences", "candidates", "accounts"}
    unknown = sorted(set(config) - allowed)
    if unknown or "routes" not in config:
        raise Error(
            f"{source} must contain routes and only: {', '.join(sorted(allowed))}"
        )
    validate_rows(
        config["routes"], require_base, source, allow_empty=not require_base
    )
    validate_preferences(config.get("preferences", []), source)
    validate_candidate_overrides(config.get("candidates", {}), source)
    validate_accounts(config.get("accounts", {}), source)


def load(path, require_base=False):
    with path.open(encoding="utf-8") as stream:
        config = parse_json(stream, str(path))
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
    validate_rows(catalog["routes"], True, str(CATALOG))
    validate_candidate_overrides(catalog["candidates"], str(CATALOG))
    if not isinstance(catalog["methodology"], dict):
        raise Error(f"{CATALOG} methodology must be an object")
    return catalog


def ordered(routes):
    keys = [route for route in BASE if route in routes]
    keys += sorted(route for route in routes if route not in BASE)
    return {route: routes[route] for route in keys}


def record(scope, path):
    return {
        "scope": scope,
        "path": str(path),
        "exists": path.exists(),
        "config": (load(path) if path.exists() else None),
    }


def selected(routes, route_ids):
    if not route_ids:
        return ordered(routes)
    unknown = sorted(set(route_ids) - set(routes))
    if unknown:
        raise Error(f"configured routes not found: {', '.join(unknown)}")
    wanted = set(route_ids)
    return {route: row for route, row in ordered(routes).items() if route in wanted}


def resolve(paths, route_ids=None):
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
        config = load(path) if exists else None
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
    result = resolve(paths, route_ids)
    root, _common = repo_info(repo)
    return {"repo": str(root), **result}


def report_markdown(report):
    lines = [
        "# Routing report",
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
        choices=("template", "read", "resolve", "report", "write", "delete"),
    )
    parser.add_argument("scope", nargs="?", choices=(*SCOPES, "all"))
    parser.add_argument("--repo", default=".")
    parser.add_argument("--file", default="-", help="JSON file, or - for stdin")
    parser.add_argument("--yes", action="store_true")
    parser.add_argument("--compact", action="store_true")
    parser.add_argument("--route", action="append", default=[])
    parser.add_argument("--format", choices=("markdown", "json"))
    args = parser.parse_args()
    if args.command in {"read", "write", "delete"} and args.scope is None:
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
    if args.yes and args.command != "delete":
        parser.error("--yes is valid only for delete")
    return args


def main():
    args = arguments()
    try:
        if args.command == "template":
            emit(
                {
                    "version": VERSION,
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
                emit({"layers": [record(scope, paths[scope]) for scope in SCOPES]})
            else:
                emit(record(args.scope, paths[args.scope]))
        elif args.command == "resolve":
            result = resolve(paths, args.route)
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
        print(f"model-routing-config: {error}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
