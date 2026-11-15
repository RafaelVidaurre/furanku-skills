"""Give the split-off `Hands` part its own UV layout and texture maps, baked from the body's maps it used before.
Its old layout is kept as UV_Outfit for the bake and removed from the exported files by export_ue.py (it exports UV0 alone).
blender --background --python-exit-code 1 --python bake_hands.py -- <split.blend> <out.blend> <texture-dir> [maps-dir] --character <character.json> [--modelled <split-modelled.blend> <out-modelled.blend>]
maps-dir: where to look for the body's maps when the blend's relative paths no longer reach them.
--modelled gives the body as modelled the same hands layout and material, so both files stay alike.
Writes T_<name>_<hands>_<BaseColor|Normal|ORM>.png (the spec's hands texture size) and hands-bake-report.json in texture-dir."""
import bpy, sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import charspec

args, spec = charspec.require()
modelled = None
if "--modelled" in args:
    i = args.index("--modelled"); modelled = args[i + 1:i + 3]; del args[i:i + 3]
blend, out_blend, tex_dir = args[:3]
HANDS = spec.part("hands"); size = spec.texture_sizes["hands"]
args = args[:3] + args[4:] if len(args) > 3 and args[3].isdigit() else args   # an old size argument is ignored: the spec sets it
bpy.ops.wm.open_mainfile(filepath=blend); os.makedirs(tex_dir, exist_ok=True)
if len(args) > 3: bpy.ops.file.find_missing_files(directory=os.path.abspath(args[3]))
hands = bpy.data.objects[HANDS]; mesh = hands.data; mat = hands.material_slots[0].material
nodes, links = mat.node_tree.nodes, mat.node_tree.links
sources = {"BaseColor": None, "ORM": None, "Normal": None}
for n in nodes:
    if n.type == "TEX_IMAGE" and n.image:
        for k in sources:
            if n.image.name.endswith(f"_{k}.png"): sources[k] = n.image

for k, img in sources.items():
    if img is None or not os.path.exists(bpy.path.abspath(img.filepath)) or img.size[0] == 0:
        raise SystemExit(f"source map {k} is missing: {img.filepath if img else None}")

# Keep the atlas layout for sampling; pack the hands' islands to fill a square of their own in UV0.
old = mesh.uv_layers.new(name="UV_Outfit", do_init=True)
for i, d in enumerate(mesh.uv_layers["UV0"].data): old.data[i].uv = d.uv
mesh.uv_layers.active = mesh.uv_layers["UV0"]; mesh.uv_layers["UV0"].active_render = True
bpy.ops.object.select_all(action="DESELECT"); hands.select_set(True); bpy.context.view_layer.objects.active = hands
bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT"); bpy.ops.uv.select_all(action="SELECT")
bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, scale=True, margin=0.01)
bpy.ops.object.mode_set(mode="OBJECT")
u = [d.uv[0] for d in mesh.uv_layers["UV0"].data]; v = [d.uv[1] for d in mesh.uv_layers["UV0"].data]
uv_box = [round(min(u), 4), round(max(u), 4), round(min(v), 4), round(max(v), 4)]

scene = bpy.context.scene; scene.render.engine = "CYCLES"; scene.cycles.device = "CPU"; scene.cycles.samples = 1
scene.render.bake.margin = 8; scene.render.bake.use_selected_to_active = False

def image(name, color):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "sRGB" if color else "Non-Color"
    img.filepath_raw = os.path.join(tex_dir, name + ".png"); img.file_format = "PNG"
    return img

