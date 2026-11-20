"""A minimal glTF 2.0 reader and writer: the JSON, node rest transforms, accessors, animation sampling, and adding
animations to a file without changing its scene, meshes or skins. Reads .glb and .gltf (buffers and images in the file,
in files it references, or in base64 data URIs); writes a self-contained .glb."""
import base64
import json
import os
import struct
import urllib.parse

import numpy as np

from . import mathx

_COMPONENT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
_PATH_WIDTH = {"translation": 3, "rotation": 4, "scale": 3}


class GltfError(ValueError):
    pass


def decompose(matrix):
    """(translation [3], rotation [4] xyzw, scale [3]) of a node's column-major `matrix`. glTF requires a node's matrix
    to be decomposable into these, so nothing is lost; a mirroring matrix gets a negative x scale."""
    M = np.array(matrix, dtype=np.float64).reshape(4, 4).T
    s = np.linalg.norm(M[:3, :3], axis=0)
    if np.linalg.det(M[:3, :3]) < 0:
        s[0] = -s[0]
    return M[:3, 3], mathx.mat_to_quat(M[:3, :3] / s), s


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
                T[i], R[i], S[i] = decompose(node["matrix"])
            else:
                T[i] = node.get("translation", [0, 0, 0]); R[i] = node.get("rotation", [0, 0, 0, 1]); S[i] = node.get("scale", [1, 1, 1])
        return T, R, S

    def read_uri(self, uri):
        """The bytes a buffer's or image's URI holds: a base64 data URI, or a file named relative to this one."""
        if uri.startswith("data:"):
            head, _, data = uri.partition(",")
            if not head.endswith(";base64"):
                raise GltfError("%s: only base64 data URIs are read" % self.path)
            return base64.b64decode(data)
        path = os.path.join(os.path.dirname(os.path.abspath(self.path)), urllib.parse.unquote(uri))
        try:
            with open(path, "rb") as f:
                return f.read()
        except OSError as e:
            raise GltfError("%s refers to %s, which cannot be read: %s" % (self.path, uri, e.strerror or e))

    def resources(self):
        """[(kind, index, uri)] of every buffer and image stored outside the file's own binary chunk."""
        return ([("buffer", i, b["uri"]) for i, b in enumerate(self.json.get("buffers", [])) if "uri" in b]
                + [("image", i, im["uri"]) for i, im in enumerate(self.json.get("images", [])) if "uri" in im])

    def _buffer(self, index):
        if index not in self._buffers:
            uri = self.json["buffers"][index].get("uri")
            if uri is None:
                if self.bin is None:
                    raise GltfError("buffer %d has no data" % index)
                self._buffers[index] = self.bin
            else:
                self._buffers[index] = self.read_uri(uri)
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


# How close (relative) a rate read from key times must be to a whole number to be that number: storing the times
# (32-bit floats, or a BVH file's six-decimal frame time below 400 fps) moves a rate by less, and the NTSC rates
# (1000/1001 of a whole rate, such as 29.97) lie 0.1% away, five times further.
WHOLE_RATE = 2e-4


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
    return float(round(fps)) if abs(fps - round(fps)) < WHOLE_RATE * fps else fps


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


# Extensions whose data references no accessor and no buffer view, or a buffer view only under a "bufferView" key; a
# file using any other extension keeps the dropped animations' data, since a reference to it could not be renumbered.
_COMPACT_SAFE = ("KHR_draco_mesh_compression", "KHR_texture_transform", "KHR_texture_basisu", "EXT_texture_webp",
                 "EXT_texture_avif", "KHR_lights_punctual", "KHR_mesh_quantization", "KHR_xmp_json_ld", "KHR_animation_pointer")


def _accessor_refs(doc):
    """(where, key, accessor) of every accessor reference the core spec defines; `where[key]` holds it."""
    out = []
    for mesh in doc.get("meshes", []):
        for prim in mesh.get("primitives", []):
            out += [(prim["attributes"], k, v) for k, v in prim.get("attributes", {}).items()]
            if "indices" in prim:
                out.append((prim, "indices", prim["indices"]))
            for target in prim.get("targets", []):
                out += [(target, k, v) for k, v in target.items()]
    for skin in doc.get("skins", []):
        if "inverseBindMatrices" in skin:
            out.append((skin, "inverseBindMatrices", skin["inverseBindMatrices"]))
    for anim in doc.get("animations", []):
        for sampler in anim.get("samplers", []):
            out += [(sampler, "input", sampler["input"]), (sampler, "output", sampler["output"])]
    return out


