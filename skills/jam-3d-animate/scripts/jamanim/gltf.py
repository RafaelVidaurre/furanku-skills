"""A minimal glTF 2.0 reader for clips: the skeleton of each skin, the animations, their key times, and joint world
positions at any key time. Reads .glb and .gltf (external buffers beside the file, their URIs percent-decoded; no data
URIs)."""
import json
import os
import struct
import urllib.parse

import numpy as np

_COMPONENT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
_NORMALIZED = {5120: 127.0, 5121: 255.0, 5122: 32767.0, 5123: 65535.0}


class GltfError(ValueError):
    pass


def quat_matrix(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def trs(t, r, s):
    M = np.eye(4)
    M[:3, :3] = quat_matrix(r) * np.asarray(s, dtype=np.float64)[None, :]
    M[:3, 3] = t
    return M


class Gltf:
    def __init__(self, path):
        self.path = path
        with open(path, "rb") as f:
            raw = f.read()
        self.bin = None
        if raw[:4] == b"glTF":
            _, _, total = struct.unpack_from("<4sII", raw, 0)
            offset, self.json = 12, None
            while offset + 8 <= min(total, len(raw)):
                size, kind = struct.unpack_from("<I4s", raw, offset)
                chunk = raw[offset + 8:offset + 8 + size]
                if kind == b"JSON":
                    self.json = json.loads(chunk.decode("utf-8"))
                elif kind == b"BIN\x00":
                    self.bin = chunk
                offset += 8 + size + (-size % 4)
            if self.json is None:
                raise GltfError("%s has no JSON chunk" % path)
        else:
            try:
                self.json = json.loads(raw.decode("utf-8"))
            except ValueError:
                raise GltfError("%s is neither a .glb nor glTF JSON" % path)
        self.nodes = self.json.get("nodes", [])
        self.parent = {}
        for i, node in enumerate(self.nodes):
            for c in node.get("children", []):
                self.parent[c] = i
        self._buffers = {}

    # ---- raw data ---------------------------------------------------------------------------------------------

    def _buffer(self, index):
        if index not in self._buffers:
            uri = self.json["buffers"][index].get("uri")
            if uri is None:
                if self.bin is None:
                    raise GltfError("buffer %d has no data" % index)
                self._buffers[index] = self.bin
            elif uri.startswith("data:"):
                raise GltfError("buffers stored as data URIs are not read; pack the file as .glb")
            else:
                with open(os.path.join(os.path.dirname(self.path), urllib.parse.unquote(uri)), "rb") as f:
                    self._buffers[index] = f.read()
        return self._buffers[index]

    def accessor(self, index):
        """An accessor's values as a float64 array of shape (count, width)."""
        acc = self.json["accessors"][index]
        if "sparse" in acc:
            raise GltfError("sparse accessors are not read")
        dtype, width, count = np.dtype(_COMPONENT[acc["componentType"]]), _WIDTH[acc["type"]], acc["count"]
        if "bufferView" not in acc:
            return np.zeros((count, width))
        view = self.json["bufferViews"][acc["bufferView"]]
        data = self._buffer(view["buffer"])
        start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        stride = view.get("byteStride") or dtype.itemsize * width
        rows = np.ndarray((count, width), dtype=dtype, buffer=data, offset=start, strides=(stride, dtype.itemsize))
        out = rows.astype(np.float64)
        if acc.get("normalized") and acc["componentType"] in _NORMALIZED:
            out = np.maximum(out / _NORMALIZED[acc["componentType"]], -1.0)
        return out

    # ---- skeleton ---------------------------------------------------------------------------------------------

    def name(self, i):
        return self.nodes[i].get("name", "node%d" % i)

    def skeleton(self):
        """[(joint name, parent joint name or None)] over every skin, in skin order; joints named once."""
        out, seen = [], set()
        for skin in self.json.get("skins", []):
            joints = set(skin["joints"])
            for j in skin["joints"]:
                if j in seen:
                    continue
                seen.add(j)
                p = self.parent.get(j)
                while p is not None and p not in joints:
                    p = self.parent.get(p)
                out.append((self.name(j), self.name(p) if p is not None else None))
        return out

    def rest_local(self, i):
        node = self.nodes[i]
        if "matrix" in node:
            return np.array(node["matrix"], dtype=np.float64).reshape(4, 4).T
        return trs(node.get("translation", [0, 0, 0]), node.get("rotation", [0, 0, 0, 1]), node.get("scale", [1, 1, 1]))

    # ---- animations -------------------------------------------------------------------------------------------

    def animation_names(self):
        return [a.get("name", "animation%d" % k) for k, a in enumerate(self.json.get("animations", []))]

    def animation(self, name=None):
        """(index, animation) by name; with no name, the only one. Raises GltfError otherwise."""
        anims = self.json.get("animations", [])
        names = self.animation_names()
        if not anims:
            raise GltfError("%s holds no animation" % self.path)
        if name is None:
            if len(anims) != 1:
                raise GltfError("%s holds %d animations (%s); name one" % (self.path, len(anims), ", ".join(names)))
            return 0, anims[0]
        if name not in names:
            raise GltfError("%s has no animation %r (it has: %s)" % (self.path, name, ", ".join(names)))
        k = names.index(name)
        return k, anims[k]

    def key_times(self, name=None):
        """Sorted union of every key time of one animation, in seconds."""
        _, anim = self.animation(name)
        times = set()
        for sampler in anim["samplers"]:
            times.update(float(t) for t in self.accessor(sampler["input"])[:, 0])
        return sorted(times)

    def channels(self, name=None):
        """{node index: {path: (times, values, interpolation)}} of one animation."""
        _, anim = self.animation(name)
        out = {}
        for ch in anim["channels"]:
            target = ch["target"]
            if "node" not in target or target["path"] not in ("translation", "rotation", "scale"):
                continue
            s = anim["samplers"][ch["sampler"]]
            t, v = self.accessor(s["input"])[:, 0], self.accessor(s["output"])
            interp = s.get("interpolation", "LINEAR")
            if interp == "CUBICSPLINE":
                v = v[1::3]
            out.setdefault(target["node"], {})[target["path"]] = (t, v, interp)
        return out

    def pose_world(self, time, name=None, channels=None):
        """{node name: 4x4 world matrix} of every node at one time of an animation (LINEAR, STEP; cubic at keys)."""
        channels = self.channels(name) if channels is None else channels
        local = {}
        for i, node in enumerate(self.nodes):
            if "matrix" in node and i not in channels:
                local[i] = self.rest_local(i)
                continue
            parts = {"translation": node.get("translation", [0, 0, 0]), "rotation": node.get("rotation", [0, 0, 0, 1]),
                     "scale": node.get("scale", [1, 1, 1])}
            for path, (t, v, interp) in channels.get(i, {}).items():
                parts[path] = _sample(t, v, interp, time, path == "rotation")
            local[i] = trs(parts["translation"], parts["rotation"], parts["scale"])
        world = {}

        def w(i):
            if i not in world:
                world[i] = w(self.parent[i]) @ local[i] if i in self.parent else local[i]
            return world[i]
        return {self.name(i): w(i) for i in range(len(self.nodes))}


def _sample(t, v, interp, time, is_rotation):
    if time <= t[0]:
        return v[0]
    if time >= t[-1]:
        return v[-1]
    k = int(np.searchsorted(t, time, side="right")) - 1
    if interp == "STEP" or t[k + 1] == t[k]:
        return v[k]
    a = (time - t[k]) / (t[k + 1] - t[k])
    if not is_rotation:
        return v[k] * (1 - a) + v[k + 1] * a
    q0, q1 = v[k], v[k + 1]
    if np.dot(q0, q1) < 0:
        q1 = -q1
    q = q0 * (1 - a) + q1 * a
    return q / np.linalg.norm(q)


def whole_frames(times, fps):
    """(every time on a whole frame of fps, largest distance from one in frames)."""
    if not times:
        return True, 0.0
    off = max(abs(t * fps - round(t * fps)) for t in times)
    return off < 1e-3, float(off)


def sampling(model, fps, name=None):
    """How an animation is sampled against the frame grid of fps:
    {"passed", "largestOffsetFrames", "framesWithoutKey": [...], "sparse": [...]}.

    It passes when every key lies on a whole frame, every frame from the first key to the last has a key, and every
    channel either has a key on each of those frames or holds one value throughout (a bone the clip does not move).
    A channel keyed on fewer frames than that leaves the frames between to the engine's interpolation, which is not the
    clip the spec asks for."""
    channels = model.channels(name)
    times = model.key_times(name)
    on_grid, off = whole_frames(times, fps)
    first, last = int(round(times[0] * fps)), int(round(times[-1] * fps))
    grid = set(range(first, last + 1))
    keyed = {int(round(t * fps)) for t in times}
    sparse = []
    for node, paths in sorted(channels.items()):
        for path, (t, v, _) in sorted(paths.items()):
            if {int(round(x * fps)) for x in t} >= grid:
                continue
            if len(v) and float(np.abs(v - v[0]).max()) <= 1e-6:
                continue
            sparse.append("%s.%s (%d keys over %d frames)" % (model.name(node), path, len(t), len(grid)))
    missing = sorted(grid - keyed)
    return {"passed": bool(on_grid and not missing and not sparse), "largestOffsetFrames": round(off, 5),
            "framesWithoutKey": missing[:20], "sparse": sparse[:20]}


def rest_world(model):
    """{joint name: 4x4 world matrix at rest} for every joint of every skin: the nodes' own transforms, parents
    (joints or not) included."""
    local = {i: model.rest_local(i) for i in range(len(model.nodes))}
    world = {}

    def w(i):
        if i not in world:
            world[i] = w(model.parent[i]) @ local[i] if i in model.parent else local[i]
        return world[i]
    return {model.name(j): w(j) for skin in model.json.get("skins", []) for j in skin["joints"]}


def rest_difference(clip, rig, names):
    """Worst difference between two rests over the named joints: {"position": m, "positionBone", "linear", "linearBone"}
    where linear is the largest entry of the difference of the joints' world rotation-and-scale matrices (0.0002 is
    about a hundredth of a degree)."""
    a, b = rest_world(clip), rest_world(rig)
    out = {"position": 0.0, "positionBone": None, "linear": 0.0, "linearBone": None}
    for n in names:
        if n not in a or n not in b:
            continue
        dp = float(np.linalg.norm(a[n][:3, 3] - b[n][:3, 3]))
        dl = float(np.abs(a[n][:3, :3] - b[n][:3, :3]).max())
        if dp > out["position"]:
            out["position"], out["positionBone"] = dp, n
        if dl > out["linear"]:
            out["linear"], out["linearBone"] = dl, n
    return out
