"""Baking code shared by bake_textures.py and transfer_color.py: cast each map from source meshes onto the
target's UVs, tell hit texels from missed ones, fill the misses and pad the islands.

Base colour, roughness and metallic are baked as emission of whatever feeds that input of the source's materials,
so the result does not depend on lighting and metal keeps its colour. Normals are baked in tangent space with green
up (the glTF convention).
"""
import bpy
import numpy as np

import jamscene as js

CHANNELS = {"basecolor": ("Base Color", "sRGB"), "roughness": ("Roughness", "Non-Color"), "metallic": ("Metallic", "Non-Color")}
FLAT_NORMAL = (0.5, 0.5, 1.0)


def to_array(image):
    width, height = image.size
    return np.array(image.pixels[:], dtype=np.float32).reshape(height, width, 4)


def save_png(array, path, colorspace):
    height, width = array.shape[:2]
    image = bpy.data.images.new("jam-save", width, height, alpha=False)
    image.colorspace_settings.name = colorspace
    full = np.ones((height, width, 4), dtype=np.float32)
    full[:, :, :3] = array[:, :, :3]
    image.pixels[:] = full.ravel()
    image.filepath_raw = path
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)


def target_image(size, colorspace):
    image = bpy.data.images.new("jam-bake", size, size, alpha=True)
    image.colorspace_settings.name = colorspace
    image.generated_color = (0, 0, 0, 0)
    return image


def bake_material(targets):
    """Give every target one material whose active node is an image slot; returns (material, set_image)."""
    material = js.new_material("jam-bake-target")
    node = material.node_tree.nodes.new("ShaderNodeTexImage")
    material.node_tree.nodes.active = node
    node.select = True
    for ob in targets:
        ob.data.materials.clear()
        ob.data.materials.append(material)
        for poly in ob.data.polygons:
            poly.material_index = 0

    def set_image(image):
        node.image = image

    return material, set_image


def coverage(targets, material, set_image, size):
    """Texels a face of the target covers: the target baked alone, emitting white."""
    tree = material.node_tree
    output = next(n for n in tree.nodes if n.type == "OUTPUT_MATERIAL")
    old = output.inputs[0].links[0].from_socket
    emit = tree.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (1, 1, 1, 1)
    tree.links.new(emit.outputs[0], output.inputs[0])
    image = target_image(size, "Non-Color")
    set_image(image)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 1
    for index, ob in enumerate(targets):
        js.select([ob])
        bpy.ops.object.bake(type="EMIT", use_selected_to_active=False, margin=0, use_clear=index == 0)
    covered = to_array(image)[:, :, 0] > 0.5
    bpy.data.images.remove(image)
    tree.links.new(old, output.inputs[0])
    tree.nodes.remove(emit)
    return covered


