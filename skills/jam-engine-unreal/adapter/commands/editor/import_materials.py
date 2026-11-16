"""Build one parent material with three texture parameters, and one material instance per material slot. Runs inside the Unreal editor.

ARGS: {"parent": "/Game/.../Materials/M_Hero",
       "buildParent": true,      false: the parent exists already (with BaseColor, Normal and ORM parameters) and is left as it is
       "instances": [{"id": "/Game/.../Materials/MI_Hero_Body", "textures": {"BaseColor": "<texture id>", "Normal": "...", "ORM": "..."},
                      "twoSided": false}]}
The parent samples BaseColor into base colour, Normal into the normal, and the ORM map's red, green and blue into
ambient occlusion, roughness and metallic. An instance set two-sided is for an open shell seen from inside.
Nothing is saved here: the mesh import that follows saves the whole destination folder.
"""
# jam: include editor_shared
import unreal

KINDS = ("BaseColor", "Normal", "ORM")


def main(ARGS):
    eal = unreal.EditorAssetLibrary
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    mel = unreal.MaterialEditingLibrary
    out = {}
    instances = ARGS["instances"]
    tex = {}
    for inst in instances:
        for kind in KINDS:
            a = eal.load_asset(inst["textures"][kind])
            if a is None: raise RuntimeError("texture missing: " + inst["textures"][kind])
            tex[(inst["id"], kind)] = a
    # --- parent material ---
    mpath = ARGS["parent"]; folder, mname = mpath.rsplit("/", 1)
    if ARGS.get("buildParent", True):
        mat = eal.load_asset(mpath) if eal.does_asset_exist(mpath) else tools.create_asset(mname, folder, unreal.Material, unreal.MaterialFactoryNew())
        mel.delete_all_material_expressions(mat)
        def sampler(name, texture, sampler_type, y):
            e = mel.create_material_expression(mat, unreal.MaterialExpressionTextureSampleParameter2D, -500, y)
            e.set_editor_property("parameter_name", name); e.set_editor_property("texture", texture); e.set_editor_property("sampler_type", sampler_type)
            return e
        first = instances[0]["id"]
        bc = sampler("BaseColor", tex[(first, "BaseColor")], unreal.MaterialSamplerType.SAMPLERTYPE_COLOR, -300)
        nm = sampler("Normal", tex[(first, "Normal")], unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL, 0)
        orm = sampler("ORM", tex[(first, "ORM")], unreal.MaterialSamplerType.SAMPLERTYPE_MASKS, 300)
        ok = [mel.connect_material_property(bc, "RGB", unreal.MaterialProperty.MP_BASE_COLOR),
              mel.connect_material_property(nm, "RGB", unreal.MaterialProperty.MP_NORMAL),
              mel.connect_material_property(orm, "R", unreal.MaterialProperty.MP_AMBIENT_OCCLUSION),
              mel.connect_material_property(orm, "G", unreal.MaterialProperty.MP_ROUGHNESS),
              mel.connect_material_property(orm, "B", unreal.MaterialProperty.MP_METALLIC)]
        mel.recompile_material(mat)
        out["materialConnections"] = ok
    else:
        mat = eal.load_asset(mpath)
        if mat is None: raise RuntimeError("parent material %s not found: import the asset that owns it first" % mpath)

    # --- one instance per material slot ---
    made = []
    for inst in instances:
        ifolder, mi_name = inst["id"].rsplit("/", 1)
        mi = eal.load_asset(inst["id"]) if eal.does_asset_exist(inst["id"]) else tools.create_asset(mi_name, ifolder, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        mel.set_material_instance_parent(mi, mat)
        for kind in KINDS:
            mel.set_material_instance_texture_parameter_value(mi, kind, tex[(inst["id"], kind)])
        if inst.get("twoSided"):
            o = mi.get_editor_property("base_property_overrides"); o.set_editor_property("override_two_sided", True); o.set_editor_property("two_sided", True)
            mi.set_editor_property("base_property_overrides", o)
        mel.update_material_instance(mi)
        made.append(inst["id"])
    out["parent"] = mpath
    out["instances"] = made
    out["dirtyPackages"] = jam_dirty_packages()
    return out
