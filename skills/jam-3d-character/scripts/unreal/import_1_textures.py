"""Step 1, textures of importing a delivered body into the Unreal project. Run each step as its own call of the editor's
Python tool (for example PythonScriptingTools.execute_python through an editor MCP); the tool wants short calls.
Set CONFIG below (the same block in all four steps). Name and parts come from the body's character.json. Sources are
read from the delivery folder inside this checkout, so the assets store a path relative to the project: maps
stages/texture/T_<name>_<Part>_<kind>.png, the whole body unreal/SKM_<name>.fbx and each part unreal/SKM_<name>_<Part>.fbx
(the part meshes are what outfits wear), with material slots M_<name>_<Part>. <Part> is the part's object name."""
import unreal, json, os

# --- CONFIG: the same block in import_1_textures.py to import_4_save.py; set delivery in each call ---
CONFIG = {
    "delivery": "",          # repository-relative body delivery folder (Art/Assets/<asset>/<revision>); required
    "character": None,       # the body's character.json, repository-relative; None reads <delivery>/character.json
    "dest": None,            # content folder; None gives /Game/Characters/<name>
    "mannequins": "/Game/Characters/Mannequins",   # Epic's mannequin content (third-person template); change if moved
}
CONFIG.update(globals().get("JAM_CONFIG") or {})   # values sent ahead of this script: JAM_CONFIG = {"delivery": ...}
c = CONFIG
if not c["delivery"] or os.path.isabs(c["delivery"]): raise RuntimeError("set CONFIG['delivery'] to the body's delivery folder, relative to the project")
proj = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
src = os.path.join(proj, *c["delivery"].split("/"))
spec = json.load(open(os.path.join(proj, *(c["character"] or c["delivery"] + "/character.json").split("/")), encoding="utf-8"))
name = spec["name"]
parts = tuple(spec["parts"][r] for r in ("head", "hair", "body", "hands") if spec["parts"].get(r))
hair = spec["parts"].get("hair")   # an open shell: its material is two-sided
dest = c["dest"] or "/Game/Characters/" + name
eal = unreal.EditorAssetLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()
out = {}
# --- end CONFIG ---

# --- textures ---
tasks = []
for part in parts:
    for kind in ("BaseColor", "Normal", "ORM"):
        t = unreal.AssetImportTask()
        t.filename = os.path.join(src, "stages", "texture", "T_%s_%s_%s.png" % (name, part, kind))
        t.destination_path = dest + "/Textures"; t.destination_name = "T_%s_%s_%s" % (name, part, kind); t.automated = True; t.replace_existing = True; t.save = False
        t.factory = unreal.TextureFactory()
        tasks.append(t)
tools.import_asset_tasks(tasks)
tex = {}
for part in parts:
    for kind in ("BaseColor", "Normal", "ORM"):
        path = "%s/Textures/T_%s_%s_%s" % (dest, name, part, kind)
        a = eal.load_asset(path)
        if a is None: raise RuntimeError("texture not imported: " + path)
        if kind == "Normal":
            a.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
            a.set_editor_property("srgb", False)
            a.set_editor_property("flip_green_channel", True)   # the maps are baked in Blender's +Y convention
        elif kind == "ORM":
            a.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_MASKS)
            a.set_editor_property("srgb", False)
        tex[(part, kind)] = a
out["textures"] = {"%s_%s" % k: [v.blueprint_get_size_x(), v.blueprint_get_size_y(), str(v.get_editor_property("compression_settings")), bool(v.get_editor_property("srgb"))] for k, v in tex.items()}

out["dirtyPackages"] = sorted(p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages())
out["saved"] = eal.save_directory(dest + "/Textures", only_if_is_dirty=False, recursive=True)
json.dumps(out)
