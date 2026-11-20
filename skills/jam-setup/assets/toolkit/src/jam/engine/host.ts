// Engine commands run on behalf of a run: the host finds the run's files, calls the adapter with
// the command's standard arguments, and records the step the recipe marks as done by that command.
import * as Effect from "effect/Effect"
import { decode } from "../../kernel/decode.ts"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { Ids, nowIso } from "../../kernel/Ids.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { Stamps } from "../../kernel/Stamps.ts"
import { ClipSpec, runSpecs } from "../animation/clip.ts"
import { Checks } from "../checks/Checks.ts"
import { Measure } from "../measure/Measure.ts"
import { Recipes } from "../recipes/Recipes.ts"
import type { ResolvedStep } from "../recipes/schema.ts"
import { kindOf } from "../runs/media.ts"
import { type RecordResult, recordSteps } from "../runs/record.ts"
import { type RunContext, Runs } from "../runs/Runs.ts"
import { latestRecord } from "../runs/schema.ts"
import { Engine, type EngineOutcome } from "./Engine.ts"
import { ConformReceipt, ImportReceipt, takesKind } from "./schema.ts"

export interface HostedResult {
  readonly outcome: EngineOutcome
  /** The step recorded for the run, when the adapter ran the command. */
  readonly recorded?: RecordResult
}

type Needs = Runs | Recipes | Stamps | Measure | Checks | Ids | ProjectFiles | Engine

interface RunTarget {
  readonly run?: string | undefined
  readonly step?: string | undefined
  /** Arguments after `--`, passed to the adapter's command as typed. */
  readonly extra?: ReadonlyArray<string>
}

const LANDMARKS_ROLE = "landmarks"
/** The import kind for animation clips; its sources are a run's recorded `clip` files. */
const ANIMATION = "animation"

/** The step a recipe marks as performed by `jam engine <command>`. */
const stepFor = (context: RunContext, command: string, named: string | undefined): Effect.Effect<ResolvedStep, ToolError> => {
  const candidates = context.recipe.steps.filter((step) => step.run?.[0] === "engine" && step.run[1] === command)
  const step = named === undefined ? (candidates.length === 1 ? candidates[0] : undefined) : context.recipe.steps.find((candidate) => candidate.id === named)
  return step !== undefined
    ? Effect.succeed(step)
    : fail("invalid", named !== undefined
      ? `step ${named} is not in recipe ${context.recipe.id}`
      : `recipe ${context.recipe.id} has ${candidates.length === 0 ? "no step" : "several steps"} run by "jam engine ${command}"`, {
      fix: `name the step with --step <step>; steps: ${context.recipe.steps.map((candidate) => candidate.id).join(", ")}`
    })
}

/** Files with a role in the current record of the last needed step that has any. */
const fromNeeds = (context: RunContext, step: ResolvedStep, role: string): ReadonlyArray<string> => {
  for (const need of [...step.needs].reverse()) {
    if (context.ref.run.steps[need]?.skip !== undefined) continue
    const found = latestRecord(context.ref.run, need)?.files.filter((file) => file.role === role).map((file) => file.path) ?? []
    if (found.length > 0) return found
  }
  return []
}

/** Audio files, whatever their role, in the current record of the last needed step that has any. */
const audioFromNeeds = (context: RunContext, step: ResolvedStep): ReadonlyArray<string> => {
  for (const need of [...step.needs].reverse()) {
    if (context.ref.run.steps[need]?.skip !== undefined) continue
    const found = latestRecord(context.ref.run, need)?.files.filter((file) => kindOf(file.path) === "audio").map((file) => file.path) ?? []
    if (found.length > 0) return found
  }
  return []
}

const sourcesFor = (context: RunContext, step: ResolvedStep, given: ReadonlyArray<string>, command: string, what: "model" | "clip" | "audio" = "model"): Effect.Effect<ReadonlyArray<string>, ToolError> => {
  const sources = given.length > 0 ? given : what === "audio" ? audioFromNeeds(context, step) : fromNeeds(context, step, what)
  return sources.length > 0
    ? Effect.succeed(sources)
    : fail("conflict", `nothing to ${command}: the steps ${step.id} needs (${step.needs.join(", ") || "none"}) have no recorded ${what}`, {
      fix: `record them first ("jam run next ${context.ref.run.id}"), or name the files after the command`
    })
}

const pair = (flag: string, value: string | number | undefined): ReadonlyArray<string> => (value === undefined ? [] : [flag, String(value)])
const resumeLine = (command: string, target: RunTarget, flags: ReadonlyArray<string>): string =>
  ["jam engine", command, ...flags, ...pair("--run", target.run), ...pair("--step", target.step), ...(target.extra !== undefined && target.extra.length > 0 ? ["--", ...target.extra] : [])].join(" ")

