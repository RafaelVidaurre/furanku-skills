// Small immutable edits of a run record.
import type { Job, Run, StepLog, StepRecord } from "./schema.ts"

const EMPTY: StepLog = { records: [] }

export const appendRecord = (run: Run, step: string, record: StepRecord): Run => ({
  ...run,
  // Recording a step replaces an earlier decision to skip it.
  steps: { ...run.steps, [step]: { records: [...(run.steps[step] ?? EMPTY).records, record] } }
})

export const updateLatest = (run: Run, step: string, change: (record: StepRecord) => StepRecord): Run => {
  const log = run.steps[step]
  const latest = log?.records.at(-1)
  if (log === undefined || latest === undefined) return run
  return { ...run, steps: { ...run.steps, [step]: { ...log, records: [...log.records.slice(0, -1), change(latest)] } } }
}

export const setSkip = (run: Run, step: string, skip: { reason: string; at: string; auto?: boolean }): Run => ({
  ...run,
  steps: { ...run.steps, [step]: { ...(run.steps[step] ?? EMPTY), skip } }
})

export const updateJob = (run: Run, id: string, change: (job: Job) => Job): Run => ({
  ...run,
  jobs: run.jobs.map((job) => (job.id === id ? change(job) : job))
})
