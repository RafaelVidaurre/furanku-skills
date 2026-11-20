# The clip spec

`clip.json` says what one clip must be before any motion exists. Every route and the check read it. The exact shape is the toolkit's schema (`tools/jam/schemas/animation-clip.schema.json`); `scripts/jamanim/spec.py` reads the same fields and `clip_spec.py` checks a file against them.

## Ask, then write

Settle each field with the person. A value comes from them, from the project's own files (the budget in `jam config show`, the engine adapter's facts, an earlier accepted clip of the same character), or from the rig itself. Nothing comes from habit, from another project, or from this page. When the person has no view on a field, say what it changes and let them choose.

| Field | Ask | What it changes |
| --- | --- | --- |
| `id`, `purpose` | What the clip is for, in one sentence: the action, and where it plays | The route, the key poses, how you judge the sheet |
| `rig.model`, `rig.map` | Which rigged `.glb` is the character, and its skeleton map (bone name → landmark). A rig made with the rigging skill has its landmark file; any other needs a map written as that skill's landmark reference describes | Everything is measured on this rig; clips on other skeletons are retargeted onto it |
| `fps` | The frame rate the project's clips use | Every key falls on a whole frame of it |
| `length` | Seconds, or a range when any length in it will do | Checked against the delivered clip |
| `loop` | Does the clip repeat seamlessly? | Adds the loop-seam check and its threshold |
| `root` | `in-place` (travel removed, the game moves the character) or `root-motion` (the clip moves it). For root motion: the bone that carries travel, or none when the rig has no ground-level root and the hips carry it | `root_convention.py` puts the travel there; the check reads the seam relative to it |
| `ground` | `flat`, or a description of the height change the clip crosses (a stair, a ledge) | Penetration is measured only on flat ground |
| `keyPoses` | The poses that must appear, each with a name and a time. Ask for them when the motion has moments that matter (a contact, the peak of a jump, an impact) or the route needs them (`inbetween`) | Step 2 builds `keyposes.glb` from them |
| `contacts.planted` | Which feet (or hands) should be planted when, when the person knows | Reported beside the detected contacts so you can see where they disagree |
| `contacts.detect` | How close to its resting height (metres) and how slow (m/s) a foot must be to count as planted | Which frames the slide and penetration windows cover |
| `accept` | The largest foot slide while planted, penetration below the ground, jump at the first or last frame, and (when looping) loop seam that the project accepts, in metres | Pass or fail of the check |

### Setting the numbers

The person or the project sets every number; the skill ships none. Help them choose by what each means on screen:

- `accept.footSlide`: how far a planted foot may drift during one contact; compare it with the character's foot length.
- `accept.penetration`: how far a sole may go below the ground before it shows; a camera that never sees the feet allows more.
- `accept.boundaryJump` and `accept.loopSeam`: how far a joint may jump between the end of one play and the start of the next. The check reports how rough the clip's own frame-to-frame motion is (`boundary.interior`), which helps choose when a first threshold turns out too tight.
- `contacts.detect.height` must be above the noise of a planted foot and below the lowest point of a swinging one; `contacts.detect.speed` must be above the speed of a slide you still want to catch (a sliding foot faster than it is not counted as planted, and its slide is never measured) and below a swinging foot's speed. When unsure, run the check once and read the detected windows against the sheet.

## Template

Every `<…>` is the person's or the project's answer; nothing here is a suggested value.

```text
{
  "id": "<clip id>",
  "purpose": "<what the clip is for, in one sentence>",
  "rig": {"model": "<project rig .glb>", "map": "<its skeleton map .json>"},
  "fps": <frames per second>,
  "length": <seconds> | {"min": <seconds>, "max": <seconds>},
  "loop": true | false,
  "root": {"mode": "in-place"} | {"mode": "root-motion"} | {"mode": "root-motion", "bone": "<root bone>"},
  "ground": "flat" | "<the height change the clip crosses>",
  "keyPoses": {"file": "keyposes.glb", "poses": [{"name": "<pose>", "time": <seconds>}, ...]},
  "contacts": {"detect": {"height": <metres>, "speed": <metres per second>},
               "planted": [{"limb": "foot.l" | "foot.r" | "hand.l" | "hand.r", "from": <seconds>, "to": <seconds>}, ...]},
  "accept": {"footSlide": <metres>, "penetration": <metres>, "boundaryJump": <metres>, "loopSeam": <metres, only when looping>}
}
```

`keyPoses` and `contacts` are optional; without `contacts.detect` the check takes the two detection numbers on its command line. Distances are metres and speeds metres per second, in the clip's glTF frame (+Y up, the character faces +Z, +X is its left). A relative path is looked up beside `clip.json`, then from the current folder.

Short forms are accepted: `"root": "in-place"`, `"ground": "<description>"`, and `keyPoses` as the bare list of poses (the file is then `keyposes.glb` beside `clip.json`).

## A loop's last frame

A cycle of L seconds at f fps either ends one frame before its first pose comes round again (L·f frames, "open-end") or repeats the first pose as its last frame (L·f + 1 frames, "duplicate-end"). With one number for `length`, the frame count says which; with a range, the scripts read it from the poses. Ask which the engine's import expects when the person knows; the check accepts both.
