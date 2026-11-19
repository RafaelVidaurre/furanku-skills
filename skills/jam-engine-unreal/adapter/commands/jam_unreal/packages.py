"""Read an editor-saved Unreal package's header without the engine: what the Asset Registry would gather from it.

The header holds the package summary, the name, import and export tables, the soft package references, the
searchable names, the asset registry block (each asset's object path, class and tags) and the dependency block
(which references the game needs). Export data is read only for the property values a caller asks for, by class
(`fields.py`).

Only package versions this reader was checked against are read; anything else raises `Unreadable` with the reason,
so the caller can fall back to the engine. Layout follows the engine's own serializers: FPackageFileSummary,
FObjectImport, FObjectExport and FPackageReader.
"""
import os
import struct

from .fields import FieldsError, Package, read_fields, read_soft_object_path

PACKAGE_TAG = 0x9E2A83C1
LEGACY_VERSIONS = (-8, -9)          # UE5 summaries; -9 adds a contract on early exits, not a layout change
UE4_VERSION = 522                    # every UE5 package is saved with the final UE4 version
UE5_FIRST, UE5_LAST = 1000, 1018     # INITIAL_VERSION .. IMPORT_TYPE_HIERARCHIES (5.8)
PKG_FILTER_EDITOR_ONLY = 0x80000000  # cooked

# EUnrealEngineObjectUE5Version values the layout branches on
OPTIONAL_RESOURCES = 1003
REMOVE_OBJECT_EXPORT_PACKAGE_GUID = 1005
TRACK_OBJECT_EXPORT_IS_INHERITED = 1006
ADD_SOFTOBJECTPATH_LIST = 1008
DATA_RESOURCES = 1009
SCRIPT_SERIALIZATION_OFFSET = 1010
ASSETREGISTRY_PACKAGEBUILDDEPENDENCIES = 1013
METADATA_SERIALIZATION_OFFSET = 1014
VERSE_CELLS = 1015
PACKAGE_SAVED_HASH = 1016
IMPORT_TYPE_HIERARCHIES = 1018


class Unreadable(Exception):
    """The package is not one this reader can read; the message says why."""


class _Reader:
    def __init__(self, f, size):
        self.f, self.size = f, size
        self.base, self.buf, self.pos = 0, b"", 0

    def window(self, offset, length):
        if offset < 0 or offset > self.size:
            raise Unreadable("offset %d is outside the file" % offset)
        self.f.seek(offset)
        self.base, self.buf, self.pos = offset, self.f.read(min(length, self.size - offset)), 0

    def seek(self, offset, need=1 << 16):
        if self.base <= offset and offset + need <= self.base + len(self.buf):
            self.pos = offset - self.base
        else:
            self.window(offset, max(need, 1 << 16))

    def tell(self):
        return self.base + self.pos

    def take(self, n):
        if n < 0:
            raise Unreadable("negative length")
        if self.pos + n > len(self.buf):
            if self.tell() + n > self.size:
                raise Unreadable("read past the end of the file")
            self.window(self.tell(), max(n, 1 << 16))
        out = self.buf[self.pos:self.pos + n]
        self.pos += n
        return out

    def i32(self):
        return struct.unpack("<i", self.take(4))[0]

    def u32(self):
        return struct.unpack("<I", self.take(4))[0]

    def i64(self):
        return struct.unpack("<q", self.take(8))[0]

    def u16(self):
        return struct.unpack("<H", self.take(2))[0]

    def string(self):
        n = self.i32()
        if n == 0:
            return ""
        if n > 0:
            if n > 1 << 20:
                raise Unreadable("string length %d" % n)
            return self.take(n)[:-1].decode("latin-1")
        if -n > 1 << 20:
            raise Unreadable("string length %d" % n)
        return self.take(-n * 2)[:-2].decode("utf-16-le")

    def count(self, what, each=1):
        n = self.i32()
        if n < 0 or n * each > self.size:
            raise Unreadable("%s count %d" % (what, n))
        return n


def _engine_version(r):
    major, minor, patch, changelist = r.u16(), r.u16(), r.u16(), r.u32()
    branch = r.string()
    return "%d.%d.%d-%d%s" % (major, minor, patch, changelist, ("+" + branch) if branch else "")


