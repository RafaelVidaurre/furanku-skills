---
name: jam-concept
description: Create reviewable concept images for a named game asset in the project's art style. Use when the user asks for a concept, design options or alternatives for an asset, or when the jam 3D workflow needs an accepted design before its turnaround.
---

# Concept design

When `tools/jam/jam.mjs` is missing from the project, use the `jam-setup` skill first (when it is not installed: `npx skills add rafaelvidaurre/furanku-skills --skill jam-setup`). Follow `tools/jam/docs/task-intent.md` across the conversation. Concept work needs no triangle or texture profile: use a style-bound `node tools/jam/jam.mjs init` without `--profile` while those geometry decisions are open.

1. **Brief.** For production concepts, read `tools/jam/docs/contracts.md` and the selected style guide. Derive purpose, silhouette, key materials, distinguishing features and intended camera from the user's words and images; ask only for missing details that change the design. For style exploration, use `jam-style`'s visual loop instead: it needs no approved style or profile, and its outputs stay outside production runs. Done when the brief names each of those properties or the user's reason for leaving one open.
2. **Route.** Complete image-route discovery (`tools/jam/docs/images.md#discover-and-offer-usable-routes`) and use the user's chosen route. Done when a route is chosen.
3. **Generate.** Keep the brief's identity and established visual choices while exploring meaningful alternatives. Keep reference roles explicit; production concepts inherit the approved game style. Done when the requested candidates exist as files.
4. **Inspect.** Look at each image, including at game-camera scale: silhouette, construction, material separation, and hidden-side decisions that still need resolving. A concept serves 2D or 3D; leave the turnaround layout to `jam-turnaround`. Done when every candidate has been judged against the brief.
5. **Record and review.** Register production or paid candidates as `concept` with original images, prompt and settings provenance and visual evidence; native previews may stay outside a run until admitted under the image-route custody rules. Choose or revise through `tools/jam/docs/review.md` under the configured policy.

**Done:** the selected design is accepted for its recorded brief and style, or a specific visual decision is pending. Exploratory preference stays separate from production acceptance, and rejected candidates stay distinguishable from the selection.
