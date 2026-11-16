// `jam recipe …`.
import * as Argument from "effect/cli/Argument"
import * as Command from "effect/cli/Command"
import * as Flag from "effect/cli/Flag"
import * as Effect from "effect/Effect"
import { Output } from "../../kernel/cli.ts"
import { attempt, fail, type ToolError } from "../../kernel/errors.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { Checks } from "../checks/Checks.ts"
import { described, maybe, text } from "../cliSupport.ts"
import type { Problem } from "../common.ts"
import { Config } from "../config/Config.ts"
import { BUILTIN_PREFIX } from "../layout.ts"
import { Runs } from "../runs/Runs.ts"
import { conditionFacts } from "../runs/status.ts"
import { lines, table } from "../text.ts"
import { Toolkit } from "../Toolkit.ts"
import { captureRecipe } from "./capture.ts"
import { evaluateCondition } from "./conditions.ts"
import { resolveGuide } from "./guides.ts"
import { Recipes } from "./Recipes.ts"
import { recipeProblems, stepOf } from "./resolve.ts"
import { GATES, type Recipe, type ResolvedRecipe, type Step } from "./schema.ts"

const recipeArg = Argument.String("id").pipe(Argument.withDescription("Recipe id"))

const list = Command.make("list", {}, () =>
  Effect.gen(function*() {
    const recipes = yield* Recipes
    const entries = yield* recipes.list
    const rows = yield* Effect.forEach(entries, (entry) =>
      recipes.get(entry.id).pipe(
        Effect.map((recipe) => ({ ...entry, when: recipe.when ?? recipe.description ?? "", steps: recipe.steps.map((step) => step.id), problem: null as string | null })),
        Effect.catch((error) => Effect.succeed({ ...entry, when: "", steps: [] as ReadonlyArray<string>, problem: error.message }))
      ))
    yield* (yield* Output).emit({ recipes: rows }, rows.map((row) =>
      lines(
        `${row.id}  (${row.source}${row.shadows ? ", replaces the shipped one" : ""}${row.extends === null ? "" : `, extends ${row.extends}`})`,
        row.problem !== null ? `  problem: ${row.problem}` : `  for:   ${row.when}`,
        row.problem !== null ? null : `  steps: ${row.steps.join(" > ")}`
      )).join("\n"))
  })).pipe(described("List the recipes a run can use, with what each is for. Choosing the recipe from the request is how work starts.", "jam recipe list"))

const show = Command.make("show", { id: recipeArg }, ({ id }) =>
  Effect.gen(function*() {
    const recipe = yield* (yield* Recipes).get(id)
    // Conditions are shown as they stand for a run with the recipe's own budget.
    const config = yield* (yield* Config).load
    const facts = yield* conditionFacts(config, recipe.budget ?? null)
    const steps = recipe.steps.map((step) => ({ ...step, ...(step.when === undefined ? {} : { condition: evaluateCondition(step.when, facts) }) }))
    yield* (yield* Output).emit({ ...recipe, steps }, lines(
      `${recipe.id}: ${recipe.title}  (${recipe.chain.join(" < ")})`,
      recipe.when ?? recipe.description ?? null,
      recipe.budget === undefined ? null : `budget: ${recipe.budget}`,
      table(["step", "needs", "outputs", "gate", "checks", "skill", "notes"], steps.map((step) => [
        step.id,
        step.needs.join(", "),
        step.produces.map((output) => `${output.role} (${output.kind}${output.keys === undefined ? "" : `: ${output.keys.join(", ")}`})`).join(", "),
        `${step.review}${step.review === "human" && step.reviewer !== undefined ? ` by ${step.reviewer}` : ""} [${step.origin["review"] ?? "default"}]`,
        step.checks.join(", "),
        step.skill ?? "",
        [
          step.optional ? "optional" : null,
          step.guide === undefined ? null : `guide ${[step.guide, ...step.baseGuides].join(" + ")}`,
          step.paid ? "paid" : null,
          step.condition === undefined ? null : `when ${step.condition.when}: ${step.condition.met ? "holds" : `does not hold here (${step.condition.reason})`}`,
          step.origin["id"] === recipe.chain[0] ? null : `from ${step.origin["id"]}`
        ].filter((part) => part !== null).join("; ")
      ]))
    ))
  })).pipe(described("Show a recipe's resolved steps, where each gate came from, and whether each step's condition holds in this project.", "jam recipe show prop"))