def _summary(r):
    if r.u32() != PACKAGE_TAG:
        raise Unreadable("not an Unreal package (wrong tag)")
    legacy = r.i32()
    if legacy not in LEGACY_VERSIONS:
        raise Unreadable("package summary version %d is not one this reader knows (UE5 packages use -8 or -9)" % legacy)
    r.i32()  # LegacyUE3Version
    ue4, ue5, licensee = r.i32(), r.i32(), r.i32()
    if ue4 == 0 and ue5 == 0:
        raise Unreadable("unversioned package (cooked)")
    if ue4 != UE4_VERSION or not UE5_FIRST <= ue5 <= UE5_LAST:
        raise Unreadable("package version %d/%d is not one this reader knows (it reads UE5 %d-%d)" % (ue4, ue5, UE5_FIRST, UE5_LAST))
    s = {"ue5": ue5, "licensee": licensee}
    if ue5 >= PACKAGE_SAVED_HASH:
        s["hash"] = r.take(20).hex()
        r.i32()  # TotalHeaderSize
    s["custom"] = {}
    for _ in range(r.count("custom version", 20)):
        a, b, c, d, version = struct.unpack("<IIIIi", r.take(20))
        s["custom"]["%08X%08X%08X%08X" % (a, b, c, d)] = version
    if ue5 < PACKAGE_SAVED_HASH:
        r.i32()
    r.string()  # PackageName (deprecated)
    s["flags"] = r.u32()
    if s["flags"] & PKG_FILTER_EDITOR_ONLY:
        raise Unreadable("cooked package")
    s["name_count"], s["name_offset"] = r.i32(), r.i32()
    s["soft_path_count"], s["soft_path_offset"] = (r.i32(), r.i32()) if ue5 >= ADD_SOFTOBJECTPATH_LIST else (0, 0)
    r.string()  # LocalizationId
    r.i32(); r.i32()  # gatherable text data
    s["export_count"], s["export_offset"] = r.i32(), r.i32()
    s["import_count"], s["import_offset"] = r.i32(), r.i32()
    if ue5 >= VERSE_CELLS:
        r.i32(); r.i32(); r.i32(); r.i32()
    if ue5 >= METADATA_SERIALIZATION_OFFSET:
        r.i32()
    r.i32()  # DependsOffset
    s["soft_count"], s["soft_offset"] = r.i32(), r.i32()
    s["searchable_offset"] = r.i32()
    s["thumbnail_offset"] = r.i32()
    if ue5 >= IMPORT_TYPE_HIERARCHIES:
        r.i32(); r.i32()
    if ue5 < PACKAGE_SAVED_HASH:
        s["hash"] = r.take(16).hex()  # the legacy package guid
    r.take(16)  # PersistentGuid
    r.take(r.count("generation", 8) * 8)
    s["saved"] = _engine_version(r)
    _engine_version(r)  # CompatibleWithEngineVersion
    r.u32()  # CompressionFlags
    if r.i32() != 0:
        raise Unreadable("compressed package")
    r.u32()  # PackageSource
    for _ in range(r.count("additional package")):
        r.string()
    s["registry_offset"] = r.i32()
    return s


def _names(r, s):
    r.seek(s["name_offset"])
    names = []
    for _ in range(s["name_count"]):
        names.append(r.string())
        r.u32()  # hashes
    return names


def _name(r, names):
    index, number = r.i32(), r.i32()
    if not 0 <= index < len(names):
        raise Unreadable("name index %d of %d" % (index, len(names)))
    return names[index] if number == 0 else "%s_%d" % (names[index], number - 1)


def _imports(r, s, names):
    if s["import_count"] < 0:
        raise Unreadable("import count")
    r.seek(s["import_offset"], s["import_count"] * 40)
    out = []
    for _ in range(s["import_count"]):
        class_package, class_name, outer, object_name = _name(r, names), _name(r, names), r.i32(), _name(r, names)
        package_name = _name(r, names)
        if s["ue5"] >= OPTIONAL_RESOURCES:
            r.u32()
        out.append({"class_package": class_package, "class": class_name, "outer": outer, "name": object_name,
                    "package": None if package_name == "None" else package_name})
    return out


def _exports(r, s, names):
    if s["export_count"] < 0:
        raise Unreadable("export count")
    r.seek(s["export_offset"], s["export_count"] * 112)
    out = []
    for _ in range(s["export_count"]):
        class_index, _super, _template, outer = r.i32(), r.i32(), r.i32(), r.i32()
        name = _name(r, names)
        r.u32()  # flags
        serial_size, serial_offset = r.i64(), r.i64()
        r.u32(); r.u32(); r.u32()  # forced export, not for client, not for server
        if s["ue5"] < REMOVE_OBJECT_EXPORT_PACKAGE_GUID:
            r.take(16)
        if s["ue5"] >= TRACK_OBJECT_EXPORT_IS_INHERITED:
            r.u32()
        r.u32()  # package flags
        r.u32()  # not always loaded for editor game
        is_asset = r.u32() != 0
        if s["ue5"] >= OPTIONAL_RESOURCES:
            r.u32()
        r.i32(); r.i32(); r.i32(); r.i32(); r.i32()  # preload dependencies
        script = (r.i64(), r.i64()) if s["ue5"] >= SCRIPT_SERIALIZATION_OFFSET else (0, serial_size)
        out.append({"class": class_index, "outer": outer, "name": name, "is_asset": is_asset,
                    "offset": serial_offset, "size": serial_size, "script": script})
    return out


