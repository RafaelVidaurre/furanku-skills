// Jam command group: everything except `catalog`.
import * as Command from "effect/cli/Command"
import * as Effect from "effect/Effect"
import { type CommandGroup, Output } from "../kernel/cli.ts"
import { fail } from "../kernel/errors.ts"
import { Git } from "../kernel/Git.ts"
import { audio } from "./audio/commands.ts"
import { described } from "./cliSupport.ts"
import { config, setup } from "./config/commands.ts"
import { doctor } from "./doctor.ts"
import { engine } from "./engine/commands.ts"
import { jamLayer } from "./layers.ts"
import { commands as fileTools } from "./measure/commands.ts"
import { provider } from "./providers/commands.ts"
import { recipe } from "./recipes/commands.ts"
import { job, run } from "./runs/commands.ts"
import { Toolkit } from "./Toolkit.ts"

const where = Command.make("where", {}, () =>
  Effect.gen(function*() {
    const checkout = yield* (yield* Git).checkout
    yield* (yield* Output).emit(
      checkout,
      `${checkout.root}\n${checkout.git ? `branch ${checkout.branch ?? `detached at ${checkout.head?.slice(0, 12)}`}` : "not a Git checkout"}`
    )
  })).pipe(described("Show which project and checkout commands act on.", "jam where"))

/**
 * Every file the toolkit generates from its own definitions. Loaded by the commands that need it:
 * the published schemas include the catalog's, which no other jam command loads.
 */
const generated: Effect.Effect<ReadonlyArray<{ readonly path: string; readonly text: string }>> = Effect.promise(() =>
  import("./reference.ts").then(({ REFERENCE_PATH, renderReference, renderSchemas }) => [...renderSchemas(), { path: REFERENCE_PATH, text: renderReference(commands()) }])
)

const schemasWrite = Command.make("write", {}, () =>
  Effect.gen(function*() {
    const toolkit = yield* Toolkit
    const files = yield* generated
    for (const file of files) yield* toolkit.writeText(file.path, file.text)
    yield* (yield* Output).emit({ written: files.map((file) => file.path), toolkit: toolkit.dir }, `wrote ${files.length} files in ${toolkit.dir}:\n${files.map((file) => `  ${file.path}`).join("\n")}`)
  })).pipe(described("Regenerate the published JSON Schemas (schemas/) and the command reference (docs/cli.md) from the toolkit's own definitions.", "jam schemas write"))

const schemasCheck = Command.make("check", {}, () =>
  Effect.gen(function*() {
    const toolkit = yield* Toolkit
    const stale: Array<string> = []
    for (const file of yield* generated) {
      const current = yield* toolkit.readText(file.path).pipe(Effect.catch(() => Effect.succeed(null)))
      if (current !== file.text) stale.push(file.path)
    }
    if (stale.length > 0) return yield* fail("conflict", `out of date: ${stale.join(", ")}`, { fix: `run "jam schemas write" and commit the result` })
    yield* (yield* Output).emit({ current: true }, "schemas and the command reference are up to date")
  })).pipe(described("Fail when a published schema or the command reference no longer matches the toolkit's definitions.", "jam schemas check"))

const schemas = Command.make("schemas").pipe(
  Command.withDescription("The published contract: JSON Schemas of every authored file, and the command reference"),
  Command.withSubcommands([schemasWrite, schemasCheck])
)

// A function, because the reference describes the command list that contains the command printing it.
function commands(): CommandGroup["commands"] {
  return [where, setup, config, recipe, run, job, ...fileTools, provider, engine, audio, schemas, doctor]
}

export const group: CommandGroup = {
  commands: commands(),
  layer: jamLayer
}
