"""Read and rewrite binary glTF (.glb) without a DCC: geometry, UV sets, materials and embedded images.

The report scripts of jam-3d-retopo, jam-3d-uv and jam-3d-texture each ship an identical copy of this file, so a skill
installed alone still works; test_glb.py fails when the copies differ. Needs numpy.
"""
import base64
import hashlib
import json
import struct

import numpy as np


class GlbError(Exception):
    """The file cannot be read as the scripts need it; the message says what to do."""


_DTYPE = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}
_JSON, _BIN = 0x4E4F534A, 0x004E4942
TEXTURE_SLOTS = ("baseColorTexture", "metallicRoughnessTexture", "normalTexture", "occlusionTexture", "emissiveTexture")


def read(path):
    with open(path, "rb") as handle:
        data = handle.read()
    if data[:4] != b"glTF":
        raise GlbError(f"{path}: not a binary glTF (.glb). Embed a .gltf with 'jam pack-glb'; export other formats to GLB from a DCC")
    doc, blob, offset = None, b"", 12
    while offset + 8 <= len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        chunk = data[offset + 8:offset + 8 + length]
        offset += 8 + length
        if kind == _JSON:
            doc = json.loads(chunk.decode("utf-8"))
        elif kind == _BIN:
            blob = bytes(chunk)
    if doc is None:
        raise GlbError(f"{path}: no JSON chunk")
    return Glb(doc, blob, str(path))


def write(path, doc, blob):
    text = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    text += b" " * (-len(text) % 4)
    blob = bytes(blob) + b"\0" * (-len(blob) % 4)
    chunks = struct.pack("<II", len(text), _JSON) + text
    if blob:
        chunks += struct.pack("<II", len(blob), _BIN) + blob
    with open(path, "wb") as handle:
        handle.write(b"glTF" + struct.pack("<II", 2, 12 + len(chunks)) + chunks)


