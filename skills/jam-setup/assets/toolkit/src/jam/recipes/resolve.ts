// Pure recipe resolution: apply a chain of recipe files (base first), then validate the result.
import { raise } from "../../kernel/errors.ts"
import type { Problem } from "../common.ts"
import type { Recipe, ResolvedRecipe, ResolvedStep, Step } from "./schema.ts"

export interface Loaded {
  /** `builtin:<id>` or `project:<id>`. */
  readonly label: string
  readonly recipe: Recipe
}

type Draft = { -readonly [K in keyof ResolvedStep]: ResolvedStep[K] } & { origin: Record<string, string> }

const STEP_FIELDS = ["title", "skill", "guide", "run", "needs", "produces", "checks", "review", "reviewer", "paid", "maxJobs", "optional", "when"] as const

const blank = (id: string, label: string): Draft => ({
  id,
  title: id,
  baseGuides: [],
  needs: [],
  produces: [],
  checks: [],
  review: "agent",
  paid: false,
  optional: false,
  origin: { id: label }
})

const applyStep = (steps: Array<Draft>, step: Step, label: string): void => {
  const at = steps.findIndex((existing) => existing.id === step.id)
  if (step.remove === true) {
    if (at === -1) raise("invalid", `recipe ${label}: step ${step.id} has "remove": true but no inherited step has that id`, { fix: "remove the entry, or correct its id" })
    steps.splice(at, 1)
    return
  }
  const draft = at === -1 ? blank(step.id, label) : steps[at]!
  // A project guide adds the project's notes to the step; the base's notes still apply, so they
  // are kept and read after it instead of being silently replaced.
  if (step.guide !== undefined && draft.guide !== undefined && draft.guide !== step.guide) {
    draft.baseGuides = [draft.guide, ...draft.baseGuides.filter((guide) => guide !== step.guide)]
  }
  for (const field of STEP_FIELDS) {
    if (step[field] === undefined) continue
    ;(draft as Record<string, unknown>)[field] = step[field]
    draft.origin[field] = label
  }
  if (at !== -1 && step.after === undefined) return
  if (at !== -1) steps.splice(at, 1)
  if (step.after === undefined) steps.push(draft)
  else {
    const anchor = steps.findIndex((existing) => existing.id === step.after)
    if (anchor === -1) raise("invalid", `recipe ${label}: step ${step.id} is placed "after": "${step.after}", which is not a step`, { fix: `use one of: ${steps.map((s) => s.id).join(", ")}` })
    steps.splice(anchor + 1, 0, draft)
  }
}

const cycleIn = (steps: ReadonlyArray<ResolvedStep>): ReadonlyArray<string> | null => {
  const byId = new Map(steps.map((step) => [step.id, step]))
  const done = new Set<string>()
  const visit = (id: string, path: ReadonlyArray<string>): ReadonlyArray<string> | null => {
    if (path.includes(id)) return [...path.slice(path.indexOf(id)), id]
    if (done.has(id)) return null
    for (const need of byId.get(id)?.needs ?? []) {
      const found = visit(need, [...path, id])
      if (found) return found
    }
    done.add(id)
    return null
  }
  for (const step of steps) {
    const found = visit(step.id, [])
    if (found) return found
  }
  return null
}

/** Merge a chain of recipe files, base first. Throws a ToolError naming the file and the fix. */
export const resolveChain = (chain: ReadonlyArray<Loaded>): ResolvedRecipe => {
  const top = chain.at(-1)
  if (top === undefined) return raise("internal", "a recipe chain cannot be empty")
  const steps: Array<Draft> = []
  let budget: string | undefined
  let style = false
  let deliverable = true
  let roots: { scratch?: string; delivered?: string } = {}
  let catalog: { scope?: string } = {}
  // What a recipe is for is inherited until a recipe says otherwise.
  let title: string | undefined
  let description: string | undefined
  let when: string | undefined
  for (const { label, recipe } of chain) {
    const seen = new Set<string>()
    for (const step of recipe.steps) {
      if (seen.has(step.id)) raise("invalid", `recipe ${label}: step id ${step.id} appears twice`, { fix: "give each step its own id" })
      seen.add(step.id)
      applyStep(steps, step, label)
    }
    budget = recipe.budget ?? budget
    style = recipe.style ?? style
    deliverable = recipe.deliverable ?? deliverable
    roots = { ...roots, ...recipe.roots }
    catalog = { ...catalog, ...recipe.catalog }
    title = recipe.title ?? title
    description = recipe.description ?? description
    when = recipe.when ?? when
  }
  const ids = new Set(steps.map((step) => step.id))
  for (const step of steps) {
    for (const need of step.needs) {
      if (need === step.id) raise("invalid", `recipe ${top.label}: step ${step.id} needs itself`)
      if (!ids.has(need)) {
        raise("invalid", `recipe ${top.label}: step ${step.id} needs ${need}, which is not a step`, { fix: `use one of: ${[...ids].join(", ")}; or drop it from "needs"` })
      }
    }
  }
  const cycle = cycleIn(steps)
  if (cycle) raise("invalid", `recipe ${top.label}: steps need each other in a cycle: ${cycle.join(" -> ")}`, { fix: `remove one of these from a "needs" list` })
  return {
    id: top.recipe.id,
    title: title ?? top.recipe.id,
    ...(description === undefined ? {} : { description }),
    ...(when === undefined ? {} : { when }),
    ...(budget === undefined ? {} : { budget }),
    roots,
    style,
    deliverable,
    catalog,
    steps,
    chain: [...chain].reverse().map((loaded) => loaded.label)
  }
}

