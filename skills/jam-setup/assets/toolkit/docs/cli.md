# jam command reference

Generated from the command definitions by `jam schemas write`; do not edit by hand. Every command also prints this with `--help`.

Run commands as `node <toolkit>/jam.mjs <command>` from anywhere inside the project (the toolkit folder is `toolkit` in `jam.config.json`, by default `tools/jam`). Paths are project-relative with forward slashes.

Every command accepts:

| Flag | Meaning |
|---|---|
| `--root <folder>` | Project folder (default: the nearest folder with `jam.config.json`, else the Git checkout) |
| `--json` | Print one JSON object on standard output instead of text |
| `--help` | Describe the command, its flags and one example |

A failure prints `error:` with the field and expected form and, when there is one, `fix:` with what to do; with `--json` it is `{"error": {"code", "message", "fix"}}` on standard error. The exit code is 2 for wrong input and 1 for anything else.

## Starting in the middle of a recipe

A run normally starts at its recipe's first step. When the work begins from an existing file (a bought mesh to retexture, a scan to retopologize), start with `jam run start <recipe> <id> --from <step>`: the steps before `<step>` are not needed, `jam run next` begins at `<step>`, and recording that step requires `--source <origin> --source-evidence <path>` so the record says where the work came from. Recording any step with `--source` and `--source-evidence` while the steps it needs are unmet has the same effect for that step.

When one operation produced the results of several steps, record them in one call: `jam run record <id> topology uv texture --file model=<file> ...`. One record is written per step, sharing the files; each step's checks and gate apply on their own, and nothing is written unless every step passes.

## Steps that depend on the engine

A recipe step may carry a condition (`when`), such as "the engine adapter provides `import`". When the condition does not hold the step is skipped automatically, with the reason on record, and later steps treat it as satisfied. `jam run status` and `jam recipe show` print each condition and whether it holds. A run therefore finishes with any engine adapter and with none.

## Commands

| Command | What it is for |
|---|---|
| `jam where` | Show which project and checkout commands act on |
| `jam setup` | Create jam.config.json from decided choices merged over the toolkit's defaults, or from the defaults alone |
| `jam config` | Project configuration (jam.config.json) |
| `jam recipe` | Recipes: the written, checkable workflows runs follow |
| `jam run` | Runs: start, see what is next, record steps, review, deliver |
| `jam job` | The paid-operation ledger: open a job before submitting, then record what became of it |
| `jam measure` | Measure a file the way run records do: triangles, materials and texture memory of a GLB, or the pixel size of an image |
| `jam crop` | Cut a turnaround sheet into its five views without resampling, on equal canvases, and check that left and right face opposite ways |
| `jam pack-glb` | Embed a glTF's buffers and images into one self-contained GLB without changing geometry, materials, skeleton or animations |
| `jam python` | Run Python with this project's interpreter (jam.local.json, else PATH) |
| `jam blender` | Run a script in headless Blender (jam.local.json, else PATH) |
| `jam provider` | Providers: generation services the project can use |
| `jam engine` | The engine adapter: conventions, and commands that reach the engine |
| `jam audio` | Sound effects and voiced dialogue: generate, process to loudness targets, check, keep originals |
| `jam schemas` | The published contract: JSON Schemas of every authored file, and the command reference |
| `jam doctor` | Report everything the toolkit depends on: Node, npm packages, Python imaging packages, Blender, ffmpeg, Git and LFS, configuration, recipes, providers, the engine adapter, unsettled jobs and stale locks |

## where

Show which project and checkout commands act on.

```
jam where
```

Example:

```
jam where
```

## setup

Create jam.config.json from decided choices merged over the toolkit's defaults, or from the defaults alone. With neither flag it prints the defaults to decide on. It never authenticates, spends, or replaces an existing file.

```
jam setup [flags]
```

| Flag | Meaning |
|---|---|
| `--from <string>` | JSON file with the decided choices: any fields of jam.config.json |
| `--defaults` | Write the toolkit's defaults as they are; change single fields afterwards with jam config set |

Example:

```
jam setup --from choices.json
```

## config

Project configuration (jam.config.json)

### config show

Show the project configuration, or one field of it.

```
jam config show [<path>]
```

| Argument | Meaning |
|---|---|
| `path` | Dotted field to print, e.g. spend or budgets.prop |

Example:

```
jam config show spend
```

### config check

Validate jam.config.json and jam.local.json; every problem is listed with its field.

```
jam config check
```

Example:

```
jam config check
```

### config migrate

Upgrade a version 1 jam.config.json: profiles become budgets, the review policy becomes recipes under jam/recipes/, spending limits become per-run caps. Version 1 runs stay readable.

```
jam config migrate [flags]
```

| Flag | Meaning |
|---|---|
| `--dry-run` | Print what would be written and change nothing |

Example:

```
jam config migrate --dry-run
```

### config set

Change one field of jam.config.json. The whole file is validated before it is written, so a wrong value changes nothing.

```
jam config set <path> [<value>] [flags]
```

