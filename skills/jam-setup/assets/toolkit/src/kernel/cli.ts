// Conventions every command shares: where the project is, how results are printed, how failures
// are reported. A command returns data; this module decides how it reaches the terminal.
import * as Cause from "effect/Cause"
import * as CliError from "effect/cli/CliError"
import type * as Command from "effect/cli/Command"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { spawnSync } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import * as nodePath from "node:path"
import { isToolError, type ToolError, toolError } from "./errors.ts"
import { Git } from "./Git.ts"
import { Ids } from "./Ids.ts"
import { Process } from "./Process.ts"
import { ProjectFiles } from "./ProjectFiles.ts"

/** Flags read before command parsing, because services are built from them. */
export interface EdgeArgs {
  readonly root: string | undefined
  readonly json: boolean
}

export const edgeArgs = (argv: ReadonlyArray<string>, env: NodeJS.ProcessEnv = process.env): EdgeArgs => {
  let root: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ""
    if (arg === "--") break
    if (arg === "--root") root = argv[i + 1]
    else if (arg.startsWith("--root=")) root = arg.slice("--root=".length)
  }
  const stop = argv.indexOf("--")
  const flags = stop === -1 ? argv : argv.slice(0, stop)
  return { root: root ?? env["JAM_ROOT"], json: flags.includes("--json") || env["JAM_JSON"] === "1" }
}

/**
 * Commands that hand the rest of the line to another program. Everything after their script
 * belongs to that script, dashes included, so a `--` is put there for the parser when the caller
 * did not type one. Flags for the command itself go before the script.
 */
const LAUNCHERS = new Set(["python", "blender"])

export const launcherArgv = (argv: ReadonlyArray<string>): ReadonlyArray<string> => {
  const at = argv.findIndex((arg, index) => !arg.startsWith("-") && argv[index - 1] !== "--root")
  if (at === -1 || !LAUNCHERS.has(argv[at] ?? "") || argv.includes("--")) return argv
  const script = argv.findIndex((arg, index) => index > at && !arg.startsWith("-"))
  return script === -1 || script === argv.length - 1 ? argv : [...argv.slice(0, script + 1), "--", ...argv.slice(script + 1)]
}

const MARKERS = ["jam.config.json", "catalog.config.json"]

/**
 * The project a command acts on: the given folder, else the nearest ancestor of the current
 * folder holding a jam or catalog configuration, else the Git checkout, else the current folder.
 */
export const projectRoot = (given: string | undefined, cwd: string = process.cwd()): string => {
  if (given !== undefined) {
    const full = nodePath.resolve(cwd, given)
    if (!existsSync(full)) throw toolError("invalid", `--root ${given} does not exist`, { fix: "pass the project folder, or run the command from inside it" })
    return realpathSync(full)
  }
  for (let dir = realpathSync(cwd);;) {
    if (MARKERS.some((name) => existsSync(nodePath.join(dir, name)))) return dir
    const up = nodePath.dirname(dir)
    if (up === dir) break
    dir = up
  }
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", windowsHide: true })
  return top.status === 0 && top.stdout.trim() !== "" ? realpathSync(top.stdout.trim()) : realpathSync(cwd)
}

export class Output extends Context.Service<Output, {
  readonly json: boolean
  /**
   * Print a command's result: the value as JSON with `--json`, otherwise the text (or the JSON
   * when a command has no text form). Results go to standard output; nothing else does.
   */
  emit(value: unknown, text?: string | (() => string)): Effect.Effect<void>
  /** A progress or advisory line for people, on standard error. */
  note(line: string): Effect.Effect<void>
}>()("jam/kernel/Output") {
  static readonly layer = (json: boolean, sink: { out(line: string): void; err(line: string): void } = {
    out: (line) => void process.stdout.write(`${line}\n`),
    err: (line) => void process.stderr.write(`${line}\n`)
  }): Layer.Layer<Output> =>
    Layer.succeed(Output, {
      json,
      emit: (value, text) =>
        Effect.sync(() => {
          if (json || text === undefined) sink.out(JSON.stringify(value, null, 2))
          else sink.out(typeof text === "function" ? text() : text)
        }),
      note: (line) => Effect.sync(() => sink.err(line))
    })
}

/** Print a failure the way the output mode asks: one JSON object, or `error:` and `fix:` lines. */
export const reportFailure = (cause: Cause.Cause<unknown>, json: boolean, err: (line: string) => void): void => {
  const reasons = cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error)
  for (const error of reasons) {
    if (isToolError(error)) {
      if (json) err(JSON.stringify({ error: error.toJSON() }, null, 2))
      else {
        err(`error: ${error.message}`)
        if (error.fix !== undefined) err(`  fix: ${error.fix}`)
      }
      return
    }
  }
  // Usage errors were already rendered by the command parser.
  if (reasons.some(CliError.isCliError)) return
  if (Cause.hasInterruptsOnly(cause)) return
  const message = Cause.pretty(cause)
  if (json) err(JSON.stringify({ error: { code: "internal", message } }, null, 2))
  else err(`error: internal: ${message}`)
}

/** Everything the kernel offers, for one project. */
export const kernelLayer = (root: string, json: boolean): Layer.Layer<Kernel> =>
  Layer.mergeAll(Git.layerNoDeps, Ids.layer, Output.layer(json)).pipe(
    Layer.provideMerge(Layer.mergeAll(ProjectFiles.layer(root), Process.layer))
  )

/** The kernel for the project the command line names; fails when `--root` names no folder. */
export const kernelLayerFor = (edge: EdgeArgs): Layer.Layer<Kernel, ToolError> =>
  Layer.unwrap(Effect.try({
    try: () => kernelLayer(projectRoot(edge.root), edge.json),
    catch: (cause) => (isToolError(cause) ? cause : toolError("internal", String(cause)))
  }))

/** The services a command may use without declaring anything further. */
export type Kernel = ProjectFiles | Process | Git | Ids | Output

/**
 * What a command group contributes: its commands, and a layer for the services they need beyond
 * the kernel. The layer may require kernel services and may fail with a ToolError.
 */
export interface CommandGroup {
  // Commands differ in name and input, so the list is necessarily loosely typed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly commands: ReadonlyArray<Command.Command<any, any, any, any, any>>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly layer: Layer.Layer<never, any, any> | Layer.Layer<any, any, any>
}
