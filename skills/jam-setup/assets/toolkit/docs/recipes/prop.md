# Static prop recipe

Notes for each step of the `prop` recipe. `jam run next` points here; `jam recipe show prop` lists the steps.

Each step's skill says how the work is done; these notes say only what making a prop adds.

## concept

- **A set comes from one reference scene.** Props that stand together are designed from one image of the place with them in it at real scale, so their relative sizes and materials agree; a lineup of isolated props hides relative size. The first prop of a set fixes its material colours: get it accepted before making the rest, and attach its concept to later ones as a colour reference only.
- **Draw the prop alone**, on a plain light background, three-quarter from slightly above, whole and centred, with its real size in the brief.
- **Everything drawn becomes geometry.** Describe tops, seats, lids and panels as one continuous piece (plank seams and segmented rims come back as carved grooves); keep details the same in every view; leave out nails, studs and tufting the design does not need; make symmetric parts identical; put nothing on the prop.
- **Decide here how it will be built.** A boxy or turned prop (table, shelf, door, bottle, bowl, barrel, lamp) is modelled from primitives to this concept; only organic or intricate shapes (a carved chair, a plant, draped cloth) go to generation.

## turnaround

Draw only the views that differ, and record with `--symmetric` when a side is reused:

| Symmetry | Draw | Fill the rest by |
| --- | --- | --- |
| Rotational (barrel, round stool) or four-way (pedestal table) | front, three-quarter | reusing the front |
| Mirrored left to right (chair, counter) | front, one side, back, three-quarter | mirroring the side |
| None | all five | |

Orthographic views at the prop's mid height, on equal cells at one scale. A detail one view shows and another contradicts (board ends on a side that the top lacks) comes back as something nobody drew: fix it in the image.

## mesh

- **Modelled props** (decided at the concept): build the model as `jam-3d-retopo`'s procedural route describes and record it here with `--tool`; the topology step then keeps it.
- **Generated props:** ask for the budget's `triangles.target` (nearer `triangles.max` for thin parts), textures at or above `textureSize`, the origin at the bottom, and the unreduced mesh as well.
- **Inspect before accepting**, from stills: textured, untextured (`jam-3d-retopo`'s `render_wire.py --style clay` shows grooves, rings and dents a texture hides) and from behind and below (`jam-3d-texture`'s `render_textured.py --views back-three-quarter,under` shows open backs and patches no view covered).
- **Repair with the cheapest fix that removes the flaw:** correct the images and generate again when the flaw is drawn in them; replace a bad part with a clean primitive of the same size; retexture for a texture-only flaw; bake the original texture onto a repaired mesh (free, and sharper than a retexture).

## topology

Bring the model to delivery conventions in this step, before UVs and textures depend on it: its real height from the brief, standing on the origin, front facing the delivery's forward. `jam engine facts` gives the conventions (`authoring.<budget>` when the project sets a pivot or forward for this budget; otherwise glTF's: metres, +Y up, front +Z, with the pivot at the bottom centre so a prop placed at floor height stands on the floor).

```
jam blender --factory-startup toolkit:normalize-model.py -- <model> <work>/<id>.glb <work>/normalize-report.json --height <metres> --front-from <axis the front faces now> --max-texture-size <textureSize>
```

Find `--front-from` on a front still. Done when the report's `sizeAfterMeters` matches the brief and `lowestPoint` is at height 0.

**When the generated mesh is already within budget, unwrapped and textured,** that one command finishes topology, UVs and textures together. Make each step's evidence on its output (`jam-3d-retopo`, `jam-3d-uv` and `jam-3d-texture` say which), then record the three in one call:

```
jam run record <id> topology uv texture --file model=<work>/<id>.glb --evidence <topology report> --evidence <wire sheet> --evidence <uv report> --evidence <texture report> --evidence <textured sheet> --note "<what the generation gave and what was normalised>" --job <job> --accept "<what you checked>"
```

A generated layout usually fails the default padding and density thresholds of the UV report. Keep it when the textured stills show no seam at the distance the game's camera sees the prop, stating the thresholds it does meet (`--min-gap-px`, `--max-density-spread`) in the note; otherwise unwrap and bake locally as the separate steps below.

## uv

Only when the layout is redone: boxy props take `jam-3d-uv`'s projection route, organic ones the seams route. A prop made of parts in several materials is unwrapped into one shared layout, which is what brings it to one material.

## texture

Only when the surface is redone. Bake from the generated model (colour from its textured mesh, normals from the unreduced one). For a bought or modelled prop with several flat materials, bake the model onto its own new layout. Match the set: put the textured sheet beside the first accepted prop's before accepting.

## collision

Runs only when the engine adapter has an import command; `jam-engine` says how its engine takes collision shapes (`jam engine facts collision`). What a prop needs: simple shapes that cover what should stop a body or a hand (a table's top and legs, with the space underneath left open; a lamp's base, arm and shade), a handful of boxes or convex hulls, never the render mesh. Skip the step with the reason for a prop nothing touches: `jam run skip <id> collision --reason "..."`.

## import

`jam engine import --kind static --run <id>` imports the delivered model and records the step; without an adapter command the step is skipped and the run ends at the delivered files. Its check compares what the engine reports (size in metres, pivot, material slots) with the budget and the brief: a prop that is 100 times too large or lies on its side is a unit or axis mismatch between the file and the adapter's facts, fixed in the adapter, not in the model.

## delivery

Stand the prop with the set's delivered props beside a figure of the game's reference height, and look at one still:

```
jam blender --factory-startup toolkit:scene-test.py -- <work>/scene.json <work>/scene
```

`scene.json` lists the models with their places on the floor (`{"models": [{"file": "...", "x": 0, "z": 0, "turn": 0}], "figureHeight": 1.8}`), arranged as the reference scene arranges them; add the game's own camera as `"camera"` when it is known. Done when the prop's size is believable against the figure and its neighbours, nothing floats or sinks, and its materials belong to the set. A prop that is the wrong size goes back to the topology step's height.

Record delivery with that still and the three reports as evidence; a person accepts it.
