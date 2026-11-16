# What the jam-texture scripts were run on

Run on 2026-11-16 with Blender 5.1.2 on macOS, Python 3 with numpy 2.4 and Pillow 11.3. Numbers are from those runs. "Viewed" means the stills were opened and judged, not only written.

## Models

| Name here | What it is |
| --- | --- |
| Character | A generated character: the dense textured source (663,014 triangles, 4096 maps) and a 20,878-triangle remesh of it, unwrapped by `jam-uv` at 2048, with its five-view turnaround |
| Prop | A generated prop: the dense untextured mesh (635,400 triangles), the provider's reduced textured mesh (5,075 triangles, three 2048 maps), and a local 3,000-triangle reduction unwrapped at 1024 |
| Bought bucket | A bought low-poly model: 976 triangles, 2 materials, six 2048 maps (128 MiB), unwrapped into one layout at 1024 |
| Bought chair | A bought low-poly model: 170 triangles, one flat-coloured material, unwrapped at 256 |

## Results

| Script | Run on | Result |
| --- | --- | --- |
| `bake_textures.py` | Character at 2048 from the dense textured source | 99.98% of texels found the source; base colour, normal and ORM maps; `jam measure`: 64 MiB, 1 material. Stills viewed lit and unlit, with face and hand close-ups: face, glasses, beard, clothes and shoes correct; a few pale specks on the hair beside the hat |
| `bake_textures.py` | Prop at 1024: colour from the reduced textured mesh, normals from the dense one (`--normal-source`) | 99.5% hit; 16 MiB. Stills viewed beside the provider's own model from the same views: the same look, slightly softer on the mop strands |
| `bake_textures.py` | Bought bucket onto its own new layout at 1024 | 100% hit; 2 materials and six 2048 maps became 1 material and three 1024 maps, 128 MiB to 16. Stills viewed lit and unlit, including from below: planks, rope hoops and metal handle correct, no seam or patch |
| `bake_textures.py` | Bought chair onto its own layout at 256 | 100% hit; roughness 1.0 and metallic 0 came out constant and became material values; base colour and a normal map written, 0.67 MiB. Stills viewed beside the bought model: no visible difference |
| `transfer_color.py` | The remesh as delivered (5% too large) from the dense textured source | Aligned by scale 0.95041; surfaces then at most 1.05% apart; 99.98% hit, through the remesh's own UVs |
| `render_textured.py` | Every result above, and the sources for comparison | Lit and unlit sheets viewed |
| `texture_report.py` | Every result, and the bought bucket as bought | Agrees with `jam measure` (16.0, 64.0, 0.667 and 128.0 MiB). The bought bucket fails `texture-size`, `texture-memory` and `materials` against a 1024, 24 MiB, 1-material budget; every baked result passes. `--extract` wrote the character's three maps |
| `resize_textures.py` | Bought bucket, 2048 to 1024 | Six maps resized, 128 MiB to 32, geometry and UVs unchanged, `jam measure` reads the result |
| `pack_maps.py` | The character's baked maps | `ORM` and `M00S` packed from the baked ORM map; a pixel checked in each; the normal map's green inverted once (128 to 127 at a flat texel) |
| `compare_reference.py` | Character stills against the turnaround's front, back and left | One image of three pairs, viewed: the model matches the turnaround in each view |

The toolkit's `normalize-model.py` was run on the baked prop (to 1.15 m, textures within 1024), the provider's reduced prop as delivered (the one-operation path: 2048 maps bounded to 1024) and the baked bucket (to 0.35 m, turned from -X, maps to 512, 4 MiB); `scene-test.py` stood the three with the baked chair beside a 1.8 m figure, with a camera, and the overview was viewed: every model stands on the floor at its stated height.

## What failed and was fixed

- The first bake took alpha as "this texel is covered" and counted the empty texture as missed (hit share 48%). Coverage now comes from a bake of the target alone.
- `texture_report.py` and the GLB reader failed on a material pointing at a texture the file lacks; found by a unit test.
- `resize_textures.py` could not drop an unused image that an unused texture still named; the texture now goes with it.

## Not validated

- The retexture route: no provider job was run.
- Occlusion is not baked: the ORM map's red channel is always 1.
- `--maps` with a subset, a rigged target, and `.fbx`, `.obj` or `.blend` inputs to the bake scripts.
- JPEG and WebP images through `resize_textures.py` (the real model and the test use PNG).
- Colour pulled from a neighbouring surface where layers lie closer than the ray reach was looked for in the character's close-ups and not seen; no model was made to provoke it.
- The tests (`test_texture_scripts.py`, 9 cases; `test_texture_blender.py`, 4 cases on generated models) pass on this machine only.
