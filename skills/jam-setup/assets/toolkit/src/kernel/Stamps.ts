// File stamps: a path with the SHA-256 it had when recorded. Status checks re-verify every recorded
// file of every run, so digests are reused across processes while a file's inode, size,
// modification time and change time hold. The change time moves on any write and cannot be set
// back, so a rewrite that keeps size and modification time is still rehashed.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import * as fsp from "node:fs/promises"
import * as nodePath from "node:path"
import { asToolError, fail, type ToolError } from "./errors.ts"
import { isRecord } from "./hash.ts"
import { ProjectFiles } from "./ProjectFiles.ts"

export interface FileStamp {
  readonly path: string
  readonly sha256: string
}

interface Entry {
  readonly key: string
  readonly sha256: string
}

export class Stamps extends Context.Service<Stamps, {
  /** Hash a project file. Fails with `not_found` when it does not exist. */
  stamp(path: string): Effect.Effect<FileStamp, ToolError>
  /** True when the file still has the recorded bytes. A missing or unreadable file is changed. */
  unchanged(stamp: FileStamp): Effect.Effect<boolean>
}>()("jam/kernel/Stamps") {
  /**
   * Stamps for the project, remembered in `cacheFile` (a project path in an ignored folder) between
   * runs of the tool; `null` keeps them for this process only.
   */
  static readonly layerAt = <E, R>(cacheFile: Effect.Effect<string | null, E, R>): Layer.Layer<Stamps, E, ProjectFiles | R> =>
    Layer.effect(
      Stamps,
      Effect.gen(function*() {
        const files = yield* ProjectFiles
        const file = yield* cacheFile
        let entries: Map<string, Entry> | undefined
        let dirty = false

        const load = Effect.suspend(() => {
          if (entries !== undefined) return Effect.succeed(entries)
          const read = file === null ? Effect.succeed<unknown>({}) : files.readJson(file).pipe(Effect.catch(() => Effect.succeed<unknown>({})))
          return Effect.map(read, (raw) => {
            entries = new Map()
            if (isRecord(raw)) {
              for (const [path, entry] of Object.entries(raw)) {
                if (isRecord(entry) && typeof entry["key"] === "string" && typeof entry["sha256"] === "string") {
                  entries.set(path, { key: entry["key"], sha256: entry["sha256"] })
                }
              }
            }
            return entries
          })
        })

        if (file !== null) {
          yield* Effect.addFinalizer(() =>
            dirty && entries !== undefined
              // A cache that cannot be written only costs time on the next run.
              ? Effect.ignore(files.writeText(file, JSON.stringify(Object.fromEntries(entries))))
              : Effect.void
          )
        }

        const statKey = (full: string): Promise<string | null> =>
          fsp.stat(full).then(
            (info) => (info.isFile() ? `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}` : null),
            () => null
          )

        const hash = (full: string): Promise<string> =>
          new Promise((done, reject) => {
            const sha = createHash("sha256")
            createReadStream(full).on("data", (chunk) => sha.update(chunk)).on("error", reject).on("end", () => done(sha.digest("hex")))
          })

        const stamp = (path: string): Effect.Effect<FileStamp, ToolError> =>
          Effect.gen(function*() {
            // Resolving confines the path to the project, including through symbolic links.
            const full = yield* files.resolve(path)
            const cache = yield* load
            const key = yield* Effect.promise(() => statKey(full))
            if (key === null) return yield* fail("not_found", `${path} does not exist`)
            const hit = cache.get(path)
            if (hit !== undefined && hit.key === key) return { path, sha256: hit.sha256 }
            const sha256 = yield* Effect.tryPromise({ try: () => hash(full), catch: asToolError("unavailable", `hash ${path}`) })
            // Only remember a digest when the file did not change while it was read.
            if ((yield* Effect.promise(() => statKey(full))) === key) {
              cache.set(path, { key, sha256 })
              dirty = true
            }
            return { path, sha256 }
          })

        return {
          stamp,
          unchanged: (recorded) =>
            stamp(recorded.path).pipe(
              Effect.map((now) => now.sha256 === recorded.sha256),
              Effect.catch(() => Effect.succeed(false))
            )
        }
      })
    )

  /** Stamps with no persistent cache. */
  static readonly layerNoCache: Layer.Layer<Stamps, never, ProjectFiles> = Stamps.layerAt(Effect.succeed(null))
}

/** The folder of a project path ("" for a top-level file). */
export const parentOf = (path: string): string => {
  const parent = nodePath.posix.dirname(path)
  return parent === "." ? "" : parent
}
