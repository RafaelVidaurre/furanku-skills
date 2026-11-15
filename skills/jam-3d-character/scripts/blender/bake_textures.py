"""Bake final textures for the character's parts onto UV layer UV0.

Base colour: Meshy's remesh texture read through the old layout (UV_Meshy) and written through UV0 on the same
mesh, with a per-class colour correction toward each class's reference colour in the character spec, and the skin
colour on the built scalp. The source's painting is kept as it is: texture repairs run only when the spec's `repair`
flags ask for them (hairline: the pale outline and stray colour along the hair role's border; skinDarkSpots: dark specks
on the skin role's class below the head), and each reports how many texels it changed, with before/after images in debug/.
Normal: tangent-space bake from the accepted high-resolution source mesh; the scalp is left flat.
ORM: occlusion 1, each class's roughness from the spec, metallic from each class's `metallic` or, with --metallic-map,
the provider's metallic map read through the old layout.
Maps are T_<name>_<object>_<BaseColor|Normal|ORM>.png and materials M_<name>_<object>, after the spec's name.

blender --background --python-exit-code 1 --python bake_textures.py -- <uv.blend> <remesh_base_color.png> <source_highres.glb> <out-dir> --character <character.json> [--metallic-map <provider_metallic.png>]
"""
import bpy, bmesh, sys, os, json, colorsys
import numpy as np
from mathutils import Vector
from mathutils.geometry import intersect_point_line
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import charspec

args, spec = charspec.require()
METAL_PATH = None
if "--metallic-map" in args:
    i = args.index("--metallic-map"); METAL_PATH = args[i + 1]; del args[i:i + 2]
blend, tex, highres, out = args[:4]
REPAIR = spec.repair
REPAIR_BOUND = 0.05   # a repair that changes more than this share of a part's covered texels is reported as out of bounds
os.makedirs(os.path.join(out, "debug"), exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=blend)
src_img = bpy.data.images.load(tex); W, Hh = src_img.size
px = np.array(src_img.pixels[:], dtype=np.float32).reshape(Hh, W, src_img.channels)[:, :, :3]
HEAD, HAIR, BODY = spec.part("head"), spec.part("hair"), spec.part("body")
SKIN, HAIR_CLS = spec.role_class("skin"), spec.role_class("hair")
ROLE_OF = {spec.part(r): r for r in ("head", "hair", "body") if spec.part(r)}
SIZES = {n: spec.texture_sizes[r] for n, r in ROLE_OF.items()}
REF = {c: spec.rgb(c) for c in spec.classes}
ROUGH = {c: spec.roughness(c) for c in spec.classes}
METAL = {c: spec.metallic(c) for c in spec.classes}
if SKIN: REF["scalp"], ROUGH["scalp"], METAL["scalp"] = REF[SKIN], ROUGH[SKIN], 0.0
metal_img = None
if METAL_PATH:
    metal_img = bpy.data.images.load(METAL_PATH); metal_img.colorspace_settings.name = "Non-Color"
# cage extrusion and maximum ray distance of the normal bake, in millimetres of the real character
RAYS_MM = {"head": (4.81632, 11.5592), "hair": (4.81632, 11.5592), "body": (2.88979, 5.77958)}
lin = lambda c: np.where(np.array(c) <= 0.04045, np.array(c) / 12.92, ((np.array(c) + 0.055) / 1.055) ** 2.4)
report = {"blender": bpy.app.version_string, "reference": REF, "roughness": ROUGH, "metallic": "provider map " + os.path.basename(METAL_PATH) if METAL_PATH else METAL,
          "repair": REPAIR, "repairBoundShare": REPAIR_BOUND, "parts": {}}


def face_rgb(f, uv):
    cu = sum((l[uv].uv for l in f.loops), Vector((0, 0))) / len(f.loops)
    cols = [px[min(Hh - 1, max(0, int(p.y % 1.0 * Hh))), min(W - 1, max(0, int(p.x % 1.0 * W)))] for p in [cu] + [(l[uv].uv + cu) / 2 for l in f.loops]]
    return np.median(np.array(cols), axis=0)


