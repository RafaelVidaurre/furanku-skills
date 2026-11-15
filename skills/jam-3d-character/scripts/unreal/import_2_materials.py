"""Step 2, parent material and one instance per part of importing a delivered body into the Unreal project. Run each step as its own call of the editor's
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

tex = {}
for part in parts:
    for kind in ("BaseColor", "Normal", "ORM"):
        tex[(part, kind)] = eal.load_asset("%s/Textures/T_%s_%s_%s" % (dest, name, part, kind))
# --- parent material ---
mel = unreal.MaterialEditingLibrary
mpath = dest + "/Materials/M_" + name
mat = eal.load_asset(mpath) if eal.does_asset_exist(mpath) else tools.create_asset("M_" + name, dest + "/Materials", unreal.Material, unreal.MaterialFactoryNew())
mel.delete_all_material_expressions(mat)
def sampler(name, texture, sampler_type, y):
    e = mel.create_material_expression(mat, unreal.MaterialExpressionTextureSampleParameter2D, -500, y)
    e.set_editor_property("parameter_name", name); e.set_editor_property("texture", texture); e.set_editor_property("sampler_type", sampler_type)
    return e
bc = sampler("BaseColor", tex[(parts[0], "BaseColor")], unreal.MaterialSamplerType.SAMPLERTYPE_COLOR, -300)
nm = sampler("Normal", tex[(parts[0], "Normal")], unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL, 0)
orm = sampler("ORM", tex[(parts[0], "ORM")], unreal.MaterialSamplerType.SAMPLERTYPE_MASKS, 300)
ok = [mel.connect_material_property(bc, "RGB", unreal.MaterialProperty.MP_BASE_COLOR),
      mel.connect_material_property(nm, "RGB", unreal.MaterialProperty.MP_NORMAL),
      mel.connect_material_property(orm, "R", unreal.MaterialProperty.MP_AMBIENT_OCCLUSION),
      mel.connect_material_property(orm, "G", unreal.MaterialProperty.MP_ROUGHNESS),
      mel.connect_material_property(orm, "B", unreal.MaterialProperty.MP_METALLIC)]
mel.recompile_material(mat)
out["materialConnections"] = ok

# --- one instance per part ---
inst = {}
for part in parts:
    mi_name = "MI_%s_%s" % (name, part); ipath = dest + "/Materials/" + mi_name
    mi = eal.load_asset(ipath) if eal.does_asset_exist(ipath) else tools.create_asset(mi_name, dest + "/Materials", unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    mel.set_material_instance_parent(mi, mat)
    for kind in ("BaseColor", "Normal", "ORM"):
        mel.set_material_instance_texture_parameter_value(mi, kind, tex[(part, kind)])
    if part == hair:
        # hair is a single-sided shell that is open underneath
        o = mi.get_editor_property("base_property_overrides"); o.set_editor_property("override_two_sided", True); o.set_editor_property("two_sided", True)
        mi.set_editor_property("base_property_overrides", o)
    mel.update_material_instance(mi)
    inst[part] = mi

out["dirtyPackages"] = sorted(p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages())
json.dumps(out)
