// Spending rules. Caps are per provider, in the provider's own unit: one for a single run, one for
// all runs together. Every job that may still be charged holds its full estimate.
import { type ToolError, toolError } from "../../kernel/errors.ts"
import type { Spend } from "../config/schema.ts"
import type { Job } from "../runs/schema.ts"
import type { Descriptor } from "./schema.ts"

export interface SpendState {
  readonly paid: boolean
  /** Whether a job may be opened at all. */
  readonly enabled: boolean
  readonly summary: string
  readonly perRun: number | null
  readonly total: number | null
  readonly standing: string | null
}

export const spendState = (descriptor: Descriptor, spend: Spend | undefined): SpendState => {
  const unit = descriptor.unit.label
  if (!descriptor.unit.paid) return { paid: false, enabled: true, summary: `not billed per job (${unit})`, perRun: null, total: null, standing: spend?.standing ?? null }
  if (spend === undefined) return { paid: true, enabled: false, summary: "paid work disabled (no spend entry)", perRun: 0, total: 0, standing: null }
  const enabled = spend.perRun !== 0 && spend.total !== 0
  const cap = (value: number | null): string => (value === null ? "no cap" : String(value))
  return {
    paid: true,
    enabled,
    summary: enabled ? `per run ${cap(spend.perRun)}, total ${cap(spend.total)} ${unit}` : "paid work disabled (cap 0)",
    perRun: spend.perRun,
    total: spend.total,
    standing: spend.standing ?? null
  }
}

/** What a provider's jobs hold or have cost: the actual charge once known, else the estimate. */
export const committed = (jobs: ReadonlyArray<Job>, provider: string): number =>
  jobs.filter((job) => job.provider === provider).reduce((sum, job) => sum + (job.state === "not-submitted" ? 0 : job.actual ?? job.estimate), 0)

export interface CapInput {
  readonly descriptor: Descriptor
  readonly spend: Spend | undefined
  readonly estimate: number
  /** Jobs of the run that wants to spend. */
  readonly runJobs: ReadonlyArray<Job>
  /** Jobs of every run, this one included. */
  readonly allJobs: ReadonlyArray<Job>
}

/** Why a new job may not be opened, or null when it may. */
export const capProblem = (input: CapInput): ToolError | null => {
  const { descriptor, spend, estimate } = input
  const id = descriptor.id
  const state = spendState(descriptor, spend)
  if (!state.paid) return null
  if (!state.enabled) {
    return toolError("forbidden", `${id}: paid work is disabled (${spend === undefined ? `no spend.${id} entry` : "a cap is 0"} in jam.config.json)`, {
      fix: `only the person can enable it: "jam config set spend.${id}.perRun <number|none>" after they decide the cap`
    })
  }
  const inRun = committed(input.runJobs, id)
  if (state.perRun !== null && inRun + estimate > state.perRun) {
    return toolError("forbidden", `${id}: this job (${estimate}) would take the run to ${inRun + estimate} ${descriptor.unit.label}, over the per-run cap of ${state.perRun}`, {
      fix: `stop and report; only the person raises spend.${id}.perRun`
    })
  }
  const everywhere = committed(input.allJobs, id)
  if (state.total !== null && everywhere + estimate > state.total) {
    return toolError("forbidden", `${id}: this job (${estimate}) would take all runs to ${everywhere + estimate} ${descriptor.unit.label}, over the total cap of ${state.total}`, {
      fix: `stop and report; only the person raises spend.${id}.total`
    })
  }
  return null
}
