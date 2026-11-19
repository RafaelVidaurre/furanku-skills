// `jam catalog migrate`: move a project's catalog files to the current formats in one step. It
// reads `.catalog/`, catalog.config.json, the manifest and its unit files; plans every change;
// refuses while those files have uncommitted changes (they are rewritten in place); validates the
// whole result; and only then writes. A second run finds nothing to do.
import * as Command from "effect/cli/Command"
import * as Flag from "effect/cli/Flag"
import * as Effect from "effect/Effect"
import { Output } from "../../kernel/cli.ts"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { Git } from "../../kernel/Git.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { CONFIG_FILE } from "../CatalogConfig.ts"
import { FORMAT_FILE, RECORDS_DIR } from "../records/layout.ts"
import { applyPlan, validatePlan } from "./apply.ts"
import { type Change, JOURNAL_DIR, manifestPathOf, type Plan, planMigration, type SourceFile, unitFoldersOf } from "./plan.ts"

export interface MigrationReport {
  readonly format: Plan["format"]
  readonly changes: ReadonlyArray<Change>
  readonly warnings: ReadonlyArray<string>
  readonly dryRun: boolean
}

const hidden = (path: string, from: string): boolean => path.slice(from.length + 1).split("/").some((segment) => segment.startsWith("."))

/** Read what the migration covers; a file or folder that cannot be read is named by the plan, not thrown. */
const gather = Effect.gen(function*() {
  const files = yield* ProjectFiles
  const unreadable: Array<{ file: string; error: string }> = []
  const named = <A>(path: string, effect: Effect.Effect<A, ToolError>, fallback: A): Effect.Effect<A> =>
    Effect.catch(effect, (error) => Effect.sync(() => (unreadable.push({ file: path, error: error.message }), fallback)))
  const read = (path: string): Effect.Effect<SourceFile | null> =>
    named(path, Effect.flatMap(files.stat(path, { noFollow: true }), (stat) => (stat?.kind === "file" ? Effect.map(files.readText(path, { noFollow: true }), (text) => ({ path, text })) : Effect.succeed(null))), null)
  const json = (file: SourceFile | null): unknown => {
    try {
      return file === null ? null : JSON.parse(file.text) as unknown
    } catch {
      return undefined
    }
  }
  const config = yield* read(CONFIG_FILE)
  const manifestPath = manifestPathOf(json(config))
  const manifest = manifestPath === null ? null : yield* read(manifestPath)
  const folders = manifest === null ? [] : unitFoldersOf(json(manifest))
  const unitFiles: Array<SourceFile> = []
  for (const folder of folders) {
    for (const path of yield* named(folder, files.walk(folder), [])) {
      if (!path.endsWith(".json") || hidden(path, folder)) continue
      const file = yield* read(path)
      if (file) unitFiles.push(file)
    }
  }
  const skip = (path: string, kind: string): boolean => kind === "directory" && (path === `${RECORDS_DIR}/.local` || path === `${RECORDS_DIR}/evidence`)
  const recordPaths = (yield* named(RECORDS_DIR, files.walk(RECORDS_DIR, { skip }), []))
    .filter((path) => path.endsWith(".json") && path !== FORMAT_FILE && !hidden(path, RECORDS_DIR))
  const records: Array<SourceFile> = []
  for (const path of recordPaths) {
    const file = yield* read(path)
    if (file) records.push(file)
  }
  const journal = (yield* named(JOURNAL_DIR, files.stat(JOURNAL_DIR, { noFollow: true }), null)) !== null
  const marker = yield* read(FORMAT_FILE)
  return { config, manifest, unitFiles, records, marker, journal, unreadable }
})

/**
 * Uncommitted changes to the files the plan rewrites, moves or deletes, as project paths; null
 * outside a Git checkout.
 */
