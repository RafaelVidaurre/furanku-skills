"""A minimal glTF 2.0 reader: the JSON, node world transforms, accessors, and what a skinned mesh needs checked.
Reads .glb and .gltf (external buffers beside the file; no data URIs)."""
import json
import os
import struct

import numpy as np

_COMPONENT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


class GltfError(ValueError):
    pass


class Gltf:
    def __init__(self, path):
        self.path = path
        with open(path, "rb") as f:
            raw = f.read()
        self.bin = None
        if raw[:4] == b"glTF":
            _, _, total = struct.unpack_from("<4sII", raw, 0)
            offset = 12
            self.json = None
            while offset + 8 <= min(total, len(raw)):
                size, kind = struct.unpack_from("<I4s", raw, offset)
                chunk = raw[offset + 8:offset + 8 + size]
                if kind == b"JSON": self.json = json.loads(chunk.decode("utf-8"))
                elif kind == b"BIN\x00": self.bin = chunk
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
        self._world = {}
        self._buffers = {}

    def local(self, i):
        node = self.nodes[i]
        if "matrix" in node:
            return np.array(node["matrix"], dtype=np.float64).reshape(4, 4).T
        t = node.get("translation", [0, 0, 0]); x, y, z, w = node.get("rotation", [0, 0, 0, 1]); s = node.get("scale", [1, 1, 1])
        R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        M = np.eye(4); M[:3, :3] = R * np.array(s)[None, :]; M[:3, 3] = t
        return M

    def world(self, i):
        if i not in self._world:
            M = self.local(i)
            self._world[i] = self.world(self.parent[i]) @ M if i in self.parent else M
        return self._world[i]

    def _buffer(self, index):
        if index not in self._buffers:
            uri = self.json["buffers"][index].get("uri")
            if uri is None:
                if self.bin is None: raise GltfError("buffer %d has no data" % index)
                self._buffers[index] = self.bin
            elif uri.startswith("data:"):
                raise GltfError("buffers stored as data URIs are not read; pack the file as .glb")
            else:
                with open(os.path.join(os.path.dirname(self.path), uri), "rb") as f:
                    self._buffers[index] = f.read()
        return self._buffers[index]

    def accessor(self, index):
        """An accessor's values as an array of shape (count, width)."""
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
            out = out.astype(np.float64) / np.iinfo(dtype).max
        return out

    # ---- skeletons -------------------------------------------------------------------------------------------------
    def skin_joints(self, skin=0):
        """[(bone name, parent bone name or None, world position)] of a skin's joints, in the file's frame."""
        skins = self.json.get("skins", [])
        if not skins:
            raise GltfError("%s has no skin: it is not a rigged model" % self.path)
        joints = skins[skin]["joints"]
        inside = set(joints)
        out = []
        for i in joints:
            p = self.parent.get(i)
            while p is not None and p not in inside:
                p = self.parent.get(p)
            out.append((self.nodes[i].get("name", "node%d" % i), self.nodes[p].get("name", "node%d" % p) if p is not None else None,
                        tuple(float(v) for v in self.world(i)[:3, 3])))
        return out

    def named_nodes(self):
        """[(node name, parent node name or None, world position)] of every named node: the joints of a file that has
        markers or a bare skeleton but no skin."""
        return [(node["name"], self.nodes[self.parent[i]].get("name") if i in self.parent else None, tuple(float(v) for v in self.world(i)[:3, 3]))
                for i, node in enumerate(self.nodes) if node.get("name")]

    def bind_spread(self, skin=0):
        """How far the node pose is from the bind pose: the largest distance, in the file's units, between where two
        joints say the mesh origin is. Near zero for a file saved in its bind pose; None when it cannot be read."""
        skins = self.json.get("skins", [])
        if not skins or "inverseBindMatrices" not in skins[skin]:
            return None
        s = skins[skin]
        try:
            ibm = self.accessor(s["inverseBindMatrices"]).astype(np.float64).reshape(-1, 4, 4).transpose(0, 2, 1)
        except (GltfError, OSError):
            return None
        origins = np.array([(self.world(j) @ ibm[k])[:3, 3] for k, j in enumerate(s["joints"])])
        return float(np.linalg.norm(origins.max(axis=0) - origins.min(axis=0)))

    def mesh_bounds(self):
        """World bounds ((min), (max)) of all mesh geometry in its stored pose, from the POSITION accessors' declared
        ranges; None when no mesh declares them."""
        lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
        for i, node in enumerate(self.nodes):
            if "mesh" not in node:
                continue
            M = self.world(i)
            if "skin" in node:
                s = self.json["skins"][node["skin"]]
                try:
                    ibm = self.accessor(s["inverseBindMatrices"]).astype(np.float64).reshape(-1, 4, 4).transpose(0, 2, 1)
                    M = self.world(s["joints"][0]) @ ibm[0]
                except (KeyError, GltfError, OSError):
                    M = np.eye(4)
            for prim in self.json["meshes"][node["mesh"]]["primitives"]:
                acc = self.json["accessors"][prim["attributes"]["POSITION"]]
                if "min" not in acc or "max" not in acc:
                    continue
                a, b = acc["min"], acc["max"]
                corners = np.array([[x, y, z, 1.0] for x in (a[0], b[0]) for y in (a[1], b[1]) for z in (a[2], b[2])]) @ M.T
                lo = np.minimum(lo, corners[:, :3].min(axis=0)); hi = np.maximum(hi, corners[:, :3].max(axis=0))
        return None if not np.isfinite(lo).all() else (tuple(float(v) for v in lo), tuple(float(v) for v in hi))


