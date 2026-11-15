"""Import an outfit delivery into the Unreal project. Run in the editor's Python tool (for example
PythonScriptingTools.execute_python through an editor MCP) after setting CONFIG; the tool wants one call. Import the body
first (import_1_textures.py to import_4_save.py): the outfit is worn with the body's own part meshes and material.

The pieces are the delivery's unreal/SKM_<Piece>_<name>.fbx files (Outfit, Hat, Hair for hat hair); they go to <dest>
with their maps (stages/texture/T_<name>_<Piece>_<kind>.png) and one material instance per piece under the body's parent
material. Hat hair (Hair) wears the body's hair material. Hats and hat hair are open shells: their materials are
two-sided, or from below a brim the sky shows through the hat's inside. It saves everything and returns what it made,
including `outfitParts`: the body's shared part meshes (head, hands, and its hair when the outfit brings no hat hair)
plus this outfit's meshes, in the order to register them with the game's outfit or wearable mechanism. Check the
skeleton of every mesh in the result (Interchange may ignore FBX factory options), then run the project's test that every
piece shares the body's reference skeleton."""
import unreal, json, os

CONFIG = {
    "delivery": "",          # repository-relative outfit delivery folder (Art/Assets/<asset>/<revision>); required
    "name": "",              # the outfit's <Name> used in Blender (pieces Outfit_<Name>, Hat_<Name>); required
    "character": "",         # the body's character.json, repository-relative (in the body's delivery); required
    "body_dest": None,       # where the body was imported; None gives /Game/Characters/<body name>, as the body steps do
    "dest": None,            # content folder; None gives /Game/Characters/Outfits/<name>
    "mannequins": "/Game/Characters/Mannequins",   # Epic's mannequin content (third-person template); change if moved
}
CONFIG.update(globals().get("JAM_CONFIG") or {})   # values sent ahead of this script: JAM_CONFIG = {"delivery": ...}

c = CONFIG; out = {}
missing = [k for k in ("delivery", "name", "character") if not c[k]]
if missing: raise RuntimeError("set CONFIG " + ", ".join(missing))
proj = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
src = os.path.join(proj, *c["delivery"].split("/"))
body = json.load(open(os.path.join(proj, *c["character"].split("/")), encoding="utf-8"))
body_name, body_parts = body["name"], body["parts"]
body_dest = c["body_dest"] or "/Game/Characters/" + body_name
dest = c["dest"] or "/Game/Characters/Outfits/" + c["name"]
eal = unreal.EditorAssetLibrary; mel = unreal.MaterialEditingLibrary; tools = unreal.AssetToolsHelpers.get_asset_tools()
suffix = "_" + c["name"] + ".fbx"
found = [f[len("SKM_"):-len(suffix)] for f in os.listdir(os.path.join(src, "unreal")) if f.startswith("SKM_") and f.endswith(suffix)]
order = ["Outfit", "Hat", "Hair"]
pieces = sorted(found, key=lambda p: (order.index(p) if p in order else len(order), p))
if not pieces: raise RuntimeError("no unreal/SKM_<Piece>%s in %s" % (suffix, c["delivery"]))
hat_hair = "Hair" in pieces
if hat_hair and not body_parts.get("hair"): raise RuntimeError("the outfit has hat hair but the body's character spec has no hair part")
body_material = body_dest + "/Materials/M_" + body_name
body_hair_material = body_dest + "/Materials/MI_%s_%s" % (body_name, body_parts["hair"]) if hat_hair else None
# the body's shared parts worn with this outfit: head and hands, and the body's own hair unless the outfit brings hat hair
shared = [body_parts.get("head"), None if hat_hair else body_parts.get("hair"), body_parts.get("hands")]
body_pieces = ["%s/Meshes/SKM_%s_%s" % (body_dest, body_name, p) for p in shared if p]
textured = [p for p in pieces if p != "Hair"]
tasks = []
for piece in textured:
    for kind in ("BaseColor", "Normal", "ORM"):
        t = unreal.AssetImportTask(); t.filename = os.path.join(src, "stages", "texture", "T_%s_%s_%s.png" % (c["name"], piece, kind))
        t.destination_path = dest + "/Textures"; t.automated = True; t.replace_existing = True; t.save = False; t.factory = unreal.TextureFactory(); tasks.append(t)
