"""Bake an outfit's generated maps (Meshy's, on UV_Meshy) into each piece's own UV0 layout (uv_outfit.py).
blender --background --python-exit-code 1 --python bake_outfit.py -- <uv.blend> <maps-dir> <out.blend> <texture-dir> <prefix> [Piece=size ...]
maps-dir holds Meshy's texture_0.png (base colour; or texture_0_base_color.png), texture_0_normal.png, texture_0_roughness.png
and texture_0_metallic.png. Writes <prefix>_<Piece>_<BaseColor|Normal|Roughness|Metallic>.png per piece (sizes default
2048 for Outfit_*, 1024 otherwise); combine Roughness and Metallic into ORM with pack_orm.py."""
import bpy, sys, os, json
args = sys.argv[sys.argv.index("--") + 1:]
src, maps_dir, out_blend, tex_dir, prefix = args[:5]
sizes = dict(a.split("=") for a in args[5:])
bpy.ops.wm.open_mainfile(filepath=src); os.makedirs(tex_dir, exist_ok=True)
def load(*names):
    for n in names:
        p = os.path.join(maps_dir, n)
        if os.path.exists(p): return bpy.data.images.load(os.path.abspath(p))
    raise SystemExit(f"missing map: {names}")
srcmaps = {"BaseColor": load("texture_0_base_color.png", "texture_0.png"), "Normal": load("texture_0_normal.png"),
           "Roughness": load("texture_0_roughness.png"), "Metallic": load("texture_0_metallic.png")}
for k, img in srcmaps.items(): img.colorspace_settings.name = "sRGB" if k == "BaseColor" else "Non-Color"
sc = bpy.context.scene; sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = 1; sc.render.bake.margin = 16
report = {}
for o in [o for o in bpy.data.objects if o.type == "MESH"]:
    size = int(sizes.get(o.name, 2048 if o.name.startswith("Outfit") else 1024))
    mat = bpy.data.materials.new("M_" + o.name); mat.use_nodes = True
    o.data.materials.clear(); o.data.materials.append(mat)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o
    o.data.uv_layers.active = o.data.uv_layers["UV0"]; o.data.uv_layers["UV0"].active_render = True
    out = {}
    for kind, img_src in srcmaps.items():
        for n in list(nodes): nodes.remove(n)
        res = nodes.new("ShaderNodeOutputMaterial"); uvn = nodes.new("ShaderNodeUVMap"); uvn.uv_map = "UV_Meshy"
        t = nodes.new("ShaderNodeTexImage"); t.image = img_src; links.new(uvn.outputs["UV"], t.inputs["Vector"])
        if kind == "Normal":
            nm = nodes.new("ShaderNodeNormalMap"); nm.uv_map = "UV_Meshy"; links.new(t.outputs["Color"], nm.inputs["Color"])
            bs = nodes.new("ShaderNodeBsdfDiffuse"); links.new(nm.outputs["Normal"], bs.inputs["Normal"]); links.new(bs.outputs["BSDF"], res.inputs["Surface"])
        else:
            em = nodes.new("ShaderNodeEmission"); links.new(t.outputs["Color"], em.inputs["Color"]); links.new(em.outputs["Emission"], res.inputs["Surface"])
        name = f"{prefix}_{o.name.split('_')[0]}_{kind}"
        tgt_img = bpy.data.images.new(name, size, size, alpha=False); tgt_img.colorspace_settings.name = "sRGB" if kind == "BaseColor" else "Non-Color"
        tgt_img.filepath_raw = os.path.join(tex_dir, name + ".png"); tgt_img.file_format = "PNG"
        tgt = nodes.new("ShaderNodeTexImage"); tgt.image = tgt_img
        for n in nodes: n.select = False
        tgt.select = True; nodes.active = tgt
        if kind == "Normal": bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", uv_layer="UV0")
        else: bpy.ops.object.bake(type="EMIT", uv_layer="UV0")
        tgt_img.save(); out[kind] = tgt_img
    # final material on UV0
    for n in list(nodes): nodes.remove(n)
    res = nodes.new("ShaderNodeOutputMaterial"); bs = nodes.new("ShaderNodeBsdfPrincipled"); links.new(bs.outputs["BSDF"], res.inputs["Surface"])
    bc = nodes.new("ShaderNodeTexImage"); bc.image = out["BaseColor"]; links.new(bc.outputs["Color"], bs.inputs["Base Color"])
    ro = nodes.new("ShaderNodeTexImage"); ro.image = out["Roughness"]; links.new(ro.outputs["Color"], bs.inputs["Roughness"])
    me_ = nodes.new("ShaderNodeTexImage"); me_.image = out["Metallic"]; links.new(me_.outputs["Color"], bs.inputs["Metallic"])
    nr = nodes.new("ShaderNodeTexImage"); nr.image = out["Normal"]; nm = nodes.new("ShaderNodeNormalMap"); nm.uv_map = "UV0"
    links.new(nr.outputs["Color"], nm.inputs["Color"]); links.new(nm.outputs["Normal"], bs.inputs["Normal"])
    for img in out.values(): img.filepath = img.filepath_raw
    # the maps are baked: drop the generation's layout, so UV0 is the only (and first) UV set every exporter sees
    o.data.uv_layers.remove(o.data.uv_layers["UV_Meshy"])
    report[o.name] = {"size": size, "maps": {k: os.path.basename(v.filepath_raw) for k, v in out.items()}, "material": mat.name}
bpy.ops.wm.save_as_mainfile(filepath=out_blend, relative_remap=True)
json.dump(report, open(os.path.join(tex_dir, "bake-report.json"), "w"), indent=1); print(json.dumps(report))
