// Which catalog server belongs to this checkout. `jam catalog open` starts one server per
// checkout and leaves it running; this record (`.catalog/.local/server.json`, machine-local and
// never committed) is how later commands find it again, and how an action's answer can carry a
// link a person can click instead of a route they have to assemble.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { hostname } from "node:os"
import type { ToolError } from "../kernel/errors.ts"
import { Git } from "../kernel/Git.ts"
import { ProjectFiles } from "../kernel/ProjectFiles.ts"
import { ensureLocal } from "./records/files.ts"
import { LOCAL_DIR } from "./records/layout.ts"

export const SERVER_STATE_FILE = `${LOCAL_DIR}/server.json`
export const SERVER_LOG_FILE = `${LOCAL_DIR}/server.log`

export const ServerRecord = Schema.Struct({
  pid: Schema.Int,
  host: Schema.String,
  port: Schema.Int,
  /** `http://127.0.0.1:<port>/` */
  url: Schema.String,
  /** The worktree this server serves (`Checkout.worktree`); it follows branch switches. */
  checkout: Schema.String,
  /** Version of the toolkit that started it; a newer toolkit replaces an older server. */
  toolkit: Schema.String,
  startedAt: Schema.String,
  /** Origins it admits besides this machine's (`--allow-origin`); `open` reuses it only for the same ones. */
  allowOrigins: Schema.optionalKey(Schema.Array(Schema.String))
})
export type ServerRecord = typeof ServerRecord.Type

const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    // No permission to signal it still means it exists.
    return (cause as { code?: string }).code === "EPERM"
  }
}

export class ServerState extends Context.Service<ServerState, {
  /** The record as written, whatever became of the process; null when there is none or it is unreadable. */
  readonly recorded: Effect.Effect<ServerRecord | null>
  /**
   * The server of this checkout, when one is known: recorded for this worktree on this machine by
   * a process that is still running. Costs one small file read; no request is made.
   */
  readonly known: Effect.Effect<ServerRecord | null>
  /** Whether the recorded process is still running on this machine. */
  alive(record: ServerRecord): Effect.Effect<boolean>
  write(record: Omit<ServerRecord, "host" | "checkout">): Effect.Effect<ServerRecord, ToolError>
  /** Remove the record; with `pid`, only when it is that process's record. */
  clear(pid?: number): Effect.Effect<void>
}>()("jam/catalog/ServerState") {
  static readonly layerNoDeps: Layer.Layer<ServerState, never, ProjectFiles | Git> = Layer.effect(
    ServerState,
    Effect.gen(function*() {
      const files = yield* ProjectFiles
      const git = yield* Git
      const host = hostname()

      const recorded = files.readJson(SERVER_STATE_FILE, { noFollow: true }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ServerRecord)),
        Effect.catch(() => Effect.succeed(null))
      )
      const alive = (record: ServerRecord): Effect.Effect<boolean> => Effect.sync(() => record.host === host && processAlive(record.pid))
      const known = Effect.gen(function*() {
        const record = yield* recorded
        if (record === null || !(yield* alive(record))) return null
        return record.checkout === (yield* git.checkout).worktree ? record : null
      })
      const write = (record: Omit<ServerRecord, "host" | "checkout">): Effect.Effect<ServerRecord, ToolError> =>
        Effect.gen(function*() {
          const full: ServerRecord = { ...record, host, checkout: (yield* git.checkout).worktree }
          yield* ensureLocal(files)
          yield* files.writeJson(SERVER_STATE_FILE, full, { noFollow: true })
          return full
        })
      const clear = (pid?: number): Effect.Effect<void> =>
        Effect.gen(function*() {
          if (pid !== undefined && (yield* recorded)?.pid !== pid) return
          yield* files.remove(SERVER_STATE_FILE, { noFollow: true }).pipe(Effect.catch(() => Effect.void))
        })
      return { recorded, known, alive, write, clear }
    })
  )
}
