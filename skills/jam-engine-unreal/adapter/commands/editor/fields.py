"""Effective property values of the assets a project's field list selects: what the engine holds after loading them,
inherited and native defaults included. Runs inside the Unreal editor, for `jam engine inventory --engine`.

ARGS: {"listed": {"<class path>": ["<property>", ...] | null},
       "assets": [{"id": "<asset id>", "defaults": "<generated class>" (a Blueprint: read its class defaults),
                   "class": "<class path>", "native": "<nearest code class, when known>",
                   "listed": [<listed classes it derives from, as the files say>],
                   "known": ["<property the file sets>", ...], "soft": ["<property holding a soft reference>", ...],
                   "components": [{"name", "path", "known": [...], "soft": [...]}]}]}

An asset is read when its class derives from a listed class, which the editor decides from the loaded classes. Its
properties are the listed class's `properties`, or else every editor-visible property the listed class and its
subclasses declare (inherited engine properties left out). Values use the inventory's encoding (docs/inventory.md);
a text gives its display string. Python names its properties in snake case: names the file uses keep their case,
other names are rebuilt from Python's and checked against the class. Returns {"engine", "parents": {native class:
its parent}, "assets": {"<asset id>": {"fields", "components"} | {"error"}}}.
"""
import math
import re
import struct

import unreal

PROPERTY_LINE = re.compile(r"^- ``(\w+)`` \(([^)]*)\)", re.M)


def _number(value):
    if math.isnan(value) or math.isinf(value):
        return "NaN" if math.isnan(value) else ("Infinity" if value > 0 else "-Infinity")
    single = struct.unpack("<f", struct.pack("<f", value))[0]
    if single == value:  # a value a float holds exactly: the shortest form that reads back as that float
        for digits in range(6, 10):
            short = float("%.*g" % (digits, value))
            if struct.unpack("<f", struct.pack("<f", short))[0] == value:
                return short
    return value


_boxes = {}


def _enum_name(value):
    """`EAttachmentRule::KeepWorld`, or `ECC_Camera` for an enum whose names carry their own prefix, as the file says."""
    kind = type(value)
    if kind not in _boxes:
        box = type("JamEnumBox%d" % len(_boxes), (unreal.StructBase,), {"value": unreal.uproperty(kind)})
        _boxes[kind] = unreal.ustruct()(box)
    holder = _boxes[kind]()
    holder.set_editor_property("value", value)
    short = holder.export_text()[len("(value="):-1]
    enum = kind.static_enum().get_name()
    if "::" in short or re.match(r"^[A-Z][A-Z0-9]*_", short):
        return short
    return "%s::%s" % (enum, short)


def _struct_keys(value):
    """The top-level field names of a struct, from its exported text `(Name=...,Other=(...))`."""
    text = value.export_text()
    if not text.startswith("("):
        return None
    keys, depth, quoted, start = [], 0, False, 1
    i = 1
    while i < len(text):
        ch = text[i]
        if quoted:
            if ch == "\\":
                i += 1
            elif ch == '"':
                quoted = False
        elif ch == '"':
            quoted = True
        elif ch == "(":
            depth += 1
        elif ch == ")":
            if depth == 0:
                break
            depth -= 1
        elif ch == "=" and depth == 0 and start is not None:
            keys.append(text[start:i].strip())
            start = None
        elif ch == "," and depth == 0:
            start = i + 1
        i += 1
    return keys


def _python_names(kind):
    """{python name: type text} of the editor properties a wrapped type's docstring lists."""
    doc = kind.__doc__ or ""
    head = doc.find("**Editor Properties:**")
    return dict(PROPERTY_LINE.findall(doc[head:])) if head >= 0 else {}


def _original(obj, python, type_text, known):
    """The property's own name for a Python name: one the file used, else rebuilt (MaxSpeed, bIsMoving) and checked."""
    plain = python.replace("_", "").lower()
    for name in known:
        if name.replace("_", "").lower() in (plain, "b" + plain):
            return name
    pascal = "".join(part[:1].upper() + part[1:] for part in python.split("_"))
    candidates = (["b" + pascal] if type_text == "bool" else []) + [pascal, "In" + pascal, python]
    for candidate in candidates:
        try:
            obj.get_editor_property(candidate)
            return candidate
        except Exception:
            continue
    return python