def classify(ob):
    """Face index -> class name, from the source texture through UV_Meshy."""
    bm = bmesh.new(); bm.from_mesh(ob.data); uv = bm.loops.layers.uv["UV_Meshy"]; bm.faces.ensure_lookup_table()
    cls, rgb = {}, {}
    role = ROLE_OF[ob.name]
    if role == "hair" and REPAIR["hairline"]:
        for f in bm.faces: cls[f.index] = HAIR_CLS; rgb[f.index] = face_rgb(f, uv)
    elif role == "head" and SKIN:
        cands = spec.candidates("head"); hair_keys = set()
        if HAIR:
            hb = bmesh.new(); hb.from_mesh(bpy.data.objects[HAIR].data); huv = hb.loops.layers.uv["UV_Meshy"]
            hair_keys = {tuple(sorted((round(l[huv].uv.x, 5), round(l[huv].uv.y, 5)) for l in f.loops)) for f in hb.faces}; hb.free()
        for f in bm.faces:
            key = tuple(sorted((round(l[uv].uv.x, 5), round(l[uv].uv.y, 5)) for l in f.loops))
            c = face_rgb(f, uv); rgb[f.index] = c
            cls[f.index] = "scalp" if key in hair_keys else (SKIN if len(cands) == 1 else spec.classify(tuple(float(x) for x in c), cands))
    else:
        cands = spec.candidates(role)
        for f in bm.faces:
            c = face_rgb(f, uv); rgb[f.index] = c
            cls[f.index] = spec.classify(tuple(float(x) for x in c), cands)
        for _ in range(2):
            change = {}
            for f in bm.faces:
                around = [g.index for e in f.edges for g in e.link_faces if g is not f]
                other = [cls[i] for i in around if cls[i] != cls[f.index]]
                if around and len(other) > len(around) / 2: change[f.index] = max(set(other), key=other.count)
            cls.update(change)
    bm.free(); return cls, rgb


def new_image(name, size, colorspace, fill):
    img = bpy.data.images.new(name, size, size, alpha=False); img.colorspace_settings.name = colorspace
    img.generated_color = fill; return img


def setup_bake_materials(ob, cls, rgb, mode, target):
    """One material per face class. mode: 'color', 'rough' or 'mask'. The target image node is active in each."""
    names = sorted(set(cls.values())); ob.data.materials.clear(); factors = {}
    for n in names:
        m = bpy.data.materials.new(f"bake_{ob.name}_{n}_{mode}"); m.use_nodes = True; nt = m.node_tree
        for node in list(nt.nodes): nt.nodes.remove(node)
        outn = nt.nodes.new("ShaderNodeOutputMaterial"); em = nt.nodes.new("ShaderNodeEmission"); nt.links.new(em.outputs[0], outn.inputs[0])
        if mode == "color":
            if n == "scalp":
                em.inputs["Color"].default_value = (*lin(np.array(REF["scalp"]) / 255.0), 1)
            else:
                med = np.median(np.array([rgb[i] for i, c in cls.items() if c == n]), axis=0)
                fac = np.clip(lin(np.array(REF[n]) / 255.0) / np.maximum(lin(med), 1e-4), 0.25, 4.0); factors[n] = [round(float(x), 3) for x in fac]
                uvn = nt.nodes.new("ShaderNodeUVMap"); uvn.uv_map = "UV_Meshy"
                t = nt.nodes.new("ShaderNodeTexImage"); t.image = src_img; nt.links.new(uvn.outputs["UV"], t.inputs["Vector"])
                mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.blend_type = "MULTIPLY"; mix.inputs[0].default_value = 1.0
                nt.links.new(t.outputs["Color"], mix.inputs[6]); mix.inputs[7].default_value = (*fac, 1)
                nt.links.new(mix.outputs[2], em.inputs["Color"])
        elif mode == "rough":
            r = ROUGH[n]; em.inputs["Color"].default_value = (r, r, r, 1)
        elif mode == "metal":
            if metal_img is not None and n != "scalp":
                uvn = nt.nodes.new("ShaderNodeUVMap"); uvn.uv_map = "UV_Meshy"
                t = nt.nodes.new("ShaderNodeTexImage"); t.image = metal_img; nt.links.new(uvn.outputs["UV"], t.inputs["Vector"])
                nt.links.new(t.outputs["Color"], em.inputs["Color"])
            else:
                v = METAL[n]; em.inputs["Color"].default_value = (v, v, v, 1)
        elif mode == "skinmask":
            v = 1.0 if n == SKIN else 0.0; em.inputs["Color"].default_value = (v, v, v, 1)
        else:
            v = 1.0 if n == "scalp" else 0.0; em.inputs["Color"].default_value = (v, v, v, 1)
        tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = target; nt.nodes.active = tn; tn.select = True
        ob.data.materials.append(m)
    idx = {n: i for i, n in enumerate(names)}
    for p in ob.data.polygons: p.material_index = idx[cls[p.index]]
    return factors


