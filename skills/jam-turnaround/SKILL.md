---
name: jam-turnaround
description: Create and crop a consistent five-view turnaround (front, left, back, right, three-quarter) from an accepted concept, as input for 3D generation. Use when the user asks for a turnaround, orthographic views or a model sheet of an asset, or when the jam 3D workflow needs views before mesh generation.
---

# Five-view turnaround

When `tools/jam/jam.mjs` is missing from the project, use the `jam-setup` skill first (when it is not installed: `npx skills add rafaelvidaurre/furanku-skills --skill jam-setup`). Reuse the ongoing task's authorization (`tools/jam/docs/task-intent.md`). Triangle and texture budgets are not prerequisites here: without a profile, `init` without `--profile` binds the style and brief and keeps the normal review and ledger checks.

1. **Inputs and route.** Read `tools/jam/docs/contracts.md`, the accepted concept and the selected style. Complete image-route discovery (`tools/jam/docs/images.md#discover-and-offer-usable-routes`) and use the user's chosen route with the reference and editing capabilities it needs. Done when the route is chosen.
2. **Generate.** Request one sheet of the same object from front, subject's left, back, subject's right and three-quarter: orthographic cardinal views, consistent pose and scale, centred, equal canvas cells, flat uniform background, no text, labels, borders or watermarks. The three-quarter is a review view and may use mild perspective. Name the subject's asymmetric details so left and right are not mirrored inventions. Prefer a layout the model produces cleanly: one row of five, or two by three with the last cell empty, at a cell resolution the downstream provider can use. Done when a sheet exists whose views agree and stay inside their cells; otherwise regenerate or use an expressly chosen editing route.
3. **Crop.** Record exact pixel crop rectangles in `layout.json`, measured on the sheet, then run `python tools/jam/crop_turnaround.py <sheet> <layout.json> <new-output-directory>` with the configured Python (`python` in `jam.local.json`). Done when all five files show coherent geometry, the right view identity, centring, scale, a flat background and no text; equal file dimensions alone do not prove these.
4. **Record and review.** Register `turnaround` with the five named files, `crops.json`, the source sheet and the concept dependency, and route acceptance through `tools/jam/docs/review.md`.

**Done:** all five images meet the contract and are accepted. Keep the full five-view set even when the chosen 3D model takes fewer inputs.
