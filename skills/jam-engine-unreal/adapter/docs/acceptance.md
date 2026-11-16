# Acceptance in Unreal

The engine-neutral rules are in the `jam-engine` skill (`references/acceptance.md`). This is how each is met here. An asset is accepted in the engine when every step below that applies to its kind is done.

1. **It imports as intended.** `jam engine inspect <id>` shows the class, bounds, material slots and (skinned) the skeleton you asked for. For a skinned mesh run `jam engine check --kind skinned ...` before the real import: it imports into a throwaway folder, saves nothing, and reports the skeleton used, the root bone's scale and joint positions under the reference animations. Done when the receipt's `problems` is empty.
2. **It stores project-relative sources.** `jam engine check --kind sources <ids>` reads the saved `.uasset` files in this checkout. Done when `problems` is empty.
3. **It is seen in the engine.** Capture it rendered ([cheap-looks.md](cheap-looks.md)): every material shows its own colours, shading has no inverted patches (a wrong normal-map convention), and nothing is mapped through the wrong UV layout. The jam's first character passed the headless check and was approved with scrambled textures, because nothing had been rendered in the engine.
4. **Its collision is right where it has any** ([collision.md](collision.md)): `jam engine check --kind collision <ids>` for physical props, and the collision state read from the spawned actors in play, not from the code that sets it.
5. **It plays** (characters and anything animated): start Play In Editor, drive it with real inputs, capture it standing, walking, crouched and in every other pose the game uses. For a character on a shared skeleton, `jam engine check --kind bones-in-game --skeleton <id>` compares its bones with the reference mesh's in the running game. Actors spawned at Play appear as `StaticMeshActor_N` under the play world's level: they are not saved duplicates, so check the editor world before deleting anything.
6. **The project's tests still pass.** Run them on the unchanged branch first and keep that result as the baseline. A test that fails only with the new character names a gameplay value tuned on other proportions: report it to that system's owner instead of changing the test.
7. **It ships.** The asset counts as shipped once a packaged build that contains it loads it.

Reimporting keeps the asset id: the same name in the same folder. A static mesh is replaced by the procedure in [import.md](import.md#replacing-a-mesh), which also keeps its id.
