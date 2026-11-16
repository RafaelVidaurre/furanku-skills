# Landmarks

A **landmark** is a named joint position of one humanoid mesh. The landmark file is the only thing rigging reads about where a character's joints are, whatever placed them.

## The file

```json
{
  "units": "meters",
  "up": "+Y",
  "landmarks": { "hips": [0.0, 0.96, -0.02], "upper-arm.l": [0.17, 1.31, -0.03] },
  "source": "skeleton of rigged.glb through left-right-camelcase.json"
}
```

- Positions are metres in the mesh's own space, at the size and place the mesh has when it is bound.
- `up` is `+Y` (glTF's frame, the character faces `+Z`) or `+Z` (the character faces `-Y`). In both, `+X` is the character's own left.
- `source` says what placed the joints. No other keys are allowed; the schema is `tools/jam/schemas/landmarks.schema.json`.

## The vocabulary

Sided landmarks end in `.l` or `.r`: the character's own left and right.

| Landmark | Where it sits | Hangs from |
| --- | --- | --- |
| `hips` | Centre of the pelvis, a little above the line between the hip joints | (root) |
| `spine` | Lowest joint of the spine, at the top of the pelvis | `hips` |
| `chest` | Top of the spine, where the neck and the collarbones attach | `spine` |
| `neck` | Base of the neck | `chest` |
| `head` | Base of the skull, about level with the jaw | `neck` |
| `shoulder` | Inner end of the collarbone, near the midline at arm height | `chest` |
| `upper-arm` | Shoulder joint | `shoulder` |
| `lower-arm` | Elbow | `upper-arm` |
| `hand` | Wrist | `lower-arm` |
| `upper-leg` | Hip joint | `hips` |
| `lower-leg` | Knee | `upper-leg` |
| `foot` | Ankle | `lower-leg` |
| `toes` | Ball of the foot | `foot` |
| `thumb-1`, `index-1`, `middle-1`, `ring-1`, `pinky-1` (optional) | First joint of the finger: the knuckle; for the thumb, its base inside the palm | `hand` |
| `…-2`, `…-3` (optional) | Middle and last joint of that finger | the joint before |

The 21 body landmarks are required. Fingers are optional, one finger at a time: a finger counts when all three of its joints are present.

Two placements decide more than their size suggests:

- **`head`** splits the head from the neck. Everything of the head above it by 2% of the height follows the head bone rigidly; below it, weights blend into the neck. Put it at jaw level so the whole face is above it.
- **`spine`** splits the trunk: above it vertices may follow the arms and chest, below it the legs.

## Where landmarks come from

`<S>` is this skill's `scripts/` folder, `<A>` its `assets/` folder, `jam` is `node tools/jam/jam.mjs`.

| Source | How |
| --- | --- |
| A rigged file from an auto-rig service | `jam python <S>/landmarks_from_rig.py -- <rigged.glb> <landmarks.json> --map <table.json>`. The table maps the service's bone names to landmarks: one from `<A>/landmark-maps/` (each file's `label` and `notes` say which naming it covers), the provider descriptor when it carries `rig.landmarks`, or one you write (below). Only the joint positions are used; the service's weights are discarded. |
| The rig already on the mesh (a bought character, a rig to redo after the mesh changed) | The same command on that file. For a rig built on a skeleton profile, pass the profile as the table: `--map <profile file> [--profile-id <id>]`. For a rig `bind.py` built without a profile, `--map <A>/landmark-maps/landmark-names.json`. |
| A person, or an estimate made in a DCC | Place one empty or bone per landmark in the DCC, named by its landmark, on the mesh in its bind pose. Export a glTF file and run the same command with `--map <A>/landmark-maps/landmark-names.json`; a file without a skin gives its named nodes. For an estimate, put each joint at the centre of the limb's cross-section where it bends, then check it as below. |
| Anything else | Write the file directly in the format above. |

A rig with one spine bone or without collarbones has no joint for `spine`, `chest` or `shoulder`: `--derive` fills those three from the joints around them (shares of the hips-to-neck line measured on two auto-rigs) and says so in `source`. Nothing else is derived; a missing `toes` or wrist has to be placed.

### Writing a bone-name table

```json
{ "label": "what naming this covers", "landmarks": { "<bone name>": "<landmark>", "Hips": "hips" } }
```

Run the command once with an empty table (`"landmarks": {}`): its error names every bone of the rig. Map each bone that stands at a landmark and leave the others out (extra spine joints, end markers, twist bones). When every bone name carries the same prefix, keep the table bare and pass `--strip-prefix <prefix>`. Several bone names may map to one landmark as alternative spellings, as long as a single rig has only one of them.

## The mesh and the landmarks must share a space

A service that rigs a mesh often returns it at another size than the mesh you bind (a height it was told, a normalised remesh). Compare `heightMeters` in the command's output with the mesh you will bind. When they differ, bind with `--height-meters <the landmarks' height>`: the mesh is scaled to it and stood on the ground. The two must still be the same model in the same pose.

## Checking landmarks

`landmarks_from_rig.py` checks what it writes, and `bind.py` checks again against the mesh it binds. Errors stop the run; warnings are printed for you to judge.

| Finding | Level | Meaning |
| --- | --- | --- |
| `sides` | error | Left joints are not on `+X` of right ones: the model faces backward, or the table swaps left and right |
| `spine-order`, `leg-order`, `arm-order`, `finger-order` | error | Joints of a chain are out of order (hips to head must rise, hip-knee-ankle descend, arm and finger joints lead away from the body) |
| `zero-length` | error | Two neighbouring joints at one place |
| `outside-bounds` | error | A joint outside the mesh's bounding box: another mesh, or this one at another size or place |
| `upside-down` | error | Head below the feet: the wrong `up` |
| `asymmetric`, `off-centre`, `length` | warning | Left and right differ by more than 5% of the height, a centre joint is off the midline, or paired bones differ by over 20% in length. Expected for an asymmetric bind pose; otherwise one joint is misplaced |
| `facing` | warning | Toes behind the ankles: the model may face backward |
| `proportion` | warning | Hips, ankles or head joint at an unusual height for the mesh |
| `posed` | warning | The rigged file is not saved in its bind pose, so its joints may not sit in the mesh as stored |

`bind.py` adds two checks that need the surface: landmarks not enclosed by the mesh (a warning naming them), and regions with no vertices (an error: the landmarks do not fit).

Look as well as measure: `pose_evidence.py --poses rest` after a bind shows the mesh, and a joint in the wrong place shows at once in `elbows-bent` and `knee-bend` (the limb bends beside its joint instead of at it).
