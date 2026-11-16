"""Compare the bones of every character mesh in the running game with a reference mesh's. Runs inside a live Unreal editor during Play In Editor.

ARGS: {"reference": "<asset name of the reference skeletal mesh, as it appears in the level>"}
The level must hold both the new character and a character wearing the reference mesh (place one if it has none).
Returns, per mesh in play: bone count, bones missing from or extra to the reference, and whether the order matches.
"""
import unreal


def main(ARGS):
    w = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_game_world()
    if w is None: raise RuntimeError("no game world: start Play In Editor first")
    out = {}
    for a in unreal.GameplayStatics.get_all_actors_of_class(w, unreal.Character):
        c = a.get_editor_property("mesh"); asset = c.get_skinned_asset()
        out.setdefault(asset.get_name(), [str(c.get_bone_name(i)) for i in range(c.get_num_bones())])
    if ARGS["reference"] not in out:
        raise RuntimeError("no character in play wears the reference mesh %s (meshes in play: %s)" % (ARGS["reference"], sorted(out)))
    reference = out[ARGS["reference"]]
    return {"reference": ARGS["reference"],
            "meshes": {k: {"bones": len(v), "missing": [x for x in reference if x not in v], "extra": [x for x in v if x not in reference], "sameOrder": v == reference} for k, v in out.items()}}
