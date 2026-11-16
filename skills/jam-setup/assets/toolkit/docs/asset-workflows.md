# Budgets, topology, UVs and baking: research notes

Engine-neutral background for choosing a budget and for the topology, UV and texture steps. Researched 2026-11-10 from first-party sources, listed per section. Nothing here was verified on target hardware. An engine's own limits and import behaviour are in its adapter's guides (`jam engine docs <topic>`); a provider's limits are in `docs/providers/<id>.md`.

## Budgets

No first-party source gives a universal per-asset triangle count. The figures that are published bound a whole view, a whole application or a tool:

| Source | Figure | What it bounds |
| --- | --- | --- |
| Khronos 3D Commerce guidelines 1.0 | 150k triangles and textures up to 2K (mobile AR, web), 250k (desktop web), 30k and 512 px (banner), 40k and 1K (planner) | One published commerce item per view. Not a game budget |
| Engine vendors' performance pages | Per-view or per-scene ceilings and draw-call counts | The whole scene on a named device class |
| Generation providers | Caps on face counts per operation | Which route can produce the mesh, not what the game can afford |

Derive a budget from four things: the platform's ceiling for a whole view; how many of the asset are on screen at once; how much of the screen it covers at the gameplay camera distance; whether it deforms. Then measure four numbers on the result: triangles after export, vertices after engine import (UV seams and hard edges split vertices), material or draw count, and texture memory. A web or mobile target budgets texture memory as carefully as triangles.

**Starting points to put to a person**, not sourced limits. Each assumes one material, one UV set and an asset that is not alone on screen.

| Look and platform | Small prop | Hero prop or character | Textures per asset |
| --- | --- | --- | --- |
| Faceted low-poly, any platform | 50 to 800 triangles | 300 to 3k | Palette or gradient 64 to 256 px, or vertex colour |
| Web or mobile, third-person | 200 to 3k | 3k to 15k, one skinned mesh | 512 to 1K; 2K for a hero only |
| Stylized desktop, third-person | 1k to 10k | 10k to 40k | 1K to 2K |

For a top-tier hero character there is no general number: set it from frame budgets measured on the target hardware.

Sources: [Khronos 3DC guidelines 1.0, Publishing Targets](https://github.com/KhronosGroup/3DC-Asset-Creation/blob/main/asset-creation-guidelines-1.0/full-version/sec99_PublishingTargets/PublishingTargets.md).

## Topology

- GPUs draw triangles, and a quad counts as two.
- glTF stores triangles only. Editable quad topology lives in the DCC file or an FBX beside the GLB.
- Khronos recommends an editable, quad-based base asset; real-time variants derived from it may be irregular triangle meshes.
- Some automated unwrap and conversion operations triangulate their input.
- For deforming assets, no source consulted guarantees usable edge loops from an automated route. A provider's "animation-ready" label is not deformation evidence; posed renders or playback are.
- A static rigid asset needs well-behaved triangles. Quads help deformation and subdivision only when the edge flow supports them, and decimation does not create that flow.

## UVs

- Hide seams at natural breaks.
- Keep texel density consistent. Packing tools help; island orientation is the artist's call.
- Overlap only on purpose (mirrors, stacks). Before baking, move duplicates exactly one UV unit outside 0 to 1, because bakers sample only that square.
- For tiling materials, one UV unit is one meter (glTF).
- Margin pixels around islands prevent bleeding under filtering and mip-mapping.
- "Has UVs" proves a channel exists, not that the layout is clean.

## Baking

- Bake from the detailed source to the final mesh with a cage, or with extrusion and a maximum ray distance. A cage shares the low-poly mesh's topology and face order and has no hard splits.
- Bake tangent-space normals for anything that deforms.
- Test thin surfaces that sit close together for rays hitting the wrong one.

## Channels, colour and axes

- glTF: base colour and emissive are sRGB; normal, occlusion and metallic-roughness are linear. Roughness is packed in green and metallic in blue. Normals are +X right, +Y up.
- Engines differ on the normal map's green channel and on packed-map order: `jam engine facts textures`. Record the convention of every normal map you deliver.
- glTF is right-handed, +Y up, front toward +Z, in meters. An engine may differ: `jam engine facts`. Deliver in glTF conventions; conversion belongs to the adapter's import.

Sources: [glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html), Khronos 3DC 1.0 [Geometry](https://github.com/KhronosGroup/3DC-Asset-Creation/blob/main/asset-creation-guidelines-1.0/full-version/sec03_Geometry/Geometry.md), [UV Coordinates](https://github.com/KhronosGroup/3DC-Asset-Creation/blob/main/asset-creation-guidelines-1.0/full-version/sec04_UVCoordinates/UVCoordinates.md), [Materials](https://github.com/KhronosGroup/3DC-Asset-Creation/blob/main/asset-creation-guidelines-1.0/full-version/sec05_MaterialsAndTextures/MaterialsAndTextures.md), [Blender manual: Render Baking](https://docs.blender.org/manual/en/latest/render/cycles/baking.html).