def _structure(value, soft=False):
    if isinstance(value, (unreal.SoftObjectPath, unreal.SoftClassPath)):
        text = value.export_text()
        return {"soft": text} if text and text != "None" else None
    if isinstance(value, unreal.Guid):
        return unreal.GuidLibrary.conv_guid_to_string(value)
    if isinstance(value, unreal.InstancedStruct):
        if value.export_text() == "None":
            return None
        if not hasattr(value, "get_value"):  # 5.8's Python cannot open one
            return {"unparsed": "InstancedStruct"}
        return {"struct": value.export_text().split("(", 1)[0], "value": encode(value.get_value())}
    name = type(value).__name__
    if name == "GameplayTag":
        return str(value.get_editor_property("tag_name"))
    if name == "GameplayTagContainer":
        return [str(t.get_editor_property("tag_name")) for t in value.get_editor_property("gameplay_tags")]
    if name.startswith("PerPlatform"):
        return {"Default": encode(value.get_editor_property("Default")),
                "PerPlatform": {str(k): encode(v) for k, v in value.get_editor_property("PerPlatform").items()}}
    keys = _struct_keys(value)
    if keys is None:
        keys = [_original(value, python, kind, ()) for python, kind in _python_names(type(value)).items()]
    if not keys:
        return {"unparsed": name}
    out = {}
    for key in keys:
        try:
            out[key] = encode(value.get_editor_property(key), soft)
        except Exception:
            out[key] = {"unparsed": "%s.%s" % (name, key)}
    return out


def encode(value, soft=False):
    """A Python value from get_editor_property in the inventory's encoding."""
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, int) and not isinstance(value, unreal.EnumBase):
        return value
    if isinstance(value, float):
        return _number(value)
    if isinstance(value, (unreal.Name, unreal.Text)):
        return str(value)
    if isinstance(value, unreal.EnumBase):
        return _enum_name(value)
    if isinstance(value, unreal.Object):
        path = value.get_path_name()
        return {"soft": path} if soft else {"object": path, "class": value.get_class().get_path_name()}
    if isinstance(value, unreal.StructBase):
        return _structure(value, soft)
    if isinstance(value, unreal.Map) or isinstance(value, dict):
        return [{"key": encode(k), "value": encode(v, soft)} for k, v in value.items()]
    if isinstance(value, (unreal.Array, unreal.Set, unreal.FixedArray, list, tuple, set)):
        return [encode(v, soft) for v in value]
    return {"unparsed": type(value).__name__}


def _python_type(path):
    cls = unreal.load_object(None, path)
    if cls is None:
        return None
    try:
        return unreal.get_type_from_class(cls)
    except Exception:
        return None


def _chain(kind):
    """Class paths of a Python wrapped type and its parents, nearest first."""
    out = []
    for c in kind.__mro__:
        static = getattr(c, "static_class", None)
        try:
            cls = static() if static else None
        except Exception:
            cls = None
        if cls is not None:
            out.append(cls.get_path_name())
    return out


def _references(value, path, out, soft_too=True):
    if isinstance(value, dict):
        if isinstance(value.get("object"), str):
            out.append({"property": path, "to": value["object"], "kind": "native" if value["object"].startswith("/Script/") else "hard"})
            return
        if isinstance(value.get("soft"), str):
            out.append({"property": path, "to": value["soft"], "kind": "soft"})
            return
        if set(value) == {"key", "value"}:
            _references(value["key"], path + ".key", out)
            _references(value["value"], path + ".value", out)
            return
        for key, inner in value.items():
            _references(inner, "%s.%s" % (path, key) if path else key, out)
    elif isinstance(value, list):
        for i, inner in enumerate(value):
            _references(inner, "%s[%d]" % (path, i), out)


def _values(obj, names, known, soft):
    fields = {}
    for name in names:
        try:
            fields[name] = encode(obj.get_editor_property(name), name in soft)
        except Exception as e:
            fields[name] = {"unparsed": "%s (not readable from the editor's Python)" % name}
    refs = []
    for name, value in fields.items():
        _references(value, name, refs)
    return fields, refs


def _declared(obj, listed_type):
    """{python name: type text} of the properties the listed class and the classes below it declare."""
    names = dict(_python_names(type(obj)))
    for c in type(obj).__mro__:
        names.update({k: v for k, v in _python_names(c).items() if k not in names})
        if c is listed_type:
            break
    above = listed_type.__mro__[1] if listed_type is not None and len(listed_type.__mro__) > 1 else None
    inherited = set(_python_names(above)) if above is not None and above is not object else set()
    return {k: v for k, v in names.items() if k not in inherited}


