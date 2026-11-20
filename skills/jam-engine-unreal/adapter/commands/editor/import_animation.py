"""Import the animations of one glTF clip onto a skeleton already in the project. Runs inside the Unreal editor.

ARGS: {"source": "<project-relative glb>", "sha256": "...", "target": "<skeleton, or skeletal mesh whose skeleton to use>",
       "joints": ["<every joint the clip's skin holds>"], "dest": "/Game/Characters/Hero/Animations", "name": "AS_HeroWalk"}

A clip whose joints the skeleton lacks is refused before anything is imported: its animation would play on nothing.
The clip goes through Interchange's generic pipeline with "import only animations" on the target skeleton, straight
into `dest` under `name`: one animation becomes `<dest>/<name>`, several become `<dest>/<name><animation name>` (the
importer's own rule). Importing again replaces those sequences in place. Nothing is renamed afterwards: a moved asset
resolves its stored source from its new folder and loses it.
"""
# jam: include editor_shared
import unreal


def main(ARGS):
    eal = unreal.EditorAssetLibrary
    target = eal.load_asset(ARGS["target"].split(".")[0])
    if target is None: raise RuntimeError("target not found: " + ARGS["target"])
    skeleton = target.get_editor_property("skeleton") if isinstance(target, unreal.SkeletalMesh) else target
    if not isinstance(skeleton, unreal.Skeleton): raise RuntimeError("%s is neither a skeleton nor a skeletal mesh" % ARGS["target"])
    skeleton_id = skeleton.get_path_name().split(".")[0]
    bones = [str(n) for n in unreal.AnimPoseExtensions.get_bone_names(unreal.AnimPoseExtensions.get_reference_pose(skeleton))]
    missing = [j for j in ARGS["joints"] if j not in bones]
    if missing:
        raise RuntimeError("skeleton %s lacks the clip's bones %s; retarget the clip onto this skeleton first" % (skeleton_id, ", ".join(missing[:12])))

    pipeline = unreal.InterchangeGenericAssetsPipeline()
    common = pipeline.get_editor_property("common_skeletal_meshes_and_animations_properties")
    common.set_editor_property("import_only_animations", True)
    common.set_editor_property("skeleton", skeleton)
    pipeline.get_editor_property("animation_pipeline").set_editor_property("import_animations", True)
    params = unreal.ImportAssetParameters()
    params.is_automated = True
    params.replace_existing = True
    params.destination_name = ARGS["name"]
    params.override_pipelines.append(unreal.SoftObjectPath(pipeline.get_path_name()))
    source = unreal.InterchangeManager.create_source_data(jam_source(ARGS["source"], ARGS.get("sha256")))
    made = unreal.InterchangeManager.get_interchange_manager_scripted().import_asset(ARGS["dest"], source, params)

    out = {"assets": [], "other": []}
    for obj in made or []:
        path = obj.get_path_name().split(".")[0]
        if not isinstance(obj, unreal.AnimSequence):
            out["other"].append(path)
            continue
        sk = obj.get_editor_property("skeleton")
        if sk is None or sk.get_path_name() != skeleton.get_path_name():
            raise RuntimeError("%s landed on %s, not on %s" % (path, sk.get_path_name() if sk else None, skeleton_id))
        entry = {"id": path, "skeleton": skeleton_id, "seconds": round(obj.get_play_length(), 4), "source": jam_stored_source(obj)}
        try:
            entry["frames"] = int(unreal.AnimationLibrary.get_num_frames(obj))
            step = unreal.AnimationLibrary.get_time_at_frame(obj, 1)
            entry["fps"] = round(1.0 / step, 3) if step > 0 else None
        except Exception as e:
            entry["unavailable"] = repr(e)
        out["assets"].append(entry)
    if not out["assets"]: raise RuntimeError("no animation was imported from %s (made: %s)" % (ARGS["source"], out["other"]))
    out["saved"] = all([eal.save_asset(a["id"], only_if_is_dirty=False) for a in out["assets"]])
    out["projectDir"] = jam_project_dir()
    out["dirtyContent"] = jam_dirty_packages()
    return out