tools.import_asset_tasks(tasks)
mis = {}
parent = eal.load_asset(body_material)
if parent is None: raise RuntimeError("body material %s not found: import the body first, or set body_dest" % body_material)
for piece in textured:
    tex = {}
    for kind in ("BaseColor", "Normal", "ORM"):
        a = eal.load_asset("%s/Textures/T_%s_%s_%s" % (dest, c["name"], piece, kind))
        if a is None: raise RuntimeError("texture missing %s %s" % (piece, kind))
        if kind == "Normal":  # baked in Blender's +Y convention
            a.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP); a.set_editor_property("srgb", False); a.set_editor_property("flip_green_channel", True)
        elif kind == "ORM":
            a.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_MASKS); a.set_editor_property("srgb", False)
        tex[kind] = a
    name = "MI_%s_%s" % (c["name"], piece); path = dest + "/Materials/" + name
    mi = eal.load_asset(path) if eal.does_asset_exist(path) else tools.create_asset(name, dest + "/Materials", unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    mel.set_material_instance_parent(mi, parent)
    for kind, a in tex.items(): mel.set_material_instance_texture_parameter_value(mi, kind, a)
    if piece.startswith("Hat"):
        o = mi.get_editor_property("base_property_overrides"); o.set_editor_property("override_two_sided", True); o.set_editor_property("two_sided", True)
        mi.set_editor_property("base_property_overrides", o)
    mel.update_material_instance(mi); mis[piece] = mi
skel = eal.load_asset(c["mannequins"] + "/Meshes/SK_Mannequin"); pa = eal.load_asset(c["mannequins"] + "/Rigs/PA_Mannequin")
meshes = []
for piece in pieces:
    name = "SKM_%s_%s" % (piece, c["name"])
    task = unreal.AssetImportTask(); task.filename = os.path.join(src, "unreal", name + ".fbx"); task.destination_path = dest + "/Meshes"; task.destination_name = name
    task.automated = True; task.replace_existing = True; task.save = False
    ui = unreal.FbxImportUI(); ui.import_mesh = True; ui.import_as_skeletal = True; ui.import_animations = False; ui.import_materials = False; ui.import_textures = False
    ui.mesh_type_to_import = unreal.FBXImportType.FBXIT_SKELETAL_MESH; ui.skeleton = skel; ui.create_physics_asset = False
    ui.skeletal_mesh_import_data.set_editor_property("import_morph_targets", False)
    task.options = ui; tools.import_asset_tasks([task])
    mesh = eal.load_asset(dest + "/Meshes/" + name)
    if mesh is None: raise RuntimeError("mesh not imported " + name)
    mi = mis.get(piece) or eal.load_asset(body_hair_material)
    mats = list(mesh.get_editor_property("materials"))
    for m in mats: m.set_editor_property("material_interface", mi)
    mesh.set_editor_property("materials", mats); mesh.set_editor_property("physics_asset", pa)
    sk = mesh.get_editor_property("skeleton")
    out[name] = {"skeleton": sk.get_name() if sk else None, "material": mi.get_name(),
                 "source": os.path.relpath(str(mesh.get_editor_property("asset_import_data").extract_filenames()[0]), proj).replace(os.sep, "/")}
    meshes.append(mesh)
out["outfitParts"] = body_pieces + [m.get_path_name().split(".")[0] for m in meshes]
out["saved"] = eal.save_directory(dest, only_if_is_dirty=False, recursive=True)
out["dirtyContent"] = sorted(p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages())
json.dumps(out)
