"""Import FBX files as skeletal meshes on a reference skeleton into a throwaway folder and report what the engine made of each. Runs inside the Unreal editor (a commandlet is enough).

ARGS: {"sources": [{"source": "<project-relative fbx>", "sha256": "...", "name": "SK_Hero"}],
       "skeleton": "<skeleton asset id>", "scratch": "/Game/JamCheck"}
Per file: class, skeleton used and whether it is the one asked for, material slots, bounds, LOD 0 vertices and
sections. Nothing is saved. Bone names are compared in the running game with compare_bones_in_game.py.
"""
# jam: include editor_shared
import unreal


def main(ARGS):
    rep = {"engine": unreal.SystemLibrary.get_engine_version(), "imports": {}}
    ar = unreal.AssetRegistryHelpers.get_asset_registry(); ar.scan_paths_synchronous(["/Game"], True)
    skel = unreal.EditorAssetLibrary.load_asset(ARGS["skeleton"])
    rep["skeleton"] = skel.get_path_name() if skel else None
    scratch = ARGS["scratch"]

    def import_fbx(item):
        name = item["name"]
        task = unreal.AssetImportTask(); task.filename = jam_source(item["source"], item.get("sha256")); task.destination_path = scratch; task.destination_name = name
        task.automated = True; task.replace_existing = True; task.save = False
        ui = unreal.FbxImportUI(); ui.import_mesh = True; ui.import_as_skeletal = True; ui.import_animations = False; ui.import_materials = False; ui.import_textures = False
        ui.mesh_type_to_import = unreal.FBXImportType.FBXIT_SKELETAL_MESH; ui.skeleton = skel; ui.create_physics_asset = False
        ui.skeletal_mesh_import_data.set_editor_property("import_morph_targets", False)
        ui.skeletal_mesh_import_data.set_editor_property("preserve_smoothing_groups", True)
        task.options = ui
        unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
        paths = list(task.imported_object_paths) if hasattr(task, "imported_object_paths") else []
        info = {"importedObjectPaths": [str(p) for p in paths]}
        mesh = unreal.EditorAssetLibrary.load_asset(scratch + "/" + name)
        if mesh:
            info["class"] = mesh.get_class().get_name()
            sk = mesh.get_editor_property("skeleton"); info["skeleton"] = sk.get_path_name() if sk else None
            info["usesSkeleton"] = bool(sk and skel and sk.get_path_name() == skel.get_path_name())
            try: info["materials"] = [str(m.material_slot_name) for m in mesh.get_editor_property("materials")]
            except Exception as e: info["materials"] = "error %r" % e
            try:
                b = mesh.get_bounds(); info["boundsExtentCm"] = [round(b.box_extent.x, 1), round(b.box_extent.y, 1), round(b.box_extent.z, 1)]; info["boundsOriginCm"] = [round(b.origin.x, 1), round(b.origin.y, 1), round(b.origin.z, 1)]
            except Exception as e: info["bounds"] = "error %r" % e
            try:
                sub = unreal.get_editor_subsystem(unreal.SkeletalMeshEditorSubsystem)
                info["lod0Vertices"] = sub.get_num_verts(mesh, 0); info["lod0Sections"] = sub.get_num_sections(mesh, 0)
            except Exception as e: info["lodInfo"] = "error %r" % e
        return info

    for item in sorted(ARGS["sources"], key=lambda i: i["name"]):
        try:
            rep["imports"][item["name"]] = import_fbx(item)
        except Exception as e: rep["imports"][item["name"]] = {"error": repr(e)}
    return rep
