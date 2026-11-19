// `doctor`: everything that keeps the catalog from being trusted, in one pass. Built-in checks
// cover media and reviews; plugins add their own. `doctor` only reads. A check may offer a fix;
// fixes change project files, so they are applied by a separate write action, `doctor.fix`.
import * as Effect from "effect/Effect"
import type { ActionServices, ReadEnv, WriteEnv } from "./action.ts"
import { Git } from "../kernel/Git.ts"
import { ProjectFiles } from "../kernel/ProjectFiles.ts"
import { lfsPointer } from "./Evidence.ts"
import { factsOf, type Projection } from "./Projection.ts"
import type { Owned } from "./Plugins.ts"
import type { Check, CheckProblem, RunAction } from "./plugin.ts"
import { problemsOf } from "./queries/inbox.ts"
import { submissionView } from "./queries/reviews.ts"
import { fromPlugin, toPromise } from "./support.ts"

type Checking = Effect.Effect<ReadonlyArray<CheckProblem>, never, ActionServices>
const POINTER_MAX = 1024
const LISTED = 50

/** Asset files that are Git LFS pointers: the repository has them, this checkout does not. */
const pointerFiles = (p: Projection): Effect.Effect<Array<string>, never, ProjectFiles> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const suspects = p.snapshot.assets.filter((asset) => {
      const facts = factsOf(p, asset.id)
      return facts.state !== "ok" && facts.state !== "missing" && facts.state !== "forbidden" && (facts.size ?? Infinity) <= POINTER_MAX
    })
    const checked = yield* Effect.forEach(suspects, (asset) =>
      files.readBytes(asset.path).pipe(Effect.map((bytes) => (lfsPointer(bytes) === null ? null : asset.path)), Effect.catch(() => Effect.succeed(null))))
    return checked.filter((path): path is string => path !== null)
  })

const lfsCheck = (p: Projection): Checking =>
  Effect.gen(function*() {
    const git = yield* Git
    const pointers = yield* pointerFiles(p)
    // One repair restores every pointer: from the local LFS store first, then from the remote.
    const restore = async (): Promise<void> => {
      await toPromise(Effect.gen(function*() {
        for (let i = 0; i < pointers.length; i += 200) yield* git.text(["lfs", "checkout", "--", ...pointers.slice(i, i + 200)])
        yield* git.text(["lfs", "pull", "--include", pointers.join(",")])
      }))
    }
    let restoring: Promise<void> | undefined
    return pointers.map((path) => ({
      subject: path,
      message: `${path} is a Git LFS pointer; the media itself is not in this checkout`,
      fix: { label: "fetch the file with git lfs (checkout, then pull)", apply: () => (restoring ??= restore()) }
    }))
  })

const unreadableCheck = (p: Projection, pointers: ReadonlySet<string>): ReadonlyArray<CheckProblem> =>
  p.snapshot.assets.flatMap((asset) => {
    const facts = factsOf(p, asset.id)
    if (facts.state === "ok" || pointers.has(asset.path) || !p.usage.has(asset.id)) return []
    return [{ subject: asset.path, message: `${asset.path}: ${facts.error ?? facts.state}`, fix: { label: "replace the file or fix the link that names it" } }]
  })

/** Media under the asset roots that no unit shows: forgotten deliveries, or files to remove. */
const unlinkedCheck = (p: Projection): Checking =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const git = yield* Git
    const extensions = new Set(p.plugins.mediaKinds.flatMap((kind) => kind.extensions))
    const linked = new Set(p.snapshot.assets.filter((asset) => p.usage.has(asset.id)).map((asset) => asset.path))
    for (const kind of Object.values(p.snapshot.schema.collectionKinds)) {
      const base = kind.preview?.base === undefined ? undefined : p.snapshot.assetsById.get(kind.preview.base)
      if (base) linked.add(base.path)
    }
    const hidden = (path: string): boolean => path.split("/").some((segment) => segment.startsWith(".") || segment === "node_modules")
    const found = new Set<string>()
    for (const root of p.snapshot.assetRoots) {
      const inside = yield* files.walk(root, { skip: (path) => hidden(path) }).pipe(Effect.catch(() => Effect.succeed([] as ReadonlyArray<string>)))
      for (const path of inside) if (extensions.has(path.split(".").pop()?.toLowerCase() ?? "") && !linked.has(path)) found.add(path)
    }
    const ignored = new Set(yield* git.ignored([...found]).pipe(Effect.catch(() => Effect.succeed([] as ReadonlyArray<string>))))
    const unlinked = [...found].filter((path) => !ignored.has(path)).sort()
    return unlinked.slice(0, LISTED).map((path, index): CheckProblem => ({
      subject: path,
      severity: "info",
      message: index === LISTED - 1 && unlinked.length > LISTED ? `${path} and ${unlinked.length - LISTED} more files are not linked by any unit` : `${path} is not linked by any unit`
    }))
  })

