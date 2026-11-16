# Importing by hand

The `import` command does this for you; this page is what it does, for when it cannot run.

1. Copy the file to `game/assets/<kind>/<file name>` (`static`, `skinned` or `audio`). Its id is `assets/<kind>/<file name>`.
2. Beside it, write `<file name>.source.json`: `{"source": "<project-relative path of the original>", "sha256": "<of the copy>"}`.

Done when `jam engine check` reports no problems.

Deliver models as `.glb` in glTF's conventions (meters, +Y up, front +Z) with one node per mesh left unmoved: `inspect` reads bounds from the mesh data and does not apply node transforms.
