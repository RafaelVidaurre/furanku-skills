"""Make previews of assets: a texture's source image, a sound's source audio, or a self-contained GLB with baked
materials of a mesh, material, animation, skeleton (its preview mesh) or actor Blueprint (its components). Runs inside the Unreal editor with a renderer, which baking materials needs.

ARGS: {"jobs": [{"path", "asset": "<object path>", "method": "texture|gltf|preview-mesh|actor|wav", "file": "<absolute>"}],
       "progress": "<absolute file>"}
Each job's result is appended to `progress` as one JSON line as soon as it is done, so a process that stops early
still says what it finished. Returns {"results": [{"path", "error"?, "seconds"}]}.
"""
import json
import os
import time

import unreal

BAKE_SIZE = 512
GARBAGE_EVERY = 20


def _options():
    options = unreal.GLTFExportOptions()
    options.set_editor_property("bake_material_inputs", unreal.GLTFMaterialBakeMode.USE_MESH_DATA)
    size = unreal.GLTFMaterialBakeSize()
    size.set_editor_property("x", BAKE_SIZE)
    size.set_editor_property("y", BAKE_SIZE)
    options.set_editor_property("default_material_bake_size", size)
    options.set_editor_property("texture_image_format", unreal.GLTFTextureImageFormat.JPEG)
    options.set_editor_property("export_preview_mesh", True)
    return options


def _gltf(obj, file, actors=()):
    selected = unreal.Set(unreal.Actor)
    for actor in actors:
        selected.add(actor)
    returned = unreal.GLTFExporter.export_to_gltf(obj, file, _options(), selected)
    ok, messages = returned if isinstance(returned, tuple) else (returned, None)
    if not ok:
        errors = [str(m) for m in messages.errors] if messages else []
        raise RuntimeError("glTF export failed" + (": " + "; ".join(errors)[:300] if errors else ""))


def _export(obj, file, exporter):
    task = unreal.AssetExportTask()
    task.object = obj
    task.filename = file
    task.automated = True
    task.prompt = False
    task.replace_identical = True
    task.exporter = exporter
    if not unreal.Exporter.run_asset_export_task(task):
        errors = [str(e) for e in task.errors]
        raise RuntimeError("export failed" + (": " + "; ".join(errors)[:300] if errors else ""))


def _preview_mesh(skeleton):
    """The skeletal mesh the editor previews a skeleton with, else one built on that skeleton."""
    try:
        mesh = skeleton.get_skeleton_preview_mesh()
    except Exception:
        mesh = None
    if mesh:
        return mesh
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    if not _preview_mesh.searched:
        registry.search_all_assets(True)
        _preview_mesh.searched = True
    package = obj.get_outermost().get_name()
    options = unreal.AssetRegistryDependencyOptions(include_soft_package_references=False, include_hard_package_references=True,
                                                    include_searchable_names=False, include_soft_management_references=False,
                                                    include_hard_management_references=False)
    for referencer in registry.get_referencers(package, options) or []:
        for data in registry.get_assets_by_package_name(referencer):
            if data.asset_class_path.asset_name == "SkeletalMesh":
                return data.get_asset()
    raise RuntimeError("it has no preview mesh and no skeletal mesh uses it")


_preview_mesh.searched = False


class _Stage:
    """A blank level, made once, where actor Blueprints are placed one at a time."""
    world = None

    @classmethod
    def place(cls, blueprint):
        generated = blueprint.generated_class()
        if generated is None or not isinstance(unreal.get_default_object(generated), unreal.Actor):
            raise RuntimeError("not an actor Blueprint: nothing to place")
        if cls.world is None:
            cls.world = unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
        return unreal.get_editor_subsystem(unreal.EditorActorSubsystem).spawn_actor_from_class(generated, unreal.Vector(0, 0, 0))


def _make(job):
    obj = unreal.load_asset(job["asset"])
    if obj is None:
        raise RuntimeError("the editor could not load it")
    method, file = job["method"], job["file"]
    if os.path.exists(file):
        os.remove(file)
    if method == "texture":
        _export(obj, file, unreal.TextureExporterPNG())
    elif method == "wav":
        _export(obj, file, unreal.SoundExporterWAV())
    elif method == "gltf":
        _gltf(obj, file)
    elif method == "preview-mesh":
        _gltf(_preview_mesh(obj), file)
    elif method == "actor":
        actor = _Stage.place(obj)
        try:
            _gltf(actor.get_world(), file, [actor])
        finally:
            unreal.get_editor_subsystem(unreal.EditorActorSubsystem).destroy_actor(actor)
    else:
        raise RuntimeError("unknown preview method %s" % method)


def main(ARGS):
    results = []
    for index, job in enumerate(ARGS["jobs"]):
        started = time.time()
        result = {"path": job["path"]}
        try:
            _make(job)
        except Exception as error:
            result["error"] = str(error) or repr(error)
        result["seconds"] = round(time.time() - started, 3)
        results.append(result)
        try:
            with open(ARGS["progress"], "a", encoding="utf-8") as f:
                f.write(json.dumps(result) + "\n")
        except OSError:
            pass    # an editor on another machine: its returned results are what counts

        if (index + 1) % GARBAGE_EVERY == 0:
            unreal.SystemLibrary.collect_garbage()
    return {"results": results}
