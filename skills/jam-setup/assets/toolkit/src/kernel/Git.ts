// The checkout the tools describe. Git is optional: a folder that is not a repository still works,
// with no branch, no blobs and nothing ignored.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { existsSync, realpathSync } from "node:fs"
import * as fsp from "node:fs/promises"
import * as nodePath from "node:path"
import type { ToolError } from "./errors.ts"
import { sha256 } from "./hash.ts"
import { Process, type RunOptions } from "./Process.ts"
import { ProjectFiles } from "./ProjectFiles.ts"

export interface Checkout {
  readonly root: string
  readonly name: string
  readonly git: boolean
  readonly branch: string | null
  readonly head: string | null
  readonly detached: boolean
  /** Stable for one worktree on one machine. */
  readonly worktree: string
  /** Worktree plus branch (or detached commit): changes when the checkout moves. */
  readonly key: string
}

export class Git extends Context.Service<Git, {
  /** Run git in the project; null when it exits nonzero or git is missing. */
  text(args: ReadonlyArray<string>, options?: RunOptions): Effect.Effect<string | null>
  /** Run git and return raw output bytes; null on failure. */
  bytes(args: ReadonlyArray<string>, options?: RunOptions): Effect.Effect<Uint8Array | null>
  /** Which worktree and branch this is. Reads Git's files directly: no process, no file status. */
  readonly checkout: Effect.Effect<Checkout>
  /** Number of changed or untracked paths, leaving out those under the given portable prefixes. */
  dirtyCount(excluding?: ReadonlyArray<string>): Effect.Effect<number>
  /** The configured user name, when there is one. */
  readonly userName: Effect.Effect<string | null>
  /** Which of these project paths Git ignores. Empty outside a repository. */
  ignored(paths: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string>, ToolError>
}>()("jam/kernel/Git") {
  static readonly layerNoDeps: Layer.Layer<Git, never, Process | ProjectFiles> = Layer.effect(
    Git,
    Effect.gen(function*() {
      const proc = yield* Process
      const files = yield* ProjectFiles
      const root = files.root
      const env = { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" }

      const bytes = (args: ReadonlyArray<string>, options: RunOptions = {}): Effect.Effect<Uint8Array | null> =>
        proc.run("git", args, { cwd: root, ...options, env: { ...env, ...options.env } }).pipe(
          Effect.map((result) => (result.code === 0 ? result.stdout : null)),
          Effect.catch(() => Effect.succeed(null))
        )
      const text = (args: ReadonlyArray<string>, options?: RunOptions): Effect.Effect<string | null> =>
        Effect.map(bytes(args, options), (out) => (out === null ? null : Buffer.from(out).toString("utf8").trim()))

      const noGit = (): Checkout => {
        const id = sha256(root).slice(0, 12)
        return { root, name: nodePath.basename(root), git: false, branch: null, head: null, detached: false, worktree: id, key: `nogit:${id}` }
      }

      // Asked for on every poll of a running catalog, so it reads Git's own files instead of
      // starting processes: `.git` (a folder, or a file naming the folder for a linked worktree)
      // and `HEAD`. Anything unexpected falls back to asking git.
      const fromFiles = async (): Promise<Checkout | "not-a-checkout" | "ask-git"> => {
        const dotGit = nodePath.join(root, ".git")
        let gitDir: string
        try {
          const info = await fsp.stat(dotGit)
          if (info.isDirectory()) gitDir = dotGit
          else {
            const pointer = /^gitdir: (.+)$/m.exec(await fsp.readFile(dotGit, "utf8"))
            if (!pointer?.[1]) return "ask-git"
            gitDir = nodePath.resolve(root, pointer[1].trim())
          }
        } catch {
          // No `.git` here: either not a repository, or a folder inside one (which is not its checkout).
          return "not-a-checkout"
        }
        let head: string
        try {
          head = (await fsp.readFile(nodePath.join(gitDir, "HEAD"), "utf8")).trim()
        } catch {
          return "ask-git"
        }
        const symbolic = /^ref: refs\/heads\/(.+)$/.exec(head)
        if (!symbolic && !/^[0-9a-f]{40,64}$/.test(head)) return "ask-git"
        const branch = symbolic?.[1] ?? null
        let commit: string | null = symbolic ? null : head
        if (branch !== null) {
          // A branch's commit lives in the shared folder of the repository: loose first, then packed.
          let common = gitDir
          try {
            common = nodePath.resolve(gitDir, (await fsp.readFile(nodePath.join(gitDir, "commondir"), "utf8")).trim())
          } catch { /* the main worktree has no commondir file */ }
          try {
            commit = (await fsp.readFile(nodePath.join(common, "refs", "heads", ...branch.split("/")), "utf8")).trim()
          } catch {
            try {
              const packed = await fsp.readFile(nodePath.join(common, "packed-refs"), "utf8")
              const line = packed.split("\n").find((entry) => entry.endsWith(` refs/heads/${branch}`))
              commit = line?.split(" ")[0] ?? null
            } catch { /* a branch with no commit yet */ }
          }
        }
        const worktree = sha256(realpathSync(gitDir)).slice(0, 12)
        const ref = branch ?? `detached@${commit?.slice(0, 12) ?? "unborn"}`
        return { root, name: nodePath.basename(root), git: true, branch, head: commit, detached: branch === null, worktree, key: `${worktree}:${ref}` }
      }

      const fromGit: Effect.Effect<Checkout> = Effect.gen(function*() {
        const top = yield* text(["rev-parse", "--show-toplevel"])
        // A project folder nested in someone else's repository is not that repository's checkout.
        if (top === null || realpathSync(top) !== root) return noGit()
        const gitDirRaw = (yield* text(["rev-parse", "--git-dir"])) ?? ".git"
        const gitDir = nodePath.isAbsolute(gitDirRaw) ? gitDirRaw : nodePath.resolve(root, gitDirRaw)
        const branch = (yield* text(["symbolic-ref", "--short", "-q", "HEAD"])) || null
        const head = (yield* text(["rev-parse", "--verify", "-q", "HEAD"])) || null
        const worktree = sha256(existsSync(gitDir) ? realpathSync(gitDir) : gitDir).slice(0, 12)
        const ref = branch ?? `detached@${head?.slice(0, 12) ?? "unborn"}`
        return { root, name: nodePath.basename(root), git: true, branch, head, detached: branch === null, worktree, key: `${worktree}:${ref}` }
      })

      const checkout: Effect.Effect<Checkout> = Effect.flatMap(
        Effect.promise(() => fromFiles().catch(() => "ask-git" as const)),
        (read) => (read === "ask-git" ? fromGit : read === "not-a-checkout" ? Effect.succeed(noGit()) : Effect.succeed(read))
      )

      const dirtyCount = (excluding: ReadonlyArray<string> = []): Effect.Effect<number> =>
        Effect.map(bytes(["status", "--porcelain=v1", "-z", "--untracked-files=all"]), (out) => {
          if (out === null) return 0
          return Buffer.from(out).toString("utf8").split("\0").filter(Boolean)
            .filter((line) => !excluding.some((prefix) => line.slice(3).startsWith(prefix))).length
        })

      const ignored = (paths: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string>, ToolError> =>
        paths.length === 0
          ? Effect.succeed([])
          : proc.run("git", ["check-ignore", "--no-index", "-z", "--stdin"], { cwd: root, env, input: `${paths.join("\0")}\0` }).pipe(
            // 0: some are ignored (listed); 1: none are; anything else: not a repository.
            Effect.map((result) => (result.code === 0 ? Buffer.from(result.stdout).toString("utf8").split("\0").filter(Boolean) : [])),
            Effect.catch(() => Effect.succeed([] as ReadonlyArray<string>))
          )

      return { text, bytes, checkout, dirtyCount, userName: Effect.map(text(["config", "user.name"]), (name) => name || null), ignored }
    })
  )
}