class Emission:
    """While active, the materials of the source meshes emit one of their own inputs (or plain white)."""

    def __init__(self, sources, channel=None):
        self.materials = {slot.material for ob in sources for slot in ob.material_slots if slot.material}
        self.sources, self.channel, self.undo, self.filled = sources, channel, [], []

    def __enter__(self):
        for ob in self.sources:
            if not any(slot.material for slot in ob.material_slots):
                plain = js.new_material("jam-bake-plain")
                ob.data.materials.append(plain)
                self.materials.add(plain)
                self.filled.append(ob)
        for material in self.materials:
            if material.node_tree is None:
                material.use_nodes = True
            tree = material.node_tree
            output = next((n for n in tree.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None) or tree.nodes.new("ShaderNodeOutputMaterial")
            old = output.inputs[0].links[0].from_socket if output.inputs[0].links else None
            shader = next((n for n in tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            emit = tree.nodes.new("ShaderNodeEmission")
            if self.channel is None:
                emit.inputs["Color"].default_value = (1, 1, 1, 1)
            else:
                socket = shader.inputs[CHANNELS[self.channel][0]] if shader else None
                if socket is not None and socket.is_linked:
                    tree.links.new(socket.links[0].from_socket, emit.inputs["Color"])
                elif socket is not None:
                    value = socket.default_value
                    emit.inputs["Color"].default_value = tuple(value) if hasattr(value, "__len__") else (value, value, value, 1)
                else:
                    fallback = {"basecolor": tuple(material.diffuse_color), "roughness": (0.5, 0.5, 0.5, 1), "metallic": (0, 0, 0, 1)}
                    emit.inputs["Color"].default_value = fallback[self.channel]
            tree.links.new(emit.outputs[0], output.inputs[0])
            self.undo.append((tree, output, old, emit))
        return self

    def __exit__(self, *exc):
        for tree, output, old, emit in self.undo:
            if old is not None:
                tree.links.new(old, output.inputs[0])
            tree.nodes.remove(emit)
        return False


def cast(targets, sources, image, kind, extrusion, distance, samples=2):
    """Bake `kind` (EMIT or NORMAL) from the sources onto each target's UVs into one image."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.render.bake.margin = 0
    for index, ob in enumerate(targets):
        scene.render.bake.use_clear = index == 0
        bpy.ops.object.select_all(action="DESELECT")
        for source in sources:
            source.select_set(True)
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        options = {"normal_space": "TANGENT"} if kind == "NORMAL" else {}
        bpy.ops.object.bake(type=kind, use_selected_to_active=True, cage_extrusion=extrusion, max_ray_distance=distance, margin=0, use_clear=index == 0, **options)
    return to_array(image)


def grow(values, known, into, rounds):
    """Spread known texels into `into`, one texel a round, each new texel taking the mean of its known neighbours."""
    values, known = values.copy(), known.copy()
    for _ in range(rounds):
        need = into & ~known
        if not need.any():
            break
        total = np.zeros_like(values)
        count = np.zeros(known.shape, dtype=np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            near = np.roll(known, (dy, dx), axis=(0, 1))
            total += np.roll(values, (dy, dx), axis=(0, 1)) * near[:, :, None]
            count += near
        step = need & (count > 0)
        if not step.any():
            break
        values[step] = total[step] / count[step][:, None]
        known |= step
    return values, known


def bake_maps(targets, sources, size, maps, reach, normal_sources=None, margin_px=16, samples=2):
    """Bake the named maps. Returns ({map: (h, w, 3) array}, facts). `reach` is the tight ray length in scene units;
    a second, wider pass (3x) fills what the tight one missed."""
    material, set_image = bake_material(targets)
    facts = {"size": size, "rayReach": {"tight": [round(reach, 6), round(reach * 2, 6)], "wide": [round(reach * 3, 6), round(reach * 7.5, 6)]}}
    covered = coverage(targets, material, set_image, size)
    with Emission(sources):
        image = target_image(size, "Non-Color")
        set_image(image)
        tight = cast(targets, sources, image, "EMIT", reach, reach * 2, 1)
        wide = cast(targets, sources, image, "EMIT", reach * 3, reach * 7.5, 1)
        bpy.data.images.remove(image)
    hit_tight = covered & (tight[:, :, 0] > 0.5)
    hit_wide = covered & (wide[:, :, 0] > 0.5)
    hit = hit_tight | hit_wide
    texels = max(int(covered.sum()), 1)
    facts.update({"coveredTexelShare": round(float(covered.mean()), 4), "hitShare": round(float(hit.sum()) / texels, 5),
                  "hitShareTightPass": round(float(hit_tight.sum()) / texels, 5)})
    everywhere = np.ones(covered.shape, dtype=bool)
    out = {}
    for name in [m for m in maps if m in CHANNELS]:
        with Emission(sources, name):
            image = target_image(size, CHANNELS[name][1])
            set_image(image)
            a = cast(targets, sources, image, "EMIT", reach, reach * 2, samples)
            b = cast(targets, sources, image, "EMIT", reach * 3, reach * 7.5, samples)
            bpy.data.images.remove(image)
        values = np.where(hit_tight[:, :, None], a[:, :, :3], b[:, :, :3])
        values, known = grow(values, hit, covered, 256)            # missed texels take their neighbours' value
        values, _ = grow(values, known, everywhere, margin_px)     # pad the islands so mip levels do not bleed
        out[name] = values
    if "normal" in maps:
        image = target_image(size, "Non-Color")
        set_image(image)
        normal = cast(targets, normal_sources or sources, image, "NORMAL", reach, reach * 2, max(samples, 4))[:, :, :3]
        bpy.data.images.remove(image)
        # a ray that reached nothing writes a zero normal, and one that hit a neighbouring or back-facing surface
        # writes a normal leaning far from the surface (blue under 0.7 is over 65 degrees off); both become flat
        missed = (normal.sum(axis=2) < 0.05) | (normal[:, :, 2] < 0.7) | ~covered
        normal[missed] = FLAT_NORMAL
        facts["normalTexelsMadeFlat"] = round(float((missed & covered).sum()) / texels, 5)
        facts["normalIsFlat"] = bool(np.abs(normal[covered] - np.array(FLAT_NORMAL, dtype=np.float32)).max() < 0.02) if covered.any() else True
        out["normal"] = normal
    for ob in targets:
        ob.data.materials.clear()
    bpy.data.materials.remove(material)
    facts["_covered"] = covered
    return out, facts


def constant(values, covered, tolerance=1.5 / 255):
    """The single value a map holds over the covered texels, or None when it varies."""
    if not covered.any():
        return None
    sample = values[covered][:, 0]
    return float(sample.mean()) if float(sample.max() - sample.min()) <= tolerance else None


def final_material(name, files, factors):
    """A metallic-roughness material reading the written maps: files = {basecolor, normal, orm} paths (any may be absent)."""
    material = js.new_material(name)
    tree = material.node_tree
    shader = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")

    def image_node(path, colorspace):
        node = tree.nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(path)
        node.image.colorspace_settings.name = colorspace
        return node

    if "basecolor" in files:
        colour = image_node(files["basecolor"], "sRGB")
        tree.links.new(colour.outputs["Color"], shader.inputs["Base Color"])
        tree.nodes.active = colour
    if "orm" in files:
        packed = image_node(files["orm"], "Non-Color")
        split = tree.nodes.new("ShaderNodeSeparateColor")
        tree.links.new(packed.outputs["Color"], split.inputs[0])
        tree.links.new(split.outputs[1], shader.inputs["Roughness"])
        tree.links.new(split.outputs[2], shader.inputs["Metallic"])
    else:
        shader.inputs["Roughness"].default_value = factors.get("roughness", 0.5)
        shader.inputs["Metallic"].default_value = factors.get("metallic", 0.0)
    if "normal" in files:
        normal = image_node(files["normal"], "Non-Color")
        bump = tree.nodes.new("ShaderNodeNormalMap")
        tree.links.new(normal.outputs["Color"], bump.inputs["Color"])
        tree.links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    return material
