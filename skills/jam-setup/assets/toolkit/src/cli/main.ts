// The `jam` command. It loads only the command group the invocation names, so a ledger command
// never pays for the catalog's HTTP stack and the reverse.
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Command from "effect/cli/Command"
import * as Flag from "effect/cli/Flag"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { readFileSync } from "node:fs"
import { edgeArgs, kernelLayerFor, launcherArgv, reportFailure } from "../kernel/cli.ts"
import { withJamPlugin, withReviewDesk } from "./compose.ts"

/**
 * What a command group contributes: its commands, and a layer for the services they need beyond
 * the kernel. The layer may require kernel services and may fail with a ToolError.
 */
export interface CommandGroup {
  // Commands differ in name and input, so the list is necessarily loosely typed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly commands: ReadonlyArray<Command.Command<any, any, any, any, any>>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly layer: Layer.Layer<never, any, any> | Layer.Layer<any, any, any>
}

// The two groups know nothing of each other; compose.ts gives the catalog its `jam` plugin and the
// run commands the catalog as their review desk. A step is submitted there under the agent's name
// (the one catalog commands take from the environment), never as a person.
const agentName = process.env["CATALOG_ACTOR_KIND"] === "human" ? undefined : process.env["CATALOG_ACTOR_NAME"]
const GROUPS: Record<string, () => Promise<CommandGroup>> = {
  catalog: () => import("../catalog/cli.ts").then((module) => withJamPlugin(module.group)),
  jam: () => import("../jam/cli.ts").then((module) => withReviewDesk(module.group, agentName))
}
const CATALOG_COMMANDS = new Set(["catalog"])

const argv = launcherArgv(process.argv.slice(2))
const edge = edgeArgs(argv)
const first = argv.find((arg, index) => !arg.startsWith("-") && argv[index - 1] !== "--root")
const wanted = first === undefined ? ["jam", "catalog"] : CATALOG_COMMANDS.has(first) ? ["catalog"] : ["jam"]
const groups = await Promise.all(wanted.map((name) => GROUPS[name]!()))

const version = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version

const root = Command.make("jam").pipe(
  Command.withSharedFlags({
    root: Flag.String("root").pipe(
      Flag.withDescription("Project folder (default: nearest folder with jam.config.json, else the Git checkout)"),
      Flag.optional
    ),
    json: Flag.Boolean("json").pipe(Flag.withDescription("Print one JSON object instead of text"), Flag.withDefault(false))
  }),
  Command.withDescription("Jam toolkit: recipes, runs, spending, providers, engine adapters and the content catalog")
)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const services = Layer.mergeAll(...groups.map((group) => group.layer) as [Layer.Layer<any, any, any>]).pipe(
  Layer.provideMerge(kernelLayerFor(edge)),
  Layer.provideMerge(NodeServices.layer)
)

const program = root.pipe(
  Command.withSubcommands(groups.flatMap((group) => group.commands) as [CommandGroup["commands"][number]]),
  (command) => Command.runWith(command, { version })(argv),
  Effect.provide(services),
  Effect.tapCause((cause) => Effect.sync(() => reportFailure(cause, edge.json, (line) => void process.stderr.write(`${line}\n`))))
) as Effect.Effect<void, unknown>

NodeRuntime.runMain(program, { disableErrorReporting: true })
