// Every read and write of project files goes through this service. Paths are project-relative with
// forward slashes; nothing resolves outside the project, including through symbolic links.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import { createHash, randomUUID } from "node:crypto"
import { createReadStream, realpathSync } from "node:fs"
import * as fsp from "node:fs/promises"
import { hostname } from "node:os"
import * as nodePath from "node:path"
import { asToolError, fail, type ToolError, toolError } from "./errors.ts"
import { portableProblem } from "./hash.ts"

export interface FileStat {
  readonly kind: "file" | "directory" | "other"
  readonly size: number
  readonly mtimeMs: number
  readonly symlink: boolean
}

export interface DirEntry {
  readonly name: string
  readonly kind: "file" | "directory" | "other"
  readonly symlink: boolean
}

export interface LockHolder {
  readonly pid: number
  readonly host: string
  readonly at: string
}

export interface AccessOptions {
  /** Refuse when any path component below the project root is a symbolic link. */
  readonly noFollow?: boolean
}

export interface WalkOptions {
  /** Return true to leave a directory or file out; receives the project-relative path. */
  readonly skip?: (path: string, kind: "file" | "directory") => boolean
}

export class ProjectFiles extends Context.Service<ProjectFiles, {
  /** Absolute, symlink-resolved project root. */
  readonly root: string
  /** Absolute path of a portable project path, refusing anything that leaves the project. */
  resolve(path: string, options?: AccessOptions): Effect.Effect<string, ToolError>
  /** The project-relative form of an absolute or relative OS path inside the project. */
  relative(osPath: string): Effect.Effect<string, ToolError>
  stat(path: string, options?: AccessOptions): Effect.Effect<FileStat | null, ToolError>
  exists(path: string): Effect.Effect<boolean, ToolError>
  readBytes(path: string, options?: AccessOptions): Effect.Effect<Uint8Array, ToolError>
  readText(path: string, options?: AccessOptions): Effect.Effect<string, ToolError>
  readJson(path: string, options?: AccessOptions): Effect.Effect<unknown, ToolError>
  /** Replace a file atomically, creating parent folders. */
  writeBytes(path: string, bytes: Uint8Array, options?: AccessOptions): Effect.Effect<void, ToolError>
  writeText(path: string, text: string, options?: AccessOptions): Effect.Effect<void, ToolError>
  /** Two-space JSON with a trailing newline. */
  writeJson(path: string, value: unknown, options?: AccessOptions): Effect.Effect<void, ToolError>
  remove(path: string, options?: AccessOptions): Effect.Effect<void, ToolError>
  copy(from: string, to: string): Effect.Effect<void, ToolError>
  makeDirectory(path: string): Effect.Effect<void, ToolError>
  list(path: string, options?: AccessOptions): Effect.Effect<ReadonlyArray<DirEntry>, ToolError>
  /** Every file under a folder, sorted. Linked folders are not entered. A missing folder is empty. */
  walk(path: string, options?: WalkOptions): Effect.Effect<ReadonlyArray<string>, ToolError>
  /** SHA-256 of a file's bytes, cached while its size and modification time are unchanged. */
  sha256(path: string): Effect.Effect<string, ToolError>
  /** Hold an exclusive lock file until the scope closes. Fails with `locked` when it is held. */
  lock(path: string): Effect.Effect<void, ToolError, Scope.Scope>
  lockHolder(path: string): Effect.Effect<LockHolder | null, ToolError>
  /** Remove a lock only when its owner ran on this machine and is no longer alive. */
  breakLock(path: string): Effect.Effect<LockHolder, ToolError>
}>()("jam/kernel/ProjectFiles") {
  /** Files of the project rooted at `root` (any OS path; it is resolved through symlinks). */
  static readonly layer = (root: string): Layer.Layer<ProjectFiles> => Layer.sync(ProjectFiles, () => make(root))
}

const missing = (cause: unknown): boolean =>
  typeof cause === "object" && cause !== null && (cause as { code?: string }).code === "ENOENT"

const inside = (base: string, target: string): boolean => {
  const rel = nodePath.relative(base, target)
  return rel === "" || (!rel.startsWith(`..${nodePath.sep}`) && rel !== ".." && !nodePath.isAbsolute(rel))
}

const kindOf = (s: { isFile(): boolean; isDirectory(): boolean }): FileStat["kind"] =>
  s.isFile() ? "file" : s.isDirectory() ? "directory" : "other"

const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    return (cause as { code?: string }).code === "EPERM"
  }
}

