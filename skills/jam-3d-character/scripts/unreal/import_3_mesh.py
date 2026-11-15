"""Step 3, skeletal mesh on Manny's skeleton, materials and physics asset of importing a delivered body into the Unreal project. Run each step as its own call of the editor's
Python tool (for example PythonScriptingTools.execute_python through an editor MCP); the tool wants short calls.
Set CONFIG below (the same block in all four steps). Name and parts come from the body's character.json. Sources are
read from the delivery folder inside this checkout, so the assets store a path relative to the project: maps
stages/texture/T_<name>_<Part>_<kind>.png, the whole body unreal/SKM_<name>.fbx and each part unreal/SKM_<name>_<Part>.fbx
(the part meshes are what outfits wear), with material slots M_<name>_<Part>. <Part> is the part's object name."""
import unreal, json, os

# --- CONFIG: the same block in import_1_textures.py to import_4_save.py; set delivery in each call ---
CONFIG = {
    "delivery": "",          # repository-relative body delivery folder (Art/Assets/<asset>/<revision>); required
    "character": None,       # the body's character.json, repository-relative; None reads <delivery>/character.json
    "dest": None,            # content folder; None gives /Game/Characters/<name>
    "mannequins": "/Game/Characters/Mannequins",   # Epic's mannequin content (third-person template); change if moved
}
CONFIG.update(globals().get("JAM_CONFIG") or {})   # values sent ahead of this script: JAM_CONFIG = {"delivery": ...}
c = CONFIG
if not c["delivery"] or os.path.isabs(c["delivery"]): raise RuntimeError("set CONFIG['delivery'] to the body's delivery folder, relative to the project")
proj = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
src = os.path.join(proj, *c["delivery"].split("/"))
spec = json.load(open(os.path.join(proj, *(c["character"] or c["delivery"] + "/character.json").split("/")), encoding="utf-8"))
name = spec["name"]
parts = tuple(spec["parts"][r] for r in ("head", "hair", "body", "hands") if spec["parts"].get(r))
hair = spec["parts"].get("hair")   # an open shell: its material is two-sided
dest = c["dest"] or "/Game/Characters/" + name
eal = unreal.EditorAssetLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()
out = {}
# --- end CONFIG ---

inst = {part: eal.load_asset("%s/Materials/MI_%s_%s" % (dest, name, part)) for part in parts}
skel = eal.load_asset(c["mannequins"] + "/Meshes/SK_Mannequin")
physics = eal.load_asset(c["mannequins"] + "/Rigs/PA_Mannequin")
def import_mesh(file_stem):
    """One skeletal mesh on Manny's skeleton, each material slot M_<name>_<Part> given its part's instance."""
    task = unreal.AssetImportTask()
    task.filename = os.path.join(src, "unreal", file_stem + ".fbx"); task.destination_path = dest + "/Meshes"; task.destination_name = file_stem
    task.automated = True; task.replace_existing = True; task.save = False
    ui = unreal.FbxImportUI(); ui.import_mesh = True; ui.import_as_skeletal = True; ui.import_animations = False; ui.import_materials = False; ui.import_textures = False
    ui.mesh_type_to_import = unreal.FBXImportType.FBXIT_SKELETAL_MESH; ui.skeleton = skel; ui.create_physics_asset = False
    ui.skeletal_mesh_import_data.set_editor_property("import_morph_targets", False)
    ui.skeletal_mesh_import_data.set_editor_property("preserve_smoothing_groups", True)
    task.options = ui
    tools.import_asset_tasks([task])
    mesh = eal.load_asset(dest + "/Meshes/" + file_stem)
    if mesh is None: raise RuntimeError("skeletal mesh not imported: " + file_stem)
    mats = list(mesh.get_editor_property("materials"))
    for m in mats:
        slot = str(m.get_editor_property("material_slot_name")).replace("M_%s_" % name, "")
        if slot not in inst: raise RuntimeError("%s: material slot %s names no part of %s" % (file_stem, m.get_editor_property("material_slot_name"), list(parts)))
        m.set_editor_property("material_interface", inst[slot])
    mesh.set_editor_property("materials", mats)
    mesh.set_editor_property("physics_asset", physics)
    sk = mesh.get_editor_property("skeleton"); b = mesh.get_bounds()
    return {"skeleton": sk.get_path_name() if sk else None, "slots": [(str(m.get_editor_property("material_slot_name")), m.get_editor_property("material_interface").get_name()) for m in mesh.get_editor_property("materials")],
            "extentCm": [round(b.box_extent.x, 1), round(b.box_extent.y, 1), round(b.box_extent.z, 1)], "physicsAsset": mesh.get_editor_property("physics_asset").get_name()}
# the whole body, then each part on its own (outfits wear the body's head, hands and hair as separate meshes)
out["mesh"] = import_mesh("SKM_" + name)
out["partMeshes"] = {part: import_mesh("SKM_%s_%s" % (name, part)) for part in parts if os.path.exists(os.path.join(src, "unreal", "SKM_%s_%s.fbx" % (name, part)))}
out["assets"] = sorted(str(p) for p in eal.list_assets(dest, recursive=True))
out["dirtyPackages"] = sorted(p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages())
json.dumps(out)
