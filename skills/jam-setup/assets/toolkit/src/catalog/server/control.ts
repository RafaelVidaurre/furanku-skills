// One catalog server per checkout, kept running between commands: `open` finds or starts it,
// `status` reports it, `stop` ends it. A server is only ever reused or stopped after it has said
// who it is: a process id in a file is not proof that the process is still that server.
import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import { Detached } from "../../kernel/Detached.ts"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { Git } from "../../kernel/Git.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { ensureLocal } from "../records/files.ts"
import { LOCAL_DIR } from "../records/layout.ts"
import { SERVER_LOG_FILE, type ServerRecord, ServerState } from "../ServerState.ts"
import { health } from "./client.ts"

/** How to start the server process: the program, its arguments, and the toolkit version it is. */
export interface Launch {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly toolkit: string
  /** The exact origins the server must admit besides this machine's; a server `open` started admitting others is replaced. */
  readonly allowOrigins: ReadonlyArray<string>
  readonly env?: Readonly<Record<string, string>>
}

const sameOrigins = (record: ServerRecord, wanted: ReadonlyArray<string>): boolean =>
  [...(record.allowOrigins ?? [])].sort().join("\n") === [...wanted].sort().join("\n")

export interface ServerStatus {
  readonly running: boolean
  readonly url: string | null
  readonly port: number | null
  readonly pid: number | null
  readonly toolkit: string | null
  readonly startedAt: string | null
  /** Why a recorded server does not count as running, when it does not. */
  readonly reason: string | null
  /** `open` or `serve` (see `ServerRecord.startedBy`); null when nothing is recorded. */
  readonly startedBy: "open" | "serve" | null
}

export interface Opened extends ServerStatus {
  readonly running: true
  readonly url: string
  /** True when this command started the server; false when one was already running. */
  readonly started: boolean
  readonly log: string
  /** Origins it admits besides this machine's. */
  readonly allowOrigins: ReadonlyArray<string>
}

type Services = ServerState | Detached | ProjectFiles | Git
const OPEN_LOCK = `${LOCAL_DIR}/server-open.lock`
const START_TIMEOUT_MS = 60_000

const describe = (record: ServerRecord): Omit<ServerStatus, "running" | "reason"> => ({ url: record.url, port: record.port, pid: record.pid, toolkit: record.toolkit, startedAt: record.startedAt, startedBy: record.startedBy ?? "open" })
const opened = (record: ServerRecord, started: boolean): Opened => ({ running: true, ...describe(record), url: record.url, reason: null, started, log: SERVER_LOG_FILE, allowOrigins: record.allowOrigins ?? [] })
const NONE: ServerStatus = { running: false, url: null, port: null, pid: null, toolkit: null, startedAt: null, reason: null, startedBy: null }

/**
 * What the record says, checked against what answers: the recorded process must be alive and a
 * catalog server at the recorded address must say it is that process, serving this folder.
 */
const inspect: Effect.Effect<{ readonly record: ServerRecord | null; readonly confirmed: boolean; readonly reason: string | null }, never, ServerState | ProjectFiles | Git> = Effect.gen(function*() {
  const state = yield* ServerState
  const record = yield* state.recorded
  if (record === null) return { record, confirmed: false, reason: null }
  if (!(yield* state.alive(record))) return { record, confirmed: false, reason: `its process ${record.pid} has exited` }
  const answer = yield* health(record.url)
  if (answer === null) return { record, confirmed: false, reason: `nothing answers at ${record.url}` }
  if (answer.pid !== record.pid || answer.root !== (yield* ProjectFiles).root) return { record, confirmed: false, reason: `${record.url} is another server` }
  if (record.checkout !== (yield* (yield* Git).checkout).worktree) return { record, confirmed: true, reason: "it was started for another checkout" }
  return { record, confirmed: true, reason: null }
})

export const serverStatus: Effect.Effect<ServerStatus, never, ServerState | ProjectFiles | Git> = Effect.map(inspect, ({ confirmed, reason, record }) =>
  record === null ? NONE : { running: confirmed && reason === null, ...describe(record), reason })

const logTail: Effect.Effect<string, never, ProjectFiles> = Effect.flatMap(ProjectFiles, (files) =>
  files.readText(SERVER_LOG_FILE, { noFollow: true }).pipe(Effect.map((text) => text.trim().split("\n").slice(-12).join("\n")), Effect.catch(() => Effect.succeed(""))))

