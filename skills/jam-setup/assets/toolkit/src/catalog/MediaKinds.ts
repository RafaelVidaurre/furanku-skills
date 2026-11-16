// What kind of media a file is and whether it can be shown: decided from its first bytes by the
// registered media kinds. Opening a project reads 64 bytes of each file, never the whole file: the
// SHA-256 is computed when something needs it (a detail page, freezing, comparing) and both are
// remembered while the file's size and modification time are unchanged, in memory and in a
// machine-local file.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import * as fsp from "node:fs/promises"
import { extensionOf, sha256 as digestOf } from "../kernel/hash.ts"
import { ProjectFiles } from "../kernel/ProjectFiles.ts"
import type { AssetFiles } from "./assetFiles.ts"
import type { MediaFacts } from "./model/types.ts"
import type { MediaKind } from "./plugin.ts"
import { ensureLocal } from "./records/files.ts"
import { fromPlugin, message } from "./support.ts"

const CACHE_FILE = ".catalog/.local/facts/media.json"
const CACHE_VERSION = 2
const HEAD_BYTES = 64

export interface Sniffed {
  readonly kind: string
  readonly mime: string
}

/** The first registered kind that recognises these bytes. */
export const sniffWith = (kinds: ReadonlyArray<MediaKind>, head: Uint8Array): Sniffed | null => {
  for (const kind of kinds) {
    const mime = kind.sniff(head)
    if (mime !== null) return { kind: kind.id, mime }
  }
  return null
}

/** The kind an extension names, before any bytes are read. */
export const kindByExtension = (kinds: ReadonlyArray<MediaKind>, path: string): string | null => {
  const extension = extensionOf(path)
  return kinds.find((kind) => kind.extensions.includes(extension))?.id ?? null
}

interface Remembered {
  readonly size: number
  readonly mtimeMs: number
  readonly facts: MediaFacts
}

interface Hashed {
  readonly size: number
  readonly mtimeMs: number
  readonly sha256: string
}

/** A cheap stand-in for a digest: it changes whenever the file's size or modification time does. */
export const versionToken = (path: string, size: number, mtimeMs: number): string => digestOf(`${path}\0${size}\0${mtimeMs}`).slice(0, 16)

