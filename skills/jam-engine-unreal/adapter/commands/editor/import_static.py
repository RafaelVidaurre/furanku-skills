"""Import one model file as a static mesh with its materials and textures under stable names. Runs inside the Unreal editor.

ARGS: {"source": "<project-relative glb or fbx>", "sha256": "...", "dest": "/Game/Props/Saloon", "name": "SM_SaloonChair",
       "base": "SaloonChair",                 the name without its type prefix, used for the material and texture names
       "prefixes": {"texture": "T_", "materialInstance": "MI_", "material": "M_"},
       "complexity": "simple-and-complex" | null}

The file goes through Interchange with the project's own pipeline stack for it, followed by a naming pipeline that
gives every asset its final name and folder before anything is created: the mesh `<dest>/<name>`, textures
`<dest>/Textures/<T_><base>_<its own name>`, materials `<dest>/Materials/<MI_><base>` (numbered when there are
several). The importer's own names (`Material_0`, `Image_0`) would collide between props. Nothing is renamed or moved
afterwards: a moved asset resolves its stored source from its new folder, to a path outside the project. Collision
shapes named for the mesh in the file (the engine's collision prefix) are imported as the mesh's simple collision.

It refuses, before creating anything, a file that holds more than one mesh, and any asset name that exists already:
the engine cannot replace a loaded asset this way and leaves the old one in place without an error (docs/import.md,
"Replacing a mesh").
"""
# jam: include editor_shared
import unreal

JAM_STATIC = {}   # what main asks of the naming pipeline, and what the pipeline found


@unreal.uclass()
class JamStaticNames(unreal.InterchangePythonPipelineBase):
    """Runs after the project's pipelines: names and places each factory node, or disables them all to refuse."""

    @unreal.ufunction(override=True)
    def scripted_execute_pipeline(self, container, source_datas, content_base_path):
        plan, prefixes = JAM_STATIC["plan"], JAM_STATIC["plan"]["prefixes"]

        def enabled(cls):
            return [(u, container.get_factory_node(u)) for u in sorted(container.get_nodes(cls.static_class())) if container.get_factory_node(u).is_enabled()]

        meshes = enabled(unreal.InterchangeStaticMeshFactoryNode)
        materials = enabled(unreal.InterchangeBaseMaterialFactoryNode)
        planned = []
        for _, node in meshes:
            node.set_asset_name(plan["name"]); node.set_custom_sub_path("")
            planned.append((node, "static-mesh"))
        for _, node in enabled(unreal.InterchangeTextureFactoryNode):
            node.set_asset_name("%s%s_%s" % (prefixes["texture"], plan["base"], node.get_asset_name())); node.set_custom_sub_path("Textures")
            planned.append((node, "texture"))
        for i, (_, node) in enumerate(materials):
            instance = isinstance(node, unreal.InterchangeMaterialInstanceFactoryNode)
            node.set_asset_name("%s%s%s" % (prefixes["materialInstance"] if instance else prefixes["material"], plan["base"], "" if len(materials) == 1 else "_%02d" % (i + 1)))
            node.set_custom_sub_path("Materials")
            planned.append((node, "material-instance" if instance else "material"))
        JAM_STATIC["planned"] = [{"id": "/".join(p for p in (plan["dest"], node.get_custom_sub_path(), node.get_asset_name()) if p), "kind": kind} for node, kind in planned]
        refusal = None
        if len(meshes) != 1:
            refusal = "expected one static mesh from %s, got %d (combine the meshes on export, or import the parts as separate files)" % (plan["source"], len(meshes))
        else:
            taken = [p["id"] for p in JAM_STATIC["planned"] if unreal.EditorAssetLibrary.does_asset_exist(p["id"])]
            if taken:
                refusal = "%s exist%s: replace %s as docs/import.md describes (stop the editor, delete its files, import fresh)" % (
                    ", ".join(taken), "s" if len(taken) == 1 else "", "it" if len(taken) == 1 else "them")
        if refusal:
            JAM_STATIC["refusal"] = refusal
            for uid in container.get_nodes(unreal.InterchangeFactoryBaseNode.static_class()):
                container.get_factory_node(uid).set_enabled(False)


def main(ARGS):
    eal = unreal.EditorAssetLibrary
    target = ARGS["dest"] + "/" + ARGS["name"]
    JAM_STATIC.clear()
    JAM_STATIC["plan"] = dict(ARGS)
    source = unreal.InterchangeManager.create_source_data(jam_source(ARGS["source"], ARGS.get("sha256")))
    params = unreal.ImportAssetParameters()
    params.is_automated = True
    params.replace_existing = False
    for pipeline in unreal.InterchangeProjectSettingsScript.get_pipeline_stack_from_source_data(False, source):
        params.override_pipelines.append(unreal.SoftObjectPath(pipeline.get_path_name()))
    namer = unreal.new_object(JamStaticNames)
    params.override_pipelines.append(unreal.SoftObjectPath(namer.get_path_name()))
    made = unreal.InterchangeManager.get_interchange_manager_scripted().import_asset(ARGS["dest"], source, params)
    if JAM_STATIC.get("refusal"):
        raise RuntimeError(JAM_STATIC["refusal"])
    made = sorted({obj.get_path_name().split(".")[0] for obj in made or []})
    planned = JAM_STATIC.get("planned") or []
    missing = [p["id"] for p in planned if p["id"] not in made]
    if missing:
        raise RuntimeError("the import of %s did not make %s (made: %s)" % (ARGS["source"], ", ".join(missing), ", ".join(made) or "nothing"))
    mesh = eal.load_asset(target)
    out = {"assets": planned, "unplaced": [m for m in made if m not in {p["id"] for p in planned}], "unavailable": {}}
    if ARGS.get("complexity") == "simple-and-complex":
        try:
            mesh.get_editor_property("body_setup").set_editor_property("collision_trace_flag", unreal.CollisionTraceFlag.CTF_USE_SIMPLE_AND_COMPLEX)
        except Exception as e:
            out["unavailable"]["complexity"] = repr(e)
    try:
        out["nanite"] = bool(mesh.get_editor_property("nanite_settings").get_editor_property("enabled"))
    except Exception as e:
        out["unavailable"]["nanite"] = repr(e)
    geom = mesh.get_editor_property("body_setup").get_editor_property("agg_geom")
    out["collision"] = {k: len(geom.get_editor_property(k)) for k in ("box_elems", "sphere_elems", "sphyl_elems", "convex_elems")}
    out["saved"] = all([eal.save_asset(p["id"], only_if_is_dirty=False) for p in planned])
    out["source"] = jam_stored_source(mesh)
    out["sources"] = {p["id"]: jam_stored_source(eal.load_asset(p["id"])) for p in planned}
    out["projectDir"] = jam_project_dir()
    out["dirtyContent"] = jam_dirty_packages()
    return out
