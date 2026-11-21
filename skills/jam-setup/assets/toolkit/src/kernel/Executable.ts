// Finding and launching the programs a project names (Python, Blender, a provider's CLI). A probe
// asks a program for its version without a shell; a launch hands it the terminal. Windows npm
// launchers are `.cmd` files, which only `cmd.exe` can start, so they get a fixed, checked command
// line instead of a shell string built from user input.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { type ChildProcessByStdio, spawn } from "node:child_process"
import type { Readable } from "node:stream"
import { hostname } from "node:os"
import * as nodePath from "node:path"
import { type ToolError, toolError } from "./errors.ts"

export interface ProbeOptions {
  /** The command is an npm-installed launcher (a `.cmd` shim on Windows). */
  readonly npmLauncher?: boolean | undefined
  readonly cwd?: string | undefined
  readonly timeoutMs?: number | undefined
}

export interface ProbeResult {
  readonly installed: boolean
  /** First line the program printed, when it ran. */
  readonly output: string | null
  /** Why it is not installed or did not run: an error code or `exit <n>`. */
  readonly error: string | null
  /** Everything it printed on standard output, for a probe whose answer is data (empty when it did not start). */
  readonly stdout: string
}

export class Executables extends Context.Service<Executables, {
  readonly platform: NodeJS.Platform
  /** The Python launcher to try when the project names none. */
  readonly defaultPython: string
  /** The Node.js binary running this tool. */
  readonly node: string
  /** This machine's name, as lock files record it. */
  readonly host: string
  /** Whether a process of this machine is still running. */
  alive(pid: number): Effect.Effect<boolean>
  /** Run a program with fixed arguments and report whether it works. Never fails. */
  probe(command: string, args: ReadonlyArray<string>, options?: ProbeOptions): Effect.Effect<ProbeResult>
  /** Run a program attached to this terminal and return its exit code. */
  launch(command: string, args: ReadonlyArray<string>, options?: { readonly cwd?: string }): Effect.Effect<number, ToolError>
  /** Make this process exit with a launched program's code once the command returns. */
  exitWith(code: number): Effect.Effect<void>
}>()("jam/kernel/Executables") {
  static readonly layerFor = (platform: NodeJS.Platform): Layer.Layer<Executables> => Layer.succeed(Executables, make(platform))
  static readonly layer: Layer.Layer<Executables> = Executables.layerFor(process.platform)
}

/**
 * A command from machine configuration: a bare name is looked up on PATH, a path is absolute or
 * relative to the project.
 */
export const commandPath = (root: string, command: string): string =>
  /[\\/]/.test(command) ? nodePath.resolve(root, command) : command

const UNSAFE_COMMAND = /[%!^&|<>"\r\n]/
const SAFE_ARGUMENT = /^[a-zA-Z0-9_.=-]+$/

function make(platform: NodeJS.Platform): Executables["Service"] {
  const probe = (command: string, args: ReadonlyArray<string>, options: ProbeOptions = {}): Effect.Effect<ProbeResult> =>
    Effect.callback<ProbeResult>((resume) => {
      const done = (result: ProbeResult): void => resume(Effect.succeed(result))
      const base = { cwd: options.cwd, timeout: options.timeoutMs ?? 10_000, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"] }
      let child: ChildProcessByStdio<null, Readable, Readable>
      try {
        if (platform === "win32" && options.npmLauncher) {
          if (UNSAFE_COMMAND.test(command) || !args.every((arg) => SAFE_ARGUMENT.test(arg))) {
            return done({ installed: false, output: null, error: "the executable path or its probe arguments contain characters cmd.exe would interpret", stdout: "" })
          }
          child = spawn("cmd.exe", ["/d", "/s", "/c", `""${command}" ${args.join(" ")}"`], { ...base, windowsVerbatimArguments: true })
        } else child = spawn(command, [...args], base)
      } catch (cause) {
        return done({ installed: false, output: null, error: (cause as Error).message, stdout: "" })
      }
      const out: Array<Buffer> = []
      const stdout: Array<Buffer> = []
      child.stdout.on("data", (chunk: Buffer) => void (out.push(chunk), stdout.push(chunk)))
      child.stderr.on("data", (chunk: Buffer) => out.push(chunk))
      child.on("error", (cause) => done({ installed: false, output: null, error: (cause as { code?: string }).code ?? cause.message, stdout: "" }))
      child.on("close", (code) => {
        const first = Buffer.concat(out).toString("utf8").split(/\r?\n/).map((line) => line.trim()).find((line) => line !== "") ?? null
        const printed = Buffer.concat(stdout).toString("utf8")
        done(code === 0 ? { installed: true, output: first, error: null, stdout: printed } : { installed: false, output: first, error: `exit ${code ?? "by signal"}`, stdout: printed })
      })
    })

  const launch = (command: string, args: ReadonlyArray<string>, options: { readonly cwd?: string } = {}): Effect.Effect<number, ToolError> =>
    Effect.callback<number, ToolError>((resume) => {
      const child = spawn(command, [...args], { cwd: options.cwd, stdio: "inherit", shell: false, windowsHide: true })
      child.on("error", (cause) =>
        resume(Effect.fail(toolError("unavailable", `cannot run ${command} (${(cause as { code?: string }).code ?? cause.message})`))))
      child.on("close", (code) => resume(Effect.succeed(code ?? 1)))
    })

  return {
    platform,
    defaultPython: platform === "win32" ? "python" : "python3",
    node: process.execPath,
    host: hostname(),
    alive: (pid) =>
      Effect.sync(() => {
        try {
          process.kill(pid, 0)
          return true
        } catch (cause) {
          return (cause as { code?: string }).code === "EPERM"
        }
      }),
    probe,
    launch,
    exitWith: (code) => Effect.sync(() => void (process.exitCode = code))
  }
}