export interface Known {
  readonly checks: ReadonlySet<string>
  /** For each guide a step names: what is wrong with it, or null when its file and anchor exist. */
  readonly guides: ReadonlyMap<string, string | null>
}

/** Problems that do not stop a recipe from loading but would stop a run: unknown checks, missing guides. */
export const recipeProblems = (recipe: ResolvedRecipe, known: Known): ReadonlyArray<Problem> => {
  const problems: Array<Problem> = []
  for (const step of recipe.steps) {
    for (const check of step.checks) {
      if (!known.checks.has(check)) {
        problems.push({
          message: `recipe ${recipe.id}: step ${step.id} names check ${check}, which does not exist`,
          fix: `use one of: ${[...known.checks].sort().join(", ")}; or define it under "checks" in jam.config.json`
        })
      }
    }
    for (const reference of [...(step.guide === undefined ? [] : [step.guide]), ...step.baseGuides]) {
      const guide = known.guides.get(reference) ?? null
      if (guide !== null) problems.push({ message: `recipe ${recipe.id}: step ${step.id} guide ${reference}: ${guide}`, fix: "create the document or heading, or correct the reference" })
    }
    for (const output of step.produces) {
      if (output.keys !== undefined && (output.min !== undefined || output.max !== undefined)) {
        problems.push({ message: `recipe ${recipe.id}: step ${step.id} role ${output.role} sets both keys and min/max`, fix: "keep keys (one file per key) or min/max, not both" })
      }
      if (output.min !== undefined && output.max !== undefined && output.min > output.max) {
        problems.push({ message: `recipe ${recipe.id}: step ${step.id} role ${output.role} has min ${output.min} above max ${output.max}` })
      }
    }
    if (new Set(step.produces.map((output) => output.role)).size !== step.produces.length) {
      problems.push({ message: `recipe ${recipe.id}: step ${step.id} lists a role twice in produces`, fix: "merge the entries" })
    }
  }
  return problems
}

/** Steps ordered so that each comes after the steps it needs, keeping the recipe's order otherwise. */
export const inNeedOrder = (recipe: ResolvedRecipe, ids: ReadonlyArray<string>): ReadonlyArray<ResolvedStep> => {
  const out: Array<ResolvedStep> = []
  const visit = (step: ResolvedStep): void => {
    if (out.includes(step)) return
    for (const need of step.needs) {
      const needed = recipe.steps.find((candidate) => candidate.id === need)
      if (needed !== undefined && ids.includes(need)) visit(needed)
    }
    out.push(step)
  }
  for (const step of recipe.steps) if (ids.includes(step.id)) visit(step)
  return out
}

/** Every step that `step` needs, directly or through others. */
export const ancestorsOf = (recipe: ResolvedRecipe, step: string): ReadonlySet<string> => {
  const out = new Set<string>()
  const visit = (id: string): void => {
    for (const need of recipe.steps.find((candidate) => candidate.id === id)?.needs ?? []) {
      if (!out.has(need)) {
        out.add(need)
        visit(need)
      }
    }
  }
  visit(step)
  return out
}

export const stepIds = (recipe: ResolvedRecipe): ReadonlyArray<string> => recipe.steps.map((step) => step.id)

export const stepOf = (recipe: ResolvedRecipe, id: string): ResolvedStep =>
  recipe.steps.find((step) => step.id === id) ??
    raise("invalid", `step ${id} is not in recipe ${recipe.id}`, { fix: `use one of: ${stepIds(recipe).join(", ")}` })
