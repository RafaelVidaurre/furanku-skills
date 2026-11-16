// The installed toolkit itself: its version and the data it ships (recipes, provider descriptors,
// engine presets, defaults, schemas, scripts). These live beside the source, outside the project,
// so they are read here and not through ProjectFiles.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as fsp from "node:fs/promises"
import * as nodePath from "node:path"
import { fileURLToPath } from "node:url"
import { asToolError, type ToolError, toolError } from "../kernel/errors.ts"

export class Toolkit extends Context.Service<Toolkit, {
  /** Absolute folder of the installed toolkit. */
  readonly dir: string
  readonly version: Effect.Effect<string, ToolError>
  /** Absolute path of a file the toolkit ships. */
  path(relative: string): string
  /** File names directly inside a shipped folder, sorted. A missing folder is empty. */
  list(folder: string): Effect.Effect<ReadonlyArray<string>, ToolError>
  exists(relative: string): Effect.Effect<boolean, ToolError>
  readText(relative: string): Effect.Effect<string, ToolError>
  readJson(relative: string): Effect.Effect<unknown, ToolError>
  /** Used only by the commands that regenerate published files (schemas, the command reference). */
  writeText(relative: string, text: string): Effect.Effect<void, ToolError>
}>()("jam/Toolkit") {
  static readonly layerAt = (dir: string): Layer.Layer<Toolkit> => Layer.sync(Toolkit, () => make(dir))
  /** The toolkit this source file belongs to. */
  static readonly layer: Layer.Layer<Toolkit> = Toolkit.layerAt(fileURLToPath(new URL("../../", import.meta.url)))
}

const missing = (cause: unknown): boolean => (cause as { code?: string } | null)?.code === "ENOENT"

function make(dirInput: string): Toolkit["Service"] {
  const dir = nodePath.resolve(dirInput)
  const path = (relative: string): string => nodePath.join(dir, ...relative.split("/"))
  const io = <A>(what: string, run: () => Promise<A>): Effect.Effect<A, ToolError> =>
    Effect.tryPromise({ try: run, catch: asToolError("unavailable", what) })

  const readText = (relative: string): Effect.Effect<string, ToolError> =>
    Effect.tryPromise({
      try: () => fsp.readFile(path(relative), "utf8"),
      catch: (cause) =>
        missing(cause)
          ? toolError("not_found", `the toolkit does not ship ${relative}`, { fix: "reinstall the toolkit with the jam-setup installer" })
          : asToolError("unavailable", `read toolkit file ${relative}`)(cause)
    })

  const readJson = (relative: string): Effect.Effect<unknown, ToolError> =>
    Effect.flatMap(readText(relative), (text) =>
      Effect.try({
        try: () => JSON.parse(text) as unknown,
        catch: (cause) => toolError("malformed", `toolkit file ${relative} is not valid JSON: ${(cause as Error).message}`)
      }))

  return {
    dir,
    path,
    version: Effect.map(readJson("package.json"), (pkg) => String((pkg as { version?: unknown }).version ?? "unknown")),
    list: (folder) =>
      io(`list toolkit folder ${folder}`, async () => {
        try {
          const entries = await fsp.readdir(path(folder), { withFileTypes: true })
          return entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort()
        } catch (cause) {
          if (missing(cause)) return []
          throw cause
        }
      }),
    exists: (relative) =>
      io(`check toolkit file ${relative}`, async () => {
        try {
          await fsp.access(path(relative))
          return true
        } catch {
          return false
        }
      }),
    readText,
    readJson,
    writeText: (relative, text) =>
      io(`write toolkit file ${relative}`, async () => {
        await fsp.mkdir(nodePath.dirname(path(relative)), { recursive: true })
        await fsp.writeFile(path(relative), text)
      })
  }
}
