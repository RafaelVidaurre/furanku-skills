// `jam engine …`: the one way skills reach an engine. They name commands, never an engine.
import * as Argument from "effect/cli/Argument"
import * as Command from "effect/cli/Command"
import * as Flag from "effect/cli/Flag"
import * as Effect from "effect/Effect"
import { afterSeparator, Argv } from "../../kernel/Argv.ts"
import { Output } from "../../kernel/cli.ts"
import { attempt, fail } from "../../kernel/errors.ts"
import { described, flag, many, maybe, text } from "../cliSupport.ts"
import { lines, pairs } from "../text.ts"
import { Engine, type EngineOutcome } from "./Engine.ts"
import { factAt } from "./factPath.ts"
import { conformFor, type HostedResult, importFor } from "./host.ts"
import { inventoryFor } from "./inventory.ts"
import { previewsFor } from "./previews.ts"
import { type Verb, VERBS } from "./schema.ts"

const stepText = (step: unknown, index: number): string => `  ${index + 1}. ${typeof step === "string" ? step : JSON.stringify(step)}`

const outcomeText = (outcome: EngineOutcome): string =>
  outcome.status === "ran"
    ? JSON.stringify(outcome.receipt, null, 2)
    : outcome.status === "handoff"
    ? lines(`not done: ${outcome.reason}`, "do these by hand, in order:", ...outcome.steps.map(stepText), `then run again: ${outcome.resume}`)
    : lines(outcome.next, outcome.guide === null ? null : `\n${outcome.guide.text}`)

const emitHosted = (result: HostedResult) =>
  Effect.flatMap(Output, (output) =>
    output.emit(result, lines(
      outcomeText(result.outcome),
      result.recorded === undefined ? null : `recorded ${result.recorded.records.map((entry) => `${entry.step} (${entry.state})`).join(", ")}`,
      result.recorded === undefined ? null : `next: ${result.recorded.next}`
    )))

// The parser folds what follows `--` into the trailing arguments; the command line says where it began.
const split = (args: ReadonlyArray<string>) =>
  Effect.map(Argv, (argv) => {
    const extra = afterSeparator(argv)
    const tail = extra.length > 0 && extra.every((value, index) => args[args.length - extra.length + index] === value)
    return tail ? { files: args.slice(0, args.length - extra.length), extra } : { files: args, extra: [] as ReadonlyArray<string> }
  })

const show = Command.make("show", {}, () =>
  Effect.gen(function*() {
    const engine = yield* Engine
    const current = yield* engine.resolved
    const own = current.provides.filter((name) => !VERBS.includes(name as Verb))
    const topics = yield* engine.topics
    const kinds = Object.fromEntries(current.provides.flatMap((name) => {
      const listed = current.adapter.commands?.[name]?.kinds
      return listed === undefined ? [] : [[name, listed]]
    }))
    yield* (yield* Output).emit(
      {
        id: current.id, label: current.label, source: current.source, dir: current.dir, versions: current.adapter.versions ?? null,
        commands: Object.fromEntries(VERBS.map((verb) => [verb, current.provides.includes(verb)])), kinds, own, docs: topics, available: yield* engine.available
      },
      pairs([
        ["adapter", `${current.id}: ${current.label}`],
        ["source", current.source === "project" ? current.dir : current.source === "preset" ? "preset shipped with the toolkit (facts and a guide)" : "no engine chosen"],
        ["versions", current.adapter.versions],
        ["runs", VERBS.filter((verb) => current.provides.includes(verb)).join(", ") || "nothing: every engine step is done by hand or skipped"],
        ["imports", current.provides.includes("import") ? (kinds["import"]?.join(", ") ?? "kinds not listed") : undefined],
        ["its own", own.length === 0 ? undefined : `${own.join(", ")}  (jam engine run <name>)`],
        ["guides", topics.join(", ") || undefined],
        ["others", (yield* engine.available).filter((other) => other.id !== current.id).map((other) => other.id).join(", ") || undefined]
      ])
    )
  })).pipe(described("Show the engine adapter in force: where it comes from, which commands it runs itself, which guides it has.", "jam engine show"))

const facts = Command.make("facts", { path: Argument.String("key").pipe(Argument.withDescription("Path of one fact, a key per argument (keys may contain dots): skeletons <id> bones upper-leg.l. One dotted argument works when unambiguous: mesh.static"), Argument.variadic()) }, ({ path }) =>
  Effect.gen(function*() {
    const resolved = (yield* (yield* Engine).resolved).facts
    const value = path.length === 0 ? resolved : yield* attempt("read the fact", () => factAt(resolved, path), "invalid")
    if (value === undefined) return yield* fail("not_found", `the engine facts have nothing at ${path.join(" ")}`, { fix: `"jam engine facts" prints all of them` })
    yield* (yield* Output).emit(value, typeof value === "string" || typeof value === "number" ? String(value) : JSON.stringify(value, null, 2))
  })).pipe(described("Print the engine's conventions (units, axes, formats, naming, skeletons) with the project's overrides applied. Skills read conventions here.", "jam engine facts skeletons biped bones upper-leg.l"))

