// What `jam catalog doctor` reports about runs. Each check reads; none changes a file. A fix is
// advice with the command to run: deleting a folder or opening a review stays a person's or an
// agent's own action.
import * as Effect from "effect/Effect"
import type { CheckProblem } from "../../catalog/plugin.ts"
import type { ToolError } from "../../kernel/errors.ts"
import { Git } from "../../kernel/Git.ts"
import { isUnder } from "../../kernel/hash.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { Engine } from "../engine/Engine.ts"
import type { ResolvedRecipe } from "../recipes/schema.ts"
import { closurePaths } from "../runs/closure.ts"
import type { RunRef } from "../runs/Runs.ts"
import { type Run, runKey, UNRESOLVED } from "../runs/schema.ts"
import type { CheckName } from "./plugin.ts"
import type { Survey } from "./RunCatalog.ts"
import { byCurrency, currentRecord } from "./units.ts"

type Checking = Effect.Effect<ReadonlyArray<CheckProblem>, ToolError, Git | ProjectFiles | Engine>

const listed = (paths: ReadonlyArray<string>): string => (paths.length <= 4 ? paths.join(", ") : `${paths.slice(0, 4).join(", ")} and ${paths.length - 4} more`)

const deliveredFiles = (survey: Survey): Checking =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const git = yield* Git
    const problems: Array<CheckProblem> = []
    for (const ref of survey.scan.runs.filter((candidate) => candidate.delivered)) {
      const paths = [ref.path, ...closurePaths(ref.run)]
      const missing: Array<string> = []
      for (const path of paths) if (!(yield* files.exists(path).pipe(Effect.catch(() => Effect.succeed(false))))) missing.push(path)
      if (missing.length > 0) {
        problems.push({
          subject: ref.path,
          message: `${runKey(ref.run)} is delivered at ${ref.dir}, but ${missing.length === 1 ? "a file it stands on is" : `${missing.length} files it stands on are`} missing: ${listed(missing)}`,
          fix: { label: `restore the files from Git; if they are gone, deliver the subject again from a new attempt (jam run start ${ref.run.recipe} ${ref.run.id} --brief <file>)` }
        })
      }
      const ignored = yield* git.ignored(paths.filter((path) => !missing.includes(path))).pipe(Effect.catch(() => Effect.succeed<ReadonlyArray<string>>([])))
      if (ignored.length > 0) {
        problems.push({
          subject: ref.path,
          message: `${runKey(ref.run)} is delivered at ${ref.dir}, but Git ignores ${listed(ignored)}: another checkout will not have ${ignored.length === 1 ? "it" : "them"}`,
          fix: { label: "change .gitignore so the delivered folder is tracked, then commit the files" }
        })
      }
    }
    return problems
  })

const unsettledJobs = (survey: Survey): Checking =>
  Effect.succeed(survey.scan.runs.filter((ref) => !ref.delivered).flatMap((ref) =>
    ref.run.jobs.filter((job) => UNRESOLVED.includes(job.state)).map((job): CheckProblem => {
      const { id } = ref.run
      const lost = job.state === "lost"
      return {
        subject: runKey(ref.run),
        // A job in flight is work in progress; a lost one needs someone to find out what became of it.
        severity: lost ? "problem" : "info",
        message: `${runKey(ref.run)}: job ${job.id} (${job.provider}, ${job.operation}) is ${job.state}; its ${job.estimate} ${job.unit} stay reserved until it is settled`,
        fix: {
          label: lost
            ? `look for it at the provider, then: jam job submitted ${id} ${job.id} --provider-job <ref>; when it never existed: jam job cancelled ${id} ${job.id} --evidence "<what was checked>"`
            : `once the outcome is known: jam job done ${id} ${job.id} --actual <charge> --evidence <reference>`
        }
      }
    })))

const reviewNotRequested = (survey: Survey): Checking =>
  Effect.succeed(survey.subjects.flatMap((subject) => {
    const status = subject.status
    if ("error" in status || status.delivered) return []
    return status.steps.filter((step) => step.state === "review" && step.gate.required === "human" && step.review === undefined).map((step): CheckProblem => ({
      subject: subject.id,
      severity: "info",
      message: `${subject.id}: ${step.step} waits for a person's acceptance and no review was requested`,
      fix: { label: `jam run request-review ${subject.id} ${step.step}` }
    }))
  }))

/** Steps of a recipe that put the result into the engine. */
const importSteps = (recipe: ResolvedRecipe): ReadonlyArray<string> =>
  recipe.steps.filter((step) => step.when?.engine === "import" || (step.run?.[0] === "engine" && step.run[1] === "import")).map((step) => step.id)

const hasEngineAsset = (run: Run, recipe: ResolvedRecipe): boolean =>
  recipe.steps.some((step) => (currentRecord(run, step.id)?.engineAssets?.length ?? 0) > 0)

const notImported = (survey: Survey): Checking =>
  Effect.gen(function*() {
    const adapter = yield* (yield* Engine).resolved.pipe(Effect.catch(() => Effect.succeed(null)))
    if (adapter === null || !adapter.provides.includes("import")) return []
    return survey.subjects.flatMap((subject): ReadonlyArray<CheckProblem> => {
      const { recipe, ref } = subject.attempts[0]!
      if (!ref.delivered || hasEngineAsset(ref.run, recipe)) return []
      // Leaving the engine out on purpose is a decision with its reason on record.
      const chosen = importSteps(recipe).find((step) => ref.run.steps[step]?.skip !== undefined && ref.run.steps[step]?.skip?.auto !== true)
      if (chosen !== undefined) return []
      return [{
        subject: subject.id,
        message: `${subject.id} is delivered at ${ref.dir} but has no engine asset id, and engine adapter ${adapter.id} can import`,
        fix: { label: `import it in a new attempt, which records the engine's asset id: jam run start ${recipe.id} ${subject.id} --brief <file>, then follow "jam run next ${subject.id}"` }
      }]
    })
  })

const supersededScratch = (survey: Survey): Checking =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const runs = survey.scan.runs
    const problems: Array<CheckProblem> = []
    for (const ref of runs.filter((candidate) => !candidate.delivered)) {
      const own = ref.run.deliveredTo !== undefined && (yield* files.exists(ref.run.deliveredTo).pipe(Effect.catch(() => Effect.succeed(false))))
        ? runs.find((candidate) => candidate.path === ref.run.deliveredTo)
        : undefined
      const delivery: RunRef | undefined = own ?? runs.find((candidate) => candidate.delivered && candidate.run.id === ref.run.id && byCurrency(candidate, ref) <= 0)
      if (delivery === undefined) continue
      // A folder another run still reads from is not offered for deletion.
      const users = runs.filter((other) => other !== ref && closurePaths(other.run).some((path) => isUnder(ref.dir, path)))
      if (users.length > 0) continue
      problems.push({
        subject: ref.dir,
        severity: "info",
        message: `${ref.dir} holds scratch run ${runKey(ref.run)}, superseded by the delivery at ${delivery.dir}`,
        fix: { label: `delete the folder when nothing in it is still wanted: ${ref.dir}` }
      })
    }
    return problems
  })

const IMPLEMENTATIONS: Readonly<Record<CheckName, (survey: Survey) => Checking>> = {
  "jam-delivered-files": deliveredFiles,
  "jam-unsettled-jobs": unsettledJobs,
  "jam-review-not-requested": reviewNotRequested,
  "jam-not-imported": notImported,
  "jam-superseded-scratch": supersededScratch
}

export const runCheck = (name: CheckName, survey: Survey): Checking => IMPLEMENTATIONS[name](survey)
