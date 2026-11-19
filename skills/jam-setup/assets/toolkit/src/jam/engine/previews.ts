// `jam engine previews`: the adapter makes something viewable of each engine file (an image, a
// self-contained model, a sound) into one machine-local folder, keyed by the file's version, and
// indexes it. The toolkit refreshes the inventory first, so the adapter sees every file's current
// version, then validates the index before anyone relies on it. Reading the index never starts the
// engine; making previews may.
import * as Effect from "effect/Effect"
import { decode } from "../../kernel/decode.ts"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { Config } from "../config/Config.ts"
import { Engine, type EngineOutcome } from "./Engine.ts"
import { inventoryFor } from "./inventory.ts"
import { EnginePreviews } from "./schema.ts"

export interface PreviewsRequest {
  /** Project path of the previews folder (default: `<roots.scratch>/.engine/previews`). */
  readonly out?: string | undefined
  /** Make every preview again, not only those of files that changed. */
  readonly full?: boolean
  /** False: make only the previews the files themselves hold; no engine starts. */
  readonly engine?: boolean
  /** Project path patterns (`*` within a folder, `**` any depth): only these files. */
  readonly only?: ReadonlyArray<string>
  /** At most this many previews made through the engine in this run. */
  readonly limit?: number | undefined
  /** Arguments for the adapter's own command, as typed after `--`. */
  readonly extra?: ReadonlyArray<string>
}

export interface PreviewsResult {
  readonly outcome: EngineOutcome
  /** The validated index, when the adapter ran. */
  readonly index?: EnginePreviews
  /** The previews folder. */
  readonly dir: string
}

export const INDEX_FILE = "index.json"

export const defaultPreviewsDir = (scratch: string): string => `${scratch}/.engine/previews`

const decodeIndex = (path: string) =>
  decode(EnginePreviews, { what: `previews index ${path}`, code: "malformed", fix: "see schemas/engine-previews.schema.json in the toolkit, or run jam engine previews --full" })

/** The previews folder and its index as last written; the index is absent until previews were made. */
export const readPreviews = (out?: string): Effect.Effect<{ readonly dir: string; readonly index?: EnginePreviews }, ToolError, ProjectFiles | Config> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const dir = out ?? defaultPreviewsDir((yield* (yield* Config).load).roots.scratch)
    const path = `${dir}/${INDEX_FILE}`
    if (!(yield* files.exists(path))) return { dir }
    return { dir, index: yield* Effect.flatMap(files.readJson(path), decodeIndex(path)) }
  })

export const previewsFor = (request: PreviewsRequest): Effect.Effect<PreviewsResult, ToolError, Engine | ProjectFiles | Config> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const dir = request.out ?? defaultPreviewsDir((yield* (yield* Config).load).roots.scratch)
    yield* files.resolve(dir)
    const engine = yield* Engine
    // Without the command the adapter's guide is what to follow; the inventory is not needed for that.
    if (!(yield* engine.resolved).provides.includes("previews")) return { outcome: yield* engine.run("previews", []), dir }
    const inventory = yield* inventoryFor({})
    if (inventory.outcome.status !== "ran") return { outcome: inventory.outcome, dir }
    const args = [
      "--inventory", inventory.path,
      "--out", dir,
      ...(request.full === true ? ["--full"] : []),
      ...(request.engine === false ? ["--no-engine"] : []),
      ...(request.only ?? []).flatMap((pattern) => ["--only", pattern]),
      ...(request.limit === undefined ? [] : ["--limit", String(request.limit)]),
      ...(request.extra ?? [])
    ]
    const outcome = yield* engine.run("previews", args)
    if (outcome.status !== "ran") return { outcome, dir }
    const path = `${dir}/${INDEX_FILE}`
    if (outcome.receipt["index"] !== path) {
      return yield* fail("malformed", `adapter ${outcome.adapter} previews reported ${JSON.stringify(outcome.receipt["index"])}, not the index it was asked to write (${path})`)
    }
    const { index } = yield* readPreviews(dir)
    if (index === undefined) return yield* fail("malformed", `adapter ${outcome.adapter} previews wrote no index at ${path}`)
    if (index.adapter !== outcome.adapter) {
      return yield* fail("malformed", `${path} was written for adapter ${index.adapter}, not ${outcome.adapter}`, { fix: "run again with --full" })
    }
    return { outcome, index, dir }
  })
