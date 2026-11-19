"""Write what the engine holds for the fixture objects' property values: each leaf path in JAM_FIXTURE_FIELDS
({"<object path>": ["Rules.Priority", "Numbers[1]", "Numbers#", "Scores{alpha}", "Payload.struct", ...]}) read with
get_editor_property on the loaded object (an asset, a Blueprint's class default object, a component template).
`[i]` indexes an array or a set, `{key}` a map, `#` is the length; `struct` and `value` open an instanced struct; a
text is its display string. Shot metadata's optionals are protected, so they are read through the engine's own
library. The adapter's tests compare the offline field reader with this file."""
import json
import os
import re

import unreal

OUT = os.environ["JAM_FIXTURE_DUMP"]
WANTED = json.loads(os.environ["JAM_FIXTURE_FIELDS"])
TOKEN = re.compile(r"\.?([^.\[{#]+)|\[(\d+)\]|\{([^}]*)\}|(#)")
SHOT = {"bIsNoGood": "is_no_good", "FavoriteRating": "favorite_rating", "bIsFlagged": "is_flagged"}


def leaf(value):
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (unreal.Name, unreal.Text)):
        return str(value)
    if isinstance(value, unreal.EnumBase):
        return value.name
    if isinstance(value, unreal.Object):
        return value.get_path_name()
    if isinstance(value, unreal.Guid):
        return unreal.GuidLibrary.conv_guid_to_string(value)
    if isinstance(value, unreal.InstancedStruct):
        text = value.export_text()
        return None if text == "None" else text
    if isinstance(value, unreal.StructBase):
        return value.export_text()
    return repr(value)


def fields_of(text):
    """`/Script/Engine.PrimaryAssetRules(Priority=4,...)` -> {"Priority": "4", ...}: top-level fields as text."""
    body = text[text.index("(") + 1:text.rindex(")")]
    out, depth, start = {}, 0, 0
    for i, ch in enumerate(body + ","):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == "," and depth == 0:
            key, _, val = body[start:i].partition("=")
            out[key.strip()] = val.strip().strip('"')
            start = i + 1
    return out


def resolve(value, path):
    if isinstance(value, unreal.Object) and value.get_class().get_name() == "MovieSceneShotMetaData" and path in SHOT:
        library, sequence = unreal.LevelSequenceShotMetaDataLibrary, value.get_outer()
        if not getattr(library, "has_" + SHOT[path])(sequence):
            return None
        got = getattr(library, "get_" + SHOT[path])(sequence)
        return got[-1] if isinstance(got, tuple) else got
    for name, index, key, length in TOKEN.findall(path):
        if isinstance(value, dict):  # a struct read from its text: fields as strings
            value = value[name]
        elif name == "struct" and isinstance(value, unreal.InstancedStruct):
            value = value.export_text().split("(", 1)[0]
        elif name == "value" and isinstance(value, unreal.InstancedStruct):
            # 5.8's Python cannot open an instanced struct: read its value from the text it exports
            value = value.get_value() if hasattr(value, "get_value") else fields_of(value.export_text())
        elif name:
            value = value.get_editor_property(name)
        elif index:
            value = list(value)[int(index)]
        elif length:
            value = len(value)
        else:
            value = value[key]
    return leaf(value)


objects = {}
for object_path, leaves in WANTED.items():
    found = unreal.load_object(None, object_path)
    values = {}
    for path in leaves:
        try:
            values[path] = resolve(found, path)
        except Exception as e:  # recorded, so a test shows which path the engine could not read
            values[path] = {"error": str(e)}
    objects[object_path] = values
with open(OUT, "w") as f:
    json.dump({"engine": unreal.SystemLibrary.get_engine_version(), "assets": objects}, f, indent=1, sort_keys=True)
