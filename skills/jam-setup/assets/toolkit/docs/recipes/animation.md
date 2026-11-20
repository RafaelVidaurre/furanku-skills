# Animation clip recipe

Notes for each step of the `animation` recipe. `jam run next` points here; `jam recipe show animation` lists the steps.

A run makes one clip for a character that is already rigged: the project rig, a `.glb` holding the skinned character, with a skeleton map (a landmark map: bone name to landmark). Each step's skill says how the work is done; these notes say what each step records. Files pass between steps as files only.

The clip file is glTF binary (`.glb`): the skinned rig and the named animation, in meters, `+Y` up, the character facing `+Z` with `+X` its left, sampled on whole frames at the spec's frame rate. Engines convert in their adapter.

## define

Write the clip spec, `clip.json`, against `schemas/animation-clip.schema.json` in the toolkit: what the clip is for, the rig and its map, frame rate, length, whether it loops, in place or with root motion, the ground, and the thresholds the check enforces. Paths in it are project-relative. Every threshold comes from the project or the person; there are no default numbers to fall back on. Ask for any that is missing.

```
jam run record <id> define --file spec=<clip.json>
```

The `clip-spec` check validates it and confirms the rig and the map it names exist; the key-pose file it names is made at the next step. The person accepts the spec: it is what the clip is judged against.

## keyposes

Optional: skip it with a reason for a library clip or footage, where the poses come with the motion. Otherwise pose the project rig at each key pose the spec names and save them in the file its `keyPoses.file` names: the rig with one animation holding one key per pose at its time. The person accepts the poses before any motion is made.

```
jam run record <id> keyposes --file keyposes=<keyposes.glb>
```

## motion

Make the motion by the route the person allows: by hand on the project rig, by retargeting a clip that exists, or from a motion provider (`jam provider list` shows the `motion` routes and their modes; the provider guide covers routes, jobs and spending). A paid job goes through the run's ledger (`jam job ...`) and is recorded with `--job`. Record the clip as the route returned it, whatever its skeleton and format:

```
jam run record <id> motion --file clip=<clip as returned> --tool "<route, model and version>"
```

## retarget

Applies when the motion is on any skeleton other than the project rig; otherwise skip it with that reason. `jam-3d-retarget` moves the clip onto the project rig through the two skeleton maps. Bones at no landmark keep their own animation or rest pose and are listed as unmapped.

```
jam run record <id> retarget --file clip=<clip on the project rig.glb> --evidence report=<retarget report> --evidence sheet=<pose sheet>
```

## check

Judge the final clip on the project rig, whatever route made it. The check writes `clip-report.json`: per contact window, slide and penetration; boundary and seam jumps; frames, frame rate and length; which thresholds pass. Contacts are found on the project rig from foot height and speed. Beside it go a pose sheet and, when a renderer is available, a video.

```
jam run record <id> check --file clip=<clip.glb> --file evidence=<clip-report.json> --file evidence=<clip-sheet.png>
```

The `clip-report` check requires a report that passed and measured this clip (its `clip` holds the clip's SHA-256). A clip that fails goes back to the step that caused it: the motion, the retarget, or the contacts. The person then watches the clip and accepts it.

## import

Runs only when the engine adapter's `import` lists the kind `animation` (`jam engine show`); otherwise the step is skipped and the run ends at the delivered clip. The clip must be on the skeleton of a skinned asset already in the engine: name it with `--target`, as its engine id or as the receipt file of its import.

```
jam engine import --kind animation --run <id> --target <engine id or import receipt>
```

The receipt lists the animation asset ids, which the step records.

## delivery

The clip accepted at the check step with its clip report; a person signs it off.

```
jam run record <id> delivery --file clip=<clip.glb> --file evidence=<clip-report.json>
```
