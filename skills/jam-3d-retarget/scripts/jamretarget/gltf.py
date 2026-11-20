"""A minimal glTF 2.0 reader and writer: the JSON, node rest transforms, accessors, animation sampling, and adding
animations to a .glb without touching anything else in it. Reads .glb and .gltf (external buffers beside the file, no
data URIs); writes .glb."""
import json
import os
import struct

import numpy as np

from . import mathx

_COMPONENT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
_PATH_WIDTH = {"translation": 3, "rotation": 4, "scale": 3}


class GltfError(ValueError):
    pass


class Gltf:
    def __init__(self, path):
        self.path = path
        with open(path, "rb") as f:
            raw = f.read()
        self.bin = None
        self.is_glb = raw[:4] == b"glTF"
        if self.is_glb:
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
        self.parent = [-1] * len(self.nodes)
        for i, node in enumerate(self.nodes):
            for c in node.get("children", []):
                self.parent[c] = i
        self.order = self._topological()
        self._buffers = {}

    def _topological(self):
        order, seen = [], set()
        stack = [i for i in range(len(self.nodes)) if self.parent[i] < 0][::-1]
        while stack:
            i = stack.pop()
            if i in seen:
                raise GltfError("the node hierarchy has a cycle")
            seen.add(i); order.append(i)
            stack.extend(self.nodes[i].get("children", [])[::-1])
        return order

    def name(self, i):
        return self.nodes[i].get("name", "node%d" % i)

    def rest_trs(self):
        """(translations [N,3], rotations [N,4] xyzw, scales [N,3]) of every node as stored."""
        n = len(self.nodes)
        T, R, S = np.zeros((n, 3)), np.tile([0.0, 0.0, 0.0, 1.0], (n, 1)), np.ones((n, 3))
        for i, node in enumerate(self.nodes):
            if "matrix" in node:
                M = np.array(node["matrix"], dtype=np.float64).reshape(4, 4).T
                s = np.linalg.norm(M[:3, :3], axis=0)
                if np.linalg.det(M[:3, :3]) < 0:
                    s[0] = -s[0]
                T[i], S[i], R[i] = M[:3, 3], s, mathx.mat_to_quat(M[:3, :3] / s)
            else:
                T[i] = node.get("translation", [0, 0, 0]); R[i] = node.get("rotation", [0, 0, 0, 1]); S[i] = node.get("scale", [1, 1, 1])
        return T, R, S

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
                with open(os.path.join(os.path.dirname(self.path), uri), "rb") as f:
                    self._buffers[index] = f.read()
        return self._buffers[index]

    def accessor(self, index):
        """An accessor's values as an array of shape (count, width), normalised integers as floats."""
        acc = self.json["accessors"][index]
        if "sparse" in acc or "bufferView" not in acc:
            raise GltfError("sparse accessors are not read")
        view = self.json["bufferViews"][acc["bufferView"]]
        dtype = np.dtype(_COMPONENT[acc["componentType"]]).newbyteorder("<"); width = _WIDTH[acc["type"]]
        start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        stride = view.get("byteStride") or dtype.itemsize * width
        data = self._buffer(view["buffer"])
        if stride == dtype.itemsize * width:
            out = np.frombuffer(data, dtype=dtype, count=acc["count"] * width, offset=start).reshape(acc["count"], width)
        else:
            out = np.stack([np.frombuffer(data, dtype=dtype, count=width, offset=start + k * stride) for k in range(acc["count"])])
        if acc.get("normalized") and dtype.kind in "ui":
            info = np.iinfo(dtype)
            out = np.maximum(out.astype(np.float64) / info.max, -1.0)
        return out.astype(np.float64) if dtype.kind == "f" or acc.get("normalized") else out

    def skin_joints(self, skin=0):
        skins = self.json.get("skins", [])
        return list(skins[skin]["joints"]) if skins else []

    # ---- animations ------------------------------------------------------------------------------------------------
    def animations(self):
        """[{"name", "channels": [(node, path, times [K], values [K, w] or [K, 3, w] for CUBICSPLINE, interpolation)]}]"""
        out = []
        for k, anim in enumerate(self.json.get("animations", [])):
            channels = []
            for ch in anim.get("channels", []):
                target = ch.get("target", {})
                if "node" not in target or target.get("path") not in _PATH_WIDTH:
                    continue                                  # morph weights and pointer targets are not skeleton motion
                sampler = anim["samplers"][ch["sampler"]]
                times = self.accessor(sampler["input"])[:, 0].astype(np.float64)
                values = self.accessor(sampler["output"]).astype(np.float64)
                interp = sampler.get("interpolation", "LINEAR")
                if interp == "CUBICSPLINE":
                    values = values.reshape(len(times), 3, -1)
                channels.append((target["node"], target["path"], times, values, interp))
            out.append({"name": anim.get("name", "animation%d" % k), "channels": channels})
        return out


