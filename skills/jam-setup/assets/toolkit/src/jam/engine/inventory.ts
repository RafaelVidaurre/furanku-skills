// `jam engine inventory`: the adapter reads the engine's content into one file; the toolkit picks
// where it goes, hands over the previous inventory so only changed files are read, and validates
// what was written before anyone relies on it.
import * as Effect from "effect/Effect"
import { decode } from "../../kernel/decode.ts"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { Config } from "../config/Config.ts"
import { Engine, type EngineOutcome } from "./Engine.ts"
import { EngineInventory } from "./schema.ts"

export interface InventoryRequest {
  /** Project path of the inventory file (default: `<roots.scratch>/.engine/inventory.json`). */
  readonly out?: string | undefined
  /** Read every file again instead of reusing the previous inventory. */
  readonly full?: boolean
  /** Let the adapter start the engine for what files cannot give: unreadable files, effective property values. */
  readonly engine?: boolean
  /** Arguments for the adapter's own command, as typed after `--`. */
  readonly extra?: ReadonlyArray<string>
}

export interface InventoryResult {
  readonly outcome: EngineOutcome
  /** The validated inventory, when the adapter ran. */
  readonly inventory?: EngineInventory
  readonly path: string
}

export const defaultInventoryPath = (scratch: string): string => `${scratch}/.engine/inventory.json`

export const inventoryFor = (request: InventoryRequest): Effect.Effect<InventoryResult, ToolError, Engine | ProjectFiles | Config> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    const path = request.out ?? defaultInventoryPath((yield* (yield* Config).load).roots.scratch)
    yield* files.resolve(path)
    const previous = request.full !== true && (yield* files.exists(path))
    const args = ["--out", path, ...(previous ? ["--previous", path] : []), ...(request.engine === true ? ["--engine"] : []), ...(request.extra ?? [])]
    const outcome = yield* (yield* Engine).run("inventory", args)
    if (outcome.status !== "ran") return { outcome, path }
    if (outcome.receipt["inventory"] !== path) {
      return yield* fail("malformed", `adapter ${outcome.adapter} inventory reported ${JSON.stringify(outcome.receipt["inventory"])}, not the file it was asked to write (${path})`)
    }
    const written = yield* files.readJson(path)
    const inventory = yield* decode(EngineInventory, {
      what: `inventory written by adapter ${outcome.adapter} (${path})`,
      code: "malformed",
      fix: "see schemas/engine-inventory.schema.json in the toolkit"
    })(written)
    if (inventory.adapter !== outcome.adapter) {
      return yield* fail("malformed", `${path} was written for adapter ${inventory.adapter}, not ${outcome.adapter}`, { fix: "run again with --full" })
    }
    return { outcome, inventory, path }
  })