export interface ImportInput extends RunTarget {
  readonly kind: string
  readonly files: ReadonlyArray<string>
  /** Where in the engine's content the assets go. */
  readonly destination?: string | undefined
  /** `name=material`: which engine material a slot of the model uses. */
  readonly slots?: ReadonlyArray<string>
  /** Skeleton profile a skinned import binds to. */
  readonly skeleton?: string | undefined
  /** What an animation plays on: an engine id, or a project file holding the import receipt of that asset. */
  readonly target?: string | undefined
  /** The engine asset's name. For an animation imported for a run: the run's clip spec id unless given. */
  readonly name?: string | undefined
}

/** The id of the run's clip spec: the name its animation is imported under, so two clips never share an engine asset by file name. */
const clipNameOf = (context: RunContext): Effect.Effect<string, ToolError, ProjectFiles> =>
  Effect.gen(function*() {
    const specs = runSpecs(context.ref.run)
    if (specs.length !== 1) {
      return yield* fail("invalid", `the run records ${specs.length} clip specs, so the animation has no name to import under`, { fix: "record the clip spec at the define step, or pass --name <engine asset name>" })
    }
    const spec = yield* Effect.flatMap((yield* ProjectFiles).readJson(specs[0]!.path), decode(ClipSpec, { what: specs[0]!.path }))
    return spec.id
  })

/** The engine id an animation plays on: given as such, or the first asset of an import receipt (a skinned import lists its skinned asset first). */
const targetOf = (given: string): Effect.Effect<string, ToolError, ProjectFiles> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    if (!given.toLowerCase().endsWith(".json") || !(yield* files.exists(given).pipe(Effect.catch(() => Effect.succeed(false))))) return given
    const receipt = yield* Effect.flatMap(files.readJson(given), decode(ImportReceipt, { what: `--target ${given}`, strict: false, fix: "give the receipt a skinned import printed, or the engine id of the asset" }))
    const first = receipt.assets[0]
    return first !== undefined ? first.id : yield* fail("invalid", `--target ${given}: the receipt lists no asset`)
  })

/**
 * `jam engine import`. The adapter's command receives
 * `--kind <kind> <file>... [--destination <where>] [--slot <name>=<material>]... [--skeleton <id>] [--target <id>] [--name <name>] [<extra>...]`.
 * For a run, the import step is recorded with the engine's asset ids.
 */
export const importFor = (input: ImportInput): Effect.Effect<HostedResult, ToolError, Needs> =>
  Effect.gen(function*() {
    const engine = yield* Engine
    const files = yield* ProjectFiles
    const context = input.run === undefined ? null : yield* (yield* Runs).open(input.run)
    const step = context === null ? null : yield* stepFor(context, "import", input.step)
    const command = (yield* engine.resolved).adapter.commands?.["import"]
    if (command != null && !takesKind(command.kinds, input.kind)) {
      return yield* fail("invalid", `--kind ${input.kind}: this adapter ${command.kinds === undefined ? `lists no kinds, and imports ${input.kind} only when it lists it` : `imports ${command.kinds.join(", ")}`}`, {
        fix: `"jam engine show" lists the kinds the adapter's import takes`
      })
    }
    const animation = input.kind === ANIMATION
    if (animation && input.target === undefined) {
      return yield* fail("invalid", "--kind animation needs --target: the skinned asset or skeleton already in the engine that the clip plays on", {
        fix: "pass --target <engine id>, or --target <the receipt file of that asset's import>"
      })
    }
    const target = input.target === undefined ? undefined : yield* targetOf(input.target)
    const name = input.name ?? (animation && context !== null ? yield* clipNameOf(context) : undefined)
    const sources = context === null || step === null ? input.files : yield* sourcesFor(context, step, input.files, "import", input.kind.startsWith("audio") ? "audio" : animation ? "clip" : "model")
    if (sources.length === 0) return yield* fail("invalid", "name the files to import, or the run whose result to import with --run <id>")
    const budget = context?.ref.run.budget
    const skeleton = input.skeleton ?? (budget == null ? undefined : context?.config.budgets[budget]?.skeleton)
    const flags = [...pair("--destination", input.destination), ...(input.slots ?? []).flatMap((slot) => ["--slot", slot]), ...pair("--skeleton", skeleton), ...pair("--target", target), ...pair("--name", name), ...(input.extra ?? [])]
    const outcome = yield* engine.run("import", ["--kind", input.kind, ...sources, ...flags], resumeLine("import", input, ["--kind", input.kind, ...pair("--target", input.target), ...(input.run === undefined ? sources : [])]))
    if (outcome.status !== "ran" || context === null || step === null) return { outcome }
    const receipt = yield* decode(ImportReceipt, { what: `import receipt of adapter ${outcome.adapter}`, code: "malformed", strict: false })(outcome.receipt)
    const evidence = `${context.ref.dir}/engine-import-${(yield* nowIso).replace(/[^0-9]/g, "").slice(0, 14)}.json`
    yield* files.writeJson(evidence, { adapter: outcome.adapter, kind: input.kind, sources, ...outcome.receipt })
    const recorded = yield* recordSteps({
      run: input.run!,
      steps: [step.id],
      files: [],
      evidence: [`receipt=${evidence}`],
      inputs: sources,
      note: `Imported ${sources.join(", ")} as ${input.kind}${target === undefined ? "" : ` onto ${target}`} through engine adapter ${outcome.adapter}.`,
      tool: `engine adapter ${outcome.adapter} import`,
      engineAssets: receipt.assets,
      arguments: ["--kind", input.kind, ...flags]
    })
    return { outcome, recorded }
  })