function make(rootInput: string): ProjectFiles["Service"] {
  const root = realpathSync(nodePath.resolve(rootInput))
  const hashes = new Map<string, { size: number; mtimeMs: number; sha256: string }>()

  const io = <A>(what: string, run: () => Promise<A>): Effect.Effect<A, ToolError> =>
    Effect.tryPromise({ try: run, catch: asToolError("unavailable", what) })

  // The nearest existing ancestor must still be inside the project once links are resolved.
  const confined = async (full: string): Promise<boolean> => {
    let ancestor = full
    for (;;) {
      try {
        return inside(root, await fsp.realpath(ancestor))
      } catch (cause) {
        if (!missing(cause)) throw cause
        const up = nodePath.dirname(ancestor)
        if (up === ancestor) return false
        ancestor = up
      }
    }
  }

  const hasLink = async (path: string): Promise<boolean> => {
    let current = root
    for (const part of path.split("/")) {
      current = nodePath.join(current, part)
      try {
        if ((await fsp.lstat(current)).isSymbolicLink()) return true
      } catch (cause) {
        if (missing(cause)) return false
        throw cause
      }
    }
    return false
  }

  const resolve = (path: string, options?: AccessOptions): Effect.Effect<string, ToolError> =>
    Effect.gen(function*() {
      const problem = portableProblem(path)
      if (problem) return yield* fail("forbidden", `${problem}: ${JSON.stringify(path)}`)
      const full = nodePath.join(root, ...path.split("/"))
      if (options?.noFollow) {
        if (yield* io(`check ${path}`, () => hasLink(path))) {
          return yield* fail("forbidden", `${path} passes through a symbolic link`)
        }
      } else if (!(yield* io(`check ${path}`, () => confined(full)))) {
        return yield* fail("forbidden", `${path} leaves the project through a symbolic link`)
      }
      return full
    })

  const relative = (osPath: string): Effect.Effect<string, ToolError> => {
    const full = nodePath.resolve(root, osPath)
    const rel = nodePath.relative(root, full).split(nodePath.sep).join("/")
    return rel !== "" && inside(root, full) ? Effect.succeed(rel) : fail("forbidden", `${osPath} is not inside the project`)
  }

  const stat = (path: string, options?: AccessOptions): Effect.Effect<FileStat | null, ToolError> =>
    Effect.flatMap(resolve(path, options), (full) =>
      io(`stat ${path}`, async () => {
        try {
          const link = await fsp.lstat(full)
          const target = link.isSymbolicLink() ? await fsp.stat(full) : link
          return { kind: kindOf(target), size: target.size, mtimeMs: target.mtimeMs, symlink: link.isSymbolicLink() }
        } catch (cause) {
          if (missing(cause)) return null
          throw cause
        }
      }))

  const readBytes = (path: string, options?: AccessOptions): Effect.Effect<Uint8Array, ToolError> =>
    Effect.flatMap(resolve(path, options), (full) =>
      Effect.tryPromise({
        try: () => fsp.readFile(full),
        catch: (cause) =>
          missing(cause) ? toolError("not_found", `${path} does not exist`) : asToolError("unavailable", `read ${path}`)(cause)
      }))

  const readText = (path: string, options?: AccessOptions): Effect.Effect<string, ToolError> =>
    Effect.map(readBytes(path, options), (bytes) => Buffer.from(bytes).toString("utf8"))

  const readJson = (path: string, options?: AccessOptions): Effect.Effect<unknown, ToolError> =>
    Effect.flatMap(readText(path, options), (text) =>
      Effect.try({
        try: () => JSON.parse(text) as unknown,
        catch: (cause) => toolError("malformed", `${path} is not valid JSON: ${(cause as Error).message}`)
      }))

  const writeBytes = (path: string, bytes: Uint8Array, options?: AccessOptions): Effect.Effect<void, ToolError> =>
    Effect.flatMap(resolve(path, options), (full) =>
      io(`write ${path}`, async () => {
        await fsp.mkdir(nodePath.dirname(full), { recursive: true })
        const temporary = `${full}.${randomUUID()}.tmp`
        try {
          await fsp.writeFile(temporary, bytes, { flag: "wx" })
          await fsp.rename(temporary, full)
        } finally {
          await fsp.rm(temporary, { force: true })
        }
      }))

  const writeText = (path: string, text: string, options?: AccessOptions): Effect.Effect<void, ToolError> =>
    writeBytes(path, Buffer.from(text, "utf8"), options)

  const writeJson = (path: string, value: unknown, options?: AccessOptions): Effect.Effect<void, ToolError> =>
    writeText(path, `${JSON.stringify(value, null, 2)}\n`, options)

  const remove = (path: string, options?: AccessOptions): Effect.Effect<void, ToolError> =>
    Effect.flatMap(resolve(path, options), (full) => io(`remove ${path}`, () => fsp.rm(full, { force: true, recursive: true })))

  const copy = (from: string, to: string): Effect.Effect<void, ToolError> =>
    Effect.gen(function*() {
      const source = yield* resolve(from)
      const target = yield* resolve(to)
      yield* Effect.tryPromise({
        try: async () => {
          await fsp.mkdir(nodePath.dirname(target), { recursive: true })
          await fsp.copyFile(source, target)
        },
        catch: (cause) =>
          missing(cause) ? toolError("not_found", `${from} does not exist`) : asToolError("unavailable", `copy ${from}`)(cause)
      })
    })

  const makeDirectory = (path: string): Effect.Effect<void, ToolError> =>
    Effect.flatMap(resolve(path), (full) => Effect.asVoid(io(`create ${path}`, () => fsp.mkdir(full, { recursive: true }))))

  const entries = async (full: string): Promise<ReadonlyArray<DirEntry>> => {
    let listed
    try {
      listed = await fsp.readdir(full, { withFileTypes: true })
    } catch (cause) {
      if (missing(cause)) return []
      throw cause
    }
    const out: Array<DirEntry> = []
    for (const entry of listed) {
      if (entry.isSymbolicLink()) {
        let kind: DirEntry["kind"] = "other"
        try {
          kind = kindOf(await fsp.stat(nodePath.join(full, entry.name)))
        } catch { /* a dangling link is neither file nor folder */ }
        out.push({ name: entry.name, kind, symlink: true })
      } else out.push({ name: entry.name, kind: kindOf(entry), symlink: false })
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }

  const list = (path: string, options?: AccessOptions): Effect.Effect<ReadonlyArray<DirEntry>, ToolError> =>
    Effect.flatMap(path === "" ? Effect.succeed(root) : resolve(path, options), (full) => io(`list ${path}`, () => entries(full)))

  const walk = (path: string, options?: WalkOptions): Effect.Effect<ReadonlyArray<string>, ToolError> =>
    Effect.flatMap(path === "" ? Effect.succeed(root) : resolve(path), (start) =>
      io(`walk ${path}`, async () => {
        const out: Array<string> = []
        const visit = async (full: string, rel: string): Promise<void> => {
          for (const entry of await entries(full)) {
            const child = rel === "" ? entry.name : `${rel}/${entry.name}`
            if (entry.kind === "directory") {
              if (entry.symlink || options?.skip?.(child, "directory")) continue
              await visit(nodePath.join(full, entry.name), child)
            } else if (entry.kind === "file" && !options?.skip?.(child, "file")) out.push(child)
          }
        }
        await visit(start, path)
        return out
      }))

  const hashFile = (full: string): Promise<string> =>
    new Promise((done, reject) => {
      const hash = createHash("sha256")
      createReadStream(full).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", () => done(hash.digest("hex")))
    })

  const sha256 = (path: string): Effect.Effect<string, ToolError> =>
    Effect.gen(function*() {
      const full = yield* resolve(path)
      const info = yield* stat(path)
      if (!info || info.kind !== "file") return yield* fail("not_found", `${path} does not exist`)
      const cached = hashes.get(path)
      if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) return cached.sha256
      const value = yield* io(`hash ${path}`, () => hashFile(full))
      hashes.set(path, { size: info.size, mtimeMs: info.mtimeMs, sha256: value })
      return value
    })

  const lockHolder = (path: string): Effect.Effect<LockHolder | null, ToolError> =>
    Effect.flatMap(resolve(path, { noFollow: true }), (full) =>
      io(`read lock ${path}`, async () => {
        try {
          return JSON.parse(await fsp.readFile(full, "utf8")) as LockHolder
        } catch (cause) {
          if (missing(cause)) return null
          return { pid: 0, host: "unknown", at: "unknown" }
        }
      }))

  const lock = (path: string): Effect.Effect<void, ToolError, Scope.Scope> =>
    Effect.flatMap(resolve(path, { noFollow: true }), (full) =>
      Effect.asVoid(Effect.acquireRelease(
        Effect.tryPromise({
          try: async () => {
            await fsp.mkdir(nodePath.dirname(full), { recursive: true })
            const holder: LockHolder = { pid: process.pid, host: hostname(), at: new Date().toISOString() }
            await fsp.writeFile(full, JSON.stringify(holder), { flag: "wx" })
          },
          catch: (cause) =>
            (cause as { code?: string }).code === "EEXIST"
              ? toolError("locked", `${path} is held by another writer`, {
                fix: "wait for it to finish; if its process has exited, remove the lock with the unlock command"
              })
              : asToolError("unavailable", `lock ${path}`)(cause)
        }),
        () => Effect.promise(() => fsp.rm(full, { force: true }))
      )))

  const breakLock = (path: string): Effect.Effect<LockHolder, ToolError> =>
    Effect.gen(function*() {
      const holder = yield* lockHolder(path)
      if (!holder) return yield* fail("not_found", `${path} is not locked`)
      if (holder.host !== hostname()) {
        return yield* fail("locked", `${path} is held from another machine (${holder.host}); it cannot be verified here`)
      }
      if (holder.pid > 0 && processAlive(holder.pid)) {
        return yield* fail("locked", `${path} is held by running process ${holder.pid}`)
      }
      yield* remove(path, { noFollow: true })
      return holder
    })

  return {
    root,
    resolve,
    relative,
    stat,
    exists: (path) => Effect.map(stat(path), (info) => info !== null),
    readBytes,
    readText,
    readJson,
    writeBytes,
    writeText,
    writeJson,
    remove,
    copy,
    makeDirectory,
    list,
    walk,
    sha256,
    lock,
    lockHolder,
    breakLock
  }
}
