"""Export Epic's Manny mesh and three of its animations to FBX, as the skeleton and animation reference for rigging.
Run headless in a project that holds Epic's mannequin content (JAM_UE_MANNEQUINS, default /Game/Characters/Mannequins):
UnrealEditor-Cmd <project.uproject> -run=pythonscript -script=<this file> -unattended -nosplash -nullrhi -stdout
The exports are Epic content: keep them in ignored scratch, never in a delivery folder."""
# Work folder: the environment variable JAM_UE_DIR names a folder outside any repository checkout; FBX files to
# check go in its import/ subfolder and results are written to its out/ subfolder.
import os
WORK = os.environ["JAM_UE_DIR"]; os.makedirs(os.path.join(WORK, "out"), exist_ok=True)
MANNY = os.environ.get("JAM_UE_MANNEQUINS", "/Game/Characters/Mannequins")   # Epic's mannequin content (third-person template); set if moved
import unreal
ar = unreal.AssetRegistryHelpers.get_asset_registry()
ar.scan_paths_synchronous(["/Game"], True)
OUT = os.path.join(WORK, "out") + "/"
def export(path, exporter, name):
    asset = unreal.EditorAssetLibrary.load_asset(path)
    if not asset:
        unreal.log_error("MANNYEXPORT missing " + path); return
    task = unreal.AssetExportTask()
    task.object = asset
    task.filename = OUT + name + ".fbx"
    task.automated = True; task.prompt = False; task.replace_identical = True
    task.exporter = exporter
    opts = unreal.FbxExportOption()
    opts.ascii = False; opts.level_of_detail = False; opts.collision = False; opts.vertex_color = False
    task.options = opts
    ok = unreal.Exporter.run_asset_export_task(task)
    unreal.log_warning("MANNYEXPORT %s -> %s : %s" % (path, task.filename, ok))
M = MANNY + "/"
export(M + "Meshes/SKM_Manny_Simple", unreal.SkeletalMeshExporterFBX(), "SKM_Manny_Simple")
export(M + "Anims/Unarmed/MM_Idle", unreal.AnimSequenceExporterFBX(), "MM_Idle")
export(M + "Anims/Unarmed/Walk/MF_Unarmed_Walk_Fwd", unreal.AnimSequenceExporterFBX(), "MF_Unarmed_Walk_Fwd")
export(M + "Anims/Unarmed/Jog/MF_Unarmed_Jog_Fwd", unreal.AnimSequenceExporterFBX(), "MF_Unarmed_Jog_Fwd")
