---
name: jam-retopo
description: Reduce, remesh or rebuild a mesh's topology to its budget while preserving silhouette, material boundaries and intended deformation, then measure and record it. Use when the user asks to retopologize, decimate, remesh or reduce the triangle count of an asset, or to qualify an existing mesh's topology.
---

# Topology

When `tools/jam/jam.mjs` is missing from the project, use the `jam-setup` skill first (when it is not installed: `npx skills add rafaelvidaurre/furanku-skills --skill jam-setup`). Read `tools/jam/docs/contracts.md`.

1. **Choose the operation.** Inspect the source and target profile, then choose reduction, remeshing, manual retopology or keeping the existing topology. Use the selected provider or DCC tool; `tools/jam/docs/providers.md` covers Meshy and Scenario. With Blender, discover the installed MCP operations and API documentation before relying on an operator. Static rigid assets may need only well-behaved triangles; quad-dominant topology helps deformation and subdivision only when its edge flow supports them. Decimation does not make animation topology. Done when the operation and its reason are recorded.
2. **Make a candidate.** Work on a new candidate and keep the source mesh and its appearance for rebaking. Done when the candidate is exported.
3. **Compare.** Compare candidate and source at the game camera and up close: silhouette, thin features, openings, connected components, shading, normals, material boundaries and intended hard edges. Judge non-manifold and boundary edges in context; an intentionally open garment is not broken. Deforming assets also need joint and face loops and representative pose tests. Done when every listed property has been checked.
4. **Measure and record.** Measure the exported candidate (`node tools/jam/jam.mjs measure --file <file.glb>`), counting triangles after modifiers. Register `topology` with triangles, materials and diagnostic findings with before and after evidence (also when verifying unchanged geometry), and review through `tools/jam/docs/review.md`. A topology change sends UVs and appearance back through `jam-uv` and `jam-texture`.

**Done:** form and topology meet the profile, measurements pass and the candidate is accepted. When automation cannot keep the required form or edge flow, stop with the specific manual work needed.
