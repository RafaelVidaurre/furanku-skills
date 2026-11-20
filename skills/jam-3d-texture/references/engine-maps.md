# Maps for an engine

The delivered GLB keeps glTF's conventions, and an engine adapter's import converts what its engine needs. Read this when an import takes loose texture files, or a person asks for a packed map or a converted normal map.

1. **Read the facts:** `jam engine facts textures` prints `packed` (the channel layout of the combined mask map, such as `ORM`) and `normalGreen` (`up` or `down`). With no adapter there are none, and glTF's apply: `ORM` and `up`.
2. **Get the maps as files.** A bake wrote them beside the GLB. For any other GLB: `jam python <S>/texture_report.py <model.glb> --out <work>/texture-report.json --extract <work>/maps`.
3. **Pack:** `jam python <S>/pack_maps.py pack <work>/engine/<name>_<packing>.png --packing <packed> --gltf <the GLB's metallic-roughness or ORM map>`. The packing word names each channel in R G B (A) order: `O` or `A` occlusion, `R` roughness, `M` metallic, `S` smoothness (1 - roughness), `H` height, `0` black, `1` white. Separate grey maps or constants go in with `--roughness`, `--metallic`, `--occlusion`, `--height`. The printed line says what each channel came from: done when it matches the engine's layout.
4. **Normal map:** when `normalGreen` is `down`, `jam python <S>/pack_maps.py normal <normal.png> <work>/engine/<name>_normal.png --from up --to down`. Done when the printed line says `greenInverted: true` once; converting twice returns the original.
5. **Hand the files to the import** (`jam engine import --kind textures ...`, or the adapter's guide: `jam engine docs import`). Naming and compression settings are the adapter's.

Base colour is sRGB; packed masks and normal maps are data (linear). An engine that imports them as colour shows washed-out roughness.
