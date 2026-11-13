"""Import every FBX in <JAM_UE_DIR>/import as a skeletal mesh on the project's SK_Mannequin and report what the engine made of it:
skeleton used, bounds, material slots, LOD 0 vertices and sections. Nothing is saved. Bone names are compared in the running game
with compare_bones_in_game.py.
UnrealEditor-Cmd <project.uproject> -run=pythonscript -script=<this file> -unattended -nosplash -nullrhi -stdout
Writes <JAM_UE_DIR>/out/import-report.json."""
# Work folder: the environment variable JAM_UE_DIR names a folder outside any repository checkout; FBX files to
# check go in its import/ subfolder and results are written to its out/ subfolder.
import os
WORK = os.environ["JAM_UE_DIR"]; os.makedirs(os.path.join(WORK, "out"), exist_ok=True)
MANNY = os.environ.get("JAM_UE_MANNEQUINS", "/Game/Characters/Mannequins")   # Epic's mannequin content (third-person template); set if moved
import unreal, json
OUT = os.path.join(WORK, "out", "import-report.json")
rep = {"engine": unreal.SystemLibrary.get_engine_version(), "imports": {}}
ar = unreal.AssetRegistryHelpers.get_asset_registry(); ar.scan_paths_synchronous(["/Game"], True)
skel = unreal.EditorAssetLibrary.load_asset(MANNY + "/Meshes/SK_Mannequin")
manny = unreal.EditorAssetLibrary.load_asset(MANNY + "/Meshes/SKM_Manny_Simple")
rep["mannySkeleton"] = skel.get_path_name() if skel else None
def import_fbx(name):
    task = unreal.AssetImportTask(); task.filename = os.path.join(WORK, "import", name + ".fbx"); task.destination_path = "/Game/JamCheck"; task.destination_name = name
    task.automated = True; task.replace_existing = True; task.save = False
    ui = unreal.FbxImportUI(); ui.import_mesh = True; ui.import_as_skeletal = True; ui.import_animations = False; ui.import_materials = False; ui.import_textures = False
    ui.mesh_type_to_import = unreal.FBXImportType.FBXIT_SKELETAL_MESH; ui.skeleton = skel; ui.create_physics_asset = False
    ui.skeletal_mesh_import_data.set_editor_property("import_morph_targets", False)
    ui.skeletal_mesh_import_data.set_editor_property("preserve_smoothing_groups", True)
    task.options = ui
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    paths = list(task.imported_object_paths) if hasattr(task, "imported_object_paths") else []
    info = {"importedObjectPaths": paths}
    mesh = unreal.EditorAssetLibrary.load_asset("/Game/JamCheck/" + name)
    if mesh:
        info["class"] = mesh.get_class().get_name()
        sk = mesh.get_editor_property("skeleton"); info["skeleton"] = sk.get_path_name() if sk else None
        info["usesMannySkeleton"] = bool(sk and skel and sk.get_path_name() == skel.get_path_name())
        try: info["materials"] = [str(m.material_slot_name) for m in mesh.get_editor_property("materials")]
        except Exception as e: info["materials"] = "error %r" % e
        try:
            b = mesh.get_bounds(); info["boundsExtentCm"] = [round(b.box_extent.x, 1), round(b.box_extent.y, 1), round(b.box_extent.z, 1)]; info["boundsOriginCm"] = [round(b.origin.x, 1), round(b.origin.y, 1), round(b.origin.z, 1)]
        except Exception as e: info["bounds"] = "error %r" % e
        try:
            sub = unreal.get_editor_subsystem(unreal.SkeletalMeshEditorSubsystem)
            info["lod0Vertices"] = sub.get_num_verts(mesh, 0); info["lod0Sections"] = sub.get_num_sections(mesh, 0)
        except Exception as e: info["lodInfo"] = "error %r" % e
    return info, mesh
for n in sorted(f[:-4] for f in os.listdir(os.path.join(WORK, "import")) if f.lower().endswith(".fbx")):
    try:
        info, mesh = import_fbx(n); rep["imports"][n] = info
    except Exception as e: rep["imports"][n] = {"error": repr(e)}
json.dump(rep, open(OUT, "w"), indent=1)
unreal.log_warning("IMPORTTEST done " + OUT)
