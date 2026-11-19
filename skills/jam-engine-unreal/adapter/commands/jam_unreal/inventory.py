"""The project's engine content as an inventory (the toolkit's engine-inventory schema): every package under the
content roots, read from its header, reusing the previous inventory's entry for every file whose size and
modification time are unchanged.

Roots: `/Game` where the `assetId` fact puts it, and `/<Plugin>` for each project plugin that can contain content.
A package this reader cannot read stays in the inventory with `unread` and the reason; with the engine fallback its
classes and package dependencies come from the editor's Asset Registry instead.

Property values (`assets[].fields`) are read for the classes `facts.extra.inventory.fields` lists. The inventory
records a hash of that list (`fieldsConfig`); when it changes, entries that had fields or hold a listed class are
read again instead of reused.
"""
import datetime
import glob
import hashlib
import json
import os

from . import hierarchy, paths
from .errors import AdapterError
from .packages import Unreadable, field_target, read_package, tag_path

EXTENSIONS = (".uasset", ".umap")
REFERENCE_KINDS = ("hard", "soft")


def mtime_ms(stat):
    """The modification time as Node reports `mtimeMs` (seconds x 1000 + nanoseconds / 1e6), so both compare exactly."""
    seconds, nanoseconds = divmod(stat.st_mtime_ns, 1_000_000_000)
    return seconds * 1e3 + nanoseconds / 1e6


def roots(cfg):
    """[{"id": "/Game", "path": "<project path>"}, ...]: where each engine root's packages live in the project."""
    scheme = cfg.facts.get("assetId") or {}
    id_head, _ = paths._split_scheme(scheme.get("scheme", "/Game/{path}"))
    file_head, file_tail = paths._split_scheme(scheme.get("from", "Content/{path}.uasset"))
    if not file_tail.endswith(".uasset"):
        raise AdapterError("invalid", "assetId.from must end in .uasset: %r" % scheme.get("from"))
    content = file_head.rstrip("/") or "."
    found = [{"id": id_head.rstrip("/"), "path": content}]
    project_dir = os.path.dirname(content) if content != "." else ""
    plugins_dir = os.path.join(cfg.project, *[p for p in project_dir.split("/") if p], "Plugins")
    for descriptor in sorted(glob.glob(os.path.join(plugins_dir, "**", "*.uplugin"), recursive=True)):
        try:
            with open(descriptor, encoding="utf-8-sig") as f:
                plugin = json.load(f)
        except (OSError, ValueError):
            continue
        if not plugin.get("CanContainContent"):
            continue
        content_dir = os.path.join(os.path.dirname(descriptor), "Content")
        if os.path.isdir(content_dir):
            relative = os.path.relpath(content_dir, cfg.project).replace(os.sep, "/")
            found.append({"id": "/" + os.path.splitext(os.path.basename(descriptor))[0], "path": relative})
    return found


def package_files(cfg, root):
    """(project path, package id, absolute path) of every package under one root."""
    base = cfg.project if root["path"] == "." else os.path.join(cfg.project, *root["path"].split("/"))
    out = []
    for folder, dirs, files in os.walk(base):
        dirs.sort()
        for name in sorted(files):
            stem, ext = os.path.splitext(name)
            if ext.lower() not in EXTENSIONS:
                continue
            full = os.path.join(folder, name)
            inner = os.path.relpath(os.path.join(folder, stem), base).replace(os.sep, "/")
            relative = os.path.relpath(full, cfg.project).replace(os.sep, "/")
            out.append((relative, root["id"] + "/" + inner, full))
    return out