def bake(ob, kind, margin=16, **kw):
    bpy.ops.object.select_all(action="DESELECT"); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    for extra in kw.pop("sources", []): extra.select_set(True)
    bpy.ops.object.bake(type=kind, margin=margin, margin_type="EXTEND", **kw)


def class_border_segments(ob, cls, group_a, group_b):
    """Mesh edges between a face of a class in group_a and a face of a class in group_b."""
    b = bmesh.new(); b.from_mesh(ob.data); b.faces.ensure_lookup_table(); segs = []
    for e in b.edges:
        if len(e.link_faces) != 2: continue
        c0, c1 = (cls[f.index] for f in e.link_faces)
        if (c0 in group_a and c1 in group_b) or (c1 in group_a and c0 in group_b):
            segs.append((ob.matrix_world @ e.verts[0].co, ob.matrix_world @ e.verts[1].co))
    b.free(); return segs


def face_group_mask(ob, cls, rgb, group, size):
    """Texels covered by faces whose class is in group (baked through UV0)."""
    img = new_image(f"{ob.name}_group", size, "Non-Color", (0, 0, 0, 1))
    setup_bake_materials(ob, {i: (SKIN if c in group else "other") for i, c in cls.items()}, rgb, "skinmask", img)
    was = hi.hide_render; hi.hide_render = True; bake(ob, "EMIT"); hi.hide_render = was
    return to_np(img)[:, :, 0] > 0.5


def boundary_segments(ob):
    b = bmesh.new(); b.from_mesh(ob.data)
    segs = [(ob.matrix_world @ e.verts[0].co, ob.matrix_world @ e.verts[1].co) for e in b.edges if e.is_boundary]; b.free(); return segs


def vertex_value_image(ob, key, vals, margin=16):
    """Bake one number per vertex (0..1) through UV0. Texels no face (or its margin) covers come back as -1."""
    me = ob.data
    a = me.attributes.get(key) or me.attributes.new(key, "FLOAT", "POINT"); a.data.foreach_set("value", vals)
    img = new_image(f"{ob.name}_{key}", SIZES[ob.name], "Non-Color", (1, 1, 1, 1))
    m = bpy.data.materials.new(f"bake_{ob.name}_{key}"); m.use_nodes = True; nt = m.node_tree
    for node in list(nt.nodes): nt.nodes.remove(node)
    outn = nt.nodes.new("ShaderNodeOutputMaterial"); em = nt.nodes.new("ShaderNodeEmission"); at = nt.nodes.new("ShaderNodeAttribute"); at.attribute_name = key
    # the bake clears the image to black first, so covered texels are lifted to at least 0.02 to tell them from empty ones
    ma = nt.nodes.new("ShaderNodeMath"); ma.operation = "MULTIPLY_ADD"; ma.inputs[1].default_value = 0.98; ma.inputs[2].default_value = 0.02
    nt.links.new(at.outputs["Fac"], ma.inputs[0]); nt.links.new(ma.outputs[0], em.inputs["Color"]); nt.links.new(em.outputs[0], outn.inputs[0])
    tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = img; nt.nodes.active = tn; tn.select = True
    me.materials.clear(); me.materials.append(m)
    for p_ in me.polygons: p_.material_index = 0
    was = hi.hide_render; hi.hide_render = True; bake(ob, "EMIT", margin=margin); hi.hide_render = was
    raw = to_np(img)[:, :, 0]; save_png(np.repeat(raw[:, :, None], 3, axis=2), os.path.join(out, "debug", f"{ob.name}-{key}.png"), "Non-Color")
    # 8-bit rounding can put a covered texel a hair under 0.02, so the value is clamped at zero rather than read as uncovered
    return np.where(raw > 0.01, np.maximum((raw - 0.02) / 0.98, 0.0), -1.0)


