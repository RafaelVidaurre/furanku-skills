// Running other programs. Always an argv array, never a shell string, so quoting is the same on
// every operating system and shell.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { spawn } from "node:child_process"
import { type ToolError, toolError } from "./errors.ts"

export interface RunOptions {
  /** Working directory (absolute). Defaults to the current directory. */
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  /** Written to the program's standard input. */
  readonly input?: string | Uint8Array
  /** Stop the program after this many milliseconds. */
  readonly timeoutMs?: number
  /** Upper bound on captured output, in bytes (default 256 MiB). */
  readonly maxBytes?: number
}

export interface RunResult {
  readonly code: number
  readonly stdout: Uint8Array
  readonly stderr: string
}

export class Process extends Context.Service<Process, {
  /** Run a program to completion. A nonzero exit is a result, not a failure; failing to start is. */
  run(command: string, args: ReadonlyArray<string>, options?: RunOptions): Effect.Effect<RunResult, ToolError>
  /** Run a program and return its trimmed output; a nonzero exit fails with its error output. */
  text(command: string, args: ReadonlyArray<string>, options?: RunOptions): Effect.Effect<string, ToolError>
}>()("jam/kernel/Process") {
  static readonly layer: Layer.Layer<Process> = Layer.succeed(Process, make())
}

function make(): Process["Service"] {
  const run = (command: string, args: ReadonlyArray<string>, options: RunOptions = {}): Effect.Effect<RunResult, ToolError> =>
    Effect.callback<RunResult, ToolError>((resume, signal) => {
      const limit = options.maxBytes ?? 256 * 1024 * 1024
      const child = spawn(command, [...args], {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        signal
      })
      // The time limit is kept here and not by spawn's own option: that one's timer outlives a
      // program that failed to start and holds the process open for the whole limit.
      const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => void child.kill(), options.timeoutMs)
      const out: Array<Buffer> = []
      const err: Array<Buffer> = []
      let size = 0
      let settled = false
      const settle = (effect: Effect.Effect<RunResult, ToolError>): void => {
        if (settled) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        resume(effect)
      }
      const collect = (into: Array<Buffer>) => (chunk: Buffer): void => {
        size += chunk.length
        if (size > limit) {
          child.kill()
          settle(Effect.fail(toolError("unavailable", `${command} produced more than ${limit} bytes of output`)))
        } else into.push(chunk)
      }
      child.stdout.on("data", collect(out))
      child.stderr.on("data", collect(err))
      child.on("error", (cause) => {
        const code = (cause as { code?: string }).code
        settle(Effect.fail(
          code === "ENOENT"
            ? toolError("unavailable", `${command} is not installed or not on PATH`)
            : code === "ABORT_ERR"
            ? toolError("unavailable", `${command} was interrupted`)
            : toolError("unavailable", `${command} could not start: ${cause.message}`)
        ))
      })
      child.on("close", (code, killedBy) => {
        if (killedBy && code === null) {
          settle(Effect.fail(toolError("unavailable", `${command} was stopped by ${killedBy}${options.timeoutMs ? ` (time limit ${options.timeoutMs} ms)` : ""}`)))
        } else settle(Effect.succeed({ code: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString("utf8") }))
      })
      child.stdin.on("error", () => { /* the program closed its input early */ })
      child.stdin.end(options.input === undefined ? undefined : Buffer.from(options.input))
    })

  const text = (command: string, args: ReadonlyArray<string>, options?: RunOptions): Effect.Effect<string, ToolError> =>
    Effect.flatMap(run(command, args, options), (result) =>
      result.code === 0
        ? Effect.succeed(Buffer.from(result.stdout).toString("utf8").trim())
        : Effect.fail(toolError("unavailable", `${command} ${args.join(" ")} exited ${result.code}: ${result.stderr.trim()}`)))

  return { run, text }
}
