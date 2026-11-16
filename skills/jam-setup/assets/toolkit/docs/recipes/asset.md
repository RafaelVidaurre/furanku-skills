# 3D asset recipe

Notes for each step of the `asset` recipe. `jam run next` points here; `jam recipe show asset` lists the steps.

Each step's skill says how the work is done; these notes say only what this recipe adds. `prop` and `character` extend this recipe and carry their own notes.

## concept

One image that settles the design: `jam-concept`. Skip it by starting later when the design already exists as a file: `jam run start asset <id> --from <step>`.

## turnaround

Five views of the accepted concept: `jam-turnaround`. A subject whose sides are identical may reuse one side view: record with `--symmetric`.

## mesh

`jam-model`. Ask the mesh route for the budget's `triangles.target` and, when it can return one, the unreduced mesh as well: later steps bake detail from it and measure against it.

## topology

`jam-retopo`. This is also where an existing model enters (`--from topology`): a scan to reduce, a bought or hand-made model to check against the budget. A model already within budget is recorded as it is, with the report and the reason.

## uv

`jam-uv`. An existing model enters here (`--from uv`) when its topology is settled and its UVs are missing or wrong.

## texture

`jam-texture`. An existing model enters here (`--from texture`) to be retextured or to have its texture memory brought within budget.

When one operation produced topology, UVs and textures together (a generated mesh that arrives within budget, unwrapped and textured), record the three in one call: `jam run record <id> topology uv texture --file model=<file> ...`. Each step still needs its own evidence in that call: the topology report and wire sheet, the UV report and layout, the texture report and stills.

## delivery

The model accepted at the texture step is the delivery: record it with the three reports and one sheet of textured stills as evidence, request the person's review (`jam run request-review <id> delivery`), then `jam run deliver <id>`. The delivered file is a GLB in glTF conventions (metres, +Y up, front +Z); a project with an engine imports it through its adapter (`jam-engine`).
