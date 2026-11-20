# Landmark maps

A landmark map names, for one skeleton, the bone that stands at each landmark. `retarget.py` reads one for the source and one for the target, each as a file path.

## The format

```json
{
  "label": "what naming this covers",
  "notes": "anything a person should know",
  "landmarks": { "Hips": "hips", "LeftArm": "upper-arm.l", "LeftForeArm": "lower-arm.l" }
}
```

Keys are bone names exactly as the glTF file names its nodes; values are landmarks. Two other shapes are read as maps: a provider descriptor (its `rig.landmarks`, the same table) and a skeleton profile (its `bones`, landmark to bone name, read the other way). Several bone names may map to one landmark as alternative spellings, as long as a single file has only one of them.

## Where maps come from

| The skeleton is | Use |
| --- | --- |
| A rig made by a rigging skill or tool that ships maps for its namings | That map file, by path. A rig bound with one bone per landmark, named by the landmark, needs a map whose keys and values are the same names |
| A provider's output skeleton | The provider descriptor itself, or a map file saved from its `rig.landmarks` |
| A rig built on a skeleton profile | The profile file |
| Anything else | A map you write (below) |

### Writing one

Run `retarget.py` once with `"landmarks": {}` for that side: the error lists every bone of the file that the map does not name. Map each bone that stands at a landmark; leave out twist, roll, helper, attachment and end bones and extra spine joints (they keep their rest transform on a target, and their motion is not carried from a source). Name sides by the character's own left and right, whatever the bone names say: the run refuses a map whose left joints are not on `+X`.

## The vocabulary

Sided landmarks end in `.l` or `.r`.

| Landmark | Where it sits | Next on its chain |
| --- | --- | --- |
| `hips` | Centre of the pelvis; the bone that carries travel | `spine` |
| `spine` | Lowest spine joint, at the top of the pelvis | `chest` |
| `chest` | Top of the spine, where the neck and collarbones attach | `neck` |
| `neck` | Base of the neck | `head` |
| `head` | Base of the skull | (end) |
| `shoulder` | Inner end of the collarbone | `upper-arm` |
| `upper-arm`, `lower-arm`, `hand` | Shoulder joint, elbow, wrist | `lower-arm`, `hand`, `middle-1` |
| `upper-leg`, `lower-leg`, `foot`, `toes` | Hip joint, knee, ankle, ball of the foot | `lower-leg`, `foot`, `toes`, (end) |
| `thumb-1..3`, `index-1..3`, `middle-1..3`, `ring-1..3`, `pinky-1..3` | The three joints of each finger, from the knuckle (the thumb from its base in the palm) | the next joint, (end) after `-3` |

Required on both maps: `hips`, `head`, and on both sides `upper-arm`, `lower-arm`, `hand`, `upper-leg`, `lower-leg`, `foot`. Everything else is optional; a landmark only one map places is listed in the report (`targetOnlyKeptAtRest` or `sourceOnlyNotCarried`).

The two skeletons need not have the same bones: a target with three spine bones takes the source's `spine` and `chest` on the two it maps, and its middle one keeps its rest; a target with fingers takes a fingerless source's clips with its fingers at rest.