def _soft_paths(r, s, names):
    """The package's soft object path list, which soft references in export data index into."""
    if s["soft_path_count"] <= 0:
        return []
    r.seek(s["soft_path_offset"])
    def sub_path():  # stored without a terminating NUL, unlike the header's other strings
        n = r.i32()
        if abs(n) > 1 << 20:
            raise Unreadable("string length %d" % n)
        return r.take(n).decode("utf-8", "replace").rstrip("\0") if n >= 0 else r.take(-2 * n).decode("utf-16-le").rstrip("\0")
    return [read_soft_object_path(lambda: _name(r, names), sub_path) for _ in range(s["soft_path_count"])]


def _import_package(imports, index):
    """The package an import lives in: its own package name, or the outermost import (FPackageDependencyData)."""
    for _ in range(len(imports)):
        if not 0 <= index < len(imports):
            return None
        imp = imports[index]
        if imp["package"]:
            return imp["package"]
        if imp["outer"] == 0:
            return imp["name"]
        if imp["outer"] > 0:
            return None
        index = -imp["outer"] - 1
    return None


def _soft_references(r, s, names):
    if s["soft_count"] <= 0 or s["soft_offset"] <= 0:
        return []
    r.seek(s["soft_offset"], s["soft_count"] * 8)
    return [_name(r, names) for _ in range(s["soft_count"])]


def _searchable_names(r, s, names, imports, package):
    if s["searchable_offset"] <= 0:
        return []
    r.seek(s["searchable_offset"])
    out = []
    for _ in range(r.count("searchable name entry")):
        index = r.i32()
        values = [_name(r, names) for _ in range(r.count("searchable name"))]
        on = package if index >= 0 else (_import_package(imports, -index - 1) or "")
        out.append({"on": on, "values": values})
    return out


