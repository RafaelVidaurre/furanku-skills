// Browser modules a plugin declares: a media kind's viewer (`mediaKinds[].web`) and collection
// previews (`previews`). They are trusted project code that runs in the catalog page, so the
// server hands out exactly the declared files and nothing beside them. A declaration is a
// project-relative path, or a `file:` URL for a module that ships beside the plugin itself
// (`new URL("./viewer.js", import.meta.url).href`), which is how a plugin outside the project
// brings its own browser code.
import * as Effect from "effect/Effect"
import * as fsp from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { fail, type ToolError } from "../kernel/errors.ts"
import { sha256 } from "../kernel/hash.ts"
import type { ProjectFiles } from "../kernel/ProjectFiles.ts"

export interface BrowserModule {
  /** Absolute path of the declared file. */
  readonly file: string
  readonly bytes: Uint8Array
  readonly sha256: string
}

const SCRIPT = /\.m?js$/
const MAX_BYTES = 4 << 20

const besidePlugin = (reference: string, what: string): Effect.Effect<BrowserModule, ToolError> =>
  Effect.gen(function*() {
    const missing = fail("not_found", `${what} file ${reference} not found`)
    const file = yield* Effect.try({ try: () => fileURLToPath(reference), catch: () => null }).pipe(Effect.catch(() => missing))
    const bytes = yield* Effect.tryPromise({
      try: async () => {
        const stat = await fsp.stat(file)
        if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("not a script file")
        return new Uint8Array(await fsp.readFile(file))
      },
      catch: () => null
    }).pipe(Effect.catch(() => missing))
    return { file, bytes, sha256: sha256(bytes) }
  })

/** Read a declared browser module. Only `.js` and `.mjs` files are modules. */
export const readBrowserModule = (files: ProjectFiles["Service"], reference: string, what: string): Effect.Effect<BrowserModule, ToolError> =>
  Effect.gen(function*() {
    const missing = fail("not_found", `${what} file ${reference} not found`)
    if (!SCRIPT.test(reference)) return yield* missing
    if (reference.startsWith("file:")) return yield* besidePlugin(reference, what)
    const path = reference.replace(/^\.\//, "")
    const bytes = yield* files.readBytes(path).pipe(Effect.catch(() => missing))
    return { file: yield* files.resolve(path), bytes, sha256: sha256(bytes) }
  })

/** The declared modules that exist, by name, with the digest that versions their URL; null when the file is missing. */
export const moduleDigests = (files: ProjectFiles["Service"], declared: Readonly<Record<string, string>>, what: string): Effect.Effect<Map<string, string | null>> =>
  Effect.gen(function*() {
    const out = new Map<string, string | null>()
    for (const [name, reference] of Object.entries(declared)) {
      out.set(name, yield* readBrowserModule(files, reference, what).pipe(Effect.map((module) => module.sha256), Effect.catch(() => Effect.succeed(null))))
    }
    return out
  })