def field_selection(cfg):
    """({class path: set of property names, or None for all}, hash of it or None) from
    `facts.extra.inventory.fields`: `[{"class": "/Script/MyGame.ItemDefinition", "properties": ["Icon"]}]`."""
    raw = (cfg.extra.get("inventory") or {}).get("fields") or []
    fix = 'set engine.facts.extra.inventory.fields in jam.config.json to [{"class": "/Script/<Module>.<Class>", "properties": ["<Name>"]}]'
    if not isinstance(raw, list):
        raise AdapterError("invalid", "engine.facts.extra.inventory.fields must be a list", fix=fix)
    selection = {}
    for item in raw:
        cls = item.get("class") if isinstance(item, dict) else None
        props = item.get("properties") if isinstance(item, dict) else None
        if not isinstance(cls, str) or not cls.startswith("/") or "." not in cls:
            raise AdapterError("invalid", "engine.facts.extra.inventory.fields: %r names no class path" % (item,), fix=fix)
        if props is not None and (not isinstance(props, list) or not all(isinstance(p, str) and p for p in props)):
            raise AdapterError("invalid", "engine.facts.extra.inventory.fields: properties of %s must be a list of names" % cls, fix=fix)
        if cls in selection and (selection[cls] is None or props is None):
            selection[cls] = None
        else:
            selection[cls] = (selection.get(cls) or set()) | set(props) if props is not None else None
    return selection, selection_key(selection)


def _touches_fields(entry, selection):
    """Whether a changed field selection can change this entry: it has fields, or an asset the selection selects."""
    return any("fields" in a or "fieldsError" in a or field_target(a, selection) for a in entry.get("assets", []))


def selection_key(selection):
    """A short hash of a field selection: what the inventory records as `fieldsConfig`."""
    if not selection:
        return None
    canonical = json.dumps({c: sorted(p) if p is not None else None for c, p in selection.items()}, sort_keys=True)
    return hashlib.sha1(canonical.encode()).hexdigest()[:16]


def engine_project_dir(cfg):
    """The folder holding the engine project (its Content, Source and Plugins), from where `/Game` is."""
    scheme = cfg.facts.get("assetId") or {}
    file_head, _ = paths._split_scheme(scheme.get("from", "Content/{path}.uasset"))
    content = file_head.rstrip("/") or "."
    project_dir = os.path.dirname(content) if content != "." else ""
    return os.path.join(cfg.project, *[p for p in project_dir.split("/") if p])


def inherit_components(files, parent_of):
    """Add to each Blueprint's components those of its Blueprint parents in the inventory that it does not override,
    marked `inherited`. Parents' components are taken as read, so a parent read in this run is current."""
    by_class = {}
    for entry in files.values():
        for asset in entry.get("assets", []):
            generated = tag_path((asset.get("tags") or {}).get("GeneratedClass"))
            if generated and "fields" in asset:
                by_class[generated] = asset
    engine = {g for g, a in by_class.items() if a.get("fieldsSource") == "engine"}  # the editor listed them all
    for generated, asset in by_class.items():
        if generated in engine:
            continue
        merged = [c for c in asset.get("components", []) if not c.get("inherited")]
        names = {c["name"] for c in merged}
        for ancestor in hierarchy.ancestors(generated, parent_of):
            parent = by_class.get(ancestor)
            for component in (parent or {}).get("components", []):
                if component.get("inherited") or component["name"] in names:
                    continue
                names.add(component["name"])
                merged.append(dict(component, inherited=True, **{"from": component.get("from") or ancestor}))
        if merged:
            asset["components"] = merged
        else:
            asset.pop("components", None)


