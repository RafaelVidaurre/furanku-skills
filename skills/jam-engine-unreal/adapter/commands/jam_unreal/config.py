"""The adapter's one configuration: adapter.json facts, the project's overrides, and this machine's engine settings.

    facts    adapter.json `facts`, with jam.config.json `engine.facts` merged over them (tracked project policy)
    local    jam.local.json `engine` (this machine: how to reach the editor; never tracked)

Adapter options that are not conventions (content destinations, skeleton assets, collision thresholds, sound toolsets)
live under `facts.extra`, so a project overrides them in `jam.config.json` at `engine.facts.extra`.
"""
import glob
import json
import os

from .errors import AdapterError

CONFIG_FILE = "jam.config.json"
LOCAL_FILE = "jam.local.json"


def deep_merge(base, over):
    """`over` wins; objects merge key by key, anything else (arrays, null) replaces."""
    if isinstance(base, dict) and isinstance(over, dict):
        out = dict(base)
        for key, value in over.items():
            out[key] = deep_merge(base[key], value) if key in base else value
        return out
    return over


def read_json(path, what):
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            value = json.load(f)
    except ValueError as e:
        raise AdapterError("invalid", "%s is not valid JSON: %s" % (what, e), fix="correct the file")
    if not isinstance(value, dict):
        raise AdapterError("invalid", "%s must hold a JSON object" % what)
    return value


class Config:
    def __init__(self, project, adapter_dir, facts, local):
        self.project = project
        self.adapter_dir = adapter_dir
        self.facts = facts
        self.local = local
        self.extra = facts.get("extra") or {}
        self.tools = {}

    # ---- conventions
    @property
    def units_per_meter(self):
        return float(self.facts.get("unitsPerMeter", 100))

    def prefix(self, asset_type):
        return (self.facts.get("naming") or {}).get(asset_type, "")

    def named(self, asset_type, name):
        """`name` with the asset type's prefix, added only when it is missing."""
        prefix = self.prefix(asset_type)
        return name if not prefix or name.startswith(prefix) else prefix + name

    # ---- adapter options
    def skeleton(self, skeleton_id):
        """A skeleton profile (`facts.skeletons.<id>`: label, bones, reference file) with this adapter's details for it
        (`facts.extra.skeletons.<id>`: the engine skeleton asset, root bone, physics asset, reference mesh, animations)."""
        known = self.facts.get("skeletons") or {}
        details = self.extra.get("skeletons") or {}
        if skeleton_id not in known and skeleton_id not in details:
            raise AdapterError(
                "unknown-skeleton", "skeleton %r is not in the engine facts (known: %s)" % (skeleton_id, ", ".join(sorted(set(known) | set(details))) or "none"),
                fix="add the profile under engine.facts.skeletons in jam.config.json and its engine assets under engine.facts.extra.skeletons",
            )
        out = deep_merge(known.get(skeleton_id) or {}, details.get(skeleton_id) or {})
        if not out.get("skeleton"):
            raise AdapterError("invalid", "skeleton %r names no engine skeleton asset" % skeleton_id,
                               fix="set engine.facts.extra.skeletons.%s.skeleton to the skeleton asset's id in jam.config.json" % skeleton_id)
        return out

    def default_skeleton(self):
        """The profile to use when none is named: the configured default, else the only one there is."""
        known = sorted(set(self.facts.get("skeletons") or {}) | set(self.extra.get("skeletons") or {}))
        chosen = self.extra.get("defaultSkeleton") or (known[0] if len(known) == 1 else None)
        if not chosen:
            raise AdapterError("missing-skeleton", "which skeleton profile to use is not stated (known: %s)" % (", ".join(known) or "none"),
                               fix="pass --skeleton <id>, or set engine.facts.extra.defaultSkeleton in jam.config.json")
        return chosen

    def destination(self, kind, explicit=None):
        dest = explicit or (self.extra.get("destinations") or {}).get(kind)
        if not dest:
            raise AdapterError(
                "missing-destination", "no content folder for %s imports" % kind,
                fix="pass --dest /Game/<folder>, or set engine.facts.extra.destinations.%s in jam.config.json" % kind,
            )
        return dest.rstrip("/")

    def option(self, *keys, default=None):
        value = self.extra
        for key in keys:
            if not isinstance(value, dict) or key not in value:
                return default
            value = value[key]
        return default if value is None else value

    # ---- this machine
    @property
    def transport(self):
        value = self.local.get("transport")
        return value if isinstance(value, dict) else {"kind": "handoff"}

    @property
    def work_dir(self):
        """Project-relative folder for prepared scripts and their results; keep it Git-ignored."""
        return str(self.local.get("work") or "Saved/JamEngine").replace("\\", "/").strip("/")

    @property
    def locks(self):
        return self.local.get("locks") or self.extra.get("locks") or "off"

    def tool(self, name):
        """A program of this machine (`blender`, `python`): the path in jam.local.json, else its name on PATH."""
        value = self.tools.get(name, name)
        return os.path.join(self.project, *value.split("/")) if ("/" in value and not os.path.isabs(value)) else value

    def uproject(self):
        named = self.local.get("project")
        if named:
            return os.path.join(self.project, *str(named).replace("\\", "/").split("/"))
        found = sorted(glob.glob(os.path.join(self.project, "*.uproject")))
        if len(found) != 1:
            raise AdapterError(
                "missing-project", "expected one .uproject in %s, found %d" % (self.project, len(found)),
                fix="set engine.project in jam.local.json to the project file, relative to the project root",
            )
        return found[0]


def load(project=None, adapter_dir=None, environ=None):
    """The toolkit runs a command from the project root and names it in JAM_PROJECT_ROOT; this machine's engine
    settings arrive in JAM_ENGINE_SETTINGS. Run directly, a command reads the same two files itself."""
    environ = os.environ if environ is None else environ
    project = os.path.abspath(project or environ.get("JAM_PROJECT_ROOT") or os.getcwd())
    adapter_dir = os.path.abspath(adapter_dir or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    adapter = read_json(os.path.join(adapter_dir, "adapter.json"), "adapter.json")
    if "facts" not in adapter:
        raise AdapterError("invalid", "adapter.json in %s has no facts" % adapter_dir)
    project_config = read_json(os.path.join(project, CONFIG_FILE), CONFIG_FILE)
    overrides = (project_config.get("engine") or {}).get("facts") or {}
    machine = read_json(os.path.join(project, LOCAL_FILE), LOCAL_FILE)
    if environ.get("JAM_ENGINE_SETTINGS"):
        try:
            local = json.loads(environ["JAM_ENGINE_SETTINGS"])
        except ValueError:
            raise AdapterError("invalid", "JAM_ENGINE_SETTINGS is not valid JSON")
    else:
        local = machine.get("engine") or {}
    if not isinstance(local, dict):
        raise AdapterError("invalid", "%s: engine must be an object" % LOCAL_FILE)
    config = Config(project, adapter_dir, deep_merge(adapter["facts"], overrides), local)
    config.tools = {name: machine[name] for name in ("blender", "python") if machine.get(name)}
    return config