def bake(kind, target):
    """Rebuild the material for one bake: sample the old map through UV_Outfit, write into target through UV0."""
    for n in list(nodes): nodes.remove(n)
    out = nodes.new("ShaderNodeOutputMaterial")
    uvn = nodes.new("ShaderNodeUVMap"); uvn.uv_map = "UV_Outfit"
    src = nodes.new("ShaderNodeTexImage"); src.image = sources[kind]; links.new(uvn.outputs["UV"], src.inputs["Vector"])
    if kind == "Normal":
        nm = nodes.new("ShaderNodeNormalMap"); nm.space = "TANGENT"; nm.uv_map = "UV_Outfit"
        links.new(src.outputs["Color"], nm.inputs["Color"])
        bsdf = nodes.new("ShaderNodeBsdfDiffuse"); links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
        links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    else:
        em = nodes.new("ShaderNodeEmission"); links.new(src.outputs["Color"], em.inputs["Color"])
        links.new(em.outputs["Emission"], out.inputs["Surface"])
    tgt = nodes.new("ShaderNodeTexImage"); tgt.image = target
    for n in nodes: n.select = False
    tgt.select = True; nodes.active = tgt
    if kind == "Normal":
        bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", uv_layer="UV0")
    else:
        bpy.ops.object.bake(type="EMIT", uv_layer="UV0")
    target.save()

maps = {}
for kind in ("BaseColor", "ORM", "Normal"):
    img = image(f"T_{spec.name}_{HANDS}_{kind}", kind == "BaseColor"); bake(kind, img); maps[kind] = img

# Final material: the same layout as the other parts, on the new maps through UV0.
for n in list(nodes): nodes.remove(n)
out = nodes.new("ShaderNodeOutputMaterial"); bsdf = nodes.new("ShaderNodeBsdfPrincipled"); links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
bc = nodes.new("ShaderNodeTexImage"); bc.image = maps["BaseColor"]; links.new(bc.outputs["Color"], bsdf.inputs["Base Color"])
orm = nodes.new("ShaderNodeTexImage"); orm.image = maps["ORM"]; sep = nodes.new("ShaderNodeSeparateColor")
links.new(orm.outputs["Color"], sep.inputs["Color"]); links.new(sep.outputs["Green"], bsdf.inputs["Roughness"]); links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
nrm = nodes.new("ShaderNodeTexImage"); nrm.image = maps["Normal"]; nm = nodes.new("ShaderNodeNormalMap"); nm.uv_map = "UV0"
links.new(nrm.outputs["Color"], nm.inputs["Color"]); links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
for img in maps.values(): img.filepath = img.filepath_raw

bpy.ops.wm.save_as_mainfile(filepath=out_blend, relative_remap=True)
report = {"size": [size, size], "uvBox": uv_box, "maps": {k: os.path.basename(v.filepath_raw) for k, v in maps.items()},
          "sources": {k: v.name for k, v in sources.items()}, "uvSets": [l.name for l in mesh.uv_layers]}
if modelled:
    # the modelled body's hands: same faces, so copy the new layout corner for corner and use the same material
    uv0 = [d.uv.copy() for d in mesh.uv_layers["UV0"].data]; mat_name = hands.material_slots[0].material.name
    bpy.ops.wm.save_as_mainfile(filepath=out_blend, relative_remap=True)
    bpy.ops.wm.open_mainfile(filepath=modelled[0]); mh = bpy.data.objects[HANDS]
    if len(mh.data.loops) != len(uv0): raise SystemExit("the modelled hands do not match the rigged ones; split both with split_hands.py --modelled")
    layer = mh.data.uv_layers.get("UV0") or mh.data.uv_layers.new(name="UV0")
    if "UV_Outfit" not in mh.data.uv_layers:
        old_ = mh.data.uv_layers.new(name="UV_Outfit")
        for i, d in enumerate(layer.data): old_.data[i].uv = d.uv
    for i, uvv in enumerate(uv0): layer.data[i].uv = uvv
    with bpy.data.libraries.load(os.path.abspath(out_blend), link=False) as (src_, dst_): dst_.materials = [mat_name]
    mh.material_slots[0].material = dst_.materials[0]
    bpy.ops.wm.save_as_mainfile(filepath=modelled[1], relative_remap=True)
    report["modelled"] = modelled[1]
json.dump(report, open(os.path.join(tex_dir, "hands-bake-report.json"), "w"), indent=1); print(json.dumps(report))