| Argument | Meaning |
|---|---|
| `path` | Dotted field, e.g. review.mode or spend.<provider>.perRun |
| `value` | New value: text, a number, true/false, none (no value), or JSON for an object |

| Flag | Meaning |
|---|---|
| `--remove` | Remove the field instead of setting it |

Example:

```
jam config set review.mode agent
```

## recipe

Recipes: the written, checkable workflows runs follow

### recipe list

List the recipes a run can use, with what each is for. Choosing the recipe from the request is how work starts.

```
jam recipe list
```

Example:

```
jam recipe list
```

### recipe show

Show a recipe's resolved steps, where each gate came from, and whether each step's condition holds in this project.

```
jam recipe show <id>
```

| Argument | Meaning |
|---|---|
| `id` | Recipe id |

Example:

```
jam recipe show prop
```

### recipe check

Validate recipes: schema, needs, cycles, unknown checks, and that each guide's file and anchor exist. Without an id: every recipe.

```
jam recipe check [<id>]
```

| Argument | Meaning |
|---|---|
| `id` | Recipe id |

Example:

```
jam recipe check
```

### recipe new

Scaffold a project recipe under jam/recipes/. With --extends it inherits a base's steps and lists only what differs.

```
jam recipe new <id> [flags]
```

| Argument | Meaning |
|---|---|
| `id` | Recipe id |

| Flag | Meaning |
|---|---|
| `--extends <string>` | Base recipe to inherit steps from: builtin:<id> or a project recipe id |

Example:

```
jam recipe new crate --extends builtin:prop
```

### recipe set

Change one step's gate, reviewer, guide or optional flag for this project. A shipped recipe is left alone: the change is written to a project recipe that extends it.

```
jam recipe set <id> <step> [flags]
```

| Argument | Meaning |
|---|---|
| `id` | Recipe id |
| `step` | Step id |

| Flag | Meaning |
|---|---|
| `--review <choice>` | Who must accept the step |
| `--reviewer <string>` | Who decides the step's human gate, as a person or role ("art lead") |
| `--guide <string>` | Document with the step's instructions: a project path or toolkit:<path>, with an optional #anchor |
| `--optional <choice>` | Whether the step may be skipped with a reason |

Example:

```
jam recipe set prop mesh --review human
```

### recipe capture

Write a recipe from the steps a run actually recorded, so a workflow that was improvised once can be repeated.

```
jam recipe capture <run> [flags]
```

| Argument | Meaning |
|---|---|
| `run` | The run to capture: its subject id |

| Flag | Meaning |
|---|---|
| `--as <string>` | **Required.** Id of the recipe to write |

Example:

```
jam recipe capture oak-barrel --as weathered-prop
```

## run

Runs: start, see what is next, record steps, review, deliver

### run start

Start a run: one attempt of a recipe for one subject. Give the brief as a file or as text.

```
jam run start <recipe> <id> [flags]
```

| Argument | Meaning |
|---|---|
| `recipe` | Recipe id; "jam recipe list" says what each is for |
| `id` | Subject id: what is being made, e.g. oak-barrel |