export interface ConformInput extends RunTarget {
  readonly files: ReadonlyArray<string>
  readonly skeleton?: string | undefined
  /** Landmark file of the model's joints. */
  readonly landmarks?: string | undefined
  /** The character's height in meters. */
  readonly height?: number | undefined
  /** How many fingers the result has, as the adapter understands it. */
  readonly fingers?: string | undefined
  readonly out?: string | undefined
  readonly accept?: string | undefined
}

/**
 * `jam engine conform-skeleton`. The adapter's command receives
 * `<model> [--landmarks <file>] --skeleton <id> [--height <meters>] [--fingers <n>] [--out <folder>] [<extra>...]`.
 * For a run, the conform step is recorded with the reworked model.
 */
export const conformFor = (input: ConformInput): Effect.Effect<HostedResult, ToolError, Needs> =>
  Effect.gen(function*() {
    const engine = yield* Engine
    const context = input.run === undefined ? null : yield* (yield* Runs).open(input.run)
    const step = context === null ? null : yield* stepFor(context, "conform-skeleton", input.step)
    const sources = context === null || step === null ? input.files : yield* sourcesFor(context, step, input.files, "conform-skeleton")
    if (sources.length !== 1) {
      return yield* fail("invalid", sources.length === 0 ? "name the rigged model to conform, or the run whose rig to conform with --run <id>" : `conform-skeleton takes one model; got ${sources.length}`)
    }
    const budget = context?.ref.run.budget
    const skeleton = input.skeleton ?? (budget == null ? undefined : context?.config.budgets[budget]?.skeleton)
    if (skeleton === undefined) {
      return yield* fail("invalid", "which skeleton to conform to is not stated", { fix: `add --skeleton <id> ("jam engine facts skeletons" lists them), or name one in the run's budget` })
    }
    const landmarks = input.landmarks ?? (context === null || step === null ? undefined : fromNeeds(context, step, LANDMARKS_ROLE)[0])
    const out = input.out ?? (context === null ? undefined : `${context.ref.dir}/conform`)
    const flags = [...pair("--landmarks", landmarks), "--skeleton", skeleton, ...pair("--height", input.height), ...pair("--fingers", input.fingers), ...pair("--out", out), ...(input.extra ?? [])]
    const outcome = yield* engine.run("conform-skeleton", [...sources, ...flags], resumeLine("conform-skeleton", input, input.run === undefined ? sources : []))
    if (outcome.status !== "ran" || context === null || step === null) return { outcome }
    const receipt = yield* decode(ConformReceipt, { what: `conform-skeleton receipt of adapter ${outcome.adapter}`, code: "malformed", strict: false })(outcome.receipt)
    const [model, ...others] = receipt.files
    const recorded = yield* recordSteps({
      run: input.run!,
      steps: [step.id],
      files: [`model=${model}`, ...others.map((file) => `support=${file}`)],
      evidence: receipt.report === undefined ? [] : [`report=${receipt.report}`],
      inputs: [...sources, ...(landmarks === undefined ? [] : [landmarks])],
      note: `Conformed ${sources.join(", ")} to skeleton ${skeleton} through engine adapter ${outcome.adapter}.`,
      tool: `engine adapter ${outcome.adapter} conform-skeleton`,
      arguments: flags,
      accept: input.accept
    })
    return { outcome, recorded }
  })
