// Writing a recipe from what a run actually recorded: how an improvised workflow becomes repeatable.
import { extensionOf } from "../../kernel/hash.ts"
import { kindOf } from "../runs/media.ts"
import type { Run, StepRecord } from "../runs/schema.ts"
import type { Gate, Produces, Recipe, ResolvedRecipe, Step } from "./schema.ts"

const producesOf = (record: StepRecord): ReadonlyArray<Produces> => {
  const roles = new Map<string, Array<{ key?: string; path: string }>>()
  for (const file of record.files) roles.set(file.role, [...(roles.get(file.role) ?? []), file])
  return [...roles.entries()].map(([role, files]): Produces => {
    const kinds = new Set(files.map((file) => kindOf(file.path)))
    const kind = kinds.size === 1 ? [...kinds][0]! : "any"
    const keys = files.map((file) => file.key)
    return keys.every((key): key is string => key !== undefined)
      ? { role, kind, keys: keys as [string, ...Array<string>] }
      : { role, kind, ...(files.length === 1 ? { max: 1 } : { min: 1 }) }
  })
}

const reviewOf = (record: StepRecord): Gate => {
  const accepted = [...record.reviews].reverse().find((review) => review.decision === "accept")
  return accepted === undefined ? "none" : accepted.actor
}

/**
 * A recipe with the steps the run recorded, in the order they were first recorded. What the source
 * recipe said about a step (title, skill, guide) is kept; what the run shows (needs, outputs, gate,
 * checks, whether it paid) replaces the rest.
 */
export const captureRecipe = (run: Run, source: ResolvedRecipe | null, id: string): Recipe => {
  const recorded = Object.entries(run.steps)
    .filter(([, log]) => log.records.length > 0)
    .sort(([, a], [, b]) => (a.records[0]!.at < b.records[0]!.at ? -1 : a.records[0]!.at > b.records[0]!.at ? 1 : 0))
  const names = new Set(recorded.map(([step]) => step))
  const order = source?.steps.map((step) => step.id) ?? []
  const steps = recorded
    .sort(([a], [b]) => (order.includes(a) && order.includes(b) ? order.indexOf(a) - order.indexOf(b) : 0))
    .map(([stepId, log]): Step => {
      const record = log.records.at(-1)!
      const original = source?.steps.find((step) => step.id === stepId)
      const needs = Object.keys(record.dependencies).filter((need) => names.has(need))
      const produces = producesOf(record)
      const checks = record.checks.map((check) => check.id)
      const formats = [...new Set(record.files.map((file) => extensionOf(file.path)))].join(", ")
      return {
        id: stepId,
        title: original?.title ?? stepId,
        ...(original?.skill === undefined ? {} : { skill: original.skill }),
        ...(original?.guide === undefined ? {} : { guide: original.guide }),
        ...(needs.length === 0 ? {} : { needs }),
        ...(produces.length === 0 ? {} : { produces }),
        ...(checks.length === 0 ? {} : { checks }),
        review: reviewOf(record),
        ...(run.jobs.some((job) => job.step === stepId) ? { paid: true } : {}),
        ...(formats === "" || original !== undefined ? {} : { title: `${stepId} (${formats})` })
      }
    })
  return {
    version: 1,
    id,
    title: `Captured from ${run.id}`,
    description: `The steps run ${run.id}:${run.n} recorded with recipe ${run.recipe}. Review the gates and checks before relying on it.`,
    ...(run.budget === null ? {} : { budget: run.budget }),
    steps
  }
}