const uncommitted = (plan: Plan): Effect.Effect<ReadonlyArray<string> | null, never, Git> =>
  Effect.gen(function*() {
    const git = yield* Git
    if ((yield* git.text(["rev-parse", "--is-inside-work-tree"])) !== "true") return null
    // The journal is machine-local and ignored by Git.
    const paths = [...new Set(plan.changes.flatMap((change) => [change.file, ...(change.to === undefined ? [] : [change.to])]).filter((path) => !path.startsWith(`${JOURNAL_DIR}`)))]
    if (paths.length === 0) return []
    // Git names paths from the top of the repository; the project may be a folder inside it.
    const prefix = (yield* git.text(["rev-parse", "--show-prefix"])) ?? ""
    const out = yield* git.bytes(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...paths.map((path) => `:(literal)${path}`)])
    // Entries are "XY <path>"; a rename adds its old path as an entry of its own.
    return out === null
      ? []
      : Buffer.from(out).toString("utf8").split("\0").filter(Boolean)
        .map((entry) => (/^[ MADRCU?!]{2} /.test(entry) ? entry.slice(3) : entry))
        .map((path) => (prefix !== "" && path.startsWith(prefix) ? path.slice(prefix.length) : path))
  })

/** Plan, check and (unless `dryRun`) write the migration of the project the kernel names. */
export const migrate = (options: { readonly dryRun: boolean; readonly force: boolean }): Effect.Effect<MigrationReport, ToolError, ProjectFiles | Git> =>
  Effect.gen(function*() {
    const plan = planMigration(yield* gather)
    const report: MigrationReport = { format: plan.format, changes: plan.changes, warnings: plan.warnings, dryRun: options.dryRun }
    // Everything is checked before anything is written: files it cannot read, then the result.
    const problems = [...plan.errors, ...(yield* validatePlan(plan))]
    if (problems.length > 0) {
      return yield* fail("malformed", `cannot migrate: ${problems.map((p) => `${p.file}: ${p.error}`).join("; ")}`, {
        fix: "repair or restore these files, then run jam catalog migrate again",
        details: { problems, report }
      })
    }
    if (options.dryRun || plan.changes.length === 0) return report
    if (!options.force) {
      const dirty = yield* uncommitted(plan)
      if (dirty === null) return yield* fail("conflict", "this is not a Git checkout, so uncommitted changes to the files the migration rewrites cannot be ruled out", { fix: "pass --force to migrate anyway" })
      if (dirty.length > 0) {
        return yield* fail("conflict", `the files the migration rewrites have uncommitted changes: ${dirty.join(", ")}`, {
          fix: "commit or stash these files first, or pass --force",
          details: { files: dirty }
        })
      }
    }
    yield* applyPlan(yield* ProjectFiles, plan)
    return report
  })

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** What changed, by file kind: the configuration, the manifest and its unit files, the records. */
const summaryOf = (report: MigrationReport): string => {
  const records = report.changes.filter((change) => change.file.startsWith(`${RECORDS_DIR}/`)).length
  const config = report.changes.some((change) => change.file === CONFIG_FILE)
  const manifest = report.changes.length - records - (config ? 1 : 0)
  const parts = [
    ...(config ? [`${CONFIG_FILE} to version 3`] : []),
    ...(manifest > 0 ? [count(manifest, "manifest or unit file", "manifest and unit files")] : []),
    ...(records > 0
      ? [report.format.from < report.format.to ? `${RECORDS_DIR}/ from format ${report.format.from} to ${report.format.to} (${count(records, "change", "changes")})` : count(records, `change under ${RECORDS_DIR}/`, `changes under ${RECORDS_DIR}/`)]
      : [])
  ]
  return report.dryRun ? `Dry run, nothing written. It would migrate ${parts.join(", ")}.` : `Migrated ${parts.join(", ")}.`
}

const reportText = (report: MigrationReport): string => {
  const lines = report.changes.map((change) => `${change.action} ${change.file}${change.to ? ` → ${change.to}` : ""}: ${change.why}`)
  lines.push(...report.warnings.map((warning) => `warning: ${warning}`))
  if (report.changes.length === 0) lines.unshift("Nothing to migrate: the catalog files are in the current formats.")
  else lines.push(summaryOf(report))
  return lines.join("\n")
}

export const migrateCommand = Command.make(
  "migrate",
  {
    dryRun: Flag.Boolean("dry-run").pipe(Flag.withDescription("List every change and write nothing"), Flag.withDefault(false)),
    force: Flag.Boolean("force").pipe(Flag.withDescription("Migrate even when the files it rewrites have uncommitted changes, or outside a Git checkout"), Flag.withDefault(false))
  },
  (flags) =>
    Effect.gen(function*() {
      const report = yield* migrate(flags)
      yield* (yield* Output).emit(report, () => reportText(report))
    })
).pipe(Command.withDescription("Move .catalog/, catalog.config.json and the manifest to the current formats (rewrites tracked files; --dry-run lists the changes)"))
