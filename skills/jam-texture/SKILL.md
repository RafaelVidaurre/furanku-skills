---
name: jam-texture
description: Create, keep, bake or retexture an asset's textures and material appearance on its final mesh and UVs, with map records and seam inspection. Use when the user asks to texture, bake, retexture or repaint an asset, or to check its maps, material or seams.
---

# Textures and materials

When `tools/jam/jam.mjs` is missing from the project, use the `jam-setup` skill first (when it is not installed: `npx skills add rafaelvidaurre/furanku-skills --skill jam-setup`). Read `tools/jam/docs/contracts.md`, the accepted design and the final topology and UV evidence.

1. **Choose the workflow.** Keep existing good textures, bake source appearance, paint locally or use a provider's retexture operation (remote work through `tools/jam/docs/providers.md`). Approved art is repainted only by deliberate choice. Done when the workflow and its reason are recorded.
2. **Produce the maps.** For baking, keep the high-detail source, align it with the final mesh, inspect cage and ray distances, and test thin nearby surfaces for cross-projection. For retexturing, verify whether the operation keeps the original UVs and geometry, and whether image inputs override text. A needed geometry or UV change goes back to `jam-retopo` or `jam-uv`. Match the style's painted or PBR treatment; add PBR maps only where the style uses them. Done when every map is on disk.
3. **Describe the material.** Record each map's meaning, dimensions, UV set, colour space and packing: colour maps normally sRGB; normal, roughness, metallic and occlusion as data. Record tangent-normal handedness and green-channel conversion for the destination renderer. Fix gamma at its source rather than tuning it to hide errors. Done when every map has those fields.
4. **Inspect.** View lit, unlit or base-colour and checker renders, at the game camera and close enough to see seams, bleed and missed bake rays. Verify mip gutters, transparency, channel packing and material count. Measure the actual downloaded map sizes (`node tools/jam/jam.mjs measure --file <file>`); a requested resolution is not proof. Done when each check has a finding.
5. **Record and review.** Register `texture` with final maps, material description, mesh identity and evidence, and review through `tools/jam/docs/review.md`.

**Done:** the actual appearance meets the style and profile and is accepted; missing maps, seam defects or native renderer differences are stated explicitly.