const readHead = async (full: string): Promise<Buffer> => {
  const handle = await fsp.open(full, "r")
  try {
    const head = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await handle.read(head, 0, HEAD_BYTES, 0)
    return head.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

const hashFile = (full: string): Promise<string> =>
  new Promise((done, reject) => {
    const hash = createHash("sha256")
    createReadStream(full)
      .on("data", (chunk) => hash.update(chunk as Buffer))
      .on("error", reject)
      .on("end", () => done(hash.digest("hex")))
  })

export interface MediaFile {
  readonly path: string
  /** The kind the project declared or the extension names; bytes of another kind are invalid. */
  readonly kind: string | null
}

export class MediaKinds extends Context.Service<MediaKinds, {
  /**
   * Facts of one file under the asset roots, from its first bytes. Never fails: a problem is a
   * state. `sha256` is present only when it was already computed for this version of the file.
   */
  facts(file: MediaFile, kinds: ReadonlyArray<MediaKind>, within: AssetFiles): Effect.Effect<MediaFacts>
  /** The SHA-256 of a file under the asset roots, read once per version of the file; null when it cannot be read. */
  hash(path: string, within: AssetFiles): Effect.Effect<string | null>
  /** Write remembered facts and digests to the machine-local cache when any changed. */
  readonly persist: Effect.Effect<void>
  /** How many files were read in full (hashed) since this service started. */
  readonly hashed: Effect.Effect<number>
}>()("jam/catalog/MediaKinds") {
  static readonly layerNoDeps: Layer.Layer<MediaKinds, never, ProjectFiles> = Layer.effect(
    MediaKinds,
    Effect.gen(function*() {
      const files = yield* ProjectFiles
      const remembered = new Map<string, Remembered>()
      const hashes = new Map<string, Hashed>()
      let loaded = false
      let dirty = false
      let hashed = 0

      // The cache is an optimisation: an unreadable or linked file just means measuring again.
      const load = files.readJson(CACHE_FILE, { noFollow: true }).pipe(
        Effect.map((value) => {
          const cache = value as { version?: unknown; entries?: Record<string, Remembered>; hashes?: Record<string, Hashed> } | null
          if (cache?.version !== CACHE_VERSION) return
          for (const [key, entry] of Object.entries(cache.entries ?? {})) if (!remembered.has(key)) remembered.set(key, entry)
          for (const [path, entry] of Object.entries(cache.hashes ?? {})) if (!hashes.has(path)) hashes.set(path, entry)
        }),
        Effect.catch(() => Effect.void)
      )
      const ready = Effect.suspend(() => {
        if (loaded) return Effect.void
        loaded = true
        return load
      })

      const measure = (file: MediaFile, full: string, size: number, mtimeMs: number, kinds: ReadonlyArray<MediaKind>): Effect.Effect<MediaFacts> =>
        Effect.gen(function*() {
          const read = yield* Effect.result(Effect.tryPromise({ try: () => readHead(full), catch: message }))
          if (read._tag === "Failure") return { state: "missing", error: `cannot read ${file.path}: ${read.failure}` } satisfies MediaFacts
          const head = read.success
          const token = versionToken(file.path, size, mtimeMs)
          const sniffed = sniffWith(kinds, head)
          const named = kindByExtension(kinds, file.path)
          if (!sniffed) {
            return named
              ? { state: "invalid", error: `file bytes are not a supported media format (${kinds.map((kind) => kind.label.toLowerCase()).join(", ")})`, token, size }
              : { state: "unsupported", error: `unsupported format: .${extensionOf(file.path)}`, token, size }
          }
          if (file.kind && sniffed.kind !== file.kind) {
            return { state: "invalid", error: `declared ${file.kind} but bytes are ${sniffed.mime}`, token, size }
          }
          const validate = kinds.find((kind) => kind.id === sniffed.kind)?.validate
          if (validate) {
            const reason = yield* fromPlugin(`validate ${file.path}`, () => validate({ path: file.path, absolutePath: full, size })).pipe(
              Effect.catch((error) => Effect.succeed(error.message))
            )
            if (reason !== null) return { state: "unsupported", error: reason, token, size }
          }
          return { state: "ok", token, size, mime: sniffed.mime, kind: sniffed.kind, mtime: mtimeMs }
        })

      const facts = (file: MediaFile, kinds: ReadonlyArray<MediaKind>, within: AssetFiles): Effect.Effect<MediaFacts> =>
        Effect.gen(function*() {
          yield* ready
          const located = yield* Effect.promise(() => within.locate(file.path))
          if ("code" in located) return { state: "forbidden", error: located.message }
          if (located.stat === null) return { state: "missing", error: `file not found: ${file.path}` }
          if (!located.stat.isFile) return { state: "missing", error: `not a file: ${file.path}` }
          const { mtimeMs, size } = located.stat
          // The same file can be asked about with and without a declared kind; each answer is kept.
          const key = `${file.path}\0${file.kind ?? ""}`
          const hit = remembered.get(key)
          let value = hit && hit.size === size && hit.mtimeMs === mtimeMs ? hit.facts : null
          if (value === null) {
            value = yield* measure(file, located.full, size, mtimeMs, kinds)
            remembered.set(key, { size, mtimeMs, facts: value })
            dirty = true
          }
          const known = hashes.get(file.path)
          return known && known.size === size && known.mtimeMs === mtimeMs && value.token !== undefined ? { ...value, sha256: known.sha256 } : value
        })

      const hash = (path: string, within: AssetFiles): Effect.Effect<string | null> =>
        Effect.gen(function*() {
          yield* ready
          const located = yield* Effect.promise(() => within.locate(path))
          if ("code" in located || located.stat === null || !located.stat.isFile) return null
          const { mtimeMs, size } = located.stat
          const known = hashes.get(path)
          if (known && known.size === size && known.mtimeMs === mtimeMs) return known.sha256
          const read = yield* Effect.result(Effect.tryPromise({ try: () => hashFile(located.full), catch: message }))
          if (read._tag === "Failure") return null
          hashed++
          hashes.set(path, { size, mtimeMs, sha256: read.success })
          dirty = true
          return read.success
        })

      const persist = Effect.suspend(() => {
        if (!dirty) return Effect.void
        dirty = false
        // The ignore rule is written first, so the cache never shows up as an untracked file.
        return ensureLocal(files).pipe(
          Effect.andThen(files.writeText(CACHE_FILE, JSON.stringify({ version: CACHE_VERSION, entries: Object.fromEntries(remembered), hashes: Object.fromEntries(hashes) }), { noFollow: true })),
          Effect.catch(() => Effect.void)
        )
      })

      return { facts, hash, persist, hashed: Effect.sync(() => hashed) }
    })
  )
}
