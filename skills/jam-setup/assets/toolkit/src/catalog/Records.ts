// Repository records: validated, atomic reads and writes under <project>/.catalog. Callers work
// with records; file layout, link safety, locking and request identity stay here.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Semaphore from "effect/Semaphore"
import * as fsp from "node:fs/promises"
import { hostname } from "node:os"
import { decode } from "../kernel/decode.ts"
import { asToolError, fail, type ToolError } from "../kernel/errors.ts"
import { digest, isRecord, sha256 } from "../kernel/hash.ts"
import { nowIso } from "../kernel/Ids.ts"
import { ProjectFiles } from "../kernel/ProjectFiles.ts"
import type { AnyRecord, RecordKind, RecordsByKind } from "./model/types.ts"
import { commit, discard, ensureBase, ensureFormat, hasConflictMarkers, type RecordProblem, scanRecords, stage, type Staged } from "./records/files.ts"
import { blobPath, EVIDENCE_PATH, fileKey, FORMAT, kindOfPath, KINDS, LOCAL_DIR, recordKey, recordPath, RECORDS_DIR } from "./records/layout.ts"
import { RECORD_SCHEMAS } from "./records/schemas.ts"
import { message } from "./support.ts"

/** Every valid record at one moment. The same object is returned until a record file changes. */
export type RecordsView = { readonly [K in RecordKind]: ReadonlyArray<RecordsByKind[K]> } & {
  /** Changes whenever a record file is added, removed or rewritten. */
  readonly signature: string
  readonly problems: ReadonlyArray<RecordProblem>
}

export type RecordOp =
  | { readonly type: "create"; readonly kind: RecordKind; readonly record: AnyRecord }
  | { readonly type: "update" | "remove"; readonly kind: RecordKind; readonly record: AnyRecord; readonly expectedRevision?: number | null | undefined }

export interface LockInfo {
  readonly file: string
  readonly name?: string
  readonly pid?: number
  readonly host?: string
  readonly at?: string
  /** Whether the owning process is running: null when it cannot be told from this machine. */
  readonly alive: boolean | null
}

export interface RecordStats {
  /** How many times the record folders were listed. */
  readonly scans: number
  /** How many record files were read and decoded. */
  readonly parsed: number
}

type Parsed = { readonly kind: RecordKind; readonly record: AnyRecord } | { readonly problem: RecordProblem } | { readonly format: number | null }
interface Remembered {
  readonly size: number
  readonly mtimeMs: number
  readonly parsed: Parsed | null
}

const LOCK_ATTEMPTS = 40
const MIGRATE = "run: jam catalog migrate"
/** Record files of format 1, recognised so they can be named rather than ignored. */
const FORMAT_1_PATH = /^(labels\/(unit|asset|collection)\/[^/]+\.json|reviews\/[^/]+\/verdicts\/[^/]+\.json)$/

/** The layout named by `.catalog/format.json`: its number, or null when the file is not a marker. */
const formatOf = (text: string): number | null => {
  try {
    const value = JSON.parse(text) as unknown
    return isRecord(value) && Number.isSafeInteger(value["format"]) && (value["format"] as number) >= 1 ? value["format"] as number : null
  } catch {
    return null
  }
}

/** Whether this toolkit reads the records: a tree in another format is refused as a whole. */
const checkFormat = (marker: Parsed | null | undefined, holdsRecords: boolean): Effect.Effect<void, ToolError> => {
  if (marker === undefined) return holdsRecords ? fail("unsupported", ".catalog/ was written by an older toolkit (format 1)", { fix: MIGRATE }) : Effect.void
  const format = marker !== null && "format" in marker ? marker.format : null
  if (format === null) return fail("malformed", `${RECORDS_DIR}/format.json must be { "format": ${FORMAT} }`, { fix: "restore it from Git" })
  if (format < FORMAT) return fail("unsupported", `.catalog/ was written by an older toolkit (format ${format})`, { fix: MIGRATE })
  if (format > FORMAT) return fail("unsupported", `.catalog/ was written by a newer toolkit (format ${format}); this one reads format ${FORMAT}`, { fix: "update the toolkit" })
  return Effect.void
}
const serialize = (record: unknown): string => `${JSON.stringify(record, null, 2)}\n`

const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    return (cause as { code?: string }).code === "EPERM"
  }
}