def sample_channel(times, values, interp, path, t):
    """Values of one channel at times t [F] (clamped to its range)."""
    t = np.clip(np.asarray(t, dtype=np.float64), times[0], times[-1])
    if len(times) == 1:
        v = values[0, 1] if interp == "CUBICSPLINE" else values[0]
        return np.tile(v, (len(t), 1))
    i = np.clip(np.searchsorted(times, t, side="right") - 1, 0, len(times) - 2)
    t0, t1 = times[i], times[i + 1]
    dt = np.where(t1 > t0, t1 - t0, 1.0)
    u = np.clip((t - t0) / dt, 0.0, 1.0)
    if interp == "STEP":
        out = np.where((u >= 1.0)[:, None], values[i + 1], values[i]) if values.ndim == 2 else values[i]
    elif interp == "CUBICSPLINE":
        p0, m0 = values[i, 1], values[i, 2] * dt[:, None]
        p1, m1 = values[i + 1, 1], values[i + 1, 0] * dt[:, None]
        u2, u3 = u * u, u * u * u
        out = ((2 * u3 - 3 * u2 + 1)[:, None] * p0 + (u3 - 2 * u2 + u)[:, None] * m0
               + (-2 * u3 + 3 * u2)[:, None] * p1 + (u3 - u2)[:, None] * m1)
    elif path == "rotation":
        out = mathx.slerp(values[i], values[i + 1], u)
    else:
        out = values[i] + (values[i + 1] - values[i]) * u[:, None]
    if path == "rotation":
        out = mathx.unit(out)
    return out


def key_times(animation):
    """Every key time of an animation's channels, sorted and unique."""
    return np.unique(np.concatenate([c[2] for c in animation["channels"]])) if animation["channels"] else np.zeros(1)


def frame_rate(times):
    """1 / the key spacing when every key follows the last by the same time (a clip sampled on its frames); None when
    the spacing varies, since a frame rate cannot then be told from the keys."""
    if len(times) < 2:
        return None
    steps = np.diff(times)
    step = float(np.mean(steps))
    if step <= 0 or np.max(np.abs(steps - step)) > 0.01 * step:
        return None
    fps = 1.0 / step
    return float(round(fps)) if abs(fps - round(fps)) < 0.001 * fps else fps


def sample_locals(model, animation, times, rest=None):
    """Local (T [F,N,3], R [F,N,4], S [F,N,3]) of every node at the given times: the rest transform where no channel
    drives a property. Also returns {node: set(paths)} of what the animation drives."""
    T0, R0, S0 = rest if rest is not None else model.rest_trs()
    F = len(times)
    T, R, S = np.repeat(T0[None], F, 0), np.repeat(R0[None], F, 0), np.repeat(S0[None], F, 0)
    driven = {}
    for node, path, ktimes, values, interp in animation["channels"]:
        v = sample_channel(ktimes, values, interp, path, times)
        {"translation": T, "rotation": R, "scale": S}[path][:, node] = v
        driven.setdefault(node, set()).add(path)
    return (T, R, S), driven