def _components(blueprint, wanted):
    """The Blueprint's components as its editor shows them, own, inherited and native, with effective values for the
    properties the file names on each."""
    subsystem = unreal.get_engine_subsystem(unreal.SubobjectDataSubsystem)
    lib = unreal.SubobjectDataBlueprintFunctionLibrary
    out, seen = [], set()
    for handle in subsystem.k2_gather_subobject_data_for_blueprint(blueprint):
        data = lib.get_data(handle)
        if not lib.is_component(data):
            continue
        template = lib.get_object_for_blueprint(data, blueprint)
        if template is None:
            continue
        name = str(lib.get_variable_name(data))
        if name == "None":
            name = template.get_name()
        if (name, template.get_path_name()) in seen:
            continue
        seen.add((name, template.get_path_name()))
        known = wanted.get(template.get_path_name()) or wanted.get(name) or {}
        entry = {"name": name, "class": template.get_class().get_path_name(), "path": template.get_path_name()}
        if lib.is_native_component(data):
            entry["native"] = True
        if lib.is_inherited_component(data):
            entry["inherited"] = True
        fields, refs = _values(template, known.get("known", []), known.get("known", []), set(known.get("soft", [])))
        entry["fields"] = fields
        if refs:
            entry["fieldReferences"] = refs
        out.append(entry)
    return out


def main(ARGS):
    listed = ARGS["listed"]
    listed_types = {cls: _python_type(cls) for cls in listed}
    chains, parents = {}, {}

    def chain_of(path):
        if path not in chains:
            kind = _python_type(path) if path else None
            chains[path] = _chain(kind) if kind is not None else []
            links = chains[path]
            if path and path.startswith("/Script/") and set(links) & set(listed):
                for child, parent in zip(links, links[1:]):
                    parents[child] = parent
        return chains[path]

    assets = {}
    for item in ARGS["assets"]:
        anchor = item.get("native") or item["class"]
        if not set(chain_of(anchor)) & set(listed) and item["class"] not in listed and not item.get("listed"):
            continue
        try:
            if item.get("defaults"):
                generated = unreal.load_object(None, item["defaults"])
                obj = unreal.get_default_object(generated)
            else:
                obj = unreal.load_object(None, item["id"])
            if obj is None:
                raise RuntimeError("the editor could not load it")
            mine = _chain(type(obj))
            matched = [cls for cls in mine if cls in listed]
            matched += [cls for cls in item.get("listed") or [] if cls not in matched]  # Blueprint parents the file names
            if not matched:
                continue
            props = set()
            for cls in matched:
                if listed[cls] is None:
                    props = None
                    break
                props |= set(listed[cls])
            known = list(item.get("known") or [])
            if props is None:
                top = listed_types.get(matched[-1])
                names = [_original(obj, python, kind, known) for python, kind in sorted(_declared(obj, top).items())]
                names += [k for k in known if k not in names]
            else:
                names = sorted(props)
            fields, refs = _values(obj, names, known, set(item.get("soft") or []))
            entry = {"fields": fields}
            if refs:
                entry["fieldReferences"] = refs
            if item.get("defaults"):
                blueprint = unreal.load_object(None, item["id"])
                wanted = {c["name"]: c for c in item.get("components") or []}
                wanted.update({c["path"]: c for c in item.get("components") or []})
                entry["components"] = _components(blueprint, wanted)
            else:
                components = []
                for c in item.get("components") or []:
                    sub = unreal.find_object(None, c["path"]) or unreal.load_object(None, c["path"])
                    if sub is None:
                        continue
                    values, sub_refs = _values(sub, c.get("known", []), c.get("known", []), set(c.get("soft") or []))
                    component = {"name": c["name"], "class": sub.get_class().get_path_name(), "path": c["path"], "fields": values}
                    if sub_refs:
                        component["fieldReferences"] = sub_refs
                    components.append(component)
                if components:
                    entry["components"] = components
            assets[item["id"]] = entry
        except Exception as e:
            assets[item["id"]] = {"error": str(e)[:300]}
    return {"engine": unreal.SystemLibrary.get_engine_version(), "parents": parents, "assets": assets}