export class Records extends Context.Service<Records, {
  /** All records, read incrementally: only files whose size or modification time changed are parsed again. */
  readonly view: Effect.Effect<RecordsView, ToolError>
  /** One record straight from its file (never from the view), or null when it does not exist. */
  readOne<K extends RecordKind>(kind: K, record: RecordsByKind[K]): Effect.Effect<RecordsByKind[K] | null, ToolError>
  /**
   * Apply record operations as one unit: every resulting record is checked (existence, expected
   * revision, schema) before any file changes. Returns the records as written.
   */
  apply(ops: ReadonlyArray<RecordOp>): Effect.Effect<ReadonlyArray<AnyRecord>, ToolError>
  /** Run under a named lock: one writer in this process and, through a lock file, on this machine. */
  withLock<A, E>(name: string, effect: Effect.Effect<A, E>): Effect.Effect<A, E | ToolError>
  readonly locks: Effect.Effect<ReadonlyArray<LockInfo>, ToolError>
  /** Remove a lock whose owner has verifiably exited on this machine. */
  unlock(name: string): Effect.Effect<{ readonly removed: string }, ToolError>
  /** The stored result of an earlier request with this id, bound to its action, input and checkout. */
  replay(requestId: string, action: string, input: unknown, checkoutKey: string): Effect.Effect<{ readonly result: unknown } | null, ToolError>
  remember(requestId: string, action: string, input: unknown, checkoutKey: string, result: unknown): Effect.Effect<void, ToolError>
  /** Store bytes under their SHA-256 in .catalog/evidence. */
  putBlob(bytes: Uint8Array, extension: string): Effect.Effect<{ readonly sha256: string; readonly path: string }, ToolError>
  /** A stored evidence blob by its structurally valid path; null when missing. */
  readBlob(path: string): Effect.Effect<Uint8Array | null, ToolError>
  /** A cheap fingerprint of a blob file, to notice it being replaced or removed. */
  blobState(path: string): Effect.Effect<string>
  /** Write a machine-local file (`<folder>/<name>` under .catalog/.local); returns its project path. */
  writeLocal(relative: string, bytes: Uint8Array): Effect.Effect<string, ToolError>
  readonly stats: Effect.Effect<RecordStats>
}>()("jam/catalog/Records") {
  static readonly layerNoDeps: Layer.Layer<Records, never, ProjectFiles> = Layer.effect(
    Records,
    Effect.gen(function*() {
      const files = yield* ProjectFiles
      const remembered = new Map<string, Remembered>()
      const queues = new Map<string, { readonly semaphore: Semaphore.Semaphore; users: number }>()
      let current: RecordsView | null = null
      let scans = 0
      let parsed = 0

      const validate = (kind: RecordKind, value: unknown): Effect.Effect<string | null> =>
        decode(RECORD_SCHEMAS[kind], { what: kind, strict: false })(value).pipe(
          Effect.as(null),
          Effect.catch((error) => Effect.succeed(((error.details as { problems?: ReadonlyArray<string> }).problems ?? [error.message]).join("; ")))
        ) as Effect.Effect<string | null>

      const parse = (kind: RecordKind, relative: string, text: string): Effect.Effect<Parsed> =>
        Effect.gen(function*() {
          const file = `${RECORDS_DIR}/${relative}`
          const problem = (error: string, recovery: string): Parsed => ({ problem: { file, kind, error, recovery } })
          if (hasConflictMarkers(text)) return problem("unresolved Git merge conflict", "resolve the conflict markers in this file and commit the result")
          let value: unknown
          try {
            value = JSON.parse(text)
          } catch (cause) {
            return problem(`invalid JSON: ${message(cause)}`, "repair or remove this file; other records are unaffected")
          }
          if (!isRecord(value)) return problem("record must be a JSON object", "repair this record; it is excluded until valid")
          const invalid = yield* validate(kind, value)
          if (invalid !== null) return problem(invalid, "repair this record; it is excluded until valid")
          const expected = KINDS[kind].file(value as never)
          if (expected !== relative) return problem(`record identity does not match its path (expected ${expected})`, "move or repair the file")
          return { kind, record: value as unknown as AnyRecord }
        })

      const readParsed = (kind: RecordKind, relative: string, full: string): Effect.Effect<Parsed> =>
        Effect.tryPromise({ try: () => fsp.readFile(full, "utf8"), catch: message }).pipe(
          Effect.tap(() => Effect.sync(() => void parsed++)),
          Effect.flatMap((text) => parse(kind, relative, text)),
          Effect.catch((error) => Effect.succeed<Parsed>({ problem: { file: `${RECORDS_DIR}/${relative}`, kind, error, recovery: "replace this path with a regular file" } }))
        )

      // Scans update the remembered files, so two actions arriving together take turns.
      const scanning = Semaphore.makeUnsafe(1)
      const view: Effect.Effect<RecordsView, ToolError> = scanning.withPermit(Effect.gen(function*() {
        scans++
        const scan = yield* Effect.tryPromise({ try: () => scanRecords(files.root), catch: asToolError("unavailable", `read ${RECORDS_DIR}`) })
        let changed = current === null || scan.files.length !== remembered.size
        const seen = new Set<string>()
        for (const file of scan.files) {
          seen.add(file.relative)
          const known = remembered.get(file.relative)
          if (known && known.size === file.size && known.mtimeMs === file.mtimeMs) continue
          changed = true
          const kind = kindOfPath(file.relative)
          const parsed = file.relative === "format.json"
            ? { format: formatOf(yield* Effect.promise(() => fsp.readFile(file.full, "utf8").catch(() => ""))) }
            : kind === null ? null : yield* readParsed(kind, file.relative, file.full)
          remembered.set(file.relative, { size: file.size, mtimeMs: file.mtimeMs, parsed })
        }
        for (const relative of [...remembered.keys()]) if (!seen.has(relative)) remembered.delete(relative)
        yield* checkFormat(remembered.has("format.json") ? remembered.get("format.json")!.parsed : undefined, scan.files.some((file) => file.relative !== "format.json"))
        const scanSignature = sha256(JSON.stringify(scan.problems))
        if (!changed && current !== null && current.signature.endsWith(scanSignature)) return current

        const lists: { [K in RecordKind]: Array<RecordsByKind[K]> } = { note: [], organization: [], collection: [], categories: [], submission: [], decision: [] }
        const problems: Array<RecordProblem> = [...scan.problems]
        const keys = new Set<string>()
        const stamp: Array<string> = []
        for (const relative of [...remembered.keys()].sort()) {
          const entry = remembered.get(relative)!
          stamp.push(`${relative}:${entry.mtimeMs}:${entry.size}`)
          // A format-1 file beside a format-2 marker: a branch merged after its migration.
          if (FORMAT_1_PATH.test(relative)) {
            problems.push({ file: `${RECORDS_DIR}/${relative}`, kind: "records", error: ".catalog/ was written by an older toolkit (format 1)", recovery: MIGRATE })
            continue
          }
          if (entry.parsed === null || "format" in entry.parsed) continue
          if ("problem" in entry.parsed) {
            problems.push(entry.parsed.problem)
            continue
          }
          const { kind, record } = entry.parsed
          const key = `${kind}\0${recordKey(kind, record)}`
          if (keys.has(key)) {
            problems.push({ file: `${RECORDS_DIR}/${relative}`, kind, error: `duplicate identity ${recordKey(kind, record)}`, recovery: "remove the duplicate record" })
            continue
          }
          keys.add(key)
          ;(lists[kind] as Array<AnyRecord>).push(record)
        }
        current = { ...lists, problems, signature: `${sha256(stamp.join("\n"))}${scanSignature}` }
        return current
      }))

      const readOne = <K extends RecordKind>(kind: K, record: RecordsByKind[K]): Effect.Effect<RecordsByKind[K] | null, ToolError> =>
        Effect.gen(function*() {
          const path = recordPath(kind, record)
          if ((yield* files.stat(path, { noFollow: true })) === null) return null
          const text = yield* files.readText(path, { noFollow: true })
          const result = yield* parse(kind, path.slice(RECORDS_DIR.length + 1), text)
          if ("format" in result) return null
          if ("problem" in result) return yield* fail("malformed", `${result.problem.file}: ${result.problem.error}`, { details: result.problem })
          return result.record as RecordsByKind[K]
        })

      const apply = (ops: ReadonlyArray<RecordOp>): Effect.Effect<ReadonlyArray<AnyRecord>, ToolError> =>
        Effect.gen(function*() {
          const planned: Array<{ readonly path: string; readonly data: string | null; readonly record: AnyRecord }> = []
          for (const op of ops) {
            const layout = KINDS[op.kind]
            const key = recordKey(op.kind, op.record)
            const path = recordPath(op.kind, op.record)
            const fresh = yield* readOne(op.kind, op.record as never)
            if (op.type === "create") {
              if (fresh) return yield* fail("conflict", `${op.kind} ${key} already exists`)
              const invalid = yield* validate(op.kind, op.record)
              if (invalid !== null) return yield* fail("invalid", invalid)
              planned.push({ path, data: serialize(op.record), record: op.record })
              continue
            }
            // Immutable records are never changed; retiring one (review.remove) is the only other operation.
            if (!layout.mutable && op.type !== "remove") return yield* fail("forbidden", `${op.kind} records are immutable`)
            if (!fresh) return yield* fail("not_found", `${op.kind} ${key} no longer exists`)
            const revision = (fresh as { revision?: number }).revision
            if (op.expectedRevision !== undefined && op.expectedRevision !== null && revision !== op.expectedRevision) {
              return yield* fail("conflict", `${op.kind} changed since it was read (revision ${revision}, expected ${op.expectedRevision})`, {
                details: { current: fresh },
                fix: "read the record again, merge your change and retry with its revision"
              })
            }
            if (op.type === "remove") {
              planned.push({ path, data: null, record: fresh })
              continue
            }
            const next = { ...op.record, revision: (revision ?? 0) + 1 } as AnyRecord
            const invalid = yield* validate(op.kind, next)
            if (invalid !== null) return yield* fail("invalid", `${key}: ${invalid}`)
            planned.push({ path, data: serialize(next), record: next })
          }
          if (new Set(planned.map((p) => p.path)).size !== planned.length) return yield* fail("invalid", "one operation touched the same record twice")
          yield* ensureBase(files)
          yield* ensureFormat(files)
          // Every new file is fully written before the first one replaces its target, so a
          // failure part-way leaves the records as they were.
          const staged: Array<Staged> = []
          for (const plan of planned) {
            if (plan.data === null) continue
            const one = yield* stage(files, plan.path, plan.data).pipe(Effect.tapError(() => Effect.forEach(staged, discard, { discard: true })))
            staged.push(one)
          }
          yield* Effect.forEach(staged, commit, { discard: true })
          for (const plan of planned) if (plan.data === null) yield* files.remove(plan.path, { noFollow: true })
          return planned.map((plan) => plan.record)
        })

      // ---- Locks: a queue inside this process plus an exclusive lock file for other processes.
      // A lock left by a crashed writer is never removed automatically.
      const lockPath = (name: string): string => `${LOCAL_DIR}/locks/${fileKey(name)}.lock`
      const acquire = (name: string): Effect.Effect<string, ToolError> =>
        Effect.gen(function*() {
          yield* ensureBase(files)
          const path = lockPath(name)
          const full = yield* files.resolve(path, { noFollow: true })
          yield* files.makeDirectory(`${LOCAL_DIR}/locks`)
          const holder = JSON.stringify({ name, pid: process.pid, host: hostname(), at: yield* nowIso })
          for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
            const taken = yield* Effect.tryPromise({
              try: () => fsp.writeFile(full, holder, { flag: "wx" }).then(() => true, (cause: { code?: string }) => (cause.code === "EEXIST" ? false : Promise.reject(cause))),
              catch: asToolError("unavailable", `lock ${name}`)
            })
            if (taken) return path
            yield* Effect.sleep("50 millis")
          }
          const owner = yield* files.lockHolder(path).pipe(Effect.catch(() => Effect.succeed(null)))
          return yield* fail("locked", `records are locked by another writer (${name})`, {
            fix: `retry shortly; if the owning process has exited, run: jam catalog unlock ${JSON.stringify(name)}`,
            details: { lock: name, owner, recovery: "retry shortly; if the owning process has exited, run `catalog unlock` for this lock" }
          })
        })
      const withLock = <A, E>(name: string, effect: Effect.Effect<A, E>): Effect.Effect<A, E | ToolError> =>
        Effect.acquireUseRelease(
          // Queues are counted so a long-running server does not keep one per note or request id.
          Effect.sync(() => {
            const queue = queues.get(name) ?? { semaphore: Semaphore.makeUnsafe(1), users: 0 }
            queue.users++
            queues.set(name, queue)
            return queue
          }),
          (queue) => queue.semaphore.withPermit(Effect.acquireUseRelease(acquire(name), () => effect, (path) => Effect.ignore(files.remove(path, { noFollow: true })))),
          (queue) => Effect.sync(() => { if (--queue.users === 0) queues.delete(name) })
        )
      const locks: Effect.Effect<ReadonlyArray<LockInfo>, ToolError> = Effect.gen(function*() {
        const folder = `${LOCAL_DIR}/locks`
        if ((yield* files.stat(folder, { noFollow: true })) === null) return []
        const entries = yield* files.list(folder, { noFollow: true })
        const host = hostname()
        return yield* Effect.forEach(entries.filter((entry) => entry.name.endsWith(".lock")), (entry) =>
          files.readJson(`${folder}/${entry.name}`, { noFollow: true }).pipe(
            Effect.catch(() => Effect.succeed({})),
            Effect.map((value): LockInfo => {
              const owner = (isRecord(value) ? value : {}) as { name?: string; pid?: number; host?: string; at?: string }
              return { file: entry.name, ...owner, alive: owner.host === host && owner.pid ? processAlive(owner.pid) : null }
            })
          ))
      })
      const unlock = (name: string): Effect.Effect<{ readonly removed: string }, ToolError> =>
        Effect.gen(function*() {
          const lock = (yield* locks).find((candidate) => candidate.name === name || candidate.file === name)
          if (!lock) return yield* fail("not_found", "no such lock")
          if (lock.alive !== false) {
            return yield* fail(
              "locked",
              lock.alive ? `lock owner process ${lock.pid} is still running` : "cannot verify that the lock owner exited on this machine; remove the lock file manually after checking",
              { details: { lock } }
            )
          }
          yield* files.remove(`${LOCAL_DIR}/locks/${lock.file}`, { noFollow: true })
          return { removed: lock.name ?? lock.file }
        })

      // ---- Durable request identity: a machine-local journal bound to the checkout.
      const journalPath = (requestId: string): string => `${LOCAL_DIR}/requests/${sha256(requestId).slice(0, 32)}.json`
      const replay = (requestId: string, action: string, input: unknown, checkoutKey: string) =>
        Effect.gen(function*() {
          const path = journalPath(requestId)
          if ((yield* files.stat(path, { noFollow: true })) === null) return null
          const entry = yield* files.readJson(path, { noFollow: true }).pipe(
            Effect.catch(() => fail("conflict", "request journal entry is unreadable; use a new request id"))
          ) as Effect.Effect<{ action?: string; input?: string; checkout?: string; result?: unknown }, ToolError>
          if (entry.action !== action || entry.input !== digest(input)) return yield* fail("conflict", "request id was already used for a different action or input")
          if (entry.checkout !== checkoutKey) return yield* fail("conflict", "request id was already used in another branch or worktree")
          return { result: entry.result }
        })
      const remember = (requestId: string, action: string, input: unknown, checkoutKey: string, result: unknown) =>
        Effect.gen(function*() {
          yield* ensureBase(files)
          const entry = { requestId, action, input: digest(input), checkout: checkoutKey, result, at: yield* nowIso }
          yield* files.writeText(journalPath(requestId), JSON.stringify(entry), { noFollow: true })
        })

      // ---- Content-addressed evidence blobs: immutable, versioned with the repository.
      const putBlob = (bytes: Uint8Array, extension: string) =>
        Effect.gen(function*() {
          const hash = sha256(bytes)
          const path = blobPath(hash, /^[a-z0-9]{1,8}$/.test(extension) ? extension : "")
          if ((yield* files.stat(path, { noFollow: true })) === null) {
            yield* ensureBase(files)
            yield* files.writeBytes(path, bytes, { noFollow: true })
          }
          return { sha256: hash, path }
        })
      const readBlob = (path: string): Effect.Effect<Uint8Array | null, ToolError> =>
        Effect.gen(function*() {
          const match = EVIDENCE_PATH.exec(path)
          if (!match || match[1] !== match[2]?.slice(0, 2)) return yield* fail("invalid", "invalid evidence path")
          const stat = yield* files.stat(path, { noFollow: true })
          if (stat === null) return null
          if (stat.kind !== "file") return yield* fail("forbidden", "evidence path is not a regular file")
          return yield* files.readBytes(path, { noFollow: true })
        })
      const blobState = (path: string): Effect.Effect<string> =>
        files.stat(path, { noFollow: true }).pipe(
          Effect.map((stat) => (stat === null ? "absent" : `${stat.size}:${stat.mtimeMs}`)),
          Effect.catch((error) => Effect.succeed(error.code === "forbidden" ? "forbidden" : "absent"))
        )
      const writeLocal = (relative: string, bytes: Uint8Array): Effect.Effect<string, ToolError> =>
        Effect.gen(function*() {
          if (!/^[a-z]+\/[A-Za-z0-9._-]+$/.test(relative)) return yield* fail("invalid", "invalid local path")
          yield* ensureBase(files)
          const path = `${LOCAL_DIR}/${relative}`
          yield* files.writeBytes(path, bytes, { noFollow: true })
          return path
        })

      return { view, readOne, apply, withLock, locks, unlock, replay, remember, putBlob, readBlob, blobState, writeLocal, stats: Effect.sync(() => ({ scans, parsed })) }
    })
  )
}