/** Everything wrong with one recipe: what stops it loading, unknown checks, guides that are missing. */
const problemsOf = (id: string): Effect.Effect<ReadonlyArray<Problem>, ToolError, Recipes | Checks | ProjectFiles | Toolkit> =>
  Effect.gen(function*() {
    const loaded = yield* Effect.result((yield* Recipes).get(id))
    if (loaded._tag === "Failure") return [{ message: loaded.failure.message, fix: loaded.failure.fix }]
    const recipe: ResolvedRecipe = loaded.success
    const guides = new Map<string, string | null>()
    for (const step of recipe.steps) for (const reference of [...(step.guide === undefined ? [] : [step.guide]), ...step.baseGuides]) guides.set(reference, (yield* resolveGuide(reference)).problem)
    return recipeProblems(recipe, { checks: new Set((yield* (yield* Checks).list).map((check) => check.id)), guides })
  })

const check = Command.make("check", { id: recipeArg.pipe(Argument.optional) }, ({ id }) =>
  Effect.gen(function*() {
    const one = maybe(id)
    const ids = one !== undefined ? [one] : (yield* (yield* Recipes).list).map((entry) => entry.id)
    const results: Array<{ recipe: string; problems: ReadonlyArray<Problem> }> = []
    for (const recipe of ids) results.push({ recipe, problems: yield* problemsOf(recipe) })
    const bad = results.filter((result) => result.problems.length > 0)
    yield* (yield* Output).emit({ valid: bad.length === 0, recipes: results }, bad.length === 0
      ? `${results.length} recipe${results.length === 1 ? "" : "s"} valid`
      : bad.flatMap((result) => result.problems.map((problem) => `${problem.message}${problem.fix === undefined ? "" : `\n  fix: ${problem.fix}`}`)).join("\n"))
    if (bad.length > 0) return yield* fail("invalid", `${bad.length} recipe${bad.length === 1 ? " has" : "s have"} problems`)
  })).pipe(described("Validate recipes: schema, needs, cycles, unknown checks, and that each guide's file and anchor exist. Without an id: every recipe.", "jam recipe check"))

const schemaPointer = (toolkit: string): string => `${"../".repeat(2)}${toolkit}/schemas/recipe.schema.json`

const make = Command.make("new", { id: recipeArg, extends: text("extends", "Base recipe to inherit steps from: builtin:<id> or a project recipe id") }, (input) =>
  Effect.gen(function*() {
    const recipes = yield* Recipes
    const base = maybe(input.extends)
    if ((yield* recipes.authored(input.id)) !== null) return yield* fail("conflict", `${recipes.projectPath(input.id)} already exists`, { fix: `edit it, or change a gate with "jam recipe set ${input.id} <step> ..."` })
    if (base !== undefined) yield* recipes.get(base)
    const config = yield* (yield* Config).load
    const recipe: Recipe = {
      $schema: schemaPointer(config.toolkit),
      version: 1,
      id: input.id,
      // Extending: title and "when" are inherited until written here. A new recipe must say both.
      ...(base === undefined ? { title: input.id, when: "TODO: which requests this recipe is for, in a sentence or two." } : {}),
      ...(base === undefined ? {} : { extends: base }),
      steps: base === undefined ? [{ id: "make", title: "What this step produces", produces: [{ role: "result", kind: "any", min: 1 }], review: "agent" }] : []
    }
    const path = yield* recipes.write(recipe)
    yield* (yield* Output).emit({ id: input.id, path }, `wrote ${path}\nedit it, then: jam recipe check ${input.id}`)
  })).pipe(described("Scaffold a project recipe under jam/recipes/. With --extends it inherits a base's steps and lists only what differs.", "jam recipe new crate --extends builtin:prop"))