def forward(model_parent, order, local):
    """World transforms [F,N,4,4] from local transforms [F,N,4,4]."""
    world = np.empty_like(local)
    for i in order:
        p = model_parent[i]
        world[:, i] = local[:, i] if p < 0 else world[:, p] @ local[:, i]
    return world


# ---- writing --------------------------------------------------------------------------------------------------------

def _pad(data, fill=b"\x00"):
    return data + fill * (-len(data) % 4)


def write_glb(path, doc, binary):
    """Write a .glb from its JSON object and binary chunk."""
    js = _pad(json.dumps(doc, separators=(",", ":")).encode("utf-8"), b" ")
    binary = _pad(bytes(binary))
    chunks = struct.pack("<I4s", len(js), b"JSON") + js
    if binary:
        chunks += struct.pack("<I4s", len(binary), b"BIN\x00") + binary
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, 12 + len(chunks)) + chunks)


class Packer:
    """Appends typed arrays to a binary chunk and declares their bufferViews and accessors in a glTF JSON object."""

    def __init__(self, doc, binary=b""):
        self.doc, self.data = doc, bytearray(binary)
        self.doc.setdefault("buffers", [{}])
        if not self.doc["buffers"]:
            self.doc["buffers"].append({})
        if "uri" in self.doc["buffers"][0]:
            raise GltfError("the first buffer is external; only a .glb with its own binary chunk can be written")

    def add(self, array, kind, component=5126, target=None, minmax=False, normalized=False):
        array = np.ascontiguousarray(array, dtype=_COMPONENT[component])
        self.data += b"\x00" * (-len(self.data) % 4)
        view = {"buffer": 0, "byteOffset": len(self.data), "byteLength": array.nbytes}
        if target:
            view["target"] = target
        self.data += array.tobytes()
        self.doc.setdefault("bufferViews", []).append(view)
        flat = array.reshape(len(array), -1)
        acc = {"bufferView": len(self.doc["bufferViews"]) - 1, "componentType": component, "count": len(array), "type": kind}
        if normalized:
            acc["normalized"] = True
        if minmax:
            acc["min"] = [float(v) for v in flat.min(axis=0)]; acc["max"] = [float(v) for v in flat.max(axis=0)]
        self.doc.setdefault("accessors", []).append(acc)
        return len(self.doc["accessors"]) - 1

    def finish(self):
        self.doc["buffers"][0]["byteLength"] = len(self.data)
        return bytes(self.data)


def add_animations(source_path, out_path, animations, keep_existing=False):
    """Copy a .glb with the given animations added; nodes, meshes, skins and materials are copied unchanged.

    animations: [{"name", "times": [F], "channels": [(node, "translation" | "rotation", values [F, w])]}]. Every channel
    is written LINEAR on the shared times. Existing animations are dropped unless keep_existing; their data stays in the
    binary chunk, unreferenced. Returns the names of the animations dropped."""
    model = Gltf(source_path)
    if not model.is_glb:
        raise GltfError("%s is not a .glb; write the rig as a binary glTF first" % source_path)
    doc = json.loads(json.dumps(model.json))
    dropped = [] if keep_existing else [a.get("name", "animation%d" % k) for k, a in enumerate(doc.get("animations", []))]
    if not keep_existing:
        doc.pop("animations", None)
    pack = Packer(doc, model.bin or b"")
    for anim in animations:
        times = pack.add(np.asarray(anim["times"], dtype=np.float32).reshape(-1, 1), "SCALAR", minmax=True)
        samplers, channels = [], []
        for node, path, values in anim["channels"]:
            out = pack.add(np.asarray(values, dtype=np.float32), {"translation": "VEC3", "rotation": "VEC4", "scale": "VEC3"}[path])
            samplers.append({"input": times, "output": out, "interpolation": "LINEAR"})
            channels.append({"sampler": len(samplers) - 1, "target": {"node": int(node), "path": path}})
        doc.setdefault("animations", []).append({"name": anim["name"], "samplers": samplers, "channels": channels})
    write_glb(out_path, doc, pack.finish())
    return dropped
