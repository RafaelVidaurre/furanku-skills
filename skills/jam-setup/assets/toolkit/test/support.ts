// Shared test helpers: a real temporary project folder and a way to run effects against it.
// Tests use real files and, where they need it, a real Git repository; nothing reads the
// machine's own configuration.
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after } from "node:test"
import { type Kernel, Output } from "../src/kernel/cli.ts"
import { type ToolError } from "../src/kernel/errors.ts"
import { Git } from "../src/kernel/Git.ts"
import { Ids } from "../src/kernel/Ids.ts"
import { Process } from "../src/kernel/Process.ts"
import { ProjectFiles } from "../src/kernel/ProjectFiles.ts"

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "Test Person",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test Person",
  GIT_COMMITTER_EMAIL: "test@example.invalid"
}

export const git = (root: string, ...args: ReadonlyArray<string>): string =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", env: GIT_ENV }).trim()

export interface ProjectOptions {
  /** Initialise a Git repository with one empty commit on branch `main`. */
  readonly git?: boolean
  /** Files to create: project-relative path to text or bytes. */
  readonly files?: Readonly<Record<string, string | Uint8Array>>
}

/** A temporary project folder, removed when the test file finishes. */
export const tempProject = (options: ProjectOptions = {}): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "jam-test-")))
  after(() => rmSync(root, { recursive: true, force: true }))
  if (options.git) {
    git(root, "init", "-q", "-b", "main")
    git(root, "config", "user.name", "Test Person")
    git(root, "config", "user.email", "test@example.invalid")
    git(root, "commit", "-q", "--allow-empty", "-m", "start")
  }
  for (const [path, content] of Object.entries(options.files ?? {})) write(root, path, content)
  return root
}

export const write = (root: string, path: string, content: string | Uint8Array): void => {
  const full = join(root, ...path.split("/"))
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

/** What `Output` received, for asserting on a command's result. */
export interface Captured {
  readonly out: Array<string>
  readonly err: Array<string>
}

/** Kernel services for a project, with counting ids and captured output. */
export const testKernel = (root: string, captured: Captured = { out: [], err: [] }, json = true): Layer.Layer<Kernel> =>
  Layer.mergeAll(
    Git.layerNoDeps,
    Ids.layerTest,
    Output.layer(json, { out: (line) => void captured.out.push(line), err: (line) => void captured.err.push(line) })
  ).pipe(Layer.provideMerge(Layer.mergeAll(ProjectFiles.layer(root), Process.layer)))

/** Run an effect against a project; rejects with the ToolError when it fails. */
export const run = <A, E>(root: string, effect: Effect.Effect<A, E, Kernel>): Promise<A> =>
  Effect.runPromise(Effect.scoped(effect).pipe(Effect.provide(testKernel(root))))

/** Run an effect that is expected to fail and return its ToolError. */
export const failure = async <A>(root: string, effect: Effect.Effect<A, ToolError, Kernel>): Promise<ToolError> => {
  const exit = await Effect.runPromiseExit(Effect.scoped(effect).pipe(Effect.provide(testKernel(root))))
  if (Exit.isSuccess(exit)) throw new Error(`expected a failure, got ${JSON.stringify(exit.value)}`)
  const error = Option.getOrUndefined(Exit.findErrorOption(exit))
  if (error === undefined) throw new Error(`expected a ToolError, got a defect: ${String(exit.cause)}`)
  return error
}
