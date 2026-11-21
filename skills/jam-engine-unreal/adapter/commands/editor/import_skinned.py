"""Import one FBX as a skeletal mesh on an existing skeleton, assign its material slots, and save. Runs inside the Unreal editor.

ARGS: {"source": "<project-relative fbx>", "sha256": "...", "dest": "/Game/.../Meshes", "name": "SK_Hero",
       "skeleton": "<skeleton asset id>", "physicsAsset": "<physics asset id>" or null,
       "slots": {"<material slot name>": "<material or instance id>"}}
When `slots` is not empty, every material slot of the imported mesh must be named in it; when it is empty the mesh
keeps the materials it imported with. Returns the skeleton the mesh ended up on (compare
it with the one asked for: Interchange may ignore FBX factory options), its slots, half extent, stored source, and
whether the mesh was saved (the steps before it save their own textures and materials). A mesh that remembers a
source outside the project is not saved (deleted when this import created it) and the import is refused.
It uses the legacy FBX factory options, which store a source path relative to the project.
"""
# jam: include editor_shared
import unreal


def main(ARGS):
    eal = unreal.EditorAssetLibrary
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    dest, name = ARGS["dest"], ARGS["name"]
    inst = {}
    for slot, material in ARGS["slots"].items():
        inst[slot] = eal.load_asset(material)
        if inst[slot] is None: raise RuntimeError("material %s for slot %s not found" % (material, slot))
    skel = eal.load_asset(ARGS["skeleton"])
    if skel is None: raise RuntimeError("skeleton not found: " + ARGS["skeleton"])
    physics = eal.load_asset(ARGS["physicsAsset"]) if ARGS.get("physicsAsset") else None
    if ARGS.get("physicsAsset") and physics is None: raise RuntimeError("physics asset not found: " + ARGS["physicsAsset"])
    existed = eal.does_asset_exist(dest + "/" + name)
    task = unreal.AssetImportTask()
    task.filename = jam_source(ARGS["source"], ARGS.get("sha256")); task.destination_path = dest; task.destination_name = name
    task.automated = True; task.replace_existing = True; task.save = False
    ui = unreal.FbxImportUI(); ui.import_mesh = True; ui.import_as_skeletal = True; ui.import_animations = False; ui.import_materials = False; ui.import_textures = False
    ui.mesh_type_to_import = unreal.FBXImportType.FBXIT_SKELETAL_MESH; ui.skeleton = skel; ui.create_physics_asset = False
    ui.skeletal_mesh_import_data.set_editor_property("import_morph_targets", False)
    ui.skeletal_mesh_import_data.set_editor_property("preserve_smoothing_groups", True)
    task.options = ui
    tools.import_asset_tasks([task])
    mesh = eal.load_asset(dest + "/" + name)
    if mesh is None: raise RuntimeError("skeletal mesh not imported: " + name)
    mats = list(mesh.get_editor_property("materials"))
    for m in mats if inst else []:
        slot = str(m.get_editor_property("material_slot_name"))
        if slot not in inst: raise RuntimeError("%s: material slot %s is not one of %s" % (name, slot, sorted(inst)))
        m.set_editor_property("material_interface", inst[slot])
    if inst: mesh.set_editor_property("materials", mats)
    if physics is not None: mesh.set_editor_property("physics_asset", physics)
    sk = mesh.get_editor_property("skeleton"); b = mesh.get_bounds()
    pa = mesh.get_editor_property("physics_asset")
    out = {"id": dest + "/" + name, "skeleton": sk.get_path_name().split(".")[0] if sk else None,
           "slots": [(str(m.get_editor_property("material_slot_name")), (lambda mi: mi.get_name() if mi else None)(m.get_editor_property("material_interface"))) for m in mesh.get_editor_property("materials")],
           "extentCm": [round(b.box_extent.x, 1), round(b.box_extent.y, 1), round(b.box_extent.z, 1)], "physicsAsset": pa.get_name() if pa else None}
    out["source"] = jam_stored_source(mesh)
    jam_refuse_outside_project({out["id"]: out["source"]}, [out["id"]], [out["id"]] if existed else [])
    out["saved"] = eal.save_asset(dest + "/" + name, only_if_is_dirty=False)
    out["projectDir"] = jam_project_dir()
    out["dirtyContent"] = jam_dirty_packages()
    return out
