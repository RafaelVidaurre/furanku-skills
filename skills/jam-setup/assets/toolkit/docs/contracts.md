# Records, custody and staleness

What a run records, what makes recorded work stop counting, and where files live. Command names and flags are in [cli.md](cli.md); `jam` is `node <toolkit>/jam.mjs`. Gates are in [review.md](review.md), spending in [settings.md](settings.md), provider work in [providers.md](providers.md).

## Where files live

| Place | What | Git |
| --- | --- | --- |
| `roots.scratch` (`<scratch>/<id>/<n>/`) | A run's folder: `run.json`, the brief, work in progress | Ignored |
| `roots.delivered` (`<delivered>/<id>/<n>/`) | The delivered copy of a finished run | Tracked; binaries in Git LFS |
| `jam.config.json`, `catalog.config.json`, `jam/` | Project policy, recipes, adapters, descriptors, plugins | Tracked |
| `jam.local.json` | This machine's paths | Ignored |
| `.catalog/` | Notes, organization, collections, review submissions and decisions (`.catalog/.local/` is ignored) | Tracked |

Every stored path is project-relative with forward slashes. Records, request files and evidence never hold an absolute path, a credential or a signed download URL.

A run is one attempt of a recipe for one subject id; `<id>` names the newest attempt and `<id>:<n>` an earlier one. One process writes a run at a time. After a crash, `jam run unlock <id>` removes the lock once the process that held it is gone.

## What a record holds

`jam run record` takes facts as flags and does the rest itself:

- **Files** (`--file`), **inputs** (`--input`) and **evidence** (`--evidence`) are hashed. Keep them unchanged afterwards: a new version is a new file, recorded again.
- **Origin**, exactly one of:
  - `--tool "<tool and version>"` for work done locally;
  - `--job <job>` for a paid result. The job must have succeeded with the same provider and its request file must be unchanged. `<run>/<job>` names another run's job; a job of a test or exploration recipe cannot back content;
  - `--source <origin> --source-evidence <path>` for work made elsewhere (bought, downloaded, hand-made earlier). The evidence is a document that shows the origin and the right to use it.
- **Measurements** are taken by the tool: triangles, materials, texture sizes and texture memory of a `.glb`; pixel size of an image. Texture memory is a decoded RGBA8 estimate with full mip chains, in MiB; it is not what an engine allocates. `--metric name=value` states a value you expect and is refused when the tool measures otherwise. A model that is not a `.glb` is measured by its own tool and passed as `--evidence measurement=<report.json>`, shaped `{"model": {"path", "sha256"}, "tool", "command", "metrics"}` and naming one recorded file by its exact hash.
- **Checks** named by the step run before anything is written. A failed check refuses the record and prints the fix.
- **Dependencies**: the current record of each step this one needs.

Nothing is written unless every part passes. `jam measure <file>` reports the same measurements without recording.

## When recorded work stops counting

`jam run status` judges every record again each time it is read.

| State | Cause | What to do |
| --- | --- | --- |
| `stale` | One of the record's own files, inputs or evidence changed or is missing | Restore the file, or record the step again |
| `stale` | The run's brief changed | Start a new attempt and bring unchanged work in with `--source` |
| `stale` | `style.revision` changed (recipes bound to the style) | The same |
| `stale` | A step it was built on has a newer record, or was skipped then and has been worked since | Record the step again on the new input |
| `blocked` | A step it was built on is no longer accepted | Settle that step first |
| `over-budget` | A measured value is over the run's budget as it is now | Redo the step, or the person relaxes the budget |
| `check-failed` | Another check that runs on status fails now | Fix what it names, record again |

Editing the style document, adding style references or editing a budget makes nothing stale. A tightened budget shows as `over-budget` on the records it catches. Earlier records are kept as history; a step's state always comes from its newest record.

## Paid jobs

The ledger is part of the run file. The toolkit records intent and outcome; the agent submits through the provider's own tool.

| State | Meaning | Moves on with |
| --- | --- | --- |
| `open` | Reserved, nothing sent | `jam job submitted`, `jam job lost`, `jam job cancelled` |
| `submitted` | The provider accepted it | `jam job done`, `jam job failed`, `jam job cancelled` (each with `--actual` and `--evidence`) |
| `lost` | Sent, response not received | `jam job submitted` once found, or `jam job cancelled` with evidence the provider has no such job |
| `succeeded`, `failed`, `cancelled`, `not-submitted` | Settled | Nothing |

- `jam job open` comes before any submission. It is refused when the step is not marked paid, when the provider has no spending entry or a cap of 0, when the estimate would pass a cap, or when the same request file is still unsettled in any run.
- Every job that may still be charged holds its full estimate against the caps. The real charge replaces the estimate when the job is settled. A job cancelled before it was sent costs nothing.
- `--actual` is what the provider charged, read from the provider. A failure is not proof of a refund.
- A lost response stays `lost` until the provider's own history shows what happened. It is never settled by resubmitting.
- A delivery is refused while any job of the run is unsettled.

## Delivery

`jam run deliver <id>` copies everything the accepted steps stand on into the delivered root, checks each copy against its recorded hash and refuses a file Git would ignore. Files recorded from outside the run folder are copied under `external/`. A delivered run no longer changes: further work is a new attempt (`jam run start` with the same id).

Work ends at neutral files: models as GLB in glTF conventions, images as PNG, audio as WAV. glTF stores triangles only, so keep an editable source with quads beside the GLB when the quads matter. Putting files into an engine is a recipe step that runs only when the project's engine adapter provides it.

## Version 1 runs

A version 1 `run.json` stays readable: its stage names are the steps of the `asset` recipe.
