#!/usr/bin/env python3
"""Resolve structured recovery policy without selecting models or probing services."""

DEFAULTS = {
    "on_limit": "equivalent",
    "on_no_reply": "stop",
    "response_seconds": 600,
    "max_wait_seconds": 1800,
    "max_replacements": 2,
}
ROLES = ("commander", "captain", "worker")


def validate(value, source="recovery"):
    if not isinstance(value, dict):
        raise ValueError(f"{source} must be an object")
    unknown = set(value) - set(DEFAULTS)
    if unknown:
        raise ValueError(f"{source} has unknown fields: {', '.join(sorted(unknown))}")
    for field, setting in value.items():
        if field == "on_limit":
            if setting not in ("equivalent", "ask", "wait"):
                raise ValueError(f"{source}.on_limit must be equivalent, ask, or wait")
        elif field == "on_no_reply":
            if setting not in ("stop", "continue"):
                raise ValueError(f"{source}.on_no_reply must be stop or continue")
        elif type(setting) is not int or setting < (0 if field == "max_replacements" else 1):
            bound = "non-negative" if field == "max_replacements" else "positive"
            raise ValueError(f"{source}.{field} must be a {bound} integer")


def validate_roles(value, source="role_recovery"):
    if not isinstance(value, dict):
        raise ValueError(f"{source} must be an object")
    for role, patch in value.items():
        if role not in ROLES:
            raise ValueError(f"{source} has unknown role {role!r}")
        validate(patch, f"{source}.{role}")


def resolve_layers(layers, role=None, route=None, overrides=None):
    """Merge ordered {scope, path, config} layers; no filesystem or environment reads."""
    if role is not None and role not in ROLES:
        raise ValueError(f"unknown recovery role {role!r}")
    if route is not None and (not isinstance(route, str) or not route):
        raise ValueError("recovery route must be a non-empty string")
    effective = dict(DEFAULTS)
    sources = {field: {"scope": "builtin", "path": None, "selector": "default"}
               for field in DEFAULTS}
    configured = set()

    def merge(patch, scope, path, selector):
        validate(patch, f"{scope} {selector}")
        for field, value in patch.items():
            effective[field] = value
            sources[field] = {"scope": scope, "path": path, "selector": selector}
            if scope != "builtin":
                configured.add(field)

    for layer in layers:
        data = layer.get("config")
        if data is None:
            continue
        scope, path = layer["scope"], layer.get("path")
        merge(data.get("recovery", {}), scope, path, "recovery")
        roles = data.get("role_recovery", {})
        validate_roles(roles, f"{scope} role_recovery")
        if role is not None:
            merge(roles.get(role, {}), scope, path, f"role_recovery.{role}")
        if route is not None:
            merge(data.get("routes", {}).get(route, {}).get("recovery", {}),
                  scope, path, f"routes.{route}.recovery")
    if overrides is not None:
        merge(overrides, "override", None, "override")
    return {"policy": effective, "sources": sources,
            "configured_fields": sorted(configured)}


def configuration_layers(repo):
    import config
    layers = [{"scope": "builtin", "path": str(config.CATALOG),
               "config": config.builtin()}]
    for scope, path in config.locations(repo).items():
        layers.append({"scope": scope, "path": str(path),
                       "config": config.load(path) if path.exists() else None})
    return layers


def resolve(repo, role=None, route=None, overrides=None):
    return resolve_layers(configuration_layers(repo), role, route, overrides)
