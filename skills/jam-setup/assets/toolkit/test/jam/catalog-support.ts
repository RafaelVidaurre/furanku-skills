// Helpers for the tests of the catalog's `jam` plugin and the review bridge: a jam project whose
// catalog lists the plugin, the catalog opened on it as the command line composes it, and jam
// operations run with the catalog as their review desk.
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Option from "effect/Option"
import { after } from "node:test"
import { catalogWithJam, jamWithCatalog } from "../../src/cli/compose.ts"
import type { JamServices } from "../../src/jam/layers.ts"
import { reviewedStatus } from "../../src/jam/runs/review.ts"
import { Runs } from "../../src/jam/runs/Runs.ts"
import type { RunStatus, StepStatus } from "../../src/jam/runs/status.ts"
import { type Kernel, kernelLayer } from "../../src/kernel/cli.ts"
import type { ToolError } from "../../src/kernel/errors.ts"
import { type App, appOf } from "../catalog/helpers.ts"
import { type JamProject, jamProject } from "./fixtures.ts"

export { agent, human } from "../catalog/helpers.ts"

/** The name the review desk submits under in these tests. */
export const WORKER = "worker"

/** A jam project in a Git repository whose catalog lists the `jam` plugin (and whatever else is named). */
export const catalogProject = (options: JamProject & { readonly plugins?: ReadonlyArray<string>; readonly catalog?: Readonly<Record<string, unknown>> } = {}): string =>
  jamProject({
    git: true,
    ...options,
    files: { "catalog.config.json": JSON.stringify({ version: 3, plugins: options.plugins ?? ["jam"], ...options.catalog }), ...options.files }
  })

/** The catalog of a project with the `jam` plugin registered: a fresh engine, as each command or a restarted server has. */
export const openCatalog = (root: string): App => {
  const runtime = ManagedRuntime.make(catalogWithJam.pipe(Layer.provideMerge(kernelLayer(root, true))))
  after(() => runtime.dispose())
  return appOf(root, runtime)
}

// The real kernel, as a command has it: record ids must differ between calls and between the
// ledger and the catalog, which the counting ids of other tests would not.
const bridged = <A, E>(root: string, effect: Effect.Effect<A, E, JamServices | Kernel>) =>
  Effect.scoped(effect).pipe(Effect.provide(Layer.provideMerge(jamWithCatalog(WORKER), kernelLayer(root, true))))

/** Run a jam operation with the catalog as its review desk, as the `jam` command does. */
export const bridge = <A, E>(root: string, effect: Effect.Effect<A, E, JamServices | Kernel>): Promise<A> => Effect.runPromise(bridged(root, effect))

export const bridgeFailure = async <A>(root: string, effect: Effect.Effect<A, ToolError, JamServices | Kernel>): Promise<ToolError> => {
  const exit = await Effect.runPromiseExit(bridged(root, effect))
  if (Exit.isSuccess(exit)) throw new Error(`expected a failure, got ${JSON.stringify(exit.value)}`)
  const error = Option.getOrUndefined(Exit.findErrorOption(exit))
  if (error === undefined) throw new Error(`expected a ToolError, got a defect: ${String(exit.cause)}`)
  return error
}

/** What `jam run status <id>` computes: catalog verdicts applied, review links attached. */
export const bridgedStatus = (root: string, id: string): Promise<RunStatus> =>
  bridge(root, Effect.gen(function*() {
    return (yield* reviewedStatus(yield* (yield* Runs).open(id))).status
  }))

export const bridgedStep = async (root: string, id: string, step: string): Promise<StepStatus> =>
  (await bridgedStatus(root, id)).steps.find((candidate) => candidate.step === step)!
