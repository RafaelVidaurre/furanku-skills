"""Import texture maps into a content folder and set each one's compression for its role. Runs inside the Unreal editor.

ARGS: {"dest": "/Game/.../Textures",
       "textures": [{"source": "<project-relative png>", "sha256": "...", "name": "T_Hero_Body_Normal", "role": "color|normal|masks"}],
       "flipGreen": true}     flip the green channel of normal maps (their source convention differs from the engine's)
Returns the textures by name with id, size, compression, sRGB and stored source. Saves the folder.
Normal maps get TC_NORMALMAP without sRGB; mask maps (packed occlusion, roughness, metallic) get TC_MASKS without sRGB.
"""
# jam: include editor_shared
import unreal


def main(ARGS):
    eal = unreal.EditorAssetLibrary
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    dest = ARGS["dest"]
    out = {}
    tasks = []
    for item in ARGS["textures"]:
        t = unreal.AssetImportTask()
        t.filename = jam_source(item["source"], item.get("sha256"))
        t.destination_path = dest; t.destination_name = item["name"]; t.automated = True; t.replace_existing = True; t.save = False
        t.factory = unreal.TextureFactory()
        tasks.append(t)
    tools.import_asset_tasks(tasks)
    textures = {}
    for item in ARGS["textures"]:
        path = "%s/%s" % (dest, item["name"])
        a = eal.load_asset(path)
        if a is None: raise RuntimeError("texture not imported: " + path)
        if item["role"] == "normal":
            a.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
            a.set_editor_property("srgb", False)
            a.set_editor_property("flip_green_channel", bool(ARGS.get("flipGreen")))
        elif item["role"] == "masks":
            a.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_MASKS)
            a.set_editor_property("srgb", False)
        textures[item["name"]] = {"id": path, "size": [a.blueprint_get_size_x(), a.blueprint_get_size_y()],
                                  "compression": str(a.get_editor_property("compression_settings")), "srgb": bool(a.get_editor_property("srgb")),
                                  "source": jam_stored_source(a)}
    out["textures"] = textures
    out["projectDir"] = jam_project_dir()
    out["dirtyPackages"] = jam_dirty_packages()
    out["saved"] = eal.save_directory(dest, only_if_is_dirty=False, recursive=True)
    return out
