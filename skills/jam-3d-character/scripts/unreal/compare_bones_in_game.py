"""Compare the bones of every character mesh in the running game with Manny's: run it through the editor's Python tool while
Play In Editor runs in a level that holds both the new character and a Manny (place one if the level has none).
The result lists bones missing from or extra in each mesh relative to SKM_Manny_Simple and whether the order matches."""
import unreal, json
w = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_game_world()
out = {}
for a in unreal.GameplayStatics.get_all_actors_of_class(w, unreal.Character):
    c = a.get_editor_property("mesh"); asset = c.get_skinned_asset()
    out.setdefault(asset.get_name(), [str(c.get_bone_name(i)) for i in range(c.get_num_bones())])
manny = out.get("SKM_Manny_Simple", [])
json.dumps({k: {"bones": len(v), "missing": [x for x in manny if x not in v], "extra": [x for x in v if x not in manny], "sameOrder": v == manny} for k, v in out.items()})
