# The clip spec

`clip.json` says what one clip must be before any motion exists. Every route and the check read it. Its definition is the jam toolkit's schema, `tools/jam/schemas/animation-clip.schema.json` in a project with the toolkit; the template below is the same shape for a project without it, and `clip_spec.py` accepts exactly the specs the toolkit accepts.

## The clip file

A clip is a glTF 2.0 binary (`.glb`) holding the skinned project rig and exactly one animation, the clip itself. Its frame is glTF's: metres, `+Y` up, the character facing `+Z` with `+X` its left. Every channel is sampled on every whole frame of the spec's `fps`, from the clip's first frame to its last (a channel that holds one value throughout may carry fewer keys). Engines convert it in their adapter. A file holding several animations is a source to pick from (`--animation`), never a delivered clip.

## Where the numbers come from

Every value in the spec comes from the person, from the project's own files (the budget in `jam config show`, the engine adapter's facts, an earlier accepted clip of the same character), or from the rig itself; when none of them gives it, ask. This holds most for the thresholds in `accept` and the detection numbers in `contacts.detect`: the skill ships none. A threshold changes only when the person decides the project accepts more, and the spec is recorded again with that reason. When the person has no view on a field, say what it changes and let them choose.

## Ask, then write

| Field | Ask | What it changes |
| --- | --- | --- |
| `id`, `purpose` | What the clip is for, in one sentence: the action, and where it plays | The route, the key poses, how you judge the sheet |
| `rig.model`, `rig.map` | Which rigged `.glb` is the character, and its skeleton map: a landmark map (bone name → landmark), a provider descriptor's `rig.landmarks`, or a skeleton profile. A rig bound by the `jam-3d-rig` skill without a profile uses that skill's landmark-names map, one bound with a profile uses the profile; any other rig needs a map written as the `jam-3d-retarget` skill's maps reference describes | Everything is measured on this rig; clips on other skeletons are retargeted onto it |
| `fps` | The frame rate the project's clips use (any number above 0, such as 30 or 29.97) | Every key falls on a whole frame of it |
| `length` | Seconds as `{min, max}`: a range when any length in it will do, `min` equal to `max` for a fixed length | Checked against the delivered clip |
| `loop` | Does the clip repeat seamlessly? | Adds the loop-seam check and its threshold |
| `root` | `mode`: `in-place` (travel removed, the game moves the character) or `root-motion` (the clip moves it). For root motion, `bone`: the ground-level root bone that carries travel; leave it out when the rig has none and the hips carry travel | `root_convention.py` puts the travel there; the check reads the seam relative to it |
| `ground` | `kind`: `flat`, or `change` with a `description` of the height change the clip crosses (a stair, a ledge) | Penetration and travel at ground height are measured only on flat ground |
| `keyPoses` | The poses that must appear, each with a name (lowercase, hyphens) and a time, in time order, and the project path of the file step 2 writes them to. Ask for them when the motion has moments that matter (a contact, the peak of a jump, an impact) or the route needs them (`inbetween`) | Step 2 builds that file from them |
| `contacts.planted` | Which feet (or hands) must stay planted when | Slide is measured over each of these windows whatever the foot's speed, so a foot that must hold cannot slide unseen; outside them, a foot's fast travel near the ground is left to the person (check.md) |
| `contacts.detect` | How close to its resting height (metres) a foot is in contact, and how slow (m/s) it must be to count as planted | Which frames count toward slide |
| `accept` | The largest foot slide while planted, penetration below the ground, jump at the first or last frame or between two frames, and (when looping) loop seam that the project accepts, in metres | Pass or fail of the check |

### Choosing the numbers

Help the person choose by what each means on screen:

- `accept.footSlide`: how far a planted foot may drift during one contact; compare it with the character's foot length.
- `accept.penetration`: how far a sole may go below the ground before it shows; a camera that never sees the feet allows more.
- `accept.boundaryJump`: how far a joint may jump between two frames, at the start or end of a play and inside the clip. `accept.loopSeam`: the same across the wrap of a loop. The report gives how rough the clip's own smooth motion is (`boundary.smooth`), which helps when a first threshold turns out too tight.
- `contacts.detect.height`: how close to its resting height a foot point must be to count as planted; it must be above the noise of a planted foot. `contacts.detect.speed`: how slow it must be; above a planted foot's noise and below a swinging foot's speed. Together they decide the detected windows; a foot within the height but faster is reported for the person to judge, never judged as slide (check.md). To see the numbers before choosing, run the check with `--measure-only`.

## Template

Every `<…>` is the person's or the project's answer; nothing here is a suggested value.

```text
{
  "id": "<clip id>",
  "purpose": "<what the clip is for, in one sentence>",
  "rig": {"model": "<project rig .glb>", "map": "<its skeleton map .json>"},
  "fps": <frames per second>,
  "length": {"min": <seconds>, "max": <seconds>},
  "loop": true | false,
  "root": {"mode": "in-place"} | {"mode": "root-motion"} | {"mode": "root-motion", "bone": "<root bone>"},
  "ground": {"kind": "flat"} | {"kind": "change", "description": "<the height change the clip crosses>"},
  "keyPoses": {"file": "<project path of keyposes.glb>", "poses": [{"name": "<pose>", "time": <seconds>}, ...]},
  "contacts": {"detect": {"height": <metres>, "speed": <metres per second>},
               "planted": [{"limb": "foot.l" | "foot.r" | "hand.l" | "hand.r", "from": <seconds>, "to": <seconds>}, ...]},
  "accept": {"footSlide": <metres>, "penetration": <metres>, "boundaryJump": <metres>, "loopSeam": <metres, only when looping>}
}
```

`keyPoses`, `contacts` and each part of `contacts` are optional: leave a part out rather than writing `null`. Without `contacts.detect` the check takes the two detection numbers on its command line. `id` and pose names are lowercase letters, digits and single hyphens; pose names are unique, listed in time order, and no pose lies past `length.max`. Every number is finite and above zero (times may be zero); distances are metres and speeds metres per second, in the clip's glTF frame. Paths are project-relative with forward slashes, opened from the project root (not from beside `clip.json`).

## A loop's last frame

A cycle of L seconds at f fps either ends one frame before its first pose comes round again (L·f frames, "open-end") or repeats the first pose as its last frame (L·f + 1 frames, "duplicate-end"). With a fixed `length` (`min` equal to `max`), the frame count says which; with a range, the scripts read it from the poses, and `--loop-end` on `root_convention.py` and `clip_check.py` sets it. Ask which the engine's import expects when the person knows; the check accepts both. A clip that does not loop has L·f + 1 frames.