def verify_skinned(path, max_influences=None):
    """Facts about a skinned glTF file and the faults that make it unusable as one.

    Returns {"joints": [names], "roots": [names], "meshes", "primitives", "vertices", "maxInfluences", "influenceSets",
    "worstWeightSum", "problems": [str]}. A sound file has a skin, every primitive of a skinned mesh carries JOINTS_0 and
    WEIGHTS_0, every vertex follows at least one joint, weights sum to 1, and no vertex follows more than `max_influences`."""
    g = Gltf(path)
    problems = []
    skins = g.json.get("skins", [])
    info = {"joints": [], "roots": [], "meshes": 0, "primitives": 0, "vertices": 0, "maxInfluences": 0, "influenceSets": 0,
            "worstWeightSum": 1.0, "problems": problems}
    if not skins:
        problems.append("no skin")
        return info
    if len(skins) > 1:
        problems.append("%d skins; one skeleton is expected" % len(skins))
    joints = g.skin_joints(0)
    info["joints"] = [name for name, _, _ in joints]
    info["roots"] = [name for name, parent, _ in joints if parent is None]
    skinned = [n for n in g.nodes if "mesh" in n and "skin" in n]
    loose = [n.get("name", "?") for n in g.nodes if "mesh" in n and "skin" not in n]
    if loose:
        problems.append("meshes without a skin: " + ", ".join(loose))
    if not skinned:
        problems.append("no mesh uses the skin")
    worst = 0.0
    for node in skinned:
        info["meshes"] += 1
        for prim in g.json["meshes"][node["mesh"]]["primitives"]:
            info["primitives"] += 1
            att = prim["attributes"]
            sets = sorted(k for k in att if k.startswith("JOINTS_"))
            if "JOINTS_0" not in att or "WEIGHTS_0" not in att:
                problems.append("a primitive of %s lacks JOINTS_0 or WEIGHTS_0" % node.get("name", "?"))
                continue
            info["influenceSets"] = max(info["influenceSets"], len(sets))
            W = np.concatenate([g.accessor(att["WEIGHTS_%d" % k]).astype(np.float64) for k in range(len(sets))], axis=1)
            Jn = np.concatenate([g.accessor(att["JOINTS_%d" % k]) for k in range(len(sets))], axis=1)
            info["vertices"] += len(W)
            used = W > 1e-6
            info["maxInfluences"] = max(info["maxInfluences"], int(used.sum(axis=1).max()) if len(W) else 0)
            if len(W):
                worst = max(worst, float(np.abs(W.sum(axis=1) - 1.0).max()))
                if int((used.sum(axis=1) == 0).sum()):
                    problems.append("%d vertices of %s follow no joint" % (int((used.sum(axis=1) == 0).sum()), node.get("name", "?")))
                if int(Jn[used].max()) >= len(joints):
                    problems.append("a vertex of %s names a joint outside the skin" % node.get("name", "?"))
    info["worstWeightSum"] = round(1.0 + worst, 6) if worst else 1.0
    if worst > 0.01:
        problems.append("weights do not sum to 1 (off by up to %.3f)" % worst)
    if max_influences is not None and info["maxInfluences"] > max_influences:
        problems.append("a vertex follows %d joints; the limit is %d" % (info["maxInfluences"], max_influences))
    return info
