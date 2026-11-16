# Providers: the neutral contract

A provider is a generation service the project can use, described by a descriptor (`providers/<id>.json` in the toolkit, `jam/providers/<id>.json` in the project; `schemas/provider.schema.json`). The toolkit never calls a provider for images or meshes: the agent drives the provider's own command, MCP server or skill, and the run's ledger records what was intended and what happened. Everything that is true of one vendor only is in `docs/providers/<id>.md`; read that page before the first job with that provider.

## Routes

A **route** is one way to get a capability served: `image`, `mesh`, `sound`, `voice`. `jam provider list` shows which providers serve each, how each is reached, its unit, and whether paid work is enabled. `routes.<capability>` in `jam.config.json` is the project's usual choice.

Before the first offer of a session, find out which routes can actually be called:

1. `jam provider list`, then `jam provider probe <id>` for each candidate. It reports **installed**, **authenticated** and **reachable** separately, and says `unknown` for what the toolkit cannot see.
2. Settle each `unknown` yourself with a free call through the provider's own tool (its status or balance read, a model listing; the provider's page names it). A route is callable only when such a call succeeded in this session. A tool the agent itself holds has no account to read: it is callable when it is in this session's tool list.
3. Include the routes that cost nothing extra: a provider whose unit is marked not billed per job (an image tool included in a plan the person already pays for, the agent's own image tool). Offer those beside the paid ones, with what each costs in words.

Report the three facts separately when one is missing ("installed, not signed in"). A route that is installed is not thereby working.

`routes` is a preference. Using another callable route for one operation is fine when the person chose it or the usual one cannot serve the request; say which route and model is in use.

When nothing callable fits what the person allowed (they asked for free, and every route for this capability is paid), stop and say which routes exist and what each needs: a sign-in, a spending limit, or a file they supply. Do not deliver a lesser stand-in without saying so.

## One paid job, start to finish

1. **Load the provider's own skill or help** and read the live schema of the operation: inputs, limits, ignored fields, plan access. Parameters do not carry over between providers.
2. **Price it** the way the descriptor's `quote` says (`jam provider probe <id>` prints it). An exact quote is priced on the real request with the real inputs.
3. **Write the request file** in the run folder, as it will be sent, without credentials, signed URLs or embedded image data.
4. **Open the job**: `jam job open <id> <step> --provider <p> --operation "<model and operation>" --estimate <n> --request <file> --price-source "<where the number came from>"`, with `--quote` for an exact quote or `--list-price` for a published price. A refusal names the cap or the unsettled job in the way; stop and report it.
5. **Submit once**, then at once `jam job submitted <id> <job> --provider-job <the provider's id>`.
6. **Wait by polling the job** with the provider's own wait or status call.
7. **Download every output** into the run folder straight away and leave those files untouched; later edits work on copies. Download links expire and some providers keep outputs only for days.
8. **Settle**: `jam job done <id> <job> --actual <charge> --evidence "<task id, billing entry or file>"`, or `jam job failed` / `jam job cancelled` with the real charge.
9. **Inspect, then record the step** with `--job <job>`. The provider's "succeeded" means a file exists; whether it is right is the step's own inspection.

If the response to a submission is lost: `jam job lost <id> <job>`, then look in the provider's own job history for it. Found: `jam job submitted` with its id. Confirmed absent: `jam job cancelled` with that evidence. A second submission before that could be charged twice, and the ledger refuses it.

## Pacing

- **Poll; never sleep for a guessed time.** The job's own status is the only clock. A "typical wait" in a descriptor is for telling the person what to expect.
- **A refusal that states a wait means exactly that wait.** "Wait 2298 seconds" is a cooldown of 38 minutes on that model, not a queue position. Do not retry the same model inside it.
- **Cooldowns are usually per model.** When the descriptor says so, send the next job to another suitable model and say which model is now in use; tell the person when the model changes, because the result may differ.
- **One job at a time per account** unless the descriptor's `pacing.concurrent` says more. Agents sharing an account say which model each is using.
- **Read real limits before planning around them**: the provider's own limit or usage call, not memory.

## Mesh input

Multiview is the default whenever a turnaround exists: send the individual views the operation accepts (the descriptor's `capabilities.mesh` gives the count and which comes first), keep all five for review, and record which were sent. The contact sheet is never sent as one view. Single-view is used only when the person chose it or the route has no multiview, and that is said before submitting. A lower triangle target, a cheaper quote or a tool's default does not choose single-view.

## Local tools are routes too

A DCC step (retopology, unwrapping, baking, conversion) done on this machine is a route with no job: record it with `--tool "<program and version>"`. A failed remote operation does not by itself authorize switching to a local one, or the reverse; say what failed and which route you propose.

## Trying a provider

`jam run start provider-test <id> --brief-text "..."` runs the `provider-test` recipe: one paid job inside the normal caps, to prove a provider works on this machine. Its output is test evidence; it cannot be delivered or used as content.

## Adding a provider

Write `jam/providers/<id>.json` against `schemas/provider.schema.json`: label, unit (and whether it is paid), capabilities, how it is reached, pacing, how to quote, how to recover a lost job, and a `docs` page for the vendor's specifics. `jam provider list` shows it once the file is valid.
