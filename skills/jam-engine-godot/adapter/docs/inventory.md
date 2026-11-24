# Inventory

`jam engine inventory` lists the Godot project's content. It writes one inventory file, by default `.engine/inventory.json` in the scratch root, and prints its path. It reads Godot's text files directly, so it needs no editor; `--engine` is accepted and changes nothing.

## What is content

The Godot project is the folder holding `project.godot`: the project root, or the folder `engine.facts.assetId.from` names (`"game/{path}"` for `game/project.godot`). Under it the inventory follows Godot's own rules:

- Hidden files and folders are skipped, `.godot/` among them.
- A folder holding a `.gdignore`, or another `project.godot`, is skipped with everything under it.
- `addons/` is content like any other folder.

A file is an entry when Godot loads it as a resource. Each entry's key is its project path and its id is `res://<path inside the Godot project>`.

| File | Class | Tags |
| --- | --- | --- |
| Any file with a `<file>.import` beside it (images, sounds, models, fonts) | The `.import` file's `type`, such as `CompressedTexture2D`, `AudioStreamWAV`, `PackedScene` | `importer`; the import settings below; `width` and `height` of a PNG, JPEG or WebP; `channels`, `sampleRate` and `seconds` of a WAV or Ogg |
| `.tscn` | `PackedScene` | `rootName`, `rootType`, `inherits` (the scene an inherited scene extends), `nodes` (how many) |
| `.tres` | Its `type`, or its `script_class` when it has one (`Item`, with `baseType` `Resource`) | For `SpriteFrames`: `animations`, each name with its frame count (`walk:13, idle:8`) |
| `.gd`, `.cs`, `.gdshader`, `.gdshaderinc` | `GDScript`, `CSharpScript`, `Shader`, `ShaderInclude` | `className` and `extends` of a GDScript |
| `.res`, `.scn` and other binary resources | The class in the file's header | `format`: `binary` |
| `.ogv` (Godot loads it with no import) | `VideoStreamTheora` | |

Every entry's `uid` tag is its `uid://` id when Godot gave it one: from the scene or resource header, the `.import` file, or a `<file>.uid` beside a script.

Import settings kept as tags, by importer:

| Importer | Settings |
| --- | --- |
| `texture` | `compress/mode` (named as the import dock names it: `Lossless`, `Lossy`, `VRAM Compressed`, `VRAM Uncompressed`, `Basis Universal`), `mipmaps/generate`, `process/fix_alpha_border`, `process/premult_alpha`, `process/size_limit` |
| `wav` | `force/mono`, `force/max_rate`, `edit/loop_mode`, `compress/mode` |
| `oggvorbisstr`, `mp3` | `loop`, `loop_offset` |
| `scene` | `nodes/root_type`, `meshes/generate_lods`, `animation/import` |

A scene's node groups are its searchable `names` (`on: groups`), which the catalog searches.

Not entries:
- files Godot does not load: notes, tool data (`.json`, `.md`, `.py`), `project.godot` itself;
- a file whose `.import` says `importer="skip"`.

## References

- `hard`: each `[ext_resource]` of a scene or resource; a GDScript's `preload("res://…")` and `extends "res://…"`; a shader's `#include`.
- `soft`: a GDScript's `load("res://…")`, loaded on demand; any other whole `res://` or `uid://` path in one of its strings; and a path a constant builds from other constants of the same file (`const WALK := FOLDER + "walk.png"`, read with `lib/gdscript.mjs`, below). A path built at run time is not read.

## Reading a script's constants in a project plugin

`jam/engines/godot/lib/gdscript.mjs` in the installed adapter exports `scriptConstants(text)`. The result lists top-level declaration names in `names` and reads a case-sensitive name with `value(name)`. It accepts explicit type annotations and multiline expressions inside collections and calls.

Supported expressions include strings, decimal numbers, booleans, arrays, dictionaries, references to constants in the same script, `+ - * /`, and `a if FLAG else b` with a boolean condition. Arithmetic uses JavaScript numbers. A dictionary literal with `key: value` entries returns a `Map`. StringName literals such as `&"attack"` become strings, and numeric keys stay numeric. Vector2 and Vector2i with two numeric arguments return `[x, y]`. Rect2 and Rect2i with four numeric arguments return `[x, y, width, height]`. Rect2i truncates fractional arguments to integers. A `preload(path)` returns the path argument as a string. A missing name or an unsupported expression returns `null`, including when an entry of a collection cannot be resolved.

A catalog plugin can use the reader to get playback settings and media bindings from the scripts that declare them.

```ts
// From jam/catalog/<plugin>.ts
import { scriptConstants } from "../engines/godot/lib/gdscript.mjs"
const constants = scriptConstants(await context.files.readText("scripts/hero.gd"))
const frames = constants.value("WALK_FRAME_COUNT")
const sounds = constants.value("ATTACK_SOUNDS")
const release = sounds instanceof Map ? sounds.get("release") : undefined
```

A reference is resolved by its uid first, as Godot resolves it, so a stale path in an `[ext_resource]` still points at the right file. A `load` of a folder or a format string (`"res://units/%s.png"`) names no file and is left out. A reference to a file that is not content (a missing file, a `.json`) stays as its `res://` path; the catalog lists it under "Uses outside the project".

`jam engine references <id>...` answers from the same reading, for `res://` or `uid://` ids: each id's `uses` and its `referencers`.

## Files it cannot read

An entry is `unread`, with the reason, when:
- its `.import` says `valid=false`: Godot failed to import it; open the project in the editor to see why;
- its `.import` names no resource type: the editor has not imported it yet;
- it is a compressed binary resource (`RSCC`): save it as `.tres` or `.tscn`.

Done when the receipt's `unread` is 0, or each unread file is one of these and you know why.

## Speed

A second run reads only files whose size or modification time changed; the newest of the file, its `.import` and its `.uid` counts, so changing an import setting reads the file again. The rest come from the previous inventory. `--full` reads everything again. A project of 2,400 files reads in about a second.

## Not covered

- Property values of resources (`fields`), such as an item's damage in its `.tres`: the class and references are read, the values are not.
- References from C# code, from `project.godot` (autoloads, the main scene) and from strings built at run time.
- Sub-resources and nodes as assets of their own: each file is one asset.

To verify which 2D textures a running scene assigns, a project fixture can preload the installed `lib/displayed-textures.gd`. Call `visit(scene, observe)` after a frame to receive textures from visible sprites, animated sprites, texture rectangles, polygon, mesh and particle nodes. `source_path(texture)` follows atlas textures to their source image. A project that generates textures can resolve its own provenance in the callback. A sample covers only the scene states exercised. Shader uniforms, custom drawing and offscreen culling require separate evidence.