const waitingCheck = (p: Projection): ReadonlyArray<CheckProblem> =>
  p.records.submission.map((submission) => submissionView(p, submission)).filter((submission) => submission.counts.waiting > 0).map((submission) => ({
    subject: submission.id,
    severity: "info" as const,
    message: `review ${submission.ref} "${submission.title}" has ${submission.counts.waiting} of ${submission.counts.items} items waiting for a verdict`
  }))

interface CheckRun {
  readonly name: string
  readonly label: string
  readonly plugin: string
  readonly problems: ReadonlyArray<CheckProblem>
}

const runChecks = (env: ReadEnv): Effect.Effect<Array<CheckRun>, never, ActionServices> =>
  Effect.gen(function*() {
    const p = env.projection
    const lfs = yield* lfsCheck(p)
    const builtin: Array<CheckRun> = [
      { name: "catalog-problems", label: "Catalog problems", plugin: "catalog", problems: problemsOf(p).map((problem) => ({ subject: problem.subject, message: problem.error, ...(problem.recovery ? { fix: { label: problem.recovery } } : {}) })) },
      { name: "lfs-pointers", label: "Git LFS files left as pointers", plugin: "catalog", problems: lfs },
      { name: "unreadable-media", label: "Media that cannot be shown", plugin: "catalog", problems: unreadableCheck(p, new Set(lfs.flatMap((problem) => (problem.subject === undefined ? [] : [problem.subject])))) },
      { name: "unlinked-files", label: "Media no unit links", plugin: "catalog", problems: yield* unlinkedCheck(p) },
      { name: "waiting-reviews", label: "Reviews waiting on a person", plugin: "catalog", problems: waitingCheck(p) }
    ]
    const fromPlugins = yield* Effect.forEach(p.plugins.checks, (owned: Owned<Check>) =>
      fromPlugin(`check ${owned.value.name}`, () => owned.value.run({ ...owned.context, run: ((action: string, input?: unknown) => toPromise(env.runRead(action, input))) as RunAction })).pipe(
        Effect.catch((error) => Effect.succeed<ReadonlyArray<CheckProblem>>([{ message: error.message }])),
        Effect.map((problems): CheckRun => ({ name: owned.value.name, label: owned.value.label ?? owned.value.name, plugin: owned.plugin, problems: Array.isArray(problems) ? problems : [] }))
      ))
    return [...builtin, ...fromPlugins]
  })

const report = (checks: ReadonlyArray<CheckRun>, fixed: ReadonlyArray<{ readonly check: string; readonly subject: string | null; readonly fix: string; readonly error: string | null }>) => {
  const shown = checks.map((check) => ({
    name: check.name,
    label: check.label,
    plugin: check.plugin,
    problems: check.problems.map((problem) => ({
      message: problem.message,
      subject: problem.subject ?? null,
      severity: problem.severity ?? "problem",
      fix: problem.fix?.label ?? null,
      fixable: typeof problem.fix?.apply === "function"
    }))
  }))
  const all = shown.flatMap((check) => check.problems)
  const blocking = all.filter((problem) => problem.severity === "problem")
  return {
    ok: blocking.length === 0,
    summary: { problems: blocking.length, info: all.length - blocking.length, fixable: all.filter((problem) => problem.fixable).length, fixed: fixed.filter((entry) => entry.error === null).length },
    checks: shown,
    fixed
  }
}

/** Run every check and report. Changes nothing. */
export const doctor = (env: ReadEnv) => Effect.map(runChecks(env), (checks) => report(checks, []))

/** Apply every repair a check declares, then check again and report what is still wrong. */
export const doctorFix = (env: WriteEnv) =>
  Effect.gen(function*() {
    const checks = yield* runChecks(env)
    const fixed = []
    for (const check of checks) {
      for (const problem of check.problems) {
        const apply = problem.fix?.apply
        if (!apply) continue
        const outcome = yield* Effect.result(fromPlugin(`fix ${check.name}`, () => apply.call(problem.fix)))
        fixed.push({ check: check.name, subject: problem.subject ?? null, fix: problem.fix?.label ?? "", error: outcome._tag === "Failure" ? outcome.failure.message : null })
      }
    }
    // What is reported is what is still wrong after the repairs, not what was wrong before.
    return report(fixed.length > 0 ? yield* runChecks({ ...env, projection: yield* env.refresh }) : checks, fixed)
  })