def band_image(ob, segs, label):
    """Distance of every texel from a set of mesh edges, in millimetres (capped at BAND_MM): a per-vertex distance
    baked through UV0. It finds the texels beside a part's border wherever the UV layout put them."""
    vals = []
    for v in ob.data.vertices:
        pt = ob.matrix_world @ v.co; best = 1e9
        for s0, s1 in segs:
            t = max(0.0, min(1.0, intersect_point_line(pt, s0, s1)[1])); best = min(best, (pt - s0.lerp(s1, t)).length)
        vals.append(min(1.0, best / (BAND_MM * MM)))
    v_img = vertex_value_image(ob, "band_" + label, vals)
    report.setdefault("bands", {})[f"{ob.name}/{label}"] = {"vertsWithin10mm": sum(1 for x in vals if x * BAND_MM < 10), "texelsWithin3mm": int(((v_img >= 0) & (v_img * BAND_MM < 3)).sum()), "coveredTexels": int((v_img >= 0).sum())}
    return np.where(v_img >= 0, v_img, 1.0) * BAND_MM


def inpaint(C, bad, allowed, fallback, covered):
    """Give the texels in `bad` the colour of the nearest good texels of the same part (`allowed`), growing inward.
    Colour travels only across texels a face covers, so it cannot arrive from another UV island over the gap between
    them; the margins around the islands are then rebuilt from the covered texels."""
    g = bad.copy(); g[1:, :] |= bad[:-1, :]; g[:-1, :] |= bad[1:, :]; g[:, 1:] |= bad[:, :-1]; g[:, :-1] |= bad[:, 1:]; bad = g & allowed & covered
    rgb = C[:, :, :3].copy()
    def grow(known, into, rounds):
        for _ in range(rounds):
            need = into & ~known
            if not need.any(): break
            acc = np.zeros_like(rgb); cnt = np.zeros(known.shape, dtype=np.float32)
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                k = np.roll(known, (dy, dx), axis=(0, 1)); acc += np.roll(rgb, (dy, dx), axis=(0, 1)) * k[:, :, None]; cnt += k
            step = need & (cnt > 0)
            if not step.any(): break
            rgb[step] = acc[step] / cnt[step][:, None]; known |= step
        return known
    known = grow(allowed & covered & ~bad, bad, 200)
    rgb[bad & ~known] = fallback
    grow(covered.copy(), ~covered, 16)
    C[:, :, :3] = rgb; return int(bad.sum())


def to_np(img):
    n = img.size[0]; return np.array(img.pixels[:], dtype=np.float32).reshape(n, n, 4)


def save_png(arr, path, colorspace):
    n = arr.shape[0]; img = bpy.data.images.new("save", n, n, alpha=False); img.colorspace_settings.name = colorspace
    a = np.ones((n, n, 4), dtype=np.float32); a[:, :, :3] = arr[:, :, :3]; img.pixels[:] = a.ravel()
    img.filepath_raw = path; img.file_format = "PNG"; img.save(); bpy.data.images.remove(img)


s = bpy.context.scene; s.render.engine = "CYCLES"; s.cycles.device = "CPU"; s.cycles.samples = 4
s.render.bake.use_clear = True; s.view_settings.view_transform = "Standard"
# high-resolution source for the normal bake
before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=highres)
hi = [o for o in bpy.data.objects if o not in before and o.type == "MESH"][0]
bpy.ops.object.select_all(action="DESELECT"); hi.select_set(True); bpy.context.view_layer.objects.active = hi
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
hv = np.array([v.co[:] for v in hi.data.vertices]); report["sourceBounds"] = [hv.min(axis=0).round(4).tolist(), hv.max(axis=0).round(4).tolist()]
lv = np.array([v.co[:] for n in SIZES for v in bpy.data.objects[n].data.vertices]); report["lowBounds"] = [lv.min(axis=0).round(4).tolist(), lv.max(axis=0).round(4).tolist()]
hi.hide_render = False
LZ0, LH = float(lv[:, 2].min()), float(lv[:, 2].max() - lv[:, 2].min())
MM = spec.mm(LH)                                      # one millimetre of the real character, in this file's units
BAND_MM = 30.0
hair_segs = boundary_segments(bpy.data.objects[HAIR]) if HAIR else []
report["borderEdges"] = {n: len(boundary_segments(bpy.data.objects[n])) for n in SIZES}

