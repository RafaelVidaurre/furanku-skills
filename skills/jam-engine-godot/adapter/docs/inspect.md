# Inspect by hand

This adapter has no inspect command. `jam engine inventory` already gives what the files hold without the editor: an image's size, a sound's length, a scene's root type, a SpriteFrames' animations, and the import settings (`jam engine docs inventory`).

For what only the imported result shows, such as a model's bounds:

1. Open the imported scene in the editor.
2. Select the mesh and read its bounding box (AABB) in the inspector; it is in meters.

Done when you have recorded the bounds, and the asset's `res://` path, as the step's evidence.
