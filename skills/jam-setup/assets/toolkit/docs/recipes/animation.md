# Animation clip recipe

Notes for each step of the `animation` recipe. `jam run next` points here; `jam recipe show animation` lists the steps.

A run makes one clip for a character that is already rigged: the project rig, a `.glb` holding the skinned character, with a skeleton map (a landmark map: bone name to landmark). The skill named for each step says how the work is done and gives its exact `jam run record` command; these notes say what each step's record holds. Files pass between steps as files only. A delivered clip is in the clip format of `jam-3d-animate` (its clip-spec reference).

## define

`jam-3d-animate` writes the clip spec, `clip.json`, against `schemas/animation-clip.schema.json` in the toolkit, with the thresholds the project or the person sets.

The record holds the spec as `spec`. The `clip-spec` check validates it and confirms the rig and the map it names exist; the key-pose file it names is made at the next step. The person accepts the spec: it is what the clip is judged against.

## keyposes

Optional: skipped with a reason for a library clip or footage, where the poses come with the motion. Otherwise `jam-3d-animate` poses the project rig at each key pose the spec names, in the file its `keyPoses.file` names.

The record holds that file as `keyposes`. The person accepts the poses before any motion is made.

## motion

`jam-3d-animate` makes the motion by the route the person allows: by hand on the project rig, by retargeting a clip that exists, or from a motion provider (`jam provider list` shows the `motion` routes and their modes; the provider guide covers routes, jobs and spending).

The record holds the clip as the route returned it, whatever its skeleton and format, as `clip`, with the route as its tool. A paid job goes through the run's ledger (`jam job ...`) and the record names it with `--job`.

## retarget

Applies when the motion is on any skeleton other than the project rig; otherwise skipped with that reason. `jam-3d-retarget` moves the clip onto the project rig through the two skeleton maps. Bones at no landmark keep their rest pose and are listed as unmapped.

The record holds the clip on the project rig as `clip`, with the retarget report and its pose sheets as evidence.

## check

`jam-3d-animate` judges the final clip on the project rig, whatever route made it, and writes the clip report with a pose sheet and, when a renderer is available, a video.

The record holds the clip as `clip` and the report and its sheet as `evidence`. The `clip-report` check requires a report that passed and that measured this clip, against the run's clip spec and the rig and map that spec names, with that spec's own contact detection (`contacts.detect`), on a clip holding exactly one animation. What the report could not measure (`unmeasured`) or left to a person (`unjudged`) must be in its `acknowledged`: the clip check records a name there only when it is run again with `--acknowledge` after the person has judged it from the sheet and video. A clip that fails goes back to the step that caused it: the motion, the retarget, or the contacts. The person then watches the clip and accepts it.

## import

Runs only when the engine adapter's `import` takes the kind `animation` (`jam engine show`); otherwise the step is skipped and the run ends at the delivered clip. The clip must be on the skeleton of a skinned asset already in the engine: the step's command, `jam engine import --kind animation --run <id> --target <engine id or import receipt>`, names it, imports the clip under the clip spec's id and records the step with the animation asset ids the adapter returns. The `jam-engine` skill covers the command.

## delivery

The clip accepted at the check step, with its clip report, recorded as `jam-3d-animate` says; the same `clip-report` check applies, and a person signs it off.
