"""Import processed audio files as SoundWaves, reimporting into the same packages. Runs inside the Unreal editor.

ARGS: {"items": [{"source": "<project-relative wav>", "sha256": "...", "asset": "/Game/Audio/.../SW_Name"}]}
Each source's bytes are checked against the caller's digest before import, so a checkout that was not synced stops
here instead of importing an older take. Each package is saved by its import task.
"""
# jam: include editor_shared
import unreal


def main(ARGS):
    result = []
    for item in ARGS["items"]:
        source = jam_source(item["source"], item.get("sha256"))
        task = unreal.AssetImportTask()
        task.set_editor_property('filename', source)
        task.set_editor_property('destination_path', item['asset'].rsplit('/', 1)[0])
        task.set_editor_property('destination_name', item['asset'].rsplit('/', 1)[1])
        task.set_editor_property('automated', True)
        task.set_editor_property('replace_existing', True)
        task.set_editor_property('save', True)
        unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
        paths = list(task.get_editor_property('imported_object_paths'))
        if not paths or not unreal.EditorAssetLibrary.does_asset_exist(item['asset']):
            raise RuntimeError('Audio import failed: ' + item['asset'])
        wave = unreal.EditorAssetLibrary.load_asset(item['asset'])
        result.append({"id": item["asset"], "imported": [str(p) for p in paths], "source": jam_stored_source(wave)})
    return {"sounds": result, "projectDir": jam_project_dir()}
