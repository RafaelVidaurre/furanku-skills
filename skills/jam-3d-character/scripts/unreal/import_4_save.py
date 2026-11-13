"""Step 4, save the new assets of importing a delivered body into the Unreal project. Run each step as its own call of the editor's
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
ok = eal.save_directory(dest, only_if_is_dirty=False, recursive=True)
mesh = eal.load_asset(dest + "/Meshes/SKM_" + name)
json.dumps({"saved": ok, "meshSource": os.path.relpath(str(mesh.get_editor_property("asset_import_data").extract_filenames()[0]), proj).replace(os.sep, "/"),
            "dirtyContent": sorted(p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages())})
