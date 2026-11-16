// Starting a run and changing what it requires.
import * as Effect from "effect/Effect"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { nowIso } from "../../kernel/Ids.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { Stamps } from "../../kernel/Stamps.ts"
import { Checks } from "../checks/Checks.ts"
import { Config } from "../config/Config.ts"
import type { JamConfig } from "../config/schema.ts"
import { Recipes } from "../recipes/Recipes.ts"
import { recipeProblems, stepOf } from "../recipes/resolve.ts"
import type { ResolvedRecipe } from "../recipes/schema.ts"
import { Runs } from "./Runs.ts"
import { type Run, runKey } from "./schema.ts"

export interface StartInput {
  readonly recipe: string
  readonly id: string
  readonly brief?: string | undefined
  readonly briefText?: string | undefined
  readonly budget?: string | undefined
  /** Steps a person must accept in this run, whatever the recipe or review mode says. */
  readonly human: ReadonlyArray<string>
  /** Start at this step from existing work. */
  readonly from?: string | undefined
  readonly dir?: string | undefined
}

export interface StartResult {
  readonly id: string
  readonly n: number
  readonly run: string
  readonly dir: string
  readonly recipe: string
  readonly budget: string | null
  readonly notes: ReadonlyArray<string>
  readonly next: string
}

const budgetFor = (config: JamConfig, recipe: ResolvedRecipe, asked: string | undefined): Effect.Effect<{ budget: string | null; note: string | null }, ToolError> => {
  const defined = Object.keys(config.budgets)
  if (asked !== undefined) {
    return asked in config.budgets
      ? Effect.succeed({ budget: asked, note: null })
      : fail("not_found", `--budget ${asked} is not defined in jam.config.json`, { fix: defined.length > 0 ? `use one of: ${defined.join(", ")}` : `define it first: jam config set budgets.${asked} '<json>'` })
  }
  if (recipe.budget === undefined) return Effect.succeed({ budget: null, note: null })
  return Effect.succeed({
    budget: recipe.budget,
    note: recipe.budget in config.budgets ? null : `budget ${recipe.budget} is not defined yet; steps that check a budget will refuse until it is (jam config set budgets.${recipe.budget} '<json>')`
  })
}

export const startRun = (input: StartInput): Effect.Effect<StartResult, ToolError, Runs | Recipes | Config | Checks | Stamps | ProjectFiles> =>
  Effect.gen(function*() {
    const runs = yield* Runs
    const files = yield* ProjectFiles
    const config = yield* (yield* Config).load
    const recipe = yield* (yield* Recipes).get(input.recipe)
    const known = new Set((yield* (yield* Checks).list).map((check) => check.id))
    const broken = recipeProblems(recipe, { checks: known, guides: new Map() })
    if (broken.length > 0) return yield* fail("invalid", broken.map((problem) => problem.message).join("; "), { fix: `"jam recipe check ${recipe.id}" lists what to correct` })
    for (const step of [...input.human, ...(input.from === undefined ? [] : [input.from])]) {
      yield* Effect.try({ try: () => stepOf(recipe, step), catch: (cause) => cause as ToolError })
    }
    if ((input.brief === undefined) === (input.briefText === undefined)) {
      return yield* fail("invalid", "give the brief as --brief <file> or --brief-text \"...\" (one of them)", { fix: "the brief says what is wanted; changing it later makes the run's work stale" })
    }
    // A missing style document does not stop work: a project may have no written art direction yet,
    // or the work may be one operation on an existing file. A document that is named but absent is a
    // broken setting, and is refused.
    const styleNotes: Array<string> = []
    if (recipe.style && config.style.document === null) {
      styleNotes.push("no style document is set, so this run is not bound to an art direction; settle one (jam config set style.document <path>) before work that must match the game's look")
    } else if (recipe.style && config.style.document !== null && !(yield* files.exists(config.style.document))) {
      return yield* fail("conflict", `style.document is ${config.style.document}, which does not exist`, {
        fix: `write it, point the setting at the right file (jam config set style.document <path>), or clear it (jam config set style.document null)`
      })
    }
    const { budget, note } = yield* budgetFor(config, recipe, input.budget)
    const scratch = recipe.roots.scratch ?? config.roots.scratch
    const attempt = yield* runs.nextAttempt(input.id, scratch)
    const dir = input.dir ?? attempt.dir
    const briefPath = input.brief ?? `${dir}/brief.md`
    if (input.briefText !== undefined) {
      if (input.briefText.trim() === "") return yield* fail("invalid", "--brief-text is empty")
      yield* files.writeText(briefPath, `${input.briefText.trim()}\n`)
    }
    const run: Run = {
      version: 2,
      id: input.id,
      n: attempt.n,
      recipe: recipe.id,
      budget,
      created: yield* nowIso,
      brief: yield* (yield* Stamps).stamp(briefPath),
      style: { revision: config.style.revision ?? null },
      human: [...new Set(input.human)],
      ...(input.from === undefined ? {} : { entry: input.from }),
      steps: {},
      jobs: []
    }
    const ref = yield* runs.create(dir, run)
    return {
      id: run.id,
      n: run.n,
      run: ref.path,
      dir,
      recipe: recipe.id,
      budget,
      notes: [...(note === null ? [] : [note]), ...styleNotes],
      next: `jam run next ${run.id}`
    }
  })

export interface SetInput {
  readonly run: string
  readonly budget?: string | undefined
  readonly human: ReadonlyArray<string>
}

/** Name the run's budget, or require a person for more steps. Requirements are only ever added. */
export const setRun = (input: SetInput): Effect.Effect<{ id: string; budget: string | null; human: ReadonlyArray<string> }, ToolError, Runs> =>
  Effect.gen(function*() {
    const runs = yield* Runs
    const opened = yield* runs.open(input.run)
    if (input.budget === undefined && input.human.length === 0) return yield* fail("invalid", "nothing to set: give --budget <name> or --human <steps>")
    if (input.budget !== undefined && !(input.budget in opened.config.budgets)) {
      return yield* fail("not_found", `--budget ${input.budget} is not defined in jam.config.json`, { fix: `use one of: ${Object.keys(opened.config.budgets).join(", ") || "(none defined)"}` })
    }
    for (const step of input.human) yield* Effect.try({ try: () => stepOf(opened.recipe, step), catch: (cause) => cause as ToolError })
    if (opened.ref.delivered || opened.ref.run.deliveredTo !== undefined) return yield* fail("conflict", `run ${runKey(opened.ref.run)} is delivered and no longer changes`)
    const next = yield* runs.mutate(opened.ref.path, (run) => {
      const changed: Run = { ...run, budget: input.budget ?? run.budget, human: [...new Set([...run.human, ...input.human])] }
      return Effect.succeed([changed, changed] as const)
    })
    return { id: next.id, budget: next.budget, human: next.human }
  })
