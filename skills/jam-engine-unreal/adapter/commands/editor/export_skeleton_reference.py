"""Export a reference skeletal mesh and animations from the project to FBX, as the skeleton and animation reference for rigging. Runs inside the Unreal editor (a commandlet is enough).

ARGS: {"outDir": "<project-relative folder>",
       "exports": [{"asset": "<asset id>", "kind": "skeletal-mesh" | "animation", "name": "<file name without .fbx>"}]}
The exports are the engine vendor's or the project's own content: keep them in ignored scratch, never in a delivery
folder.
"""
# jam: include editor_shared
import os

import unreal


def main(ARGS):
    ar = unreal.AssetRegistryHelpers.get_asset_registry()
    ar.scan_paths_synchronous(["/Game"], True)
    relative = ARGS["outDir"].strip("/")
    out_dir = os.path.join(jam_project_dir(), *relative.split("/")); os.makedirs(out_dir, exist_ok=True)
    done = []
    for item in ARGS["exports"]:
        asset = unreal.EditorAssetLibrary.load_asset(item["asset"])
        if not asset:
            raise RuntimeError("missing " + item["asset"])
        task = unreal.AssetExportTask()
        task.object = asset
        task.filename = os.path.join(out_dir, item["name"] + ".fbx")
        task.automated = True; task.prompt = False; task.replace_identical = True
        task.exporter = unreal.SkeletalMeshExporterFBX() if item["kind"] == "skeletal-mesh" else unreal.AnimSequenceExporterFBX()
        opts = unreal.FbxExportOption()
        opts.ascii = False; opts.level_of_detail = False; opts.collision = False; opts.vertex_color = False
        task.options = opts
        ok = unreal.Exporter.run_asset_export_task(task)
        done.append({"asset": item["asset"], "file": relative + "/" + item["name"] + ".fbx", "exported": bool(ok)})
    return {"exports": done}
