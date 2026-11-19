// Writing a migration plan: every file it would write is validated against the current schemas
// first, then written beside its target and moved into place (as `Records.apply` does), and the
// moved files and the request journal are removed. It is all or nothing: a plan that fails
// validation writes nothing, and a step that fails undoes every step before it.
import * as Effect from "effect/Effect"
import { randomUUID } from "node:crypto"
import * as fsp from "node:fs/promises"
import * as nodePath from "node:path"
import { decode } from "../../kernel/decode.ts"
import { fail, type ToolError, toolError } from "../../kernel/errors.ts"
import { isRecord } from "../../kernel/hash.ts"
import type { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { CatalogConfigFile, CONFIG_FILE } from "../CatalogConfig.ts"
import { type RetiredKey, retiredInManifest, retiredInUnitFile, retiredMessage } from "../model/retired.ts"
import { MANIFEST_VERSION } from "../plugins/manifest.ts"
import { RECORD_SCHEMAS } from "../records/schemas.ts"
import { message } from "../support.ts"
import type { Output, Plan } from "./plan.ts"

const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

/** Old keys the plan would still write, or null. */
const retiredOf = (keys: ReadonlyArray<RetiredKey>): string | null =>
  keys.length === 0 ? null : `still holds ${keys.map(retiredMessage).join(", ")}`

/** Why one planned file would be invalid in the current format, or null. */
const invalid = (output: Output): Effect.Effect<string | null> => {
  const problem = (effect: Effect.Effect<unknown, ToolError>): Effect.Effect<string | null> =>
    effect.pipe(Effect.as(null), Effect.catch((error) => Effect.succeed(error.message)))
  switch (output.as) {
    case "config":
      return problem(decode(CatalogConfigFile, { what: CONFIG_FILE })(output.value))
    case "manifest":
      return Effect.succeed(
        !isRecord(output.value) || output.value["version"] !== MANIFEST_VERSION ? `expected manifest version ${MANIFEST_VERSION}` : retiredOf(retiredInManifest(output.value))
      )
    case "unit":
      return Effect.succeed(retiredOf(retiredInUnitFile(output.value)))
    case "marker":
      return Effect.succeed(null)
    default:
      return problem(decode(RECORD_SCHEMAS[output.as], { what: output.path, strict: false })(output.value) as Effect.Effect<unknown, ToolError>)
  }
}

/** The problems of every file the plan would write. */
export const validatePlan = (plan: Plan): Effect.Effect<ReadonlyArray<{ readonly file: string; readonly error: string }>> =>
  Effect.map(Effect.forEach(plan.writes, (output) => Effect.map(invalid(output), (error) => (error === null ? [] : [{ file: output.path, error }]))), (lists) => lists.flat())

interface Target {
  readonly path: string
  readonly full: string
}

const absent = (cause: unknown): boolean => (cause as { code?: string } | null)?.code === "ENOENT"
const lstat = (full: string) => fsp.lstat(full).catch((cause) => (absent(cause) ? null : Promise.reject(cause)))
const aside = (full: string): string => `${full}.${randomUUID()}.bak`

/** The folders that do not exist yet among these and their parents below the root, deepest first. */
const missingFolders = async (root: string, folders: ReadonlyArray<string>): Promise<Array<string>> => {
  const missing = new Set<string>()
  for (const folder of folders) {
    for (let current = folder; current !== root && current.startsWith(`${root}${nodePath.sep}`); current = nodePath.dirname(current)) {
      if (missing.has(current)) continue
      if ((await lstat(current)) !== null) break
      missing.add(current)
    }
  }
  return [...missing].sort((a, b) => b.length - a.length)
}

/**
 * All or nothing: every file is written beside its target first; then each existing target and
 * each removed file or folder is set aside (renamed beside itself) and the new file moved into
 * place. When any step fails, every step taken is undone in reverse, the staged files are
 * discarded and the folders made for new files are removed, so the project is as it was; only
 * when every step succeeded are the set-aside copies deleted.
 */
const transact = async (root: string, writes: ReadonlyArray<Target & { readonly data: string }>, removals: ReadonlyArray<Target>): Promise<void> => {
  const created = await missingFolders(root, writes.map((write) => nodePath.dirname(write.full)))
  const staged: Array<string> = []
  const undo: Array<{ readonly path: string; readonly run: () => Promise<void> }> = []
  const setAside: Array<string> = []
  let current = ""
  try {
    for (const write of writes) {
      current = write.path
      await fsp.mkdir(nodePath.dirname(write.full), { recursive: true })
      const temporary = `${write.full}.${randomUUID()}.tmp`
      staged.push(temporary)
      const handle = await fsp.open(temporary, "wx")
      try {
        await handle.writeFile(write.data)
        await handle.sync()
      } finally {
        await handle.close()
      }
    }
    for (const [index, write] of writes.entries()) {
      current = write.path
      const existing = await lstat(write.full)
      if (existing !== null && !existing.isFile()) throw new Error(`${write.path} is ${existing.isDirectory() ? "a directory" : "not a regular file"}`)
      if (existing !== null) {
        const backup = aside(write.full)
        await fsp.rename(write.full, backup)
        setAside.push(backup)
        // Putting the old file back replaces the new one in the same step.
        undo.push({ path: write.path, run: () => fsp.rename(backup, write.full) })
      }
      await fsp.rename(staged[index]!, write.full)
      if (existing === null) undo.push({ path: write.path, run: () => fsp.rm(write.full, { force: true }) })
    }
    for (const removal of removals) {
      current = removal.path
      if ((await lstat(removal.full)) === null) continue
      const backup = aside(removal.full)
      await fsp.rename(removal.full, backup)
      setAside.push(backup)
      undo.push({ path: removal.path, run: () => fsp.rename(backup, removal.full) })
    }
  } catch (cause) {
    const unrestored: Array<string> = []
    for (const step of undo.reverse()) await step.run().catch(() => void unrestored.push(step.path))
    for (const temporary of staged) await fsp.rm(temporary, { force: true }).catch(() => undefined)
    for (const folder of created) await fsp.rmdir(folder).catch(() => undefined)
    throw Object.assign(new Error(`${current}: ${cause instanceof Error ? cause.message : String(cause)}`), { file: current, unrestored })
  }
  for (const backup of setAside) await fsp.rm(backup, { recursive: true, force: true }).catch(() => undefined)
}

/** Write the plan, all or nothing (see `transact`). The plan is validated first; an invalid plan writes nothing. */
export const applyPlan = (files: ProjectFiles["Service"], plan: Plan): Effect.Effect<void, ToolError> =>
  Effect.gen(function*() {
    const problems = yield* validatePlan(plan)
    if (problems.length > 0) {
      return yield* fail("invalid", `the migrated files would be invalid: ${problems.map((p) => `${p.file}: ${p.error}`).join("; ")}`, { details: { problems } })
    }
    const writes = yield* Effect.forEach(plan.writes, (output) => Effect.map(files.resolve(output.path, { noFollow: true }), (full) => ({ path: output.path, full, data: serialize(output.value) })))
    const removals = yield* Effect.forEach(plan.removals, (path) => Effect.map(files.resolve(path, { noFollow: true }), (full) => ({ path, full })))
    yield* Effect.tryPromise({
      try: () => transact(files.root, writes, removals),
      catch: (cause) => {
        const { file, unrestored } = cause as { file?: string; unrestored?: ReadonlyArray<string> }
        const changed = [...plan.writes.map((output) => output.path), ...plan.removals]
        return toolError(
          "unavailable",
          unrestored && unrestored.length > 0
            ? `the migration failed at ${message(cause)}, and ${unrestored.join(", ")} could not be put back (each is beside its path as <name>.<id>.bak)`
            : `the migration failed at ${message(cause)}; nothing was changed (it would have changed ${changed.join(", ")})`,
          { fix: "fix the file it names, then run jam catalog migrate again", details: { file: file ?? null, files: changed, unrestored: unrestored ?? [] } }
        )
      }
    })
  })