const install = Command.make("install", { folder: Argument.String("folder").pipe(Argument.withDescription("Folder holding adapter.json, commands/ and docs/ (anywhere on this machine)")) }, ({ folder }) =>
  Effect.gen(function*() {
    const result = yield* (yield* Engine).install(folder)
    yield* (yield* Output).emit(result, `installed adapter ${result.id} in ${result.dir} (${result.files} files) and selected it\nnext: jam engine show`)
  })).pipe(described("Copy an engine adapter folder into the project (jam/engines/<id>/) and select it in jam.config.json.", "jam engine install path/to/adapter"))

const runFlags = {
  run: text("run", "Work on this run's result and record the step the recipe marks for this command"),
  step: text("step", "The step to record, when the recipe has several for this command")
}
const fileArgs = Argument.String("file").pipe(Argument.withDescription("Project files; with --run they default to the run's current model, or for an audio kind its processed audio. Anything after -- goes to the adapter's command as typed."), Argument.variadic())

const importCommand = Command.make("import", {
  kind: Flag.String("kind").pipe(Flag.withDescription("What is imported: static, skinned, animation, textures, audio, ... (the adapter says which it accepts; \"jam engine show\" lists them)")),
  destination: text("destination", "Where in the engine's content the assets go (default: the adapter's own rule)"),
  slot: many("slot", "Which engine material a slot of the model uses, as name=material. Repeat per slot."),
  skeleton: text("skeleton", "Skeleton profile a skinned import binds to (default: the one the run's budget names)"),
  target: text("target", "For --kind animation: what the clip plays on, a skinned asset or skeleton already in the engine, as its engine id or as the import receipt file that made it"),
  name: text("name", "The engine asset's name (default: the adapter's own rule; for --kind animation with --run, the id of the run's clip spec)"),
  files: fileArgs,
  ...runFlags
}, (input) =>
  Effect.gen(function*() {
    const { files, extra } = yield* split(input.files)
    yield* emitHosted(yield* importFor({
      kind: input.kind, files, destination: maybe(input.destination), slots: input.slot, skeleton: maybe(input.skeleton), target: maybe(input.target), name: maybe(input.name), run: maybe(input.run), step: maybe(input.step), extra
    }))
  })).pipe(described(
    "Import files into the engine through the adapter and print its receipt (the engine's asset ids). With --run the import step is recorded with those ids; for --kind animation the run's recorded clip is imported onto --target. Without an import command it prints the adapter's guide for doing it by hand.",
    "jam engine import --kind static --run oak-barrel"
  ))

const conform = Command.make("conform-skeleton", {
  skeleton: text("skeleton", "Skeleton profile id (default: the one the run's budget names)"),
  landmarks: text("landmarks", "Landmark file of the model's joints (default: the one the rig step recorded with role landmarks)"),
  height: Flag.Finite("height").pipe(Flag.withDescription("The character's height in meters"), Flag.optional),
  fingers: text("fingers", "How many fingers the result has, as the adapter understands it"),
  out: text("out", "Folder for the result (default: conform/ in the run folder)"),
  accept: text("accept", "Agent self-review reason for the recorded step"),
  files: fileArgs,
  ...runFlags
}, (input) =>
  Effect.gen(function*() {
    const { files, extra } = yield* split(input.files)
    yield* emitHosted(yield* conformFor({
      files, skeleton: maybe(input.skeleton), landmarks: maybe(input.landmarks), height: maybe(input.height), fingers: maybe(input.fingers),
      out: maybe(input.out), run: maybe(input.run), step: maybe(input.step), accept: maybe(input.accept), extra
    }))
  })).pipe(described(
    "Rework a rigged model onto one of the engine's skeletons, so that engine's animations play without retargeting. Only adapters whose engine needs it provide this.",
    "jam engine conform-skeleton --run hero"
  ))

const inventory = Command.make("inventory", {
  out: text("out", "Project path of the inventory file (default: .engine/inventory.json in the scratch root)"),
  full: flag("full", "Read every file again instead of reusing what the previous inventory read"),
  engine: flag("engine", "Let the adapter start the engine for what files cannot give: unreadable files, effective property values"),
  args: Argument.String("args").pipe(Argument.withDescription("Arguments for the adapter's command; put ones that start with a dash after --"), Argument.variadic())
}, (input) =>
  Effect.gen(function*() {
    const result = yield* inventoryFor({ out: maybe(input.out), full: input.full, engine: input.engine, extra: input.args })
    const receipt = result.outcome.status === "ran" ? result.outcome.receipt : null
    // The inventory itself stays in its file; it can be large.
    yield* (yield* Output).emit({ outcome: result.outcome, path: result.path }, receipt === null
      ? outcomeText(result.outcome)
      : lines(
        `${result.path}: ${receipt["files"]} files, ${receipt["assets"]} assets`,
        `read ${receipt["read"]}, reused ${receipt["reused"]}, removed ${receipt["removed"]}`,
        Number(receipt["unread"]) > 0 ? `${receipt["unread"]} files could not be read; "jam engine inventory --engine" reads them through the engine` : null
      ))
  })).pipe(described(
    "Read what the engine's content holds (files, assets, classes, engine metadata, references) into one inventory file. Only files whose size or modification time changed are read again.",
    "jam engine inventory"
  ))

