# Troubleshooting a rig

Read `rig-report.json` first: `warnings`, `landmarks.findings`, `regions.counts`, `weights` and `deformationCheck.regions` usually name the cause. Each entry below is a symptom, why it happens, and what to change. Change the input (mesh or landmarks) before changing a threshold.

## The bind stops

| Message | Cause | Do |
| --- | --- | --- |
| `the landmarks do not fit this mesh` with `outside the mesh's bounding box` | The landmarks were taken on the model at another size or place (a rigging service returns it at the height it was told; a remesh comes back normalised) | Bind with `--height-meters <height the landmarks were taken at>`. When the pose or the model differs, get landmarks for this mesh |
| `no vertices found for <region>` | A limb's joints sit where the mesh has no surface: wrong mesh, wrong `up`, or a limb the mesh lacks | Check the file's `up` and which mesh it came from; `--poses rest` on an earlier bind shows the mesh's pose |
| `left joints are not on +X` | The model faces backward, or the bone-name table swaps sides | Turn the model to face front (`+Z` in glTF), or fix the table |
| `deformation check failed` for `upper-leg.*` | A garment hangs across both legs (skirt, apron, long coat): its surface lies in the thigh regions but rightly follows the pelvis and both legs | See "Garments across both legs" below |
| `deformation check failed` for an arm or hand | The arm lies against the body in the bind pose, or its landmarks are off, so its surface was read as trunk | Model or generate the character with arms away from the body; check `shoulder`, `upper-arm`, `lower-arm`, `hand` in the landmark file |
| `deformation check failed` for `head` | The `head` landmark sits high in the skull, so most of the head is below it and blends into the neck | Put `head` at the base of the skull, level with the jaw |

## It binds, but the poses look wrong

| In the stills | Cause | Do |
| --- | --- | --- |
| A limb bends beside its joint; an elbow or knee collapses to a point | The landmark is off the joint (auto-rigs put knees and ankles a few centimetres forward of the limb's middle) | Move that landmark to the centre of the limb where it bends; rebind |
| Face, beard or hat brim stays behind when the head turns | `head` too high (those parts fall below it), or a part reaching far from the head below the head joint | Lower `head` to jaw level |
| The torso is dragged by a raised arm | Arms close to the body in the bind pose: the surface between arm and ribs is one patch to the solver | Model or generate the character with arms 40 degrees or more from the body |
| One leg pulls the other, or a hand pulls the thigh it hangs beside | Should not happen: region limits remove those weights (`weights.removedByRegion`). When it does, the regions are wrong | Check `regions.counts` for a limb with too few vertices, then the landmarks of that limb |
| Fingers stick together, tear or crumple when curled | The mesh joins neighbouring fingers (generated hands often share faces between fingers). The report warns with `edgesBetweenFingers` | Separate the fingers on the mesh, or bind with `--fingers none` so each hand moves as one piece. For generated characters, references with relaxed, slightly spread fingers, each view generated at full resolution, give separable hands; views cut from one low-resolution sheet gave mitten hands |
| A crack opens between two objects (head and body, body and clothes) | Their border vertices do not coincide, so each side got its own weights. Coincident vertices always get identical weights (`weights.seamGroups`) | Make the borders share vertex positions, or join and weld the objects |
| A sharp step in the surface at the waist, shoulder or hip | Weights cut at a region border. They blend over 3% of the height (`weights.blendBandM`) | Report it with the mesh; a threshold will not fix it |
| Long hair, a cape, a tail or a skirt moves stiffly with the nearest body part | They have no bones of their own; this skill binds a humanoid body | Give them their own bones or simulation in the DCC or engine |

`pose-manifest.json` gives two numbers per pose: `maxEdgeStretch` and `edgesStretchedPastDouble`. A few stretched edges in the armpits and groin in `arms-raised` and `knee-bend` are what skinning does; hundreds elsewhere, or any in `elbows-bent`, point at a joint or weight problem in that limb.

## Garments across both legs

Each thigh's vertices may only follow that leg and the pelvis, which is what keeps trousers from bleeding between legs. A skirt, apron or long coat is one surface over both thighs and legitimately follows the pelvis and both legs, so its share on "its own" thigh bones is low and the check fails or nearly fails for `upper-leg.l` and `upper-leg.r` (on one aproned character the right thigh had mean own weight 0.54 with 26% stray, against limits of 0.5 and 25%).

Decide which the game needs:

- The garment may bend with the legs: rebind with `--max-stray-share 0.35`, then judge `knee-bend` and a walk in the stills yourself. The centre of the garment creases where the two legs' weights meet.
- The garment must hang or swing: split it from the body, bind the body alone, and give the garment its own bones or cloth simulation.

Record which you chose and why in the step's note; a raised threshold with no reason is a skipped check.

## The mesh itself

| Sign | Cause | Do |
| --- | --- | --- |
| `weights.method` is `heat-on-proxy` on a single object, or `distance` with a warning | Blender's heat solver gave up on the mesh: non-manifold edges, interior faces, intersecting shells or holes | For `heat-on-proxy` nothing: the weights came from a welded voxel stand-in. For `distance` (cruder at joints), repair the mesh: merge vertices by distance, delete interior faces, close holes |
| `mesh.verticesWelded` is large | Normal for a glTF file, which stores a vertex once per UV and normal; the bind welds them so weights are continuous across UV seams | Nothing |
| A remesh of the model came back with open edges along UV seams | A textured upload was split along its seams before remeshing | Upload the welded, geometry-only mesh for remeshing, then bring colour back by baking |
| Textures land scrambled in a viewer or engine | The mesh carries more than one UV set and the textured one is not first; glTF maps textures through the first set | Remove the other UV sets before binding |
| `a vertex follows N bones; the limit is M` | The budget's influence limit is lower than the default 4 | Bind with `--max-influences <budget value>` |
| The character is the wrong size or lies down after import | The skinned file is in glTF conventions (metres, +Y up, front +Z); converting to an engine's units and axes is the engine import's job | Import through the engine adapter (`jam-engine`) |