const start = (launch: Launch): Effect.Effect<Opened, ToolError, Services> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const state = yield* ServerState
    const detached = yield* Detached
    yield* ensureLocal(files)
    // A fresh log per start: what is in it is about this server.
    yield* files.writeText(SERVER_LOG_FILE, "", { noFollow: true })
    const log = yield* files.resolve(SERVER_LOG_FILE, { noFollow: true })
    const pid = yield* detached.start(launch.command, launch.args, { cwd: files.root, log, ...(launch.env ? { env: launch.env } : {}) })
    for (let waited = 0; waited < START_TIMEOUT_MS; waited += 100) {
      const record = yield* state.recorded
      if (record?.pid === pid && (yield* health(record.url))?.pid === pid) return opened(record, true)
      if (!(yield* detached.alive(pid))) {
        return yield* fail("unavailable", "the catalog server stopped while starting", { fix: `read ${SERVER_LOG_FILE}`, details: { log: yield* logTail } })
      }
      yield* Effect.sleep("100 millis")
    }
    yield* detached.stop(pid)
    return yield* fail("unavailable", `the catalog server did not start within ${START_TIMEOUT_MS / 1000} s`, { fix: `read ${SERVER_LOG_FILE}`, details: { log: yield* logTail } })
  })

/**
 * The address of this checkout's server, starting it when none is running. A running server of
 * this toolkit version is reused; a dead, foreign or older one is replaced. A server started with
 * `jam catalog serve` belongs to whoever started it (a person, a service manager): it is reused
 * whatever origins it admits, and never stopped; one of another toolkit version is an error.
 */
export const openServer = (launch: Launch): Effect.Effect<Opened, ToolError, Services> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const state = yield* ServerState
    yield* ensureLocal(files)
    // Two `open` at once must not start two servers: the second waits and finds the first's.
    yield* files.lock(OPEN_LOCK).pipe(Effect.retry({ schedule: Schedule.spaced("250 millis"), times: 280, while: (error) => error.code === "locked" }))
    const { confirmed, reason, record } = yield* inspect
    if (record !== null) {
      if (confirmed && reason === null && record.startedBy === "serve") {
        if (record.toolkit === launch.toolkit && launch.allowOrigins.every((origin) => (record.allowOrigins ?? []).includes(origin))) return opened(record, false)
        return yield* fail("unavailable", record.toolkit === launch.toolkit
          ? `the catalog server at ${record.url} (process ${record.pid}) was started with jam catalog serve and does not admit ${launch.allowOrigins.join(", ")}`
          : `the catalog server at ${record.url} (process ${record.pid}) was started with jam catalog serve by toolkit ${record.toolkit}, not ${launch.toolkit}`, {
          fix: "restart it where it was started (the command or service that runs jam catalog serve), with the toolkit and origins wanted; open does not stop a server it did not start"
        })
      }
      if (confirmed && reason === null && record.toolkit === launch.toolkit && sameOrigins(record, launch.allowOrigins)) return opened(record, false)
      // Only a process that answered as this checkout's server is stopped; anything else is left alone.
      if (confirmed) yield* (yield* Detached).stop(record.pid)
      yield* state.clear()
    }
    return yield* start(launch)
  }).pipe(Effect.scoped)

export interface Stopped {
  readonly stopped: boolean
  readonly url: string | null
  readonly pid: number | null
  readonly reason: string | null
}

/** Stop this checkout's server and forget it. Nothing is running: that is a result, not a failure. */
export const stopServer: Effect.Effect<Stopped, ToolError, Services> = Effect.gen(function*() {
  const state = yield* ServerState
  const { confirmed, reason, record } = yield* inspect
  if (record === null) return { stopped: false, url: null, pid: null, reason: "no catalog server is recorded for this checkout" }
  if (!confirmed) {
    // Not provably ours any more (exited, or the process id now belongs to something else).
    yield* state.clear()
    return { stopped: false, url: record.url, pid: record.pid, reason: `${reason}; its record was removed` }
  }
  if (!(yield* (yield* Detached).stop(record.pid))) return yield* fail("unavailable", `process ${record.pid} did not stop`, { fix: `end process ${record.pid} yourself, then run the command again` })
  yield* state.clear()
  return { stopped: true, url: record.url, pid: record.pid, reason: null }
})
