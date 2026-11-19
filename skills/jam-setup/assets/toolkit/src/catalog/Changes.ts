// Which project files changed, as the operating system reports them. A long-running catalog
// (the server) watches the checkout, so an action whose inputs saw no change reuses what it read
// last time instead of fingerprinting every input again. Before it answers, a request settles
// the feed: it writes a marker file and waits for the marker's event, and since events arrive in
// order, every change made before the request is known by then. What cannot be vouched for (no
// watcher, a watcher that failed, fell behind or stopped delivering) reads as unknown, and the
// caller checks everything as it always did.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import { type FSWatcher, mkdirSync, watch } from "node:fs"
import * as fsp from "node:fs/promises"
import * as nodePath from "node:path"
import { ProjectFiles } from "../kernel/ProjectFiles.ts"
import { ensureLocal } from "./records/files.ts"
import { LOCAL_DIR } from "./records/layout.ts"

/** Distinct changed paths remembered before the feed gives up and reads as unknown. */
const MAX_PATHS = 20_000
/** Not inputs of anything: the catalog's own machine-local files, Git's database, installed packages. */
const IGNORED = new RegExp(`^(?:\\.git|${LOCAL_DIR.replace(/\./g, "\\.")}|node_modules)(?:/|$)|/node_modules(?:/|$)`)
/** Where the markers that settle the feed are written. */
const MARKERS = `${LOCAL_DIR}/changes`
/** A marker whose event takes longer than this: the watcher is not delivering, and is no longer trusted. */
const SETTLE_MS = 2_000

export class Changes extends Context.Service<Changes, {
  /** A position in the feed, to ask later what changed after it. */
  readonly mark: Effect.Effect<number>
  /** Project-relative paths changed after `mark`; null when that is not known. A path may be a folder. */
  since(mark: number): Effect.Effect<ReadonlySet<string> | null>
  /** Wait until every change made before now is in the feed. Immediate when nothing is watched. */
  readonly settle: Effect.Effect<void>
  /** Watch the project until the scope closes. Without it every question reads as unknown. */
  readonly watch: Effect.Effect<void, never, Scope.Scope>
}>()("jam/catalog/Changes") {
  static readonly layerNoDeps: Layer.Layer<Changes, never, ProjectFiles> = Layer.effect(
    Changes,
    Effect.gen(function*() {
      const files = yield* ProjectFiles
      const root = files.root
      let seq = 0
      // Marks below `floor` predate what the feed can vouch for.
      let floor = Number.POSITIVE_INFINITY
      let watcher: FSWatcher | null = null
      const changed = new Map<string, number>()
      const forget = (): void => {
        changed.clear()
        floor = ++seq
      }
      let markers = 0
      const waiting = new Map<number, () => void>()
      const arrived = (marker: number): void => {
        for (const [n, done] of waiting) {
          if (n <= marker) {
            waiting.delete(n)
            done()
          }
        }
      }
      const distrust = (): void => {
        watcher?.close()
        watcher = null
        floor = Number.POSITIVE_INFINITY
        arrived(Number.POSITIVE_INFINITY)
      }
      const record = (path: string): void => {
        if (path.startsWith(`${MARKERS}/`)) return arrived(Number(path.slice(MARKERS.length + 1)) || 0)
        if (IGNORED.test(path)) return
        if (changed.size >= MAX_PATHS && !changed.has(path)) return forget()
        changed.set(path, ++seq)
      }
      const since = (mark: number): Effect.Effect<ReadonlySet<string> | null> =>
        Effect.sync(() => {
          if (mark < floor) return null
          const out = new Set<string>()
          for (const [path, at] of changed) if (at > mark) out.add(path)
          return out
        })
      const settle = Effect.promise(async () => {
        if (watcher === null) return
        const n = ++markers
        const file = nodePath.join(root, MARKERS, String(n))
        const seen = new Promise<void>((done) => waiting.set(n, done))
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await fsp.writeFile(file, "")
          const late = new Promise<"late">((done) => (timer = setTimeout(() => done("late"), SETTLE_MS)))
          if ((await Promise.race([seen, late])) === "late") distrust()
        } catch {
          distrust()
        } finally {
          clearTimeout(timer)
          void fsp.rm(file, { force: true }).catch(() => undefined)
        }
      })
      // The machine-local folder, with the ignore file that keeps it out of Git, holds the markers.
      const start = Effect.flatMap(Effect.result(ensureLocal(files)), (local) => Effect.sync(() => {
        if (local._tag === "Failure") return distrust()
        try {
          mkdirSync(nodePath.join(root, MARKERS), { recursive: true })
          const opened = watch(root, { recursive: true, persistent: false }, (_event, name) => {
            // No name: the platform could not say what changed.
            if (name === null) return forget()
            record(String(name).split("\\").join("/"))
          })
          opened.on("error", distrust)
          watcher = opened
          forget()
        } catch {
          distrust()
        }
      }))
      return {
        mark: Effect.sync(() => seq),
        since,
        settle,
        watch: Effect.acquireRelease(start, () => Effect.sync(distrust))
      }
    })
  )
}

/**
 * A test of whether changes concern any of `paths`: the path itself, something inside it, or a
 * folder holding it (a renamed or removed folder). `""` is the whole project. Built once for a
 * set of paths; each test costs a few lookups per changed path.
 */
export const concerns = (paths: Iterable<string>): (changed: ReadonlySet<string>) => boolean => {
  const exact = new Set<string>()
  const holders = new Set<string>()
  let everything = false
  for (const raw of paths) {
    const path = raw.replace(/^\.\//, "").replace(/\/+$/, "")
    if (path === "") everything = true
    exact.add(path)
    for (let i = path.indexOf("/"); i !== -1; i = path.indexOf("/", i + 1)) holders.add(path.slice(0, i))
  }
  return (changed) => {
    if (changed.size === 0) return false
    if (everything) return true
    for (const path of changed) {
      if (exact.has(path) || holders.has(path)) return true
      for (let i = path.lastIndexOf("/"); i > 0; i = path.lastIndexOf("/", i - 1)) if (exact.has(path.slice(0, i))) return true
    }
    return false
  }
}
