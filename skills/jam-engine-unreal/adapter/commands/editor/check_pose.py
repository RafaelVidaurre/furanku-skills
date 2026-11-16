"""Evaluate reference animations on an imported skeletal mesh in the engine and return world-space joint positions. Runs inside the Unreal editor (a commandlet is enough).

ARGS: {"source": "<project-relative fbx>", "sha256": "...", "name": "SK_Hero", "scratch": "/Game/JamCheck",
       "skeleton": "<skeleton asset id>", "referenceMesh": "<skeletal mesh id that the animations were made for>",
       "animations": [{"label": "Idle", "asset": "<animation sequence id>", "frames": [0, 39]}],
       "bones": ["pelvis", ...],                 bones whose world positions are returned per frame
       "localBones": ["root", "pelvis", ...]}    bones whose local and world transforms are returned at the first animation's frame 0
Returns per animation label, for "character" (the imported mesh) and "reference": frame -> bone -> [x, y, z] in
engine units; and under "local" each listed bone's translation, scale and rotation. The root bone's local scale must
be 1. The same poses evaluated in the DCC tool (dcc/joint_positions.py) are compared with check kind `pose`.
The import is repeated here because the import check saves nothing.
"""
# jam: include editor_shared
import unreal


def main(ARGS):
    rep = {}
    ar = unreal.AssetRegistryHelpers.get_asset_registry(); ar.scan_paths_synchronous(["/Game"], True)
    BONES = ARGS["bones"]
    MESH = ARGS["name"]; scratch = ARGS["scratch"]
    skel = unreal.EditorAssetLibrary.load_asset(ARGS["skeleton"])
    task = unreal.AssetImportTask(); task.filename = jam_source(ARGS["source"], ARGS.get("sha256")); task.destination_path = scratch; task.destination_name = MESH
    task.automated = True; task.replace_existing = True; task.save = False
    ui = unreal.FbxImportUI(); ui.import_mesh = True; ui.import_as_skeletal = True; ui.import_animations = False; ui.import_materials = False; ui.import_textures = False
    ui.mesh_type_to_import = unreal.FBXImportType.FBXIT_SKELETAL_MESH; ui.skeleton = skel; ui.create_physics_asset = False; task.options = ui
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    mine = unreal.EditorAssetLibrary.load_asset(scratch + "/" + MESH); reference = unreal.EditorAssetLibrary.load_asset(ARGS["referenceMesh"])
    if mine is None: raise RuntimeError("skeletal mesh not imported: " + MESH)
    if reference is None: raise RuntimeError("reference mesh not found: " + ARGS["referenceMesh"])
    rep["optionProperties"] = [p for p in dir(unreal.AnimPoseEvaluationOptions()) if not p.startswith("_")][:40]
    for anim in ARGS["animations"]:
        label = anim["label"]
        seq = unreal.EditorAssetLibrary.load_asset(anim["asset"]); rep[label] = {}
        if seq is None: raise RuntimeError("animation not found: " + anim["asset"])
        for who, mesh in (("character", mine), ("reference", reference)):
            rep[label][who] = {}
            for fr in anim["frames"]:
                opts = unreal.AnimPoseEvaluationOptions(); opts.set_editor_property("optional_skeletal_mesh", mesh)
                pose = unreal.AnimPoseExtensions.get_anim_pose_at_frame(seq, fr, opts)
                rep[label][who][str(fr)] = {b: (lambda t: [round(t.translation.x, 2), round(t.translation.y, 2), round(t.translation.z, 2)])(unreal.AnimPoseExtensions.get_bone_pose(pose, b, unreal.AnimPoseSpaces.WORLD)) for b in BONES}
    rep["local"] = {}
    seq = unreal.EditorAssetLibrary.load_asset(ARGS["animations"][0]["asset"])
    for who, mesh in (("character", mine), ("reference", reference)):
        opts = unreal.AnimPoseEvaluationOptions(); opts.set_editor_property("optional_skeletal_mesh", mesh)
        pose = unreal.AnimPoseExtensions.get_anim_pose_at_frame(seq, 0, opts); rep["local"][who] = {}
        for b in ARGS["localBones"]:
            for space, nm in ((unreal.AnimPoseSpaces.LOCAL, "local"), (unreal.AnimPoseSpaces.WORLD, "world")):
                t = unreal.AnimPoseExtensions.get_bone_pose(pose, b, space)
                rep["local"][who].setdefault(b, {})[nm] = {"t": [round(t.translation.x, 2), round(t.translation.y, 2), round(t.translation.z, 2)], "s": [round(t.scale3d.x, 4), round(t.scale3d.y, 4), round(t.scale3d.z, 4)], "q": [round(t.rotation.x, 3), round(t.rotation.y, 3), round(t.rotation.z, 3), round(t.rotation.w, 3)]}
    return rep