const set = Command.make("set", {
  id: recipeArg,
  step: Argument.String("step").pipe(Argument.withDescription("Step id")),
  review: Flag.Literals("review", GATES).pipe(Flag.withDescription("Who must accept the step"), Flag.optional),
  reviewer: text("reviewer", "Who decides the step's human gate, as a person or role (\"art lead\")"),
  guide: text("guide", "Document with the step's instructions: a project path or toolkit:<path>, with an optional #anchor"),
  optional: Flag.Literals("optional", ["true", "false"]).pipe(Flag.withDescription("Whether the step may be skipped with a reason"), Flag.optional)
}, (input) =>
  Effect.gen(function*() {
    const recipes = yield* Recipes
    const resolved = yield* recipes.get(input.id)
    yield* attempt("find the step", () => stepOf(resolved, input.step), "invalid")
    const change: Partial<Step> = {
      ...(maybe(input.review) === undefined ? {} : { review: maybe(input.review)! }),
      ...(maybe(input.reviewer) === undefined ? {} : { reviewer: maybe(input.reviewer)! }),
      ...(maybe(input.guide) === undefined ? {} : { guide: maybe(input.guide)! }),
      ...(maybe(input.optional) === undefined ? {} : { optional: maybe(input.optional) === "true" })
    }
    if (Object.keys(change).length === 0) return yield* fail("invalid", "nothing to set: give --review, --reviewer, --guide or --optional")
    // A shipped recipe is never edited: the change goes into a project recipe that extends it.
    const own = (yield* recipes.authored(input.id)) ?? { version: 1 as const, id: input.id, extends: `${BUILTIN_PREFIX}${input.id}`, steps: [] }
    const steps = own.steps.some((step) => step.id === input.step)
      ? own.steps.map((step) => (step.id === input.step ? { ...step, ...change } : step))
      : [...own.steps, { id: input.step, ...change }]
    const path = yield* recipes.write({ ...own, steps })
    const after = stepOf(yield* recipes.get(input.id), input.step)
    yield* (yield* Output).emit({ id: input.id, step: input.step, path, review: after.review, reviewer: after.reviewer ?? null, optional: after.optional, guide: after.guide ?? null }, `${input.id} ${input.step}: review ${after.review}${after.reviewer === undefined ? "" : ` by ${after.reviewer}`}, ${after.optional ? "optional" : "required"}${after.guide === undefined ? "" : `, guide ${after.guide}`}\nwrote ${path}`)
  })).pipe(described("Change one step's gate, reviewer, guide or optional flag for this project. A shipped recipe is left alone: the change is written to a project recipe that extends it.", "jam recipe set prop mesh --review human"))

const capture = Command.make("capture", { run: Argument.String("run").pipe(Argument.withDescription("The run to capture: its subject id")), as: Flag.String("as").pipe(Flag.withDescription("Id of the recipe to write")) }, (input) =>
  Effect.gen(function*() {
    const recipes = yield* Recipes
    const ref = yield* (yield* Runs).find(input.run)
    if ((yield* recipes.authored(input.as)) !== null) return yield* fail("conflict", `${recipes.projectPath(input.as)} already exists`, { fix: "choose another id for --as" })
    const source = yield* recipes.get(ref.run.recipe).pipe(Effect.catch(() => Effect.succeed(null)))
    const recipe = captureRecipe(ref.run, source, input.as)
    if (recipe.steps.length === 0) return yield* fail("conflict", `run ${ref.run.id} has recorded no steps to capture`)
    const path = yield* recipes.write(recipe)
    yield* (yield* Output).emit({ id: input.as, path, steps: recipe.steps.map((step) => step.id) }, `wrote ${path} with steps ${recipe.steps.map((step) => step.id).join(" > ")}\nreview its gates and checks, then: jam recipe check ${input.as}`)
  })).pipe(described("Write a recipe from the steps a run actually recorded, so a workflow that was improvised once can be repeated.", "jam recipe capture oak-barrel --as weathered-prop"))

export const recipe = Command.make("recipe").pipe(
  Command.withDescription("Recipes: the written, checkable workflows runs follow"),
  Command.withSubcommands([list, show, check, make, set, capture])
)