def image_size(data):
    """(width, height) of PNG, JPEG or WebP bytes, read from the header; None when unknown."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", data[16:24])
    if data[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                height, width = struct.unpack(">HH", data[i + 5:i + 9])
                return (width, height)
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            i += 2 + struct.unpack(">H", data[i + 2:i + 4])[0]
        return None
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        kind = data[12:16]
        if kind == b"VP8X":
            return (1 + int.from_bytes(data[24:27], "little"), 1 + int.from_bytes(data[27:30], "little"))
        if kind == b"VP8 ":
            width, height = struct.unpack("<HH", data[26:30])
            return (width & 0x3FFF, height & 0x3FFF)
        if kind == b"VP8L":
            bits = int.from_bytes(data[21:25], "little")
            return (1 + (bits & 0x3FFF), 1 + ((bits >> 14) & 0x3FFF))
    return None


def _node_matrix(node):
    if "matrix" in node:
        return np.array(node["matrix"], dtype=np.float64).reshape(4, 4).T
    matrix = np.eye(4)
    if "scale" in node:
        matrix = np.diag([*node["scale"], 1.0]) @ matrix
    if "rotation" in node:
        x, y, z, w = node["rotation"]
        rotation = np.eye(4)
        rotation[:3, :3] = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
        matrix = rotation @ matrix
    if "translation" in node:
        matrix[:3, 3] += node["translation"]
    return matrix


class Glb:
    def __init__(self, doc, blob, path="<memory>"):
        self.doc, self.blob, self.path = doc, blob, path
        for buffer in doc.get("buffers", [])[1:] + [b for b in doc.get("buffers", [])[:1] if "uri" in b]:
            raise GlbError(f"{path}: geometry lives in an external buffer ({buffer.get('uri', 'second buffer')}); embed it with 'jam pack-glb'")

    def view(self, index):
        view = self.doc["bufferViews"][index]
        if "EXT_meshopt_compression" in view.get("extensions", {}):
            raise GlbError(f"{self.path}: meshopt-compressed; decompress it first (a DCC import and export does)")
        start = view.get("byteOffset", 0)
        return self.blob[start:start + view["byteLength"]]

    def accessor(self, index):
        spec = self.doc["accessors"][index]
        dtype, width, count = np.dtype(_DTYPE[spec["componentType"]]), _WIDTH[spec["type"]], spec["count"]
        if "sparse" in spec:
            raise GlbError(f"{self.path}: sparse accessors are not supported; re-export the model from a DCC")
        if "bufferView" not in spec:
            return np.zeros((count, width), dtype=np.float64)
        view = self.doc["bufferViews"][spec["bufferView"]]
        start = view.get("byteOffset", 0) + spec.get("byteOffset", 0)
        size = dtype.itemsize * width
        stride = view.get("byteStride") or size
        if stride == size:
            values = np.frombuffer(self.blob, dtype=dtype, count=count * width, offset=start).reshape(count, width)
        else:
            raw = np.frombuffer(self.blob, dtype=np.uint8, count=(count - 1) * stride + size, offset=start)
            rows = np.arange(count)[:, None] * stride + np.arange(size)[None, :]
            values = raw[rows].copy().view(dtype).reshape(count, width)
        if spec.get("normalized") and dtype.kind in "iu":
            scale = float(np.iinfo(dtype).max)
            return np.maximum(values.astype(np.float64) / scale, -1.0)
        return values

    def primitives(self):
        """One dict per drawn triangle primitive: world-space positions, triangle indices, UV sets, material."""
        doc, out = self.doc, []
        nodes = doc.get("nodes", [])
        roots = [n for scene in doc.get("scenes", []) for n in scene.get("nodes", [])] or list(range(len(nodes)))
        stack = [(index, np.eye(4)) for index in roots]
        seen = set()
        while stack:
            index, parent = stack.pop()
            if index in seen:
                continue
            seen.add(index)
            node = nodes[index]
            world = parent @ _node_matrix(node)
            stack += [(child, world) for child in node.get("children", [])]
            if "mesh" not in node:
                continue
            mesh = doc["meshes"][node["mesh"]]
            for number, primitive in enumerate(mesh["primitives"]):
                if "KHR_draco_mesh_compression" in primitive.get("extensions", {}):
                    raise GlbError(f"{self.path}: Draco-compressed; decompress it first (a DCC import and export does)")
                if primitive.get("mode", 4) != 4:
                    continue
                attributes = primitive["attributes"]
                positions = self.accessor(attributes["POSITION"]).astype(np.float64)
                if "skin" not in node:
                    positions = positions @ world[:3, :3].T + world[:3, 3]
                if "indices" in primitive:
                    indices = self.accessor(primitive["indices"]).astype(np.int64).reshape(-1)
                else:
                    indices = np.arange(len(positions), dtype=np.int64)
                uvs = {}
                for name, accessor in attributes.items():
                    if name.startswith("TEXCOORD_"):
                        uvs[int(name[9:])] = self.accessor(accessor).astype(np.float64)
                out.append({"mesh": mesh.get("name") or f"mesh{node['mesh']}", "node": node.get("name") or f"node{index}",
                            "primitive": number, "material": primitive.get("material"), "skinned": "skin" in node,
                            "positions": positions, "triangles": indices[:len(indices) // 3 * 3].reshape(-1, 3), "uvs": uvs,
                            "attributes": sorted(attributes)})
        return out

    def images(self):
        """One dict per image entry: bytes (None when the file is external), size, sha256, and which material slots use it."""
        doc = self.doc
        users = {}
        for m_index, material in enumerate(doc.get("materials", [])):
            name = material.get("name") or f"material{m_index}"
            slots = dict(material.get("pbrMetallicRoughness", {}))
            slots.update(material)
            for slot in TEXTURE_SLOTS:
                if slot in slots and isinstance(slots[slot], dict) and slots[slot].get("index", -1) in range(len(doc.get("textures", []))):
                    texture = doc["textures"][slots[slot]["index"]]
                    source = texture.get("source")
                    for extension in texture.get("extensions", {}).values():
                        if isinstance(extension, dict) and "source" in extension:
                            source = extension["source"] if source is None else source
                    if source is not None:
                        users.setdefault(source, []).append({"material": name, "slot": slot[:-len("Texture")]})
        out = []
        for index, image in enumerate(doc.get("images", [])):
            data = None
            if "bufferView" in image:
                data = self.view(image["bufferView"])
            elif image.get("uri", "").startswith("data:"):
                data = base64.b64decode(image["uri"].split(",", 1)[1])
            size = image_size(data) if data else None
            out.append({"index": index, "name": image.get("name") or image.get("uri", f"image{index}")[:80], "mimeType": image.get("mimeType"),
                        "bytes": data, "byteLength": len(data) if data else None, "size": list(size) if size else None,
                        "sha256": hashlib.sha256(data).hexdigest() if data else None, "usedBy": users.get(index, [])})
        return out

    def rebuilt(self, replace_views=None, drop_accessors=(), drop_images=()):
        """A new (doc, blob) with some buffer views' bytes replaced and some accessors or images removed.

        Accessors and images are removed only from the lists; the caller removes what pointed at them first.
        Buffer views no remaining accessor or image uses are dropped and the binary chunk is repacked.
        """
        doc = json.loads(json.dumps(self.doc))
        replace_views = dict(replace_views or {})
        drop_accessors, drop_images = set(drop_accessors), set(drop_images)

        def remap(count, dropped):
            table, kept = {}, 0
            for index in range(count):
                if index not in dropped:
                    table[index] = kept
                    kept += 1
            return table

        if drop_images:
            def sources(texture):
                return [h for h in [texture] + [e for e in texture.get("extensions", {}).values() if isinstance(e, dict)] if "source" in h]

            # textures that read a dropped image go with it; the caller made sure no material uses them
            gone = {i for i, texture in enumerate(doc.get("textures", [])) if any(h["source"] in drop_images for h in sources(texture))}
            texture_table = remap(len(doc.get("textures", [])), gone)

            def retarget(holder):
                for key, value in holder.items():
                    if isinstance(value, dict):
                        if key.endswith("Texture") and "index" in value:
                            if value["index"] in gone:
                                raise GlbError("an image still used by a material cannot be dropped")
                            value["index"] = texture_table[value["index"]]
                        retarget(value)

            for material in doc.get("materials", []):
                retarget(material)
            doc["textures"] = [texture for i, texture in enumerate(doc.get("textures", [])) if i not in gone]
            table = remap(len(doc.get("images", [])), drop_images)
            doc["images"] = [image for index, image in enumerate(doc["images"]) if index not in drop_images]
            for texture in doc["textures"]:
                for holder in sources(texture):
                    holder["source"] = table[holder["source"]]
            for key in ("textures", "images"):
                if not doc[key]:
                    del doc[key]
        if drop_accessors:
            table = remap(len(doc.get("accessors", [])), drop_accessors)
            doc["accessors"] = [a for index, a in enumerate(doc["accessors"]) if index not in drop_accessors]
            for mesh in doc.get("meshes", []):
                for primitive in mesh["primitives"]:
                    primitive["attributes"] = {k: table[v] for k, v in primitive["attributes"].items()}
                    if "indices" in primitive:
                        primitive["indices"] = table[primitive["indices"]]
                    for target in primitive.get("targets", []):
                        for key in target:
                            target[key] = table[target[key]]
                    instancing = primitive.get("extensions", {}).get("EXT_mesh_gpu_instancing", {}).get("attributes", {})
                    for key in instancing:
                        instancing[key] = table[instancing[key]]
            for skin in doc.get("skins", []):
                if "inverseBindMatrices" in skin:
                    skin["inverseBindMatrices"] = table[skin["inverseBindMatrices"]]
            for animation in doc.get("animations", []):
                for sampler in animation["samplers"]:
                    sampler["input"], sampler["output"] = table[sampler["input"]], table[sampler["output"]]
            for node in doc.get("nodes", []):
                instancing = node.get("extensions", {}).get("EXT_mesh_gpu_instancing", {}).get("attributes", {})
                for key in instancing:
                    instancing[key] = table[instancing[key]]
        used = {a["bufferView"] for a in doc.get("accessors", []) if "bufferView" in a}
        used |= {i["bufferView"] for i in doc.get("images", []) if "bufferView" in i}
        views = doc.get("bufferViews", [])
        table, blob, kept = {}, bytearray(), []
        for index, view in enumerate(views):
            if index not in used:
                continue
            data = replace_views.get(index, self.view(index))
            blob += b"\0" * (-len(blob) % 4)
            view = dict(view, byteOffset=len(blob), byteLength=len(data), buffer=0)
            blob += data
            table[index] = len(kept)
            kept.append(view)
        for holder in doc.get("accessors", []) + doc.get("images", []):
            if "bufferView" in holder:
                holder["bufferView"] = table[holder["bufferView"]]
        doc["bufferViews"] = kept
        blob += b"\0" * (-len(blob) % 4)
        if blob:
            doc["buffers"] = [{"byteLength": len(blob)}]
        else:
            doc.pop("buffers", None)
            doc.pop("bufferViews", None)
        return doc, bytes(blob)


def weld(positions, tolerance):
    """Map each position to the index of its welded vertex: positions closer than the tolerance grid merge."""
    keys = np.round(positions / tolerance).astype(np.int64)
    _, inverse = np.unique(keys, axis=0, return_inverse=True)
    return inverse.reshape(-1)


def components(count, pairs):
    """Label 0..count-1 items by connected component, given an (n, 2) array of linked pairs."""
    labels = np.arange(count, dtype=np.int64)
    if len(pairs) == 0:
        return labels
    a, b = pairs[:, 0], pairs[:, 1]
    while True:
        low = np.minimum(labels[a], labels[b])
        updated = labels.copy()
        np.minimum.at(updated, a, low)
        np.minimum.at(updated, b, low)
        updated = updated[updated]
        if np.array_equal(updated, labels):
            return labels
        labels = updated


def build(meshes, materials=None, images=None):
    """A Glb from arrays, for generated fixtures. meshes: dicts with `positions` (n, 3), `triangles` (m, 3) and
    optionally `uvs` (a list of (n, 2) arrays, one per UV set), `material` (index) and `name`. materials: glTF
    material dicts. images: encoded image bytes (PNG), each also given a texture of the same index."""
    doc = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": list(range(len(meshes)))}], "nodes": [], "meshes": [],
           "accessors": [], "bufferViews": []}
    blob = bytearray()

    def view(data, target=None):
        blob.extend(b"\0" * (-len(blob) % 4))
        entry = {"buffer": 0, "byteOffset": len(blob), "byteLength": len(data)}
        if target:
            entry["target"] = target
        blob.extend(data)
        doc["bufferViews"].append(entry)
        return len(doc["bufferViews"]) - 1

    def accessor(array, component, kind, target, bounds=False):
        entry = {"bufferView": view(array.tobytes(), target), "componentType": component, "count": len(array), "type": kind}
        if bounds:
            entry["min"], entry["max"] = array.min(axis=0).tolist(), array.max(axis=0).tolist()
        doc["accessors"].append(entry)
        return len(doc["accessors"]) - 1

    for index, mesh in enumerate(meshes):
        attributes = {"POSITION": accessor(np.asarray(mesh["positions"], dtype=np.float32), 5126, "VEC3", 34962, bounds=True)}
        for number, uv in enumerate(mesh.get("uvs", [])):
            attributes[f"TEXCOORD_{number}"] = accessor(np.asarray(uv, dtype=np.float32), 5126, "VEC2", 34962)
        primitive = {"attributes": attributes, "indices": accessor(np.asarray(mesh["triangles"], dtype=np.uint32).reshape(-1, 1), 5125, "SCALAR", 34963)}
        if mesh.get("material") is not None:
            primitive["material"] = mesh["material"]
        doc["meshes"].append({"name": mesh.get("name", f"mesh{index}"), "primitives": [primitive]})
        doc["nodes"].append({"name": mesh.get("name", f"mesh{index}"), "mesh": index})
    if materials:
        doc["materials"] = materials
    if images:
        doc["images"] = [{"name": f"image{i}", "mimeType": "image/png", "bufferView": view(data)} for i, data in enumerate(images)]
        doc["textures"] = [{"source": i} for i in range(len(images))]
    doc["buffers"] = [{"byteLength": len(blob)}]
    return Glb(doc, bytes(blob))
