"""Import processed audio files as SoundWaves, reimporting into the same packages. Runs inside the Unreal editor.

ARGS: {"items": [{"source": "<project-relative wav>", "sha256": "...", "asset": "/Game/Audio/.../SW_Name"}]}
Each source's bytes are checked against the caller's digest before import, so a checkout that was not synced stops
here instead of importing an older take. Each sound is saved after its stored source is checked: one that remembers a
source outside the project is not saved (deleted when this import created it) and the import is refused.
"""
# jam: include editor_shared
import unreal


def main(ARGS):
    result = []
    for item in ARGS["items"]:
        source = jam_source(item["source"], item.get("sha256"))
        existed = unreal.EditorAssetLibrary.does_asset_exist(item["asset"])
        task = unreal.AssetImportTask()
        task.set_editor_property('filename', source)
        task.set_editor_property('destination_path', item['asset'].rsplit('/', 1)[0])
        task.set_editor_property('destination_name', item['asset'].rsplit('/', 1)[1])
        task.set_editor_property('automated', True)
        task.set_editor_property('replace_existing', True)
        task.set_editor_property('save', False)
        unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
        paths = list(task.get_editor_property('imported_object_paths'))
        if not paths or not unreal.EditorAssetLibrary.does_asset_exist(item['asset']):
            raise RuntimeError('Audio import failed: ' + item['asset'])
        wave = unreal.EditorAssetLibrary.load_asset(item['asset'])
        stored = jam_stored_source(wave)
        jam_refuse_outside_project({item["asset"]: stored}, [item["asset"]], [item["asset"]] if existed else [])
        result.append({"id": item["asset"], "imported": [str(p) for p in paths], "source": stored,
                       "saved": unreal.EditorAssetLibrary.save_asset(item["asset"], only_if_is_dirty=False)})
    return {"sounds": result, "projectDir": jam_project_dir(), "saved": all(s["saved"] for s in result)}
