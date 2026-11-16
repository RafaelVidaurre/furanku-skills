"""Import one model file as a static mesh with its materials and textures under stable names. Runs inside the Unreal editor.

ARGS: {"source": "<project-relative glb or fbx>", "sha256": "...", "dest": "/Game/Props/Saloon", "name": "SM_SaloonChair",
       "base": "SaloonChair",                 the name without its type prefix, used for the material and texture names
       "prefixes": {"texture": "T_", "materialInstance": "MI_", "material": "M_"},
       "scratch": "/Game/Props/Saloon/_jam_import_SaloonChair",
       "complexity": "simple-and-complex" | null}

The file is imported into the scratch folder first, because the importer names materials and textures after the
file's own (`Material_0`, `Image_0`), which collide between props. Each imported asset is then renamed into the
destination: the mesh to `name`, textures to `Textures/<T_><base>_<its own name>`, materials to
`Materials/<MI_><base>` (numbered when there are several). The scratch folder is deleted and only the new assets
are saved. Collision shapes named for the mesh in the file (the engine's collision prefix) are imported by the
engine as the mesh's simple collision.

It refuses to import over an existing mesh: the engine cannot replace a loaded asset this way and leaves the old
one in place without an error (docs/import.md, "Replacing a mesh").
"""
# jam: include editor_shared
import unreal


def main(ARGS):
    eal = unreal.EditorAssetLibrary
    dest, name, base, scratch = ARGS["dest"], ARGS["name"], ARGS["base"], ARGS["scratch"]
    prefixes = ARGS["prefixes"]
    target = dest + "/" + name
    if eal.does_asset_exist(target):
        raise RuntimeError("%s exists: replace it as docs/import.md describes (stop the editor, delete its files, import fresh)" % target)
    if eal.does_directory_exist(scratch):
        eal.delete_directory(scratch)
    task = unreal.AssetImportTask()
    task.filename = jam_source(ARGS["source"], ARGS.get("sha256")); task.destination_path = scratch; task.destination_name = name
    task.automated = True; task.replace_existing = True; task.save = False
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    imported = sorted(str(p).split(".")[0] for p in eal.list_assets(scratch, recursive=True))
    if not imported: raise RuntimeError("nothing was imported from " + ARGS["source"])
    meshes, textures, materials, other = [], [], [], []
    for path in imported:
        a = eal.load_asset(path)
        (meshes if isinstance(a, unreal.StaticMesh) else textures if isinstance(a, unreal.Texture) else materials if isinstance(a, unreal.MaterialInterface) else other).append(path)
    if len(meshes) != 1:
        raise RuntimeError("expected one static mesh from %s, got %s (combine the meshes on export, or import the parts as separate files)" % (ARGS["source"], meshes))
    moves = [(meshes[0], target, "static-mesh")]
    for path in textures:
        moves.append((path, "%s/Textures/%s%s_%s" % (dest, prefixes["texture"], base, path.rsplit("/", 1)[-1]), "texture"))
    for i, path in enumerate(materials):
        a = eal.load_asset(path)
        prefix = prefixes["materialInstance"] if isinstance(a, unreal.MaterialInstance) else prefixes["material"]
        moves.append((path, "%s/Materials/%s%s%s" % (dest, prefix, base, "" if len(materials) == 1 else "_%02d" % (i + 1)), "material-instance" if isinstance(a, unreal.MaterialInstance) else "material"))
    for old, new, _ in moves[1:]:
        if eal.does_asset_exist(new): raise RuntimeError("%s exists: replace it as docs/import.md describes" % new)
    for old, new, _ in moves:
        if not eal.rename_asset(old, new): raise RuntimeError("could not move %s to %s" % (old, new))
    mesh = eal.load_asset(target)
    out = {"assets": [{"id": new, "kind": kind} for _, new, kind in moves], "unplaced": other, "unavailable": {}}
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
    out["saved"] = all([eal.save_asset(new, only_if_is_dirty=False) for _, new, _ in moves])
    eal.delete_directory(scratch)
    out["source"] = jam_stored_source(mesh)
    out["projectDir"] = jam_project_dir()
    out["dirtyContent"] = jam_dirty_packages()
    return out