def _bits(r):
    n = r.count("bit")
    words = [r.u32() for _ in range((n + 31) // 32)]
    return [bool(words[i // 32] >> (i % 32) & 1) for i in range(n)]


def _registry(r, s, names):
    """(assets, dependency data offset) from the asset registry block."""
    if s["registry_offset"] <= 0:
        return [], -1
    r.seek(s["registry_offset"])
    dependency_offset = r.i64()
    assets = []
    for _ in range(r.count("asset", 8)):
        path, cls = r.string(), r.string()
        tags = {}
        for _ in range(r.count("tag", 8)):
            key, value = r.string(), r.string()
            if key and value:
                tags[key] = value
        assets.append({"path": path, "class": cls, "tags": tags})
    return assets, dependency_offset


def _dependency_flags(r, s, names, offset, n_imports, n_soft):
    """Which imports and soft references the game uses, and the build-only package dependencies."""
    if offset is None or offset < 0:
        return [True] * n_imports, [True] * n_soft, []
    r.seek(offset)
    imports_used, soft_used = _bits(r), _bits(r)
    if len(imports_used) != n_imports or len(soft_used) != n_soft:
        raise Unreadable("dependency flags do not match the import and soft reference tables")
    build = []
    if s["ue5"] >= ASSETREGISTRY_PACKAGEBUILDDEPENDENCIES:
        for _ in range(r.count("build dependency", 12)):
            build.append(_name(r, names))
            r.u32()
    return imports_used, soft_used, build


def _main_asset(package, assets):
    """The asset that stands for the package: the one named like it, else its only top-level asset."""
    leaf = package.rsplit("/", 1)[-1]
    named = [a for a in assets if a["id"] == "%s.%s" % (package, leaf)]
    if named:
        return named[0]["id"]
    top = [a for a in assets if "." in a["id"] and ":" not in a["id"] and not a["id"].endswith("_C")]
    return top[0]["id"] if len(top) == 1 else None


SCS_NODE = "/Script/Engine.SCS_Node"
INHERITABLE_COMPONENT_HANDLER = "/Script/Engine.InheritableComponentHandler"


def tag_path(value):
    """The object path in a registry tag such as ParentClass (`/Script/CoreUObject.Class'/Script/Engine.Actor'`)."""
    if not value or value == "None":
        return None
    if "'" in value:
        parts = value.split("'")
        return parts[1] if len(parts) >= 3 and parts[1].startswith("/") else None
    return value if value.startswith("/") else None


def field_target(asset, fields):
    """How `fields` selects an asset: ("object", class) when its own class is listed, ("defaults", generated class)
    when it is a Blueprint whose generated class is, else None."""
    if asset.get("class") in fields:
        return "object", asset["class"]
    generated = tag_path((asset.get("tags") or {}).get("GeneratedClass"))
    if generated in fields:
        return "defaults", generated
    return None


class _Exports:
    """The package's exports as a field reader needs them: paths, classes, outers and their tagged properties."""

    def __init__(self, f, size, s, names, imports, exports, package):
        self.f, self.size, self.s, self.names, self.exports = f, size, s, names, exports
        self.context = Package(package, s["ue5"], names, imports, exports, [], s.get("custom"))
        self.soft_loaded = False
        self.paths, self.classes = {}, {}
        for i in range(1, len(exports) + 1):
            try:
                self.paths[i] = self.context.object_path(i)
                self.classes[i] = self.context.class_path(i)
            except FieldsError:
                continue
        self.index = {path: i for i, path in self.paths.items()}

    def under(self, ancestor):
        """Exports whose outer chain reaches `ancestor`, in package order."""
        out = []
        for i in self.paths:
            outer, seen = self.exports[i - 1]["outer"], 0
            while outer > 0 and outer != ancestor and seen <= len(self.exports):
                outer, seen = self.exports[outer - 1]["outer"], seen + 1
            if outer == ancestor:
                out.append(i)
        return out

    def read(self, i, select=None):
        """(values, references) of export `i`; raises FieldsError when they cannot be read."""
        try:
            if not self.soft_loaded:
                self.context.soft_paths, self.soft_loaded = _soft_paths(_Reader(self.f, self.size), self.s, self.names), True
            export = self.exports[i - 1]
            start, end = export["script"]
            if not 0 <= start <= end <= export["size"] or export["offset"] + export["size"] > self.size:
                raise FieldsError("the export's data is outside the file")
            if start == end and self.s["ue5"] >= SCRIPT_SERIALIZATION_OFFSET:
                raise FieldsError("the object stores no tagged properties: its class serializes itself")
            self.f.seek(export["offset"] + start)
            return read_fields(self.f.read(end - start), self.context, select)
        except (Unreadable, struct.error, UnicodeDecodeError) as e:
            raise FieldsError(str(e) or type(e).__name__)

    def component(self, name, i, cls=None, declared_by=None):
        out = {"name": name, "class": cls or self.classes.get(i, ""), "path": self.paths[i]}
        if declared_by:
            out["from"] = declared_by
        try:
            values, refs = self.read(i)
        except FieldsError as e:
            out["fieldsError"] = str(e)
            return out
        out["fields"] = values
        if refs:
            out["fieldReferences"] = refs
        return out

    def subobjects(self, owner, named=None):
        """Instanced subobjects of export `owner`, named by the property of the owner that holds one (`named`:
        {path: property}), else by their path below it."""
        prefix = self.paths[owner]
        out = []
        for i in self.under(owner):
            rest = self.paths[i][len(prefix):].lstrip(":.")
            out.append(self.component((named or {}).get(self.paths[i], rest), i))
        return out

    def blueprint_components(self, generated):
        """The components a Blueprint class adds (its construction script's templates) and the inherited ones it
        changes (its inheritable component handler's templates)."""
        out = []
        for i in self.under(generated):
            if self.classes.get(i) == SCS_NODE:
                try:
                    node, _ = self.read(i)
                except FieldsError:
                    continue
                template = self.index.get(((node.get("ComponentTemplate") or {}).get("object")) or "")
                if template is None:
                    continue
                name = node.get("InternalVariableName") or self.exports[template - 1]["name"].replace("_GEN_VARIABLE", "")
                out.append(self.component(name, template))
            elif self.classes.get(i) == INHERITABLE_COMPONENT_HANDLER:
                try:
                    handler, _ = self.read(i, {"Records"})
                except FieldsError:
                    continue
                for record in handler.get("Records") or []:
                    if not isinstance(record, dict):
                        continue
                    key = record.get("ComponentKey") or {}
                    template = self.index.get(((record.get("ComponentTemplate") or {}).get("object")) or "")
                    if template is None or not key.get("SCSVariableName"):
                        continue
                    declared = (key.get("OwnerClass") or {}).get("object")
                    out.append(self.component(key["SCSVariableName"], template, (record.get("ComponentClass") or {}).get("object"), declared))
        return out


def _read_fields(f, size, s, names, imports, exports, package, assets, fields):
    """Fill `fields`, `fieldReferences` and `components` (or `fieldsError`) on each asset `fields` selects: an object
    of a listed class gets its own values and instanced subobjects; a Blueprint whose generated class is listed gets
    that class's defaults and its components."""
    table = _Exports(f, size, s, names, imports, exports, package)
    for asset in assets:
        target = field_target(asset, fields)
        index = table.index.get(asset["id"])
        if target is None or index is None:
            continue
        how, cls = target
        components = []
        if how == "object":
            if table.classes.get(index) != cls:
                continue
            values_of = index
        else:
            generated = table.index.get(cls)
            values_of = table.index.get("%s.Default__%s" % (package, cls.rsplit(".", 1)[-1]))
            if values_of is None or generated is None:
                asset["fieldsError"] = "the package holds no class default object for %s" % cls
                continue
            components = table.blueprint_components(generated)
        try:
            values, refs = table.read(values_of)
        except FieldsError as e:
            asset["fieldsError"] = str(e)
            continue
        named = {}  # a class default's subobject is named by the property that holds it (CharacterMovement)
        for ref in refs:
            if "." not in ref["property"] and "[" not in ref["property"] and ref["property"] != "RootComponent":
                named.setdefault(ref["to"], ref["property"])
        components = table.subobjects(values_of, named if how == "defaults" else None) + components
        select = fields[cls]
        if select is not None:
            values = {k: v for k, v in values.items() if k.split("[")[0] in select}
            refs = [r for r in refs if r["property"].split(".")[0].split("[")[0] in select]
        asset["fields"] = values
        asset["fieldsSource"] = "file"
        if refs:
            asset["fieldReferences"] = refs
        if components:
            asset["components"] = components


def read_package(path, package, fields=None):
    """What the Asset Registry would gather from one package file, as an inventory file entry (without size and
    mtime). `package` is the package's engine id (`/Game/Props/SM_Crate`), which follows from where the file is.

    `fields` ({class path: set of property names, or None for all}) selects the assets whose property values are
    read from their export data. A failure there leaves the header data and sets `fieldsError` on the asset."""
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        r = _Reader(f, size)
        r.window(0, 1 << 16)
        try:
            s = _summary(r)
            names = _names(r, s)
            imports = _imports(r, s, names)
            exports = _exports(r, s, names)  # assets come from the registry block
            soft = _soft_references(r, s, names)
            searchable = _searchable_names(r, s, names, imports, package)
            registry, dependency_offset = _registry(r, s, names)
            imports_used, soft_used, build = _dependency_flags(r, s, names, dependency_offset, len(imports), len(soft))
        except (struct.error, UnicodeDecodeError) as e:
            raise Unreadable("the header does not parse: %s" % e)

        assets = []
        for a in registry:
            object_path = a["path"] if a["path"].startswith("/") else "%s.%s" % (package, a["path"])
            assets.append({"id": object_path, "class": a["class"], "tags": a["tags"]})
        if fields:
            _read_fields(f, size, s, names, imports, exports, package, assets, fields)

    # One entry per target with its strongest kind; editor-only only when no reference to it is used in game.
    refs = {}

    def add(to, kind, in_game):
        if not to or to == "None" or to == package:
            return
        if to.startswith("/Script/"):
            kind = "native"
        rank = {"hard": 0, "native": 0, "soft": 1, "build": 2}
        current = refs.get(to)
        if current is None:
            refs[to] = {"kind": kind, "in_game": in_game}
            return
        if rank[kind] < rank[current["kind"]]:
            current["kind"] = kind
        current["in_game"] = current["in_game"] or in_game

    for i in range(len(imports)):
        add(_import_package(imports, i), "hard", imports_used[i])
    for i, target in enumerate(soft):
        add(target, "soft", soft_used[i])
    for target in build:
        add(target, "build", False)
    references = []
    for to in sorted(refs):
        entry = {"to": to, "kind": refs[to]["kind"]}
        if not refs[to]["in_game"] and refs[to]["kind"] != "native":
            entry["editorOnly"] = True
        references.append(entry)

    out = {"id": package, "saved": s["saved"], "assets": assets, "references": references}
    if s.get("hash"):
        out["hash"] = s["hash"]
    main = _main_asset(package, assets)
    if main:
        out["main"] = main
    names_out = [n for n in searchable if n["values"]]
    if names_out:
        out["names"] = names_out
    return out