| Flag | Meaning |
|---|---|
| `--brief <string>` | File that says what is wanted |
| `--brief-text <string>` | The brief itself, written to brief.md in the run folder |
| `--budget <string>` | Budget name from jam.config.json (default: the recipe's) |
| `--human <string>` | Comma-separated steps a person must accept in this run, whatever the recipe says |
| `--from <string>` | Start at this step from existing work; the steps before it are not needed |
| `--dir <string>` | Run folder (default: <scratch root>/<id>/<n>) |

Example:

```
jam run start prop oak-barrel --brief-text "A weathered oak barrel, about 1 m tall"
```

### run next

Say what to do next for a run: the step, its skill and guide, required outputs, checks, gate, and the command that records it.

```
jam run next <id>
```

| Argument | Meaning |
|---|---|
| `id` | The run's subject id (the newest attempt); <id>:<n> names an earlier attempt |

Example:

```
jam run next oak-barrel
```

### run status

Show every step of a run with its state and reason. Without an id: every run that is not delivered.

```
jam run status [<id>]
```

| Argument | Meaning |
|---|---|
| `id` | The run's subject id (the newest attempt); <id>:<n> names an earlier attempt |

Example:

```
jam run status oak-barrel
```

### run where

Print the path of a run's record file.

```
jam run where <id>
```

| Argument | Meaning |
|---|---|
| `id` | The run's subject id (the newest attempt); <id>:<n> names an earlier attempt |

Example:

```
jam run where oak-barrel
```

### run record

Record a step's result. You state facts with flags; the tool hashes the files, measures models and images, runs the step's checks and refuses the record if any fails. Nothing is written unless everything passes.

```
jam run record <id> <step...> [flags]
```

| Argument | Meaning |
|---|---|
| `id` | The run's subject id (the newest attempt); <id>:<n> names an earlier attempt |
| `step` | The step recorded; several when one operation produced them all (they share the files) |

| Flag | Meaning |
|---|---|
| `--file <string>` (repeatable) | Output file as [role[:key]=]path; the role may be left out when the step has one. Repeat per file. |
| `--evidence <string>` (repeatable) | What a reviewer looks at, as [label=]path. Repeat per file. |
| `--input <string>` (repeatable) | A file the step consumed beyond the steps it needs. Repeat per file. |
| `--note <string>` | What was done, or why existing files suffice (required) |
| `--tool <string>` | Local work: the tool and its version |
| `--job <string>` | Paid result: the succeeded job it came from (<job>, or <run>/<job> for another run's) |
| `--source <string>` | Imported work: where it came from (needs --source-evidence) |
| `--source-evidence <string>` | Imported work: a document showing the origin and the right to use it |
| `--accept <string>` | Agent self-review reason; applies to each step whose gate allows agent review |
| `--metric <string>` (repeatable) | A measured value you expect, as name=value; refused when the tool measures otherwise |
| `--symmetric` | The subject's sides are identical, so a turnaround may reuse one side view |
| `--engine-asset <string>` (repeatable) | Engine asset id of work imported by hand, as [kind=]id |

Example:

```
jam run record oak-barrel concept --file concept.png --note "Generated from the brief" --tool "image model v2"
```

### run skip

Skip an optional step, with the reason on record. Later steps treat it as satisfied.

```
jam run skip <id> <step> [flags]
```

| Argument | Meaning |
|---|---|
| `id` | The run's subject id (the newest attempt); <id>:<n> names an earlier attempt |
| `step` | A step of the run's recipe |

| Flag | Meaning |
|---|---|
| `--reason <string>` | Why this run does not need the step (required) |

Example:

```
jam run skip oak-barrel collision --reason "decorative, never touched by the player"
```

### run review

Decide a step's gate. An agent accepts with --accept --reason. A person's decision passed on by an agent is recorded as a relay with the channel and their words; a human gate takes nothing less.

```
jam run review <id> <step> [flags]
```

| Argument | Meaning |
|---|---|
| `id` | The run's subject id (the newest attempt); <id>:<n> names an earlier attempt |
| `step` | A step of the run's recipe |

| Flag | Meaning |
|---|---|
| `--accept` | Accept the step's current record |
| `--revise` | Send it back for changes |
| `--reject` | Reject it |
| `--reason <string>` | What was checked, or what must change (required unless --relay carries it) |
| `--relay <string>` | A person's decision passed on by an agent, as "<where they answered>: <their words>" |
| `--by <string>` | Who decided, when that is not whoever runs the command |
| `--record <string>` | Refuse unless this is still the step's current record id |

Example:

```
jam run review oak-barrel concept --accept --relay "chat: yes, go with the second one"
```

### run request-review

Submit a step that needs a person's acceptance to the catalog, and print the review link on its own line (url with --json; without a running catalog server, the route and how to start one). Asking again returns the same review. "jam run status" reads the person's decision.

```
jam run request-review <id> <step>
```

| Argument | Meaning |
|---|---|
| `id` | The run's subject id (the newest attempt); <id>:<n> names an earlier attempt |
| `step` | A step of the run's recipe |

Example:

```
jam run request-review oak-barrel concept
```

### run deliver

Copy everything a finished run stands on into the delivered root, verify each copy against its recorded hash, and refuse anything Git would ignore.

```
jam run deliver <id>
```

| Argument | Meaning |
|---|---|
| `id` | The run's subject id (the newest attempt); <id>:<n> names an earlier attempt |

Example:

```
jam run deliver oak-barrel
```

### run set

Name a run's budget, or require a person for more of its steps. Requirements are only added.

```
jam run set <id> [flags]
```

| Argument | Meaning |
|---|---|
| `id` | The run's subject id (the newest attempt); <id>:<n> names an earlier attempt |

| Flag | Meaning |
|---|---|
| `--budget <string>` | Budget name from jam.config.json |
| `--human <string>` | Comma-separated steps a person must accept; added to those already required |

Example:

```
jam run set oak-barrel --budget prop
```

### run unlock

Remove a run's lock after a crash. Refused while the process that holds it is alive or cannot be verified.

```
jam run unlock <id>
```

| Argument | Meaning |
|---|---|
| `id` | The run's subject id (the newest attempt); <id>:<n> names an earlier attempt |

Example:

```
jam run unlock oak-barrel
```

## job

The paid-operation ledger: open a job before submitting, then record what became of it

### job open

Open a provider job before submitting anything. Refused when the provider is disabled, a cap would be passed, or the same request is still unsettled in any run.

```
jam job open <id> <step> [flags]
```

| Argument | Meaning |
|---|---|
| `id` | The run's subject id (the newest attempt); <id>:<n> names an earlier attempt |
| `step` | A step of the run's recipe |

| Flag | Meaning |
|---|---|
| `--provider <string>` | **Required.** Provider id; "jam provider list" shows them |
| `--operation <string>` | **Required.** The model and operation being run |
| `--estimate <number>` | **Required.** Expected charge in the provider's own unit |
| `--request <string>` | **Required.** Project file holding the request as it will be sent, without credentials or signed URLs |
| `--quote` | The estimate is an exact quote from the provider |
| `--list-price` | The estimate is a published list price |
| `--price-source <string>` | Where the estimate came from (a dry run, a quote, a price page) |
| `--authorized <string>` | Who approved this spending, when, in their words (default: the provider's standing authorization) |
| `--transport <string>` | How it will be submitted: cli, mcp, browser |
| `--scope <string>` | The account, team or project it is billed to |

Example:

```
jam job open oak-barrel mesh --provider <provider> --operation "multiview to 3D" --estimate 20 --request mesh-request.json --price-source "dry run"
```

### job submitted

Record the provider's job id as soon as the submission is accepted (also when a lost job is found again).

```
jam job submitted <id> <job> [flags]
```

| Argument | Meaning |
|---|---|
| `id` | The run's subject id (the newest attempt); <id>:<n> names an earlier attempt |
| `job` | The job's id in the run, e.g. j1 |

| Flag | Meaning |
|---|---|
| `--provider-job <string>` | The id the provider gave the job |
| `--actual <number>` | What the provider charged, in its own unit |
| `--evidence <string>` | Where the outcome can be seen: a file, the provider's task id, a billing entry |

Example:

```
jam job submitted oak-barrel j1 --provider-job task_8841
```

### job done

Record a finished job with what it really cost.

```
jam job done <id> <job> [flags]
```

| Argument | Meaning |
|---|---|
| `id` | The run's subject id (the newest attempt); <id>:<n> names an earlier attempt |
| `job` | The job's id in the run, e.g. j1 |

| Flag | Meaning |
|---|---|
| `--provider-job <string>` | The id the provider gave the job |
| `--actual <number>` | What the provider charged, in its own unit |
| `--evidence <string>` | Where the outcome can be seen: a file, the provider's task id, a billing entry |

Example:

```
jam job done oak-barrel j1 --actual 20 --evidence "task_8841 billing"
```

### job failed

Record a failed job with what it really cost (a failure is not proof of a refund).

```
jam job failed <id> <job> [flags]
```

| Argument | Meaning |
|---|---|
| `id` | The run's subject id (the newest attempt); <id>:<n> names an earlier attempt |
| `job` | The job's id in the run, e.g. j1 |

| Flag | Meaning |
|---|---|
| `--provider-job <string>` | The id the provider gave the job |
| `--actual <number>` | What the provider charged, in its own unit |
| `--evidence <string>` | Where the outcome can be seen: a file, the provider's task id, a billing entry |

Example:

```
jam job failed oak-barrel j1 --actual 0 --evidence "task_8841: refunded per billing page"
```

### job cancelled

Record a cancelled job. One that was never submitted needs evidence that the provider has no such job and costs nothing; one the provider cancelled needs --actual.

```
jam job cancelled <id> <job> [flags]
```

| Argument | Meaning |
|---|---|
| `id` | The run's subject id (the newest attempt); <id>:<n> names an earlier attempt |
| `job` | The job's id in the run, e.g. j1 |

| Flag | Meaning |
|---|---|
| `--provider-job <string>` | The id the provider gave the job |
| `--actual <number>` | What the provider charged, in its own unit |
| `--evidence <string>` | Where the outcome can be seen: a file, the provider's task id, a billing entry |

Example:

```
jam job cancelled oak-barrel j1 --evidence "task list checked 14:02: no matching task"
```

### job lost

Record that a submission's response was lost. The job keeps its estimate and blocks a resubmission until it is found or confirmed absent.

```
jam job lost <id> <job> [flags]
```

| Argument | Meaning |
|---|---|
| `id` | The run's subject id (the newest attempt); <id>:<n> names an earlier attempt |
| `job` | The job's id in the run, e.g. j1 |

| Flag | Meaning |
|---|---|
| `--provider-job <string>` | The id the provider gave the job |
| `--actual <number>` | What the provider charged, in its own unit |
| `--evidence <string>` | Where the outcome can be seen: a file, the provider's task id, a billing entry |

Example:

```
jam job lost oak-barrel j1
```

### job list

List provider jobs across all runs.

```
jam job list [flags]
```

| Flag | Meaning |
|---|---|
| `--open` | Only jobs that are not settled |
| `--run <string>` | Only this run's jobs |

Example:

```
jam job list --open
```

## measure

Measure a file the way run records do: triangles, materials and texture memory of a GLB, or the pixel size of an image.

```
jam measure <file>
```

| Argument | Meaning |
|---|---|
| `file` | Project path of a .glb, .png, .jpg or .webp file |

Example:

```
jam measure final.glb
```

## crop

Cut a turnaround sheet into its five views without resampling, on equal canvases, and check that left and right face opposite ways. Needs Python with Pillow.

```
jam crop <sheet> <layout> <output> [flags]
```

| Argument | Meaning |
|---|---|
| `sheet` | Project path of the turnaround sheet image |
| `layout` | Project path of a JSON file: {"front": [x, y, width, height], "left": ..., "back": ..., "right": ..., "three-quarter": ...} |
| `output` | Project folder to create; it must not exist |

| Flag | Meaning |
|---|---|
| `--symmetric` | The subject's sides are identical, so left and right may show the same view |

Example:

```
jam crop sheet.png layout.json views
```

## pack-glb

Embed a glTF's buffers and images into one self-contained GLB without changing geometry, materials, skeleton or animations.

```
jam pack-glb <source> <destination>
```

| Argument | Meaning |
|---|---|
| `source` | Project path of a .gltf (or .glb) with external buffers or images |
| `destination` | Project path of the .glb to write |

Example:

```
jam pack-glb download/scene.gltf model.glb
```

## python

Run Python with this project's interpreter (jam.local.json, else PATH). No shell is involved, so one command line works in every terminal. toolkit:<file> names a script the toolkit ships.

```
jam python [<args...>]
```

| Argument | Meaning |
|---|---|
| `args` | Script, then its arguments exactly as the script takes them; this command's own flags go before the script |

Example:

```
jam python tools/report.py --verbose out.json
```

## blender

Run a script in headless Blender (jam.local.json, else PATH). Everything after the script reaches the script. toolkit:<file> names a script the toolkit ships.

```
jam blender [<args...>] [flags]
```

| Argument | Meaning |
|---|---|
| `args` | Script, then its arguments exactly as the script takes them; this command's own flags go before the script |

| Flag | Meaning |
|---|---|
| `--factory-startup` | Ignore the user's Blender preferences and add-ons |

Example:

```
jam blender --factory-startup toolkit:fbx-to-glb.py source.fbx model.glb
```

## provider

Providers: generation services the project can use

### provider list

List the known providers: what each can serve, which routes use it, how it is reached, and whether paid work is enabled.

```
jam provider list
```

Example:

```
jam provider list
```

### provider probe

Report, separately, whether a provider is installed, signed in and reachable. What the toolkit cannot see is reported as unknown with how to find out; it is never guessed.

```
jam provider probe <id>
```

| Argument | Meaning |
|---|---|
| `id` | Provider id |

Example:

```
jam provider probe <provider>
```

## engine

The engine adapter: conventions, and commands that reach the engine

### engine show

Show the engine adapter in force: where it comes from, which commands it runs itself, which guides it has.

```
jam engine show
```

Example:

```
jam engine show
```

### engine facts

Print the engine's conventions (units, axes, formats, naming, skeletons) with the project's overrides applied. Skills read conventions here.

```
jam engine facts [<key...>]
```

| Argument | Meaning |
|---|---|
| `key` | Path of one fact, a key per argument (keys may contain dots): skeletons <id> bones upper-leg.l. One dotted argument works when unambiguous: mesh.static |

Example:

```
jam engine facts skeletons biped bones upper-leg.l
```

### engine install

Copy an engine adapter folder into the project (jam/engines/<id>/) and select it in jam.config.json.

```
jam engine install <folder>
```

| Argument | Meaning |
|---|---|
| `folder` | Folder holding adapter.json, commands/ and docs/ (anywhere on this machine) |

Example:

```
jam engine install path/to/adapter
```

### engine import

Import files into the engine through the adapter and print its receipt (the engine's asset ids). With --run the import step is recorded with those ids. Without an import command it prints the adapter's guide for doing it by hand.

```
jam engine import [<file...>] [flags]
```

| Argument | Meaning |
|---|---|
| `file` | Project files; with --run they default to the run's current model, or for an audio kind its processed audio. Anything after -- goes to the adapter's command as typed. |

| Flag | Meaning |
|---|---|
| `--kind <string>` | **Required.** What is imported: static, skinned, textures, audio, ... (the adapter says which it accepts) |
| `--destination <string>` | Where in the engine's content the assets go (default: the adapter's own rule) |
| `--slot <string>` (repeatable) | Which engine material a slot of the model uses, as name=material. Repeat per slot. |
| `--skeleton <string>` | Skeleton profile a skinned import binds to (default: the one the run's budget names) |
| `--run <string>` | Work on this run's result and record the step the recipe marks for this command |
| `--step <string>` | The step to record, when the recipe has several for this command |

Example:

```
jam engine import --kind static --run oak-barrel
```

### engine inspect

Ask the engine what an imported asset is: bounds in meters, pivot, material slots, skeleton, collision. The engine-inspect check compares this with the budget.

```
jam engine inspect [<args...>]
```

| Argument | Meaning |
|---|---|
| `args` | Arguments for the adapter's command; put ones that start with a dash after -- |

Example:

```
jam engine inspect <engine asset id>
```

### engine references

List what an engine asset references and what references it.

```
jam engine references [<args...>]
```

| Argument | Meaning |
|---|---|
| `args` | Arguments for the adapter's command; put ones that start with a dash after -- |

Example:

```
jam engine references <engine asset id>
```

### engine capture

Capture a still of an asset or a level from the engine. Prefer one still to a recording.

```
jam engine capture [<args...>]
```

| Argument | Meaning |
|---|---|
| `args` | Arguments for the adapter's command; put ones that start with a dash after -- |

Example:

```
jam engine capture <engine asset id> out.png
```

### engine check

Run the adapter's own project checks; it prints problems in the same shape as the toolkit's checks.

```
jam engine check [<args...>]
```

| Argument | Meaning |
|---|---|
| `args` | Arguments for the adapter's command; put ones that start with a dash after -- |

Example:

```
jam engine check
```

### engine conform-skeleton

Rework a rigged model onto one of the engine's skeletons, so that engine's animations play without retargeting. Only adapters whose engine needs it provide this.

```
jam engine conform-skeleton [<file...>] [flags]
```

| Argument | Meaning |
|---|---|
| `file` | Project files; with --run they default to the run's current model, or for an audio kind its processed audio. Anything after -- goes to the adapter's command as typed. |

| Flag | Meaning |
|---|---|
| `--skeleton <string>` | Skeleton profile id (default: the one the run's budget names) |
| `--landmarks <string>` | Landmark file of the model's joints (default: the one the rig step recorded with role landmarks) |
| `--height <number>` | The character's height in meters |
| `--fingers <string>` | How many fingers the result has, as the adapter understands it |
| `--out <string>` | Folder for the result (default: conform/ in the run folder) |
| `--accept <string>` | Agent self-review reason for the recorded step |
| `--run <string>` | Work on this run's result and record the step the recipe marks for this command |
| `--step <string>` | The step to record, when the recipe has several for this command |

Example:

```
jam engine conform-skeleton --run hero
```

### engine inventory

Read what the engine's content holds (files, assets, classes, engine metadata, references) into one inventory file. Only files whose size or modification time changed are read again.

```
jam engine inventory [<args...>] [flags]
```

| Argument | Meaning |
|---|---|
| `args` | Arguments for the adapter's command; put ones that start with a dash after -- |

| Flag | Meaning |
|---|---|
| `--out <string>` | Project path of the inventory file (default: .engine/inventory.json in the scratch root) |
| `--full` | Read every file again instead of reusing what the previous inventory read |
| `--engine` | Let the adapter start the engine for what files cannot give: unreadable files, effective property values |

Example:

```
jam engine inventory
```

### engine previews

Make a viewable preview of each engine file (an image, a self-contained model or a sound) into one machine-local folder, for the catalog. Only files whose content changed are made again. It may start the engine.

```
jam engine previews [<args...>] [flags]
```

| Argument | Meaning |
|---|---|
| `args` | Arguments for the adapter's command; put ones that start with a dash after -- |

| Flag | Meaning |
|---|---|
| `--out <string>` | Project path of the previews folder (default: .engine/previews in the scratch root) |
| `--full` | Make every preview again, not only those of files that changed |
| `--no-engine` | Make only the previews the engine's files hold themselves; no engine starts |
| `--only <string>` (repeatable) | Only files whose project path matches this pattern (* within a folder, ** any depth). Repeat for several. |
| `--limit <integer>` | Make at most this many previews through the engine in this run |

Example:

```
jam engine previews
```

### engine run

Run a command the adapter adds beside the standard ones (collision fitting, exporting a reference skeleton, ...) and print its one JSON receipt.

```
jam engine run <name> [<args...>]
```

| Argument | Meaning |
|---|---|
| `name` | One of the adapter's own commands; "jam engine show" lists them |
| `args` | Arguments for the adapter's command; put ones that start with a dash after -- |

Example:

```
jam engine run fit-collision -- --mode measure <engine asset id>
```

### engine docs

Print the adapter's guidance on a topic. A facts-only preset has a guide too.

```
jam engine docs <topic>
```

| Argument | Meaning |
|---|---|
| `topic` | Guide topic, e.g. import or acceptance; "jam engine show" lists them |

Example:

```
jam engine docs import
```

## audio

Sound effects and voiced dialogue: generate, process to loudness targets, check, keep originals

### audio sfx

Sound effects: generate or add takes, cut variants, trim, tighten, reprocess

### audio sfx generate

Generate takes of a sound with the sound provider, paid through a run's ledger, and process each to the loudness target. The original of every take is kept. Needs a run: jam run start sfx <name> --brief-text "...".

```
jam audio sfx generate <name> [flags]
```

| Argument | Meaning |
|---|---|
| `name` | The sound's name: lowercase words joined by hyphens, e.g. vase-break |

| Flag | Meaning |
|---|---|
| `--prompt <string>` | **Required.** What makes the sound, as one physical event; the provider's document says how to word it |
| `--run <string>` | The run whose ledger pays (default: the run whose subject is the sound's name) |
| `--takes <integer>` | How many takes to request, 1 to 5; each is charged |
| `--duration <number>` | Length in seconds; left out, the provider chooses |
| `--setting <string>` (repeatable) | A provider setting as name=value; the provider's document lists them. Repeat per setting. |
| `--provider <string>` | Provider id (default: routes.sound) |
| `--authorized <string>` | Who approved this spending, when, in their words (default: the provider's standing authorization) |
| `--dry-run` | Print what would be sent and its cost; send nothing |
| `--loop` | A seamless loop or bed: never trimmed, levelled to the loop target |
| `--stereo` | Keep stereo (beds, non-positional sounds); the default is mono |
| `--tighten` | Fade the room tail once it has decayed 30 dB (contact sounds: steps, bumps, impacts) |
| `--title <string>` | Display name |

Example:

```
jam audio sfx generate vase-break --prompt "Ceramic vase shattering on a wooden floor, close and dry" --duration 2 --takes 2
```

### audio sfx add

Add a sound made outside the tools (recorded, bought, made in a provider's app) as a take: its file is kept as the original and processed like any other. Costs nothing and needs no run.

```
jam audio sfx add <name> [flags]
```

| Argument | Meaning |
|---|---|
| `name` | The sound's name: lowercase words joined by hyphens, e.g. vase-break |

| Flag | Meaning |
|---|---|
| `--file <string>` | **Required.** Project path of the audio file (copy a file from elsewhere into the project first) |
| `--prompt <string>` | The prompt it was made with, when it was generated elsewhere |
| `--creator <string>` | Who made it |
| `--license <string>` | The rights the project has over it |
| `--source <string>` | Where it came from |
| `--loop` | A seamless loop or bed: never trimmed, levelled to the loop target |
| `--stereo` | Keep stereo (beds, non-positional sounds); the default is mono |
| `--tighten` | Fade the room tail once it has decayed 30 dB (contact sounds: steps, bumps, impacts) |
| `--title <string>` | Display name |

Example:

```
jam audio sfx add door-creak --file inbox/door-creak.wav --creator "Sam" --license "own recording"
```

### audio sfx split

Cut one take that holds several separate events (a run of footsteps, a few knocks) into level-matched variants, one per event. Look first: --dry-run --preview draws what it found. Splitting again replaces the variants.

```
jam audio sfx split <name> [flags]
```

| Argument | Meaning |
|---|---|
| `name` | The sound's name: lowercase words joined by hyphens, e.g. vase-break |

| Flag | Meaning |
|---|---|
| `--take <integer>` | Which take (default: the only one) |
| `--min-gap <number>` | Milliseconds the level must stay down between two events (default 120) |
| `--rise <number>` | dB an event must rise above the noise floor (default 18); lower it for a continuous sound whose parts never fall silent |
| `--dry-run` | List the events found and write nothing |
| `--preview <string>` | Project path of a PNG to draw: the waveform with each event shaded |

Example:

```
jam audio sfx split footsteps-gravel --dry-run --preview work/footsteps.png
```

### audio sfx variants

Make chosen whole takes the level-matched variants of a sound: one event per take is the reliable way to get variants. Replaces earlier variants.

```
jam audio sfx variants <name> [flags]
```

| Argument | Meaning |
|---|---|
| `name` | The sound's name: lowercase words joined by hyphens, e.g. vase-break |

| Flag | Meaning |
|---|---|
| `--takes <string>` | **Required.** The takes to use, as numbers separated by commas, e.g. 1,2,4 |

Example:

```
jam audio sfx variants glass-knock --takes 1,2,4
```

### audio sfx trim

Keep only part of a take, with short fades, for feedback such as "there is a noise at the end". The take is processed again from its original, so trimming twice loses nothing.

```
jam audio sfx trim <name> [flags]
```

| Argument | Meaning |
|---|---|
| `name` | The sound's name: lowercase words joined by hyphens, e.g. vase-break |

| Flag | Meaning |
|---|---|
| `--take <integer>` | Which take (default: the only one) |
| `--start <number>` | Seconds into the take where it should begin (default 0) |
| `--end <number>` | Seconds into the take where it should end (default: its end) |

Example:

```
jam audio sfx trim wine-pour --take 1 --end 1.85
```

### audio sfx tighten

Fade out a take's room tail, for feedback such as "it has reverb": generators add room ring that rewording the prompt does not remove. Leave it off when the tail is part of the event (shards after a break, a pour).

```
jam audio sfx tighten <name> [flags]
```

| Argument | Meaning |
|---|---|
| `name` | The sound's name: lowercase words joined by hyphens, e.g. vase-break |

| Flag | Meaning |
|---|---|
| `--take <integer>` | Which take (default: the only one) |
| `--at-db <number>` | How far the sound must decay below its loudest moment before the fade starts (default 30) |
| `--fade-ms <number>` | Length of the fade in milliseconds (default 100) |

Example:

```
jam audio sfx tighten footstep-wood --take 2
```

### audio sfx reprocess

Process existing sounds again from their originals with the settings now in force, after a loudness target, the sample rate or the bit depth changed. Trims, tightening and variant cuts are kept.

```
jam audio sfx reprocess [<name...>] [flags]
```

| Argument | Meaning |
|---|---|
| `name` | Sounds to process again |

| Flag | Meaning |
|---|---|
| `--all` | Every sound |

Example:

```
jam audio sfx reprocess --all
```

### audio sfx show

List sounds with their takes, variants, levels and originals.

```
jam audio sfx show [<name>]
```

| Argument | Meaning |
|---|---|
| `name` | One sound; left out: every sound |

Example:

```
jam audio sfx show vase-break
```

### audio voice

Voiced dialogue: line status, voices, speaking lines, settling and checking takes

### audio voice status

List every dialogue line with where it stands: missing (no take), stale (its text changed after it was voiced) or voiced; whether a person marked its words reviewed; whether its take matches the text.

```
jam audio voice status [flags]
```

| Flag | Meaning |
|---|---|
| `--script <string>` | Only this lines file (its name without .json) |
| `--speaker <string>` | Only this speaker's lines |

Example:

```
jam audio voice status --script intro
```

### audio voice voices

List the voices the voice provider's account can use, with a link to hear each. The person chooses; this call is free.

```
jam audio voice voices [flags]
```

| Flag | Meaning |
|---|---|
| `--search <string>` | Narrow by name, description or label |
| `--provider <string>` | Provider id (default: routes.voice) |

Example:

```
jam audio voice voices --search "gravelly"
```

### audio voice assign

Give a speaker a voice: the id is checked with the provider and written to the speakers file with its name.

```
jam audio voice assign <speaker> [flags]
```

| Argument | Meaning |
|---|---|
| `speaker` | Speaker id as the lines name it |

| Flag | Meaning |
|---|---|
| `--voice <string>` | **Required.** The provider's id of the voice |
| `--provider <string>` | Provider id (default: routes.voice) |
| `--name <string>` | The voice's name, when you already found it through the provider; skips the lookup |
| `--setting <string>` (repeatable) | A provider voice setting as name=value, used for every line in this voice. Repeat per setting. |

Example:

```
jam audio voice assign innkeeper --voice 21m00Tcm4TlvDq8ikWAM
```

### audio voice speak

Voice dialogue lines with each speaker's assigned voice, paid through a run's ledger. Without lines: every missing or stale line. Each take is processed to the voice target and checked against its text where the transcript check is installed.

```
jam audio voice speak [<line...>] [flags]
```

| Argument | Meaning |
|---|---|
| `line` | Lines as <lines file name>/<line id>, or the id alone when only one file has it |

| Flag | Meaning |
|---|---|
| `--run <string>` | The run whose ledger pays (default: for one line, the run whose subject is the line's id) |
| `--reviewed` | Only lines a person marked reviewed |
| `--speaker <string>` | Only this speaker's lines |
| `--script <string>` | Only this lines file |
| `--takes <integer>` | Takes per line, 1 to 5; each is charged |
| `--authorized <string>` | Who approved this spending, when, in their words (default: the provider's standing authorization) |
| `--dry-run` | Print what would be sent and its cost; send nothing |

Example:

```
jam audio voice speak --run intro-lines --script intro --reviewed
```

### audio voice process

Settle the take that stands for each line: bring it to the voice target, align its words, compare a transcription with the text, and with --run record the lines on the run. Also adds a recording as a take (--file), picks a take (--take), or notes a person's acceptance by ear (--by-ear).

```
jam audio voice process [<line...>] [flags]
```

| Argument | Meaning |
|---|---|
| `line` | Lines as <lines file name>/<line id>, or the id alone when only one file has it |

| Flag | Meaning |
|---|---|
| `--all` | Every line that has a take (after the voice target or the audio format changed) |
| `--run <string>` | Record the processed lines on this run's process step; without lines, the lines this run voiced |
| `--step <string>` | The step to record (default: process) |
| `--file <string>` | Project path of a recording to add as a new take of the one named line |
| `--take <integer>` | Make this take stand for the one named line |
| `--by-ear <string>` | A person listened to the named lines and accepted them: "<where they answered>: <their words>" |
| `--recheck` | Run the transcript check again for takes that already have a result |
| `--creator <string>` | With --file: who recorded it |
| `--license <string>` | With --file: the rights the project has over it |
| `--source <string>` | With --file: where it came from |
| `--source-evidence <string>` | With --run on a run that starts at this step: the document showing where the recordings came from and the right to use them |

Example:

```
jam audio voice process --run intro-lines
```

### audio settings

Show what audio work in this project runs on: the processed format and each kind's loudness target with where it comes from, the provider of the sound and voice routes with its guide and spending caps, where files live, and whether the transcript check is installed.

```
jam audio settings
```

Example:

```
jam audio settings
```

## schemas

The published contract: JSON Schemas of every authored file, and the command reference

### schemas write

Regenerate the published JSON Schemas (schemas/) and the command reference (docs/cli.md) from the toolkit's own definitions.

```
jam schemas write
```

Example:

```
jam schemas write
```

### schemas check

Fail when a published schema or the command reference no longer matches the toolkit's definitions.

```
jam schemas check
```

Example:

```
jam schemas check
```

## doctor

Report everything the toolkit depends on: Node, npm packages, Python imaging packages, Blender, ffmpeg, Git and LFS, configuration, recipes, providers, the engine adapter, unsettled jobs and stale locks. Each line has a status and a fix. Nothing is changed.

```
jam doctor
```

Example:

```
jam doctor
```