final_mats = {}
for name, size in SIZES.items():
    ob = bpy.data.objects[name]; me = ob.data
    me.uv_layers.active = me.uv_layers["UV0"]; me.uv_layers["UV0"].active_render = True
    for p in me.polygons: p.use_smooth = True
    cls, rgb = classify(ob); role = ROLE_OF[name]
    counts = {}
    for c in cls.values(): counts[c] = counts.get(c, 0) + 1
    hi.hide_render = True
    col = new_image(f"{name}_col", size, "sRGB", (0.5, 0.5, 0.5, 1))
    factors = setup_bake_materials(ob, cls, rgb, "color", col); bake(ob, "EMIT")
    rough = new_image(f"{name}_rough", size, "Non-Color", (0.7, 0.7, 0.7, 1))
    setup_bake_materials(ob, cls, rgb, "rough", rough); bake(ob, "EMIT")
    metal = new_image(f"{name}_metal", size, "Non-Color", (0, 0, 0, 1))
    setup_bake_materials(ob, cls, rgb, "metal", metal); bake(ob, "EMIT")
    mask = new_image(f"{name}_mask", size, "Non-Color", (0, 0, 0, 1))
    setup_bake_materials(ob, cls, rgb, "mask", mask); bake(ob, "EMIT")
    hi.hide_render = False
    nrm = new_image(f"{name}_nrm", size, "Non-Color", (0.5, 0.5, 1, 1))
    setup_bake_materials(ob, cls, rgb, "mask", nrm)
    bake(ob, "NORMAL", sources=[hi], use_selected_to_active=True, cage_extrusion=RAYS_MM[role][0] * MM, max_ray_distance=RAYS_MM[role][1] * MM, normal_space="TANGENT")
    C, R, M, N = to_np(col), to_np(rough), to_np(mask), to_np(nrm)
    covered = vertex_value_image(ob, "cover", [1.0] * len(me.vertices), margin=0) >= 0
    scalp = M[:, :, 0] > 0.5
    N[scalp] = (0.5, 0.5, 1.0, 1.0)
    # a ray that reached nothing writes a zero normal, and one that hit a neighbouring or back-facing surface writes a normal
    # leaning far from the surface (blue below 0.7 is more than about 65 degrees off); both shade black, so both become flat
    missed = (N[:, :, :3].sum(axis=2) < 0.05) | (N[:, :, 2] < 0.7)
    N[missed] = (0.5, 0.5, 1.0, 1.0)
    normal_missed = round(float(missed.mean()), 4)
    orm = np.zeros((size, size, 3), dtype=np.float32); orm[:, :, 0] = 1.0; orm[:, :, 1] = R[:, :, 0]; orm[:, :, 2] = to_np(metal)[:, :, 0]
    paths = {k: os.path.join(out, f"T_{spec.name}_{name}_{k}.png") for k in ("BaseColor", "Normal", "ORM")}
    # Cycles writes linear values into the sRGB target; Blender's save applies the image colour space
    fixed = 0; repaired = {}; before = C[:, :, :3].copy()
    if role == "head" and SKIN:
        # The source texture has a pale outline around the hair, and where the hair's edge cuts a corner of the painted
        # hairline (or the colour projection reached hair from an ear) skin faces carry hair-coloured texels. Beside the
        # hair's edge these take the colour of the skin next to them; a flat colour would show as a patch on the shaded
        # face. The same is done beside the neck opening, where texels of the garment would show under another outfit.
        hairD = band_image(ob, hair_segs, "hairline") if hair_segs else np.full(scalp.shape, 1e9, dtype=np.float32)
        neckD = band_image(ob, boundary_segments(ob), "collar")
        skin_lin = np.array(REF[SKIN]) / 255.0   # the baked byte image holds sRGB-encoded values
        # every colour test is relative to the skin's reference colour: its value, saturation and green-to-red ratio
        sk_v = float(max(skin_lin)); sk_s = float((max(skin_lin) - min(skin_lin)) / max(max(skin_lin), 1e-5)); sk_gr = float(skin_lin[1] / max(skin_lin[0], 1e-5))
        mx = C[:, :, :3].max(axis=2); mn = C[:, :, :3].min(axis=2); sat = (mx - mn) / np.maximum(mx, 1e-5)
        pale = (sat < 0.6 * sk_s) & (mx > 0.68304 * sk_v); dark = mx < 0.751339 * sk_v
        # hair colour also reaches the back of an ear, where the colour projection met the hair behind it. Every dark
        # feature of the face (brows, eyes, nostrils, mouth) is in the front 45 % of the head's depth, so dark skin texels
        # behind that are projection faults.
        ys = [v.co.y for v in me.vertices]; y0, y1 = min(ys), max(ys)
        depth_share = vertex_value_image(ob, "depth_share", [(v.co.y - y0) / (y1 - y0) for v in me.vertices])
        # on the first body the skin's saturation stayed at 0.84 of its reference or more and the pale outline around the hair
        # in the source texture below 0.8 of it; the outline's cream had a green-to-red ratio more than 1.044 times the skin's
        washed = ((sat < 0.8 * sk_s) & (mx > 0.68304 * sk_v)) | (C[:, :, 1] > 1.043951 * sk_gr * np.maximum(C[:, :, 0], 1e-4))
        # under the overhang of the hair's front the outline reaches further onto the forehead; there only clearly
        # unsaturated texels count, so the lit forehead keeps its own tone (the eyes' whites are further than 22 mm away)
        own = np.ones(scalp.shape, dtype=bool)   # texels of head classes other than skin (painted hair, brows) keep their colour
        if len(set(cls.values()) - {SKIN, "scalp"}):
            om = new_image(f"{name}_own", size, "Non-Color", (0, 0, 0, 1))
            setup_bake_materials(ob, {i: (c if c in (SKIN, "scalp") else "other") for i, c in cls.items()}, rgb, "skinmask", om); hi.hide_render = True; bake(ob, "EMIT"); hi.hide_render = False
            own = to_np(om)[:, :, 0] > 0.5
        # the neck opening of a swappable head is part of the split, not a repair; the hairline is repaired on request
        bad = own & ~scalp & ((neckD < 2.5) | ((neckD < 10.0) & pale))
        if REPAIR["hairline"]:
            bad |= own & ~scalp & ((hairD < 6.0) | ((hairD < 12.0) & (washed | dark)) | ((hairD < 22.0) & (sat < 0.8 * sk_s) & (mx > 0.68304 * sk_v)) | ((depth_share > 0.45) & (washed | dark) & bool(HAIR)))
        fixed = inpaint(C, bad, ~scalp, skin_lin, covered); repaired["hairline" if REPAIR["hairline"] else "neckOpening"] = fixed
        # the high-resolution source has a small step where this hair meets the skin; the head must not carry the outline
        # of one hairstyle, so its normals fade to flat over the last 6 mm before the hair's edge
        w = np.clip((hairD - 2.0) / 4.0, 0.0, 1.0)[:, :, None]
        N[:, :, :3] = np.array([0.5, 0.5, 1.0], dtype=np.float32) * (1 - w) + N[:, :, :3] * w
        col.pixels[:] = C.ravel()
    if role == "body":
        # bare skin below the head is one flat tone: texels much darker than it are projection specks (the face of a
        # one-mesh character keeps its features: only skin below the hair line counts)
        skin = np.zeros(scalp.shape, dtype=bool)
        if SKIN and SKIN in cls.values():
            body_cls = {i: (c if not (c == SKIN and (me.polygons[i].center.z - LZ0) / LH > spec.hair_min_height_share) else SKIN + "_head") for i, c in cls.items()}
            sk = new_image(f"{name}_skin", size, "Non-Color", (0, 0, 0, 1))
            setup_bake_materials(ob, body_cls, rgb, "skinmask", sk); hi.hide_render = True; bake(ob, "EMIT"); hi.hide_render = False
            skin = to_np(sk)[:, :, 0] > 0.5
        if skin.any():
            lum = C[:, :, :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32); med = np.median(C[skin, :3], axis=0); medl = float(np.median(lum[skin]))
            if REPAIR["skinDarkSpots"]:
                # on request: bare skin below the head treated as one tone, texels much darker than it as projection specks
                speck = skin & (lum < 0.6 * medl)
                C[speck, :3] = med; fixed = int(speck.sum()); repaired["skinDarkSpots"] = fixed
        else:
            med = np.median(C[covered, :3], axis=0)
        if HEAD:
            # swappable parts: the rim of the neck opening takes the colour of the collar next to it, so no skin-coloured
            # sliver sits on its edge (part of the split, not a repair)
            neckD = band_image(ob, boundary_segments(ob), "collar")
            n_ = inpaint(C, neckD < 2.5, np.ones(neckD.shape, dtype=bool), med, covered); fixed += n_; repaired["neckOpening"] = n_
        hair_group = {HAIR_CLS} if HAIR_CLS else set()
        if REPAIR["hairline"] and not HEAD and SKIN and hair_group & set(cls.values()) and SKIN in cls.values():
            # one mesh: the hairline is the border between the head's hair classes and skin. The source texture's pale
            # outline around the hair and hair colour that reached the skin are repainted from their own side's texels,
            # as the separate head and hair parts are.
            # the hair is the largest connected patch of hair-class faces; smaller patches (brows, stubble) keep their paint
            hb_ = bmesh.new(); hb_.from_mesh(me); hb_.faces.ensure_lookup_table()
            left_ = {f.index for f in hb_.faces if cls[f.index] in hair_group}; cap = set()
            while left_:
                seed = left_.pop(); comp = {seed}; st = [seed]
                while st:
                    f_ = hb_.faces[st.pop()]
                    for e_ in f_.edges:
                        for g_ in e_.link_faces:
                            if g_.index in left_: left_.remove(g_.index); comp.add(g_.index); st.append(g_.index)
                if len(comp) > len(cap): cap = comp
            hb_.free()
            cls_cap = {i: ("hair_cap" if i in cap else c) for i, c in cls.items()}
            hairD = band_image(ob, class_border_segments(ob, cls_cap, {"hair_cap"}, {SKIN}), "hairline")
            skin_all = face_group_mask(ob, cls, rgb, {SKIN}, size); hair_t = face_group_mask(ob, cls_cap, rgb, {"hair_cap"}, size)
            skin_lin = np.array(REF[SKIN]) / 255.0
            sk_v = float(max(skin_lin)); sk_s = float((max(skin_lin) - min(skin_lin)) / max(max(skin_lin), 1e-5)); sk_gr = float(skin_lin[1] / max(skin_lin[0], 1e-5))
            mx = C[:, :, :3].max(axis=2); mn = C[:, :, :3].min(axis=2); sat = (mx - mn) / np.maximum(mx, 1e-5)
            washed = ((sat < 0.8 * sk_s) & (mx > 0.68304 * sk_v)) | (C[:, :, 1] > 1.043951 * sk_gr * np.maximum(C[:, :, 0], 1e-4))
            dark = mx < 0.751339 * sk_v
            h_ = inpaint(C, skin_all & ((hairD < 6.0) | ((hairD < 12.0) & (washed | dark))), skin_all, skin_lin, covered)
            lum = C[:, :, :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
            if hair_t.any():
                hmed = np.median(C[hair_t, :3], axis=0); hl = float(np.median(lum[hair_t]))
                h_ += inpaint(C, hair_t & ((hairD < 1.5) | ((hairD < 8.0) & (lum > 1.5 * hl)) | (lum > 1.8 * hl)), hair_t, hmed, covered)
            fixed += h_; repaired["hairline"] = h_
        col.pixels[:] = C.ravel()
    if role == "hair":
        # skin-coloured texels inside the hair faces at the hairline become bright rims after the colour correction
        lum = C[:, :, :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        used = np.abs(to_np(rough)[:, :, 0] - ROUGH[HAIR_CLS]) < 0.01  # texels covered by hair faces or their margin (the hair's roughness was baked there)
        med = np.median(C[used, :3], axis=0); medl = float(np.median(lum[used]))
        hairD = band_image(ob, hair_segs, "hairline")
        bad = used & ((hairD < 1.5) | ((hairD < 8.0) & (lum > 1.5 * medl)) | (lum > 1.8 * medl))
        fixed = inpaint(C, bad, used, med, covered); repaired["hairline"] = fixed
        col.pixels[:] = C.ravel()
    changed = covered & (np.abs(C[:, :, :3] - before).max(axis=2) > 1e-6)
    n_cov = max(int(covered.sum()), 1)
    if changed.any():
        save_png(before, os.path.join(out, "debug", f"{name}-basecolor-before-repair.png"), "sRGB")
        save_png(np.repeat(changed[:, :, None].astype(np.float32), 3, axis=2), os.path.join(out, "debug", f"{name}-repaired-texels.png"), "Non-Color")
    repair_report = {"texelsChanged": int(changed.sum()), "shareOfCovered": round(float(changed.sum()) / n_cov, 5), "byKind": repaired,
                     "withinBound": float(changed.sum()) / n_cov <= REPAIR_BOUND}
    if not repair_report["withinBound"]:
        print(f"WARNING {name}: texture repairs changed {repair_report['shareOfCovered']:.1%} of covered texels (bound {REPAIR_BOUND:.0%}); inspect debug/{name}-repaired-texels.png")
    col.filepath_raw = paths["BaseColor"]; col.file_format = "PNG"; col.save()
    save_png(N, paths["Normal"], "Non-Color"); save_png(orm, paths["ORM"], "Non-Color")
    report["parts"][name] = {"size": size, "faceClasses": counts, "colourFactorsLinear": factors, "scalpTexelShare": round(float(scalp.mean()), 4), "normalTexelsWithoutSourceMadeFlat": normal_missed, "repairs": repair_report, "normalBakeCageAndRayMm": list(RAYS_MM[role]),
                             "files": {k: os.path.basename(v) for k, v in paths.items()}}
    # final single material for the part
    m = bpy.data.materials.new(f"M_{spec.name}_{name}"); m.use_nodes = True; nt = m.node_tree
    bsdf = next(x for x in nt.nodes if x.type == "BSDF_PRINCIPLED")
    def img_node(path, cs):
        n = nt.nodes.new("ShaderNodeTexImage"); n.image = bpy.data.images.load(path); n.image.colorspace_settings.name = cs; return n
    c = img_node(paths["BaseColor"], "sRGB"); nt.links.new(c.outputs["Color"], bsdf.inputs["Base Color"])
    o_ = img_node(paths["ORM"], "Non-Color"); sep = nt.nodes.new("ShaderNodeSeparateColor"); nt.links.new(o_.outputs["Color"], sep.inputs[0])
    nt.links.new(sep.outputs[1], bsdf.inputs["Roughness"]); nt.links.new(sep.outputs[2], bsdf.inputs["Metallic"])
    nn = img_node(paths["Normal"], "Non-Color"); nm = nt.nodes.new("ShaderNodeNormalMap"); nm.uv_map = "UV0"
    nt.links.new(nn.outputs["Color"], nm.inputs["Color"]); nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    nt.nodes.active = c; final_mats[name] = m

for name, m in final_mats.items():
    me = bpy.data.objects[name].data; me.materials.clear(); me.materials.append(m)
    for p in me.polygons: p.material_index = 0
bpy.data.objects.remove(hi)
json.dump(report, open(os.path.join(out, "texture-report.json"), "w"), indent=2); print(json.dumps(report))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "character-textured.blend"))
for o in bpy.context.scene.objects: o.select_set(o.type == "MESH")
bpy.ops.export_scene.gltf(filepath=os.path.join(out, "character-textured.glb"), export_format="GLB", use_selection=True, export_apply=True)