def read_previous(path, adapter_id):
    """The previous inventory, or {} when there is none, it is unreadable or another adapter's."""
    if not path or not os.path.isfile(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            previous = json.load(f)
    except (OSError, ValueError):
        return {}
    if not isinstance(previous, dict) or previous.get("format") != 1 or previous.get("adapter") != adapter_id:
        return {}
    return previous if isinstance(previous.get("files"), dict) else {}


class Scan:
    """One inventory run: package headers first, then property values for the assets the field list selects.

    The field list is extended with every known subclass of a listed class (`hierarchy.py`): Blueprint parents from
    the inventory's tags, the project's C++ headers, and the code-class parents an engine run learned earlier (kept in
    the inventory as `parents`). Only packages holding a selected asset are read again for their values."""

    def __init__(self, cfg, previous=None, adapter_id="unreal"):
        self.cfg = cfg
        self.listed, _ = field_selection(cfg)
        self.previous_key = (previous or {}).get("fieldsConfig")
        self.learned = dict((previous or {}).get("parents") or {})
        old_files = (previous or {}).get("files") or {}
        self.where, self.fresh = {}, set()
        self.counts = {"read": 0, "reused": 0, "removed": 0, "unread": 0}
        found_roots = roots(cfg)
        files = {}
        for root in found_roots:
            for relative, package, full in package_files(cfg, root):
                stat = os.stat(full)
                size, mtime = stat.st_size, mtime_ms(stat)
                self.where[relative] = (package, full)
                old = old_files.get(relative)
                if (isinstance(old, dict) and old.get("size") == size and old.get("mtimeMs") == mtime and old.get("id") == package
                        and "unread" not in old):
                    files[relative] = old
                    self.counts["reused"] += 1
                    continue
                files[relative] = self._read(relative, None, size, mtime)
                self.fresh.add(relative)
                self.counts["read"] += 1
        self.counts["removed"] = len([k for k in old_files if k not in files])
        self.inventory = {
            "format": 1,
            "adapter": adapter_id,
            "generatedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "roots": found_roots,
            "files": files,
        }
        self.select()

    def _read(self, relative, selection, size, mtime):
        package, full = self.where[relative]
        try:
            entry = read_package(full, package, selection)
        except (Unreadable, OSError) as e:
            entry = {"id": package, "unread": str(e)}
        entry["size"], entry["mtimeMs"] = size, mtime
        return entry

    def select(self):
        """Read the property values of every selected asset whose entry does not hold them for this selection."""
        files = self.inventory["files"]
        self.selection, self.parent_of = {}, {}
        if self.listed:
            self.parent_of = hierarchy.parents(files, engine_project_dir(self.cfg), self.listed, self.learned)
            self.selection = hierarchy.expand(self.listed, self.parent_of)
        key = selection_key(self.selection)
        for relative, entry in list(files.items()):
            if "unread" in entry or any(a.get("tagsFromEngine") is False for a in entry.get("assets", [])):
                continue  # not readable from its file
            if relative in self.fresh:
                again = any(field_target(a, self.selection) for a in entry.get("assets", []))
            else:
                again = key != self.previous_key and _touches_fields(entry, self.selection)
            if not again:
                continue
            files[relative] = self._read(relative, self.selection, entry["size"], entry["mtimeMs"])
            if relative not in self.fresh:
                self.fresh.add(relative)
                self.counts["reused"] -= 1
                self.counts["read"] += 1
        if self.selection:
            inherit_components(files, self.parent_of)
        self.previous_key = key
        self.inventory.pop("fieldsConfig", None)
        if key:
            self.inventory["fieldsConfig"] = key
        self.inventory.pop("parents", None)
        if self.learned:
            self.inventory["parents"] = dict(sorted(self.learned.items()))
        self.counts["unread"] = len([e for e in files.values() if "unread" in e])

    def learn(self, parents):
        """Add code-class parents the engine reported; when they select more assets, read those assets' values."""
        new = {k: v for k, v in parents.items() if k != v and self.learned.get(k) != v}
        if not new:
            return False
        self.learned.update(new)
        self.select()
        return True


def scan(cfg, previous=None, adapter_id="unreal"):
    """(inventory, counts): every package read or reused from `previous` (an inventory); nothing written."""
    run = Scan(cfg, previous, adapter_id)
    return run.inventory, run.counts


def engine_request(inventory, listed, selection, parent_of):
    """ARGS for editor/fields.py: the listed classes, and every asset the editor may find derives from one of them,
    with what the file already says about it (its property names, soft references and components)."""
    native_of = {}
    for entry in inventory["files"].values():
        for asset in entry.get("assets", []):
            tags = asset.get("tags") or {}
            generated, native = tag_path(tags.get("GeneratedClass")), tag_path(tags.get("NativeParentClass"))
            if generated and native:
                native_of[generated] = native

    def soft_of(holder):
        return {r["property"].split(".")[0].split("[")[0] for r in holder.get("fieldReferences", []) if r["kind"] == "soft"}

    def described(holder):
        return {"known": sorted(holder.get("fields") or {}), "soft": sorted(soft_of(holder))}

    # What Blueprint classes' own defaults say about property names and soft references, for their subclasses: the
    # editor's Python neither keeps a property's case nor tells a soft reference from a hard one.
    by_class = {}
    for entry in inventory["files"].values():
        for asset in entry.get("assets", []):
            generated = tag_path((asset.get("tags") or {}).get("GeneratedClass"))
            if generated and "fields" in asset:
                by_class[generated] = (set(asset["fields"]), soft_of(asset))

    def inherited(cls):
        known, soft = set(), set()
        for c in [cls] + hierarchy.ancestors(cls, parent_of):
            k, s = by_class.get(c, ((), ()))
            known |= set(k)
            soft |= set(s)
        return known, soft

    assets = []
    for entry in inventory["files"].values():
        for asset in entry.get("assets", []):
            cls = asset.get("class") or ""
            generated = tag_path((asset.get("tags") or {}).get("GeneratedClass"))
            item = {"id": asset["id"], "class": cls}
            if generated and cls not in selection:
                item.update({"class": generated, "defaults": generated})
                native = native_of.get(generated)
            else:
                native = cls if cls.startswith("/Script/") else native_of.get(cls)
            if native:
                item["native"] = native
            target = field_target(asset, selection)
            if target:
                item["listed"] = [c for c in [target[1]] + hierarchy.ancestors(target[1], parent_of) if c in listed]
            if "fields" in asset:
                item.update(described(asset))
            known, soft = inherited(item["class"])
            if known or soft:
                item["known"] = sorted(set(item.get("known", [])) | known)
                item["soft"] = sorted(set(item.get("soft", [])) | soft)
            if "fields" in asset:
                item["components"] = [dict(described(c), name=c["name"], path=c["path"]) for c in asset.get("components", [])
                                      if not c.get("inherited") and c.get("path")]
            assets.append(item)
    return {"listed": {c: sorted(p) if p is not None else None for c, p in listed.items()}, "assets": assets}


def apply_effective(inventory, reported):
    """Replace the file's values by the editor's effective ones, marked `fieldsSource: "engine"`. An asset the editor
    could not read keeps its file values and gets `fieldsEngineError`. Returns how many assets got engine values."""
    done = 0
    for entry in inventory["files"].values():
        for asset in entry.get("assets", []):
            got = reported.get(asset["id"])
            if got is None:
                continue
            if "error" in got:
                asset["fieldsEngineError"] = got["error"]
                continue
            asset.pop("fieldsEngineError", None)
            asset.pop("fieldsError", None)
            file_components = {c["name"]: c for c in asset.get("components", [])}
            asset["fields"], refs = _merged(got["fields"], got.get("fieldReferences"), asset.get("fields"), asset.get("fieldReferences"))
            components = []
            for component in got.get("components") or []:
                mine = file_components.get(component["name"]) or {}
                component["fields"], component_refs = _merged(component.get("fields") or {}, component.get("fieldReferences"),
                                                              mine.get("fields"), mine.get("fieldReferences"))
                component.pop("fieldReferences", None)
                if component_refs:
                    component["fieldReferences"] = component_refs
                if mine.get("from") and "from" not in component:
                    component["from"] = mine["from"]
                components.append(component)
            asset["fieldsSource"] = "engine"
            for key, value in (("fieldReferences", refs), ("components", components)):
                if value:
                    asset[key] = value
                else:
                    asset.pop(key, None)
            done += 1
    return done


def _merged(engine, engine_refs, file, file_refs):
    """The engine's values, with a value the editor could not give in full (`unparsed` in it) taken from the file when
    the file sets it: what a file sets is that object's effective value."""
    fields, refs = {}, [r for r in engine_refs or [] if r["property"].split(".")[0].split("[")[0]]
    file = file or {}
    taken = set()
    for name, value in engine.items():
        if name in file and _has_unparsed(value):
            fields[name] = file[name]
            taken.add(name)
        else:
            fields[name] = value
    refs = [r for r in refs if _top(r) not in taken] + [r for r in file_refs or [] if _top(r) in taken]
    return fields, refs


def _has_unparsed(value):
    if isinstance(value, dict):
        return set(value) == {"unparsed"} or any(_has_unparsed(v) for v in value.values())
    return isinstance(value, list) and any(_has_unparsed(v) for v in value)


def _top(reference):
    return reference["property"].split(".")[0].split("[")[0]


def apply_engine(inventory, reported):
    """Fill `unread` entries from what the editor's Asset Registry reported for their packages."""
    filled = 0
    for entry in inventory["files"].values():
        if "unread" not in entry:
            continue
        got = reported.get(entry["id"])
        if not got:
            continue
        unloaded = sorted({a["class"] for a in got.get("assets", []) if a.get("classLoaded") is False})
        if unloaded:
            entry["unread"] += "; the editor could not load %s either (build the project's editor modules)" % ", ".join(unloaded)
            continue
        references = [{"to": to, "kind": "native" if to.startswith("/Script/") else "hard"} for to in got.get("hard", []) if to != entry["id"]]
        hard = {r["to"] for r in references}
        references += [{"to": to, "kind": "soft"} for to in got.get("soft", []) if to not in hard and to != entry["id"]]
        entry.pop("unread")
        entry["assets"] = [{"id": a["id"], "class": a["class"], "tags": {}, "tagsFromEngine": False} for a in got.get("assets", [])]
        entry["references"] = sorted(references, key=lambda r: r["to"])
        leaf = entry["id"].rsplit("/", 1)[-1]
        main = "%s.%s" % (entry["id"], leaf)
        if any(a["id"] == main for a in entry["assets"]):
            entry["main"] = main
        filled += 1
    return filled


def compare(inventory, reported):
    """Problems where the reader and the editor's Asset Registry disagree, for the conformance check.

    Known differences are not problems: the registry hides Blueprint generated classes, does not list every code
    module a package imports, and reports a soft reference to a package that is also a hard one only as hard. A code
    class the editor could not load is one problem, and its packages' references are not compared.
    """
    problems = []
    by_package = {e["id"]: e for e in inventory["files"].values()}
    unloaded = {}
    for package, got in reported.items():
        for a in got.get("assets", []):
            if a.get("classLoaded") is False:
                unloaded.setdefault(a["class"], set()).add(package)
    for cls, packages in sorted(unloaded.items()):
        problems.append({"message": "the editor could not load %s, so its registry holds no references for the %d packages of that class; they were not compared" % (cls, len(packages)),
                         "fix": "build the project's editor modules for this engine and run the check again"})
    skipped = set().union(*unloaded.values()) if unloaded else set()
    for package, got in sorted(reported.items()):
        entry = by_package.get(package)
        if entry is None:
            problems.append({"message": "%s is in the engine's registry but not in the inventory" % package,
                             "fix": "check the content roots (assetId fact, plugins with CanContainContent)"})
            continue
        if "unread" in entry:
            problems.append({"message": "%s could not be read: %s" % (package, entry["unread"]),
                             "fix": "update the adapter's package reader for this engine version"})
            continue
        assets = {a["id"]: a for a in entry.get("assets", [])}
        for a in got.get("assets", []):
            mine = assets.get(a["id"])
            if mine is None:
                problems.append({"message": "%s: the reader found no asset %s" % (package, a["id"])})
                continue
            if mine["class"] != a["class"]:
                problems.append({"message": "%s: class %s, the engine says %s" % (a["id"], mine["class"], a["class"])})
            for tag, value in sorted(a.get("tags", {}).items()):
                if mine.get("tags", {}).get(tag) != value:
                    problems.append({"message": "%s: tag %s is %r, the engine says %r" % (a["id"], tag, mine.get("tags", {}).get(tag), value)})
        if package in skipped:
            continue
        for kind in REFERENCE_KINDS:
            mine = {r["to"] for r in entry.get("references", []) if r["kind"] == kind}
            theirs = {to for to in got.get(kind, []) if not to.startswith("/Script/")}
            if kind == "soft":
                theirs -= {r["to"] for r in entry.get("references", []) if r["kind"] == "hard"}
            for to in sorted(theirs - mine):
                problems.append({"message": "%s: the engine has a %s reference to %s that the reader missed" % (package, kind, to)})
            for to in sorted(mine - theirs):
                problems.append({"message": "%s: the reader has a %s reference to %s the engine does not" % (package, kind, to)})
    return problems


def write(cfg, relative, inventory):
    """Write the inventory atomically at a project path."""
    full = paths.absolute(cfg.project, paths.portable(relative, "inventory file"))
    os.makedirs(os.path.dirname(full) or ".", exist_ok=True)
    temporary = full + ".tmp-%d" % os.getpid()
    with open(temporary, "w", encoding="utf-8") as f:
        json.dump(inventory, f, separators=(",", ":"), sort_keys=True)
    os.replace(temporary, full)
    return full
