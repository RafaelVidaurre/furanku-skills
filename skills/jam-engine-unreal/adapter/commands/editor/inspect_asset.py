"""Report what the engine holds for one asset: bounds, counts, material slots, skeleton, collision. Runs inside the Unreal editor.

ARGS: {"asset": "<asset id>"}
Lengths are engine units (centimetres) in the asset's own space; the caller converts them to metres. A fact the
engine would not give is left out and named under `unavailable`, never guessed.
"""
# jam: include editor_shared
import unreal


def main(ARGS):
    asset_id = ARGS["asset"].split(".")[0]
    asset = unreal.EditorAssetLibrary.load_asset(asset_id)
    if asset is None: raise RuntimeError("asset not found: " + asset_id)
    out = {"id": asset_id, "class": asset.get_class().get_name(), "unavailable": {}}
    out["source"] = jam_stored_source(asset)
    out["projectDir"] = jam_project_dir()

    def attempt(key, read):
        try: out[key] = read()
        except Exception as e: out["unavailable"][key] = repr(e)

    if isinstance(asset, unreal.StaticMesh):
        out["kind"] = "static-mesh"
        box = asset.get_bounding_box()
        out["boundsMin"] = [box.min.x, box.min.y, box.min.z]; out["boundsMax"] = [box.max.x, box.max.y, box.max.z]
        attempt("sections", lambda: asset.get_num_sections(0))
        attempt("triangles", lambda: asset.get_num_triangles(0))
        attempt("vertices", lambda: unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem).get_number_verts(asset, 0))
        attempt("materials", lambda: [str(m.get_editor_property("material_slot_name")) for m in asset.get_editor_property("static_materials")])
        attempt("lods", lambda: asset.get_num_lods())
        attempt("nanite", lambda: bool(asset.get_editor_property("nanite_settings").get_editor_property("enabled")))
        def shapes():
            geom = asset.get_editor_property("body_setup").get_editor_property("agg_geom")
            return {k: len(geom.get_editor_property(k)) for k in ("box_elems", "sphere_elems", "sphyl_elems", "convex_elems")}
        attempt("collision", shapes)
    elif isinstance(asset, unreal.SkeletalMesh):
        out["kind"] = "skeletal-mesh"
        b = asset.get_bounds()
        out["boundsMin"] = [b.origin.x - b.box_extent.x, b.origin.y - b.box_extent.y, b.origin.z - b.box_extent.z]
        out["boundsMax"] = [b.origin.x + b.box_extent.x, b.origin.y + b.box_extent.y, b.origin.z + b.box_extent.z]
        sub = unreal.get_editor_subsystem(unreal.SkeletalMeshEditorSubsystem)
        attempt("vertices", lambda: sub.get_num_verts(asset, 0))
        attempt("sections", lambda: sub.get_num_sections(asset, 0))
        attempt("materials", lambda: [str(m.get_editor_property("material_slot_name")) for m in asset.get_editor_property("materials")])
        sk = asset.get_editor_property("skeleton")
        out["skeleton"] = sk.get_path_name().split(".")[0] if sk else None
        attempt("physicsAsset", lambda: (lambda pa: pa.get_path_name().split(".")[0] if pa else None)(asset.get_editor_property("physics_asset")))
        if sk:
            attempt("bones", lambda: [str(n) for n in unreal.AnimPoseExtensions.get_bone_names(unreal.AnimPoseExtensions.get_reference_pose(sk))])
    elif isinstance(asset, unreal.SoundWave):
        out["kind"] = "sound-wave"
        attempt("durationSeconds", lambda: round(asset.get_editor_property("duration"), 3))
        attempt("channels", lambda: asset.get_editor_property("num_channels"))
        attempt("sampleRate", lambda: asset.get_sample_rate_for_current_platform())
    elif isinstance(asset, unreal.Texture2D):
        out["kind"] = "texture"
        attempt("size", lambda: [asset.blueprint_get_size_x(), asset.blueprint_get_size_y()])
        attempt("compression", lambda: str(asset.get_editor_property("compression_settings")))
        attempt("srgb", lambda: bool(asset.get_editor_property("srgb")))
    elif isinstance(asset, unreal.MaterialInstanceConstant):
        out["kind"] = "material-instance"
        attempt("parent", lambda: asset.get_editor_property("parent").get_path_name().split(".")[0])
    elif isinstance(asset, unreal.Material):
        out["kind"] = "material"
    return out
