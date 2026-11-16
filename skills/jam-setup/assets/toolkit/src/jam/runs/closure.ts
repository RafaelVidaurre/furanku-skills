// The delivery closure of a run: every file its current records, brief and job requests name, and
// where each lands under the delivered root. Pure.
import { isUnder } from "../../kernel/hash.ts"
import { RUN_FILE } from "../layout.ts"
import type { RunContext } from "./Runs.ts"
import { latestRecord, type Run } from "./schema.ts"

export interface ClosureEntry {
  readonly from: string
  readonly to: string
}

export interface Closure {
  /** The folder the run is (or would be) delivered into. */
  readonly dir: string
  readonly runFile: string
  readonly entries: ReadonlyArray<ClosureEntry>
}

/** Files of other folders are kept apart under this name so nothing can collide. */
const EXTERNAL = "external"

export const deliveredDirOf = (context: RunContext): string =>
  context.ref.delivered
    ? context.ref.dir
    : `${context.recipe.roots.delivered ?? context.config.roots.delivered}/${context.ref.run.id}/${context.ref.run.n}`

export const closurePaths = (run: Run): ReadonlyArray<string> => {
  const paths = new Set<string>([run.brief.path])
  for (const step of Object.keys(run.steps)) {
    const record = latestRecord(run, step)
    if (record === undefined) continue
    for (const file of [...record.files, ...record.inputs, ...record.evidence]) paths.add(file.path)
  }
  for (const job of run.jobs) paths.add(job.request.path)
  return [...paths].filter((path) => path !== "")
}

export const closureOf = (context: RunContext): Closure => {
  const dir = deliveredDirOf(context)
  const target = (path: string): string =>
    isUnder(dir, path) ? path : isUnder(context.ref.dir, path) ? `${dir}/${path.slice(context.ref.dir.length + 1)}` : `${dir}/${EXTERNAL}/${path}`
  return { dir, runFile: `${dir}/${RUN_FILE}`, entries: closurePaths(context.ref.run).map((from) => ({ from, to: target(from) })) }
}
