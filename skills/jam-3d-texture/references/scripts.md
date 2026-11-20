# jam-3d-texture scripts

Every script takes explicit arguments, writes only inside the output folder or file it is given, prints one summary line, and exits 0 on success, 1 when its own check fails (the files are still written), 2 on wrong input. Blender scripts were written for Blender 4.3 and newer and validated on 5.1.

| Script | Run with | Command line | Writes |
| --- | --- | --- | --- |
| `texture_report.py` | `jam python` | `<model.glb> --out <report.json> [--max-texture-size N] [--max-texture-mib F] [--max-materials N] [--expect basecolor,normal,metallic-roughness,occlusion,emissive] [--extract <dir>] [--allow <check>=<reason> ...]` | The report; with `--extract`, the embedded images as files |
| `pack_maps.py pack` | `jam python` | `<out.png> [--packing ORM] [--occlusion <png\|0-1>] [--roughness <png\|0-1>] [--metallic <png\|0-1>] [--height <png\|0-1>] [--gltf <png>] [--size N]` | The packed map |
| `pack_maps.py normal` | `jam python` | `<in.png> <out.png> --from up\|down --to up\|down` | The converted normal map |
| `resize_textures.py` | `jam python` | `<in.glb> <out.glb> --max-size N [--keep-unused] [--jpeg-quality 90]` | The GLB with bounded textures; geometry untouched |
| `compare_reference.py` | `jam python` | `<out.png> --pair <view>=<still.png>,<reference.png> [--pair ...] [--height 512]` | One image, a still beside its reference per row |
| `blender/bake_textures.py` | `jam blender` | `<target> <out-dir> --source <model> --size N [--normal-source <model>] [--maps basecolor,normal,roughness,metallic] [--name <stem>] [--reach F] [--margin-px 16] [--min-hit-share 0.98] [--samples 2]` | `<stem>.glb`, `<stem>_basecolor.png`, `<stem>_normal.png`, `<stem>_orm.png`, `bake-report.json` |
| `blender/transfer_color.py` | `jam blender` | `<target> <source> <out-dir> --size N [--name <stem>] [--no-align] [--reach F] [--margin-px 16] [--min-hit-share 0.98]` | `<stem>.glb`, `<stem>_basecolor.png`, `transfer-report.json` |
| `blender/render_textured.py` | `jam blender` | `<model> <out-dir> [--label <text>] [--modes lit,unlit] [--views ...] [--focus NAME=X,Y,Z,SIZE ...] [--resolution N]` | `<label>-<mode>-<view>.png`, `<label>-<mode>-sheet.png` |
| `blender/make_fixtures.py` | `jam blender` | `<out-dir>` | The generated models the tests use |

`blender/bakecore.py` holds the baking code the two bake scripts share. `texture_report.py`, `pack_maps.py`, `resize_textures.py` and `compare_reference.py` need Python with numpy and Pillow, no DCC, and work on files from any tool.

## Reading the texture report

`textureMiB` assumes uncompressed RGBA8 with a full mip chain for every embedded image: the basis `jam measure` uses, so the two agree (three 1024 maps are 16 MiB, three 2048 maps 64). An engine's compressed formats take less; budgets are compared on this basis.

| Check | Fails when |
| --- | --- |
| `readable-images` | An image is external or cannot be decoded |
| `texture-size` | An image is larger than `--max-texture-size` on either side |
| `texture-memory` | The estimate is over `--max-texture-mib` |
| `materials` | More materials are drawn than `--max-materials` |
| `expected-maps` | A material lacks a map named in `--expect` |
| `unused-images` | An image is embedded that no material reads (it still counts toward memory) |
| `duplicate-images` | Two embedded images are byte-identical |
| `first-uv-set` | A texture reads a UV set other than the first |

`materialList` gives, per material, which maps it has, its plain values, and whether occlusion shares the metallic-roughness image.

## Stills

Views are `front`, `back`, `left`, `right`, `three-quarter`, `back-three-quarter`, `top`, `under`. `lit` renders with an even grey sky and one soft sun; `unlit` shows base colour only. `--focus NAME=X,Y,Z,SIZE` adds a close-up: X across the width, Y up from the base and Z back from the front, each as a share of the bounding box, and SIZE as a share of the height. Use `--views under,back-three-quarter` for surfaces a camera rarely sees.

## Tests

`python3 -m pytest skills/jam-3d-texture/scripts -q` runs the report, packing and resizing anywhere, and the Blender scripts on generated models when Blender is found (`BLENDER=<binary>`, or `blender` on PATH); without it those tests are skipped with a message saying so.
