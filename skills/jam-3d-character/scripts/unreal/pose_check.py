"""Evaluate Manny's idle and walk on the imported character in the engine and write world-space joint positions, for comparison
with Blender's (blender/joint_positions.py, then compare_joints.py).
UnrealEditor-Cmd <project.uproject> -run=pythonscript -script=<this file> -unattended -nosplash -nullrhi -stdout
Writes <JAM_UE_DIR>/out/ue-joints.json."""
# Work folder: the environment variable JAM_UE_DIR names a folder outside any repository checkout; FBX files to
# check go in its import/ subfolder and results are written to its out/ subfolder.
import os
WORK = os.environ["JAM_UE_DIR"]; os.makedirs(os.path.join(WORK, "out"), exist_ok=True)
MANNY = os.environ.get("JAM_UE_MANNEQUINS", "/Game/Characters/Mannequins")   # Epic's mannequin content (third-person template); set if moved
import json
# the whole-character mesh to evaluate: JAM_UE_MESH (file name without .fbx), else SKM_<name> from the character spec at JAM_UE_CHARACTER
MESH = os.environ.get("JAM_UE_MESH") or ("SKM_" + json.load(open(os.environ["JAM_UE_CHARACTER"], encoding="utf-8"))["name"] if os.environ.get("JAM_UE_CHARACTER") else None)
if not MESH: raise RuntimeError("set JAM_UE_CHARACTER to the body's character.json (or JAM_UE_MESH to the mesh's file name)")
import unreal, traceback
OUT = os.path.join(WORK, "out", "ue-joints.json"); rep = {}
ar = unreal.AssetRegistryHelpers.get_asset_registry(); ar.scan_paths_synchronous(["/Game"], True)
BONES = ["pelvis", "spine_03", "head", "upperarm_l", "lowerarm_l", "hand_l", "hand_r", "index_01_l", "index_03_l", "thumb_03_l", "thigh_l", "calf_l", "foot_l", "foot_r", "ball_l"]
try:
    # the import in the previous run was not saved: import again in this session
    skel = unreal.EditorAssetLibrary.load_asset(MANNY + "/Meshes/SK_Mannequin")
    task = unreal.AssetImportTask(); task.filename = os.path.join(WORK, "import", MESH + ".fbx"); task.destination_path = "/Game/JamCheck"; task.destination_name = MESH
    task.automated = True; task.replace_existing = True; task.save = False
    ui = unreal.FbxImportUI(); ui.import_mesh = True; ui.import_as_skeletal = True; ui.import_animations = False; ui.import_materials = False; ui.import_textures = False
    ui.mesh_type_to_import = unreal.FBXImportType.FBXIT_SKELETAL_MESH; ui.skeleton = skel; ui.create_physics_asset = False; task.options = ui
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    mine = unreal.EditorAssetLibrary.load_asset("/Game/JamCheck/" + MESH); manny = unreal.EditorAssetLibrary.load_asset(MANNY + "/Meshes/SKM_Manny_Simple")
    rep["optionProperties"] = [p for p in dir(unreal.AnimPoseEvaluationOptions()) if not p.startswith("_")][:40]
    for label, path, frames in (("MM_Idle", MANNY + "/Anims/Unarmed/MM_Idle", (0, 39)), ("MF_Unarmed_Walk_Fwd", MANNY + "/Anims/Unarmed/Walk/MF_Unarmed_Walk_Fwd", (0, 7, 15))):
        seq = unreal.EditorAssetLibrary.load_asset(path); rep[label] = {}
        for who, mesh in (("character", mine), ("manny", manny)):
            rep[label][who] = {}
            for fr in frames:
                opts = unreal.AnimPoseEvaluationOptions(); opts.set_editor_property("optional_skeletal_mesh", mesh)
                pose = unreal.AnimPoseExtensions.get_anim_pose_at_frame(seq, fr, opts)
                rep[label][who][str(fr)] = {b: (lambda t: [round(t.translation.x, 2), round(t.translation.y, 2), round(t.translation.z, 2)])(unreal.AnimPoseExtensions.get_bone_pose(pose, b, unreal.AnimPoseSpaces.WORLD)) for b in BONES}
    rep["local"] = {}
    seq = unreal.EditorAssetLibrary.load_asset(MANNY + "/Anims/Unarmed/MM_Idle")
    for who, mesh in (("character", mine), ("manny", manny)):
        opts = unreal.AnimPoseEvaluationOptions(); opts.set_editor_property("optional_skeletal_mesh", mesh)
        pose = unreal.AnimPoseExtensions.get_anim_pose_at_frame(seq, 0, opts); rep["local"][who] = {}
        for b in ("root", "pelvis", "spine_01", "neck_01", "head", "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l", "thigh_l", "calf_l", "foot_l", "ik_foot_root", "ik_foot_l"):
            for space, nm in ((unreal.AnimPoseSpaces.LOCAL, "local"), (unreal.AnimPoseSpaces.WORLD, "world")):
                t = unreal.AnimPoseExtensions.get_bone_pose(pose, b, space)
                rep["local"][who].setdefault(b, {})[nm] = {"t": [round(t.translation.x, 2), round(t.translation.y, 2), round(t.translation.z, 2)], "s": [round(t.scale3d.x, 4), round(t.scale3d.y, 4), round(t.scale3d.z, 4)], "q": [round(t.rotation.x, 3), round(t.rotation.y, 3), round(t.rotation.z, 3), round(t.rotation.w, 3)]}
        rp = unreal.AnimPoseExtensions.get_reference_pose(mesh.get_editor_property("skeleton"))
except Exception as e:
    rep["error"] = repr(e) + traceback.format_exc()[-900:]
json.dump(rep, open(OUT, "w"), indent=1); unreal.log_warning("POSETEST done")
