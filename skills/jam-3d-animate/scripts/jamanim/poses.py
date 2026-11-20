"""From key poses to a clip sampled on every frame: each node's translation, rotation and scale at each pose, carried
from one pose to the next (rotations slerped along the shorter way, translations and scales linearly), and the result
written into a copy of the key-pose file as its one animation."""
import json
import struct

import numpy as np

from . import gltf


def slerp(q0, q1, a):
    q0, q1 = np.asarray(q0, dtype=np.float64), np.asarray(q1, dtype=np.float64)
    if np.dot(q0, q1) < 0:
        q1 = -q1
    d = float(np.clip(np.dot(q0, q1), -1.0, 1.0))
    if d > 1 - 1e-9:
        q = q0 * (1 - a) + q1 * a
    else:
        w = np.arccos(d)
        q = (np.sin((1 - a) * w) * q0 + np.sin(a * w) * q1) / np.sin(w)
    return q / np.linalg.norm(q)


def at_poses(model, pose_times, name=None):
    """{node: {path: [value per pose]}} for every animated channel of the key-pose animation, read at each pose time."""
    out = {}
    for node, paths in model.channels(name).items():
        for path, (t, v, interp) in paths.items():
            out.setdefault(node, {})[path] = [gltf._sample(t, v, interp, time, path == "rotation") for time in pose_times]
    return out


def frames_between(values, pose_frames, frames, cycle=None):
    """[frames, width]: one channel's value on frames 0 .. frames-1, from its value at each pose frame. Before the first
    pose the first holds; after the last the last holds, or, with cycle (frames in one loop), the motion goes on to the
    first pose again at frame `cycle`."""
    rotation = len(values[0]) == 4
    keys, vals = list(pose_frames), [np.asarray(v, dtype=np.float64) for v in values]
    if cycle is not None:
        keys, vals = keys + [pose_frames[0] + cycle], vals + [vals[0]]
    out = np.zeros((frames, len(vals[0])))
    for f in range(frames):
        if f <= keys[0]:
            out[f] = vals[0]
        elif f >= keys[-1]:
            out[f] = vals[-1]
        else:
            k = int(np.searchsorted(keys, f, side="right")) - 1
            a = (f - keys[k]) / (keys[k + 1] - keys[k])
            out[f] = slerp(vals[k], vals[k + 1], a) if rotation else vals[k] * (1 - a) + vals[k + 1] * a
    return out


def write_with_animation(model, path, anim_name, fps, channels):
    """Write the model (a .glb read by gltf.Gltf) to `path` with `channels` ({node: {path: [frames, width]}}, on frames
    0 .. F-1) as its only animation, sampled LINEAR on every frame of fps."""
    if model.bin is None or len(model.json.get("buffers", [])) != 1 or "uri" in model.json["buffers"][0]:
        raise gltf.GltfError("%s: a .glb with its one buffer inside the file is expected" % model.path)
    doc = json.loads(json.dumps(model.json))
    blob = bytearray(model.bin[:doc["buffers"][0]["byteLength"]])
    doc.setdefault("bufferViews", []); doc.setdefault("accessors", [])

    def add(array, kind, with_bounds=False):
        data = np.ascontiguousarray(array, dtype=np.float32).tobytes()
        blob.extend(b"\0" * (-len(blob) % 4))
        doc["bufferViews"].append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data)})
        blob.extend(data)
        acc = {"bufferView": len(doc["bufferViews"]) - 1, "componentType": 5126, "count": len(array), "type": kind}
        if with_bounds:
            acc.update(min=[float(np.min(array))], max=[float(np.max(array))])
        doc["accessors"].append(acc)
        return len(doc["accessors"]) - 1

    frames = len(next(iter(next(iter(channels.values())).values())))
    times = add(np.arange(frames, dtype=np.float64) / fps, "SCALAR", True)
    samplers, targets = [], []
    for node in sorted(channels):
        for p in sorted(channels[node]):
            values = channels[node][p]
            samplers.append({"input": times, "output": add(values, "VEC4" if p == "rotation" else "VEC3"), "interpolation": "LINEAR"})
            targets.append({"sampler": len(samplers) - 1, "target": {"node": node, "path": p}})
    doc["animations"] = [{"name": anim_name, "samplers": samplers, "channels": targets}]
    doc["buffers"][0]["byteLength"] = len(blob)
    blob.extend(b"\0" * (-len(blob) % 4))
    js = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    js += b" " * (-len(js) % 4)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + 8 + len(blob)))
        f.write(struct.pack("<I4s", len(js), b"JSON")); f.write(js)
        f.write(struct.pack("<I4s", len(blob), b"BIN\0")); f.write(bytes(blob))
