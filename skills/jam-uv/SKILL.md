---
name: jam-uv
description: Inspect, keep or unwrap a mesh's UVs for its final topology and texture use, with checker and layout evidence. Use when the user asks to unwrap, lay out or fix UVs, check texel density, stretch or overlap, or qualify an existing UV layout.
---

# UV layout

When `tools/jam/jam.mjs` is missing from the project, use the `jam-setup` skill first (when it is not installed: `npx skills add rafaelvidaurre/furanku-skills --skill jam-setup`). Read `tools/jam/docs/contracts.md`.

1. **Decide what the material needs.** Start from accepted final topology, or an independently supplied mesh whose topology has been qualified. Determine whether the material uses unique texture baking, intentional mirrored or stacked islands, tiling, UDIMs or no UV-dependent maps. Keep an already satisfactory layout. Done when the UV policy (unique, mirrored, tiling, UDIM or none) is written down.
2. **Unwrap when needed.** Use DCC operations or a provider UV operation through `tools/jam/docs/providers.md`, checking its current face limit before spending. Place seams for material and silhouette needs; generic Smart UV rarely gives good paint density. Keep the new candidate separate from the source. Done when the candidate is exported.
3. **Inspect and measure.** Check a checker render and the UV layout for stretch, folds, accidental overlap, orientation, coverage, island fragmentation and texel density at actual object scale. Measure gutters for the target texture size and mip use. Tell authorized mirrors and stacks apart from overlaps that break unique baking; name UV sets and lightmap requirements separately. Done when every listed property has a finding.
4. **Record and review.** Register `uv` with the candidate mesh, layout and checker evidence, measurements and the overlap and gutter policy, and review through `tools/jam/docs/review.md`. An intentional no-UV material records that reason and its evidence. Changed UVs require rebaking or retexturing through `jam-texture`.

**Done:** the layout supports the chosen material and bake workflow, the mesh still matches its topology input, and the layout is accepted. A provider-created UV channel alone does not satisfy this check.
