// Programs that keep running after the command that started them has ended: the catalog server a
// person keeps open while agent sessions come and go. Always an argv array, never a shell string.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { spawn } from "node:child_process"
import { closeSync, openSync } from "node:fs"
import { type ToolError, toolError } from "./errors.ts"

export interface DetachedOptions {
  /** Working directory (absolute). */
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  /** A file (absolute path) that receives the program's output; it is appended to. */
  readonly log: string
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    // No permission to signal it still means it exists.
    return (cause as { code?: string }).code === "EPERM"
  }
}

const signal = (pid: number, name?: NodeJS.Signals): void => {
  try {
    process.kill(pid, name)
  } catch { /* it has already exited */ }
}

export class Detached extends Context.Service<Detached, {
  /**
   * Start a program in its own session, holding none of this process's input or output, and
   * return its process id. Closing the terminal or ending the agent session does not stop it.
   */
  start(command: string, args: ReadonlyArray<string>, options: DetachedOptions): Effect.Effect<number, ToolError>
  alive(pid: number): Effect.Effect<boolean>
  /**
   * Ask a process to stop and wait until it has; after `graceMs` it is killed. True when it is
   * gone. On Windows there is no polite request: the process is ended at once.
   */
  stop(pid: number, graceMs?: number): Effect.Effect<boolean>
}>()("jam/kernel/Detached") {
  static readonly layer: Layer.Layer<Detached> = Layer.succeed(Detached, {
    start: (command, args, options) =>
      Effect.callback<number, ToolError>((resume) => {
        let log: number
        try {
          log = openSync(options.log, "a")
        } catch (cause) {
          resume(Effect.fail(toolError("unavailable", `cannot write the log ${options.log}: ${(cause as Error).message}`)))
          return
        }
        const child = spawn(command, [...args], {
          cwd: options.cwd,
          env: { ...process.env, ...options.env },
          detached: true,
          stdio: ["ignore", log, log],
          windowsHide: true
        })
        // The child has its own copy of the log handle from here on.
        child.once("spawn", () => {
          closeSync(log)
          child.unref()
          resume(Effect.succeed(child.pid!))
        })
        child.once("error", (cause) => {
          closeSync(log)
          resume(Effect.fail(toolError("unavailable", `${command} could not start: ${cause.message}`)))
        })
      }),
    alive: (pid) => Effect.sync(() => alive(pid)),
    stop: (pid, graceMs = 5000) =>
      Effect.gen(function*() {
        signal(pid, "SIGTERM")
        const gone = (waitMs: number): Effect.Effect<boolean> =>
          Effect.gen(function*() {
            for (let waited = 0; waited < waitMs; waited += 50) {
              if (!alive(pid)) return true
              yield* Effect.sleep("50 millis")
            }
            return !alive(pid)
          })
        if (yield* gone(graceMs)) return true
        signal(pid, "SIGKILL")
        return yield* gone(2000)
      })
  })
}
