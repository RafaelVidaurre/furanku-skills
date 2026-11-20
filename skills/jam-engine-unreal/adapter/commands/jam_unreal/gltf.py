"""What a glTF binary clip holds, read without the engine: its skinned joints and its named animations."""
import json
import struct

from .errors import AdapterError

GLB_MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A
# Characters Unreal does not keep in an object name (INVALID_OBJECTNAME_CHARACTERS); its importers write "_" in their
# place, so a joint "foot.l" becomes the bone "foot_l".
UNREAL_INVALID = "\"' ,/.:|&!~\n\r\t@#(){}[]=;^%$`"


def unreal_name(name):
    """The bone name Unreal gives a glTF joint name."""
    return "".join("_" if c in UNREAL_INVALID else c for c in name)


def document(path):
    """The JSON chunk of a .glb file."""
    with open(path, "rb") as f:
        data = f.read()
    if len(data) < 20 or struct.unpack_from("<I", data, 0)[0] != GLB_MAGIC:
        raise AdapterError("invalid", "%s is not a glTF binary (.glb) file" % path, fix="export the clip as .glb: the skinned rig with its named animations")
    length, kind = struct.unpack_from("<II", data, 12)
    if kind != JSON_CHUNK:
        raise AdapterError("invalid", "%s has no JSON chunk first" % path)
    try:
        return json.loads(data[20:20 + length].decode("utf-8"))
    except ValueError as e:
        raise AdapterError("invalid", "%s: its JSON chunk does not parse: %s" % (path, e))


def clip_facts(path):
    """{"joints": [names of every skinned joint], "animations": [names]}; refuses a file with no skin or no animation."""
    doc = document(path)
    nodes = doc.get("nodes") or []
    joints = []
    for skin in doc.get("skins") or []:
        for index in skin.get("joints") or []:
            name = (nodes[index] if index < len(nodes) else {}).get("name")
            if not name:
                raise AdapterError("invalid", "%s: joint node %d has no name, so it cannot be matched to a bone" % (path, index))
            if name not in joints:
                joints.append(name)
    if not joints:
        raise AdapterError("invalid", "%s holds no skin: an animation clip carries the skinned rig its animations play on" % path)
    animations = [a.get("name") or "animation_%d" % i for i, a in enumerate(doc.get("animations") or [])]
    if not animations:
        raise AdapterError("invalid", "%s holds no animation" % path)
    return {"joints": joints, "animations": animations}