def _view_refs(value):
    """(where, key, view) of every "bufferView" reference anywhere in the JSON (accessors, sparse data, images and
    extensions)."""
    out = []
    if isinstance(value, dict):
        for k, v in value.items():
            if k == "bufferView" and isinstance(v, int):
                out.append((value, k, v))
            elif k != "bufferViews":
                out += _view_refs(v)
    elif isinstance(value, list):
        for v in value:
            out += _view_refs(v)
    return out


def _compact(doc, binary, dropped_samplers):
    """Remove the accessors only dropped animations used, the buffer views only those used, and their bytes from the
    binary chunk; renumber every reference. Returns (binary, bytes removed) or (binary, None) when an extension the
    file uses might reference them."""
    used = [e for e in doc.get("extensionsUsed", []) if not e.startswith("KHR_materials_") and e not in _COMPACT_SAFE]
    if used:
        return binary, None
    accessors, views = doc.get("accessors", []), doc.get("bufferViews", [])
    kept_acc = {v for _, _, v in _accessor_refs(doc)}
    gone_acc = {a for a in dropped_samplers if a not in kept_acc}
    if not gone_acc:
        return binary, 0
    acc_map = {old: new for new, old in enumerate(i for i in range(len(accessors)) if i not in gone_acc)}
    doc["accessors"] = [a for i, a in enumerate(accessors) if i not in gone_acc]
    for where, key, old in _accessor_refs(doc):
        where[key] = acc_map[old]
    kept_view = {v for _, _, v in _view_refs(doc)}
    gone_view = {ref[2] for a in gone_acc for ref in _view_refs(accessors[a])} - kept_view
    view_map = {old: new for new, old in enumerate(i for i in range(len(views)) if i not in gone_view)}
    doc["bufferViews"] = [v for i, v in enumerate(views) if i not in gone_view]
    for where, key, old in _view_refs(doc):
        where[key] = view_map[old]
    # The binary chunk keeps every byte range a remaining view of buffer 0 covers, each moved by a multiple of 8 bytes
    # so every accessor stays aligned to its component size.
    spans = sorted((v.get("byteOffset", 0), v.get("byteOffset", 0) + v["byteLength"]) for v in doc["bufferViews"] if v["buffer"] == 0)
    merged = []
    for a, b in spans:
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    out, moves = bytearray(), []
    for a, b in merged:
        out += b"\x00" * ((a - len(out)) % 8)
        moves.append((a, b, len(out) - a))
        out += binary[a:b]
    for v in doc["bufferViews"]:
        if v["buffer"] == 0:
            start = v.get("byteOffset", 0)
            v["byteOffset"] = start + next(shift for a, b, shift in moves if a <= start < b)
    return bytes(out), len(binary) - len(out)


_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ktx2": "image/ktx2",
         ".avif": "image/avif"}


def _image_mime(image, uri):
    return image.get("mimeType") or (uri[5:].split(";")[0] if uri.startswith("data:") else
                                     _MIME.get(os.path.splitext(urllib.parse.unquote(uri))[1].lower()))


def check_embeddable(model):
    """Raise GltfError unless add_animations can embed everything the file keeps outside its binary chunk: each file
    it refers to is readable, each image's type is known, and data in several buffers is not referenced by an
    extension this writer cannot renumber."""
    buffers = model.json.get("buffers", [])
    if len(buffers) > 1:
        used = [e for e in model.json.get("extensionsUsed", []) if not e.startswith("KHR_materials_") and e not in _COMPACT_SAFE]
        if used:
            raise GltfError("%s keeps data in %d buffers and uses %s, whose references to them this writer cannot "
                            "renumber; pack it into one buffer first" % (model.path, len(buffers), ", ".join(used)))
    for i in range(len(buffers)):
        model._buffer(i)
    for kind, i, uri in model.resources():
        if kind == "image":
            if not _image_mime(model.json["images"][i], uri):
                raise GltfError("%s: image %d (%s) has no mimeType and no known file extension" % (model.path, i, uri))
            model.read_uri(uri)


