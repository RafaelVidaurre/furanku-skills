# Previews

`jam engine previews` makes one viewable file per package for the catalog. It writes them to one machine-local folder, by default `.engine/previews` in the scratch root, beside `index.json`. The toolkit runs `jam engine inventory` first, so every package's version is current.

## What each class gets

| Class of the package's main asset | Preview | Made by |
| --- | --- | --- |
| `Texture2D` | The source image, PNG | The editor's PNG exporter; no rendering |
| `StaticMesh`, `SkeletalMesh` | Self-contained GLB, materials baked to 512 px textures | The editor's glTF exporter |
| `Material`, `MaterialInstanceConstant` | GLB of the editor's preview sphere with the material baked | The glTF exporter |
| `AnimSequence` | GLB of its preview mesh, with the animation | The glTF exporter |
| `Skeleton` | GLB of its preview mesh, or of a skeletal mesh built on it | The glTF exporter |
| Actor `Blueprint` | GLB of the actor's components, placed in a blank level | The glTF exporter |
| `SoundWave` | The source audio, WAV | The editor's WAV exporter |
| Anything else | The thumbnail the editor stored in the package, when it has one (JPEG or PNG) | Read from the file; no editor |

- **Stored thumbnails stand in.** An editor that showed an asset in the Content Browser and then saved it stores its thumbnail in the package. A package of the classes above gets that thumbnail when the editor is not run (`--no-engine`, `--limit`) or when its export fails. The next run with the editor replaces it. Packages saved by scripts or commandlets usually have none.
- **No preview** for data assets, sound cues, MetaSounds, physics assets, maps and the like, unless they store a thumbnail. Their receipt count is `none`.
- **Empty exports are refused.** A Blueprint that places no mesh, or an export the editor wrote without a mesh, is recorded as failed with the reason, not shown empty.

## When it runs again

- A preview is named by its package's version: the package's own `SavedHash` (UE5 1016+), its legacy GUID before that.
- A package whose version is unchanged keeps its preview. A failure is not retried for the same version.
- `--full` makes again everything it selects. `--only <pattern>` (project paths, `*` within a folder, `**` any depth) selects packages; the others keep their previews. `--limit <n>` caps the editor's work in one run; the rest count as `waiting`.
- Files in the folder that the index no longer names are deleted, so the folder holds one preview per package.

## The editor run

Everything except stored thumbnails goes to the editor through the transport ([transport.md](transport.md)), with a renderer: baking materials needs one. A `commandlet` transport starts `UnrealEditor-Cmd` without `-nullrhi`, with `-AllowCommandletRendering -RenderOffscreen` (`renderArgs` overrides that). The editor writes the files itself, so it must run on this machine: a commandlet, or a `command` bridge to a local editor.

- **Batches.** Packages go 200 to an editor process. Each process starts in 20–60 s.
- **A process that stops early** costs only the package it was on. That package is marked failed with the editor's last words, and the next process carries on after it. After three such stops in one run, the rest wait.
- **Shaders.** The first bake of a material compiles its shaders; the derived data cache keeps them, so later runs are much faster.
- **The last run's details**, every package with its time and any error, are in `<work>/previews-last-run.json`. The receipt's `editorSeconds` sums the editor's time by method.

## Measured

See [validation.md](validation.md#previews).

Done when the receipt's `failed` and `waiting` are what you expect, and `jam catalog run unit.get --input '{"id":"engine:<package id>"}'` shows the preview link.
