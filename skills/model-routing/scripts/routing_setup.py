#!/usr/bin/env python3
"""Agent-guided recovery setup: inspect, preview, approve, then persist."""

import argparse
import copy
import json
from pathlib import Path
import sys

import config
import policy


def questions(resolved):
    configured = set(resolved["configured_fields"])
    pending = []
    if "on_limit" not in configured:
        pending.append({"field": "on_limit", "required": True,
                        "prompt": "When quota runs out, try an equivalent route, ask you, or wait?",
                        "choices": ["equivalent", "ask", "wait"], "default": "equivalent"})
    if "on_no_reply" not in configured:
        pending.append({"field": "on_no_reply", "required": True,
                        "prompt": "If you do not answer a recovery question, stop or continue within the approved limits?",
                        "choices": ["stop", "continue"], "default": "stop"})
    if resolved["policy"]["on_no_reply"] == "continue" and "response_seconds" not in configured:
        pending.append({"field": "response_seconds", "required": False,
                        "prompt": "Wait 600 seconds for your answer, or use another duration?",
                        "default": resolved["policy"]["response_seconds"]})
    return pending


def _view(repo, layers, role, route):
    resolved = policy.resolve_layers(layers, role, route)
    pending = questions(resolved)
    return {"status": "ready", "repo": str(config.repo_info(repo)[0]),
            "role": role, "route": route, **resolved, "questions": pending,
            "setup_complete": not any(item["required"] for item in pending),
            "configuration": [{"scope": layer["scope"], "path": layer["path"],
                               "exists": layer["config"] is not None,
                               "config": layer["config"]}
                              for layer in layers if layer["scope"] != "builtin"],
            "preferences": [{"scope": layer["scope"], "text": text}
                            for layer in layers if layer.get("config")
                            for text in layer["config"].get("preferences", [])],
            "optional_customization": {
                "models_and_providers": "config.py models --repo <repo>; edit candidate overrides with config.py set",
                "preferences": "Use config.py read/write to preserve and edit ordinary preferences",
                "roles": "Set role_recovery.commander, captain, or worker in the chosen layer",
                "quota_accounts": "references/accounts.md",
            },
            "templates": "references/message-templates.json"}


def status(repo, role=None, route=None):
    return _view(repo, policy.configuration_layers(repo), role, route)


def _snapshots(repo):
    paths = {"builtin": config.CATALOG, **config.locations(repo)}
    return [{"scope": scope, "path": str(path), "digest": config.file_digest(path)}
            for scope, path in paths.items()]


def preview(repo, scope, choices, role=None, route=None):
    """Build a complete reviewable artifact; no filesystem writes or live probes."""
    if scope not in config.SCOPES:
        raise config.Error("setup requires an explicit global, repo, or machine-repo scope")
    policy.validate(choices, "setup choices")
    snapshots = _snapshots(repo)
    layers = policy.configuration_layers(repo)
    current = policy.resolve_layers(layers, role, route)
    choices = copy.deepcopy(choices)
    # The review includes the ordinary duration when approving continuation,
    # so a later setup run does not repeatedly ask about that same default.
    if choices.get("on_no_reply") == "continue" and "response_seconds" not in choices:
        choices["response_seconds"] = current["policy"]["response_seconds"]
    target = next(layer for layer in layers if layer["scope"] == scope)
    before = target["config"]
    after = copy.deepcopy(before) if before is not None else {"version": config.VERSION, "routes": {}}
    if route is not None:
        if route not in after["routes"]:
            raise config.Error(f"route {route!r} must already exist in the {scope} layer; use config.py to define it first")
        patch = after["routes"][route].setdefault("recovery", {})
    elif role is not None:
        patch = after.setdefault("role_recovery", {}).setdefault(role, {})
    else:
        patch = after.setdefault("recovery", {})
    patch.update(choices)
    config.validate_schema(after, "setup preview")
    if snapshots != _snapshots(repo):
        raise config.Error("configuration changed during preview; create a fresh preview")
    target["config"] = after
    return {"status": "preview", "repo": str(config.repo_info(repo)[0]), "scope": scope,
            "role": role, "route": route, "path": target["path"], "choices": choices,
            "snapshots": snapshots, "before": before, "after": after,
            "changed": after != before, "effective": _view(repo, layers, role, route)}


def apply(document):
    """Apply an approved preview, refusing any change to its inputs since review."""
    if not isinstance(document, dict) or document.get("status") != "preview":
        raise config.Error("apply requires a setup preview document")
    required = {"repo", "scope", "role", "route", "choices", "snapshots", "before", "after", "path"}
    if not required <= set(document):
        raise config.Error("incomplete setup preview; create a fresh preview")
    snapshots = document["snapshots"]
    expected_scopes = ["builtin", *config.SCOPES]
    if (not isinstance(snapshots, list) or len(snapshots) != len(expected_scopes)
        or any(not isinstance(item, dict) or set(item) != {"scope", "path", "digest"}
               or item["scope"] != scope or not isinstance(item["path"], str)
               or not isinstance(item["digest"], str)
               for item, scope in zip(snapshots, expected_scopes))):
        raise config.Error("invalid setup snapshots; create a fresh preview")
    paths = config.locations(document["repo"])
    if document["scope"] not in config.SCOPES or str(paths[document["scope"]]) != document["path"]:
        raise config.Error("setup target changed; create a fresh preview")
    with config.lock_paths(paths.values()):
        return _apply_locked(document)


def _apply_locked(document):
    fresh = preview(document["repo"], document["scope"], document["choices"],
                    document["role"], document["route"])
    if fresh["path"] != document["path"]:
        raise config.Error("setup target changed; create a fresh preview")
    # A completed preview can be applied again without writing or prompting.
    target_path = Path(document["path"])
    already_applied = fresh["before"] == document["after"]
    expected = {item["scope"]: item for item in document["snapshots"]}
    for actual in fresh["snapshots"]:
        if already_applied and actual["scope"] == document["scope"]:
            continue
        if actual != expected.get(actual["scope"]):
            raise config.Error(f"configuration changed since preview: {actual['path']}; create a fresh preview")
    if fresh["after"] != document["after"] or (not already_applied and fresh["before"] != document["before"]):
        raise config.Error("setup preview content changed; create a fresh preview")
    if not already_applied:
        config._save_unlocked(target_path, document["after"], document["scope"] != "repo",
                              expected_digest=expected[document["scope"]]["digest"])
    return {"status": "unchanged" if already_applied else "applied",
            "scope": document["scope"], "path": str(target_path),
            "effective": status(document["repo"], document["role"], document["route"])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("status", "preview", "apply"))
    parser.add_argument("--repo", default=".")
    parser.add_argument("--scope", choices=config.SCOPES)
    parser.add_argument("--role", choices=policy.ROLES)
    parser.add_argument("--route")
    parser.add_argument("--file", default="-", help="choices JSON for preview, approved preview JSON for apply")
    args = parser.parse_args()
    try:
        if args.command == "status":
            result = status(args.repo, args.role, args.route)
        else:
            if args.file == "-":
                document = json.load(sys.stdin)
            else:
                document = json.loads(Path(args.file).read_text(encoding="utf-8"))
            result = (preview(args.repo, args.scope, document, args.role, args.route)
                      if args.command == "preview" else apply(document))
        config.emit(result)
    except (config.Error, ValueError, OSError) as error:
        print(f"model-routing-setup: {error}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