const previews = Command.make("previews", {
  out: text("out", "Project path of the previews folder (default: .engine/previews in the scratch root)"),
  full: flag("full", "Make every preview again, not only those of files that changed"),
  noEngine: flag("no-engine", "Make only the previews the engine's files hold themselves; no engine starts"),
  only: many("only", "Only files whose project path matches this pattern (* within a folder, ** any depth). Repeat for several."),
  limit: Flag.Int("limit").pipe(Flag.withDescription("Make at most this many previews through the engine in this run"), Flag.optional),
  args: Argument.String("args").pipe(Argument.withDescription("Arguments for the adapter's command; put ones that start with a dash after --"), Argument.variadic())
}, (input) =>
  Effect.gen(function*() {
    const result = yield* previewsFor({ out: maybe(input.out), full: input.full, engine: !input.noEngine, only: input.only, limit: maybe(input.limit), extra: input.args })
    const receipt = result.outcome.status === "ran" ? result.outcome.receipt : null
    yield* (yield* Output).emit({ outcome: result.outcome, dir: result.dir }, receipt === null
      ? outcomeText(result.outcome)
      : lines(
        `${receipt["index"]}: ${receipt["previews"]} files have a preview`,
        `made ${receipt["made"]}, reused ${receipt["reused"]}, failed ${receipt["failed"]}, no preview for their kind ${receipt["none"]}`,
        Number(receipt["waiting"]) > 0 ? `${receipt["waiting"]} files wait for the engine; run "jam engine previews" without --no-engine or --limit` : null
      ))
  })).pipe(described(
    "Make a viewable preview of each engine file (an image, a self-contained model or a sound) into one machine-local folder, for the catalog. Only files whose content changed are made again. It may start the engine.",
    "jam engine previews"
  ))

const adapterArgs = Argument.String("args").pipe(Argument.withDescription("Arguments for the adapter's command; put ones that start with a dash after --"), Argument.variadic())

const passthrough = (verb: Verb, description: string, example: string) =>
  Command.make(verb, { args: adapterArgs }, ({ args }) =>
    Effect.gen(function*() {
      const outcome = yield* (yield* Engine).run(verb, args)
      yield* (yield* Output).emit(outcome, outcomeText(outcome))
    })).pipe(described(description, example))

const own = Command.make("run", { name: Argument.String("name").pipe(Argument.withDescription("One of the adapter's own commands; \"jam engine show\" lists them")), args: adapterArgs }, ({ name, args }) =>
  Effect.gen(function*() {
    const engine = yield* Engine
    const current = yield* engine.resolved
    if (!(name in (current.adapter.commands ?? {}))) {
      return yield* fail("not_found", `adapter ${current.id} has no command ${name}`, { fix: current.provides.length > 0 ? `it runs: ${current.provides.join(", ")}` : `${current.id} runs no commands` })
    }
    const outcome = yield* engine.run(name, args)
    yield* (yield* Output).emit(outcome, outcomeText(outcome))
  })).pipe(described("Run a command the adapter adds beside the standard ones (collision fitting, exporting a reference skeleton, ...) and print its one JSON receipt.", "jam engine run fit-collision -- --mode measure <engine asset id>"))

const docs = Command.make("docs", { topic: Argument.String("topic").pipe(Argument.withDescription("Guide topic, e.g. import or acceptance; \"jam engine show\" lists them")) }, ({ topic }) =>
  Effect.gen(function*() {
    const guide = yield* (yield* Engine).doc(topic)
    yield* (yield* Output).emit(guide, `${guide.path}\n\n${guide.text}`)
  })).pipe(described("Print the adapter's guidance on a topic. A facts-only preset has a guide too.", "jam engine docs import"))

export const engine = Command.make("engine").pipe(
  Command.withDescription("The engine adapter: conventions, and commands that reach the engine"),
  Command.withSubcommands([
    show,
    facts,
    install,
    importCommand,
    passthrough("inspect", "Ask the engine what an imported asset is: bounds in meters, pivot, material slots, skeleton, collision. The engine-inspect check compares this with the budget.", "jam engine inspect <engine asset id>"),
    passthrough("references", "List what an engine asset references and what references it.", "jam engine references <engine asset id>"),
    passthrough("capture", "Capture a still of an asset or a level from the engine. Prefer one still to a recording.", "jam engine capture <engine asset id> out.png"),
    passthrough("check", "Run the adapter's own project checks; it prints problems in the same shape as the toolkit's checks.", "jam engine check"),
    conform,
    inventory,
    previews,
    own,
    docs
  ])
)
