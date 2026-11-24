# Previews

`jam engine previews` makes one viewable file per inventory entry for the catalog. It writes them to one machine-local folder, by default `.engine/previews` in the scratch root, beside `index.json`. The toolkit runs `jam engine inventory` first. Nothing needs the editor, so `--no-engine` changes nothing.

## What each file gets

| File | Preview |
| --- | --- |
| Imported PNG, JPEG or WebP | The image itself |
| Imported WAV | The sound itself |
| Imported GLB | The model itself |
| `.tres` `SpriteFrames` | Each animation playing, cut from its atlas image (below). The catalog's thumbnail is the first animation's first frame |
| `.tscn` whose `AnimatedSprite2D` nodes hold their `SpriteFrames` in the scene | The same, named `<node>/<animation>` when more than one node has one |
| `.tres` `AtlasTexture` | Its region of the atlas image |
| `.ogv` Ogg Theora video | Converted to an H.264 MP4 by ffmpeg (`JAM_FFMPEG`, else `ffmpeg` on the PATH), since most browsers do not play Theora. Without ffmpeg it is recorded as failed, saying so |
| Imported Ogg, MP3, SVG, TGA, EXR and other images, glTF, FBX, OBJ, Blender files | None, recorded as failed with the reason: the catalog shows PNG, JPEG, WebP, WAV and GLB, and this adapter converts nothing |
| Other scenes, resources, scripts, shaders | None; the receipt counts them as `none` |

## Sprite sheets

Each animation of a `SpriteFrames` becomes the image its frames are cut from and a sheet in the catalog's `frames` form:

| Catalog | Godot |
| --- | --- |
| `region` | The `AtlasTexture`'s `region`; the whole image for a frame that is an image |
| `offset` | The `AtlasTexture`'s `margin` position, when not 0 |
| `size` | `region` size plus `margin` size, when there is a margin |
| `duration` | The frame's `duration` (relative), when not 1 |
| `fps` | The animation's `speed` |
| `loop` | The animation's `loop` |

Godot 3's format, where frames are the textures themselves, reads the same way.

An animation is left out, with the reason in the entry's `how`, when:
- its frames come from more than one image (the adapter does not compose them);
- a frame is another kind of texture, or an `AtlasTexture` cut from another `AtlasTexture`;
- a region reaches outside its image;
- its speed is 0.

When no animation can be shown the entry is `failed` with each reason.

## When it runs again

- Each copy is named by its source's path and version, so an image that is also the atlas of animations is copied once, and a changed image gets a new copy.
- An entry cut from atlas images lists them under `inputs` with their versions, so the catalog says the animations are out of date as soon as an atlas changes, before the next `jam engine previews`.
- Every run reads the `SpriteFrames` again. An entry that comes out the same, with its files in the folder, is reused. An unchanged `.tres` whose atlas changed is made again.
- `--full` copies everything again. `--only <pattern>` (project paths, `*` within a folder, `**` any depth) selects entries; the others keep their previews. `--limit <n>` caps the entries that copy files in one run; the rest count as `waiting`.
- Files in the folder that the index no longer names are deleted.

Done when the receipt's `failed` and `waiting` are what you expect, and `jam catalog run unit.get --input '{"id":"engine:res://<a SpriteFrames path>"}'` shows an `animation` link with a `sheet` for each animation.
