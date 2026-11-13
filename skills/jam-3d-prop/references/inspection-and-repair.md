# Design rules, inspection and repair

Image-to-3D generators turn every line in the input images into geometry or texture. Most prop flaws are planted in the concept or turnaround and only show up in the mesh, so the cheapest fix is almost always upstream.

## Design rules

Write these into concept and turnaround prompts, and check images against them:

- **One-piece surfaces.** Describe tops, seats, lids, panels and cushions as "one smooth continuous piece". Plank seams, segmented rims and joint lines become carved grooves; a segmented rim on a round table top came back as a ring of boards.
- **Consistent details across views.** A detail drawn in one view (board ends on a rim, a seam on a leg) and absent in another is resolved by the generator into something nobody asked for.
- **Plain construction.** No nails, studs, rivets, carvings or tufting unless the design needs them; no objects resting on the prop.
- **Identical symmetric parts.** Both ends of a rail, all legs and all hoops match.
- **Real boards only where boards exist.** Barrel staves are correct as straight vertical seams of equal width, aligned above and below every hoop; offsets between sections become spirals.
- **Set colour.** Match the material colour of the set's accepted concept.

## Inspection

Look at textured (`scripts/render.py`), clay (`scripts/clay.py`) and behind and below (`scripts/back.py`) renders. To see how the texture maps, dump the UV layout with `scripts/uv_layout.py` and draw it over the base colour with `scripts/uv_overlay.py`. A flaw a player could see in normal play needs fixing; record the minor ones you accept and why.

| Flaw | Where it shows | Usual cause |
| --- | --- | --- |
| Carved grooves, rings, notches | Clay render | Seams or segmented edges in the inputs |
| Warped or creased surfaces | Clay, side views | Ambiguous depth in the inputs |
| Open backs, missing faces, gaps | Behind view, close-ups | Surfaces no input view showed |
| Grey or ghostly patches | Textured corners and backs | Texture sampled the background where no view covered the surface |
| Painted shapes contradicting the geometry | Textured flat panels | Retexture inventing detail |
| Blurry or smeared texture | Textured close-up compared with accepted props | Retexture instead of the original bake |
| Shiny or metal smears on wood | Textured, near metal parts | Metallic map bleeding |
| Wrong proportions | Bounds, scene test | Generator normalises proportions |
| Faces pointing inward | Holes in single-sided renders | Generator normals |

## Repair

Choose the cheapest fix that removes the flaw, then re-inspect:

1. **Fix the inputs and regenerate** when the flaw is planted in the concept or turnaround and is large. Image edits on a plan-included route cost no credits; a mesh cost about 120 CU (observed 2026-11).
2. **Repair geometry in Blender** by replacing the bad part with a clean primitive of the same size (a warped round table top was replaced by a bevelled disc), adding missing panels, or scaling one axis to fix proportions. Fix proportions before texturing so the texture is not stretched.
3. **Retexture** (Meshy 7 Retexture, about 40 CU, `enableOriginalUv false` after geometry changes, multiview images that show every surface the mesh has) for texture-only flaws. Its result is softer than the original generation texture.
4. **Bake the original texture onto the repaired mesh** (free, sharpest): new UV atlas, bake base colour, metallic, roughness and normal from the provider's original mesh and maps, fill surfaces the original never had with a swatch sampled from a clean flat area of the same material, keep metallic only on metal-coloured pixels, flip inward faces outward and delete faces nothing can see.

Keep every intermediate and script under the delivery's `source/edit/` and describe each step in `provenance.md`.