def _embed(model, doc):
    """Gather every buffer into one binary chunk and every image into a buffer view of it, so the written .glb needs no
    file beside it. Returns (binary, [URIs embedded])."""
    check_embeddable(model)
    buffers, embedded = doc.get("buffers", []), []
    out, offsets = bytearray(), []
    for i, buf in enumerate(buffers):
        data = model._buffer(i)[:buf.get("byteLength", None)]
        out += b"\x00" * (-len(out) % 8)
        offsets.append(len(out))
        out += data
        if "uri" in buf:
            embedded.append(buf["uri"] if not buf["uri"].startswith("data:") else "buffer %d (data URI)" % i)
    for view in doc.get("bufferViews", []):
        view["byteOffset"] = view.get("byteOffset", 0) + offsets[view["buffer"]]
        view["buffer"] = 0
    if buffers:
        doc["buffers"] = [{"byteLength": len(out)}]
    for i, image in enumerate(doc.get("images", [])):
        if "uri" not in image:
            continue
        uri = image.pop("uri")
        mime = _image_mime(image, uri)
        data = model.read_uri(uri)
        out += b"\x00" * (-len(out) % 8)
        doc.setdefault("bufferViews", []).append({"buffer": 0, "byteOffset": len(out), "byteLength": len(data)})
        out += data
        image.update(bufferView=len(doc["bufferViews"]) - 1, mimeType=mime)
        embedded.append(uri if not uri.startswith("data:") else "image %d (data URI)" % i)
    if embedded:
        doc.setdefault("buffers", [{}])[0]["byteLength"] = len(out)
    return bytes(out), embedded


def add_animations(source_path, out_path, animations, keep_existing=False):
    """Copy a glTF file as a .glb with the given animations added; scenes, meshes, skins and materials are copied
    unchanged, and every buffer and image the file keeps outside itself is embedded.

    animations: [{"name", "times": [F], "channels": [(node, "translation" | "rotation", values [F, w])]}]. Every channel
    is written LINEAR on the shared times. A node that any animation of the written file drives, and that stores a
    `matrix`, is stored as the same translation, rotation and scale instead: glTF forbids a matrix on an animated node.
    Existing animations are dropped unless keep_existing, and the data only they used is removed from the file.

    Returns {"dropped": names of the animations dropped, "removedBytes": bytes of their data removed, or None when the
    file uses an extension that might reference that data, which then stays in the file unreferenced, "embedded": the
    URIs of the buffers and images embedded}."""
    model = Gltf(source_path)
    doc = json.loads(json.dumps(model.json))
    binary, embedded = _embed(model, doc)
    removed = 0
    old = doc.get("animations", [])
    dropped = [] if keep_existing else [a.get("name", "animation%d" % k) for k, a in enumerate(old)]
    if not keep_existing and old:
        doc.pop("animations")
        binary, removed = _compact(doc, binary, {i for a in old for s in a.get("samplers", []) for i in (s["input"], s["output"])})
    pack = Packer(doc, binary)
    for anim in animations:
        times = pack.add(np.asarray(anim["times"], dtype=np.float32).reshape(-1, 1), "SCALAR", minmax=True)
        samplers, channels = [], []
        for node, path, values in anim["channels"]:
            out = pack.add(np.asarray(values, dtype=np.float32), {"translation": "VEC3", "rotation": "VEC4", "scale": "VEC3"}[path])
            samplers.append({"input": times, "output": out, "interpolation": "LINEAR"})
            channels.append({"sampler": len(samplers) - 1, "target": {"node": int(node), "path": path}})
        doc.setdefault("animations", []).append({"name": anim["name"], "samplers": samplers, "channels": channels})
    for i in sorted({c["target"]["node"] for a in doc.get("animations", []) for c in a["channels"] if "node" in c.get("target", {})}):
        node = doc["nodes"][i]
        if "matrix" in node:
            t, r, s = decompose(node.pop("matrix"))
            node.update(translation=[float(v) for v in t], rotation=[float(v) for v in r], scale=[float(v) for v in s])
    write_glb(out_path, doc, pack.finish())
    return {"dropped": dropped, "removedBytes": removed, "embedded": embedded}
