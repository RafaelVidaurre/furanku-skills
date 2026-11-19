// Where the content catalog and the run ledger meet. Neither imports the other's internals: the
// catalog gets the `jam` and `engine` plugins by name, and the ledger gets a review desk backed by the catalog.
// Each side is loaded and built the first time the other asks for it, so a ledger command does
// not load the catalog, and a catalog that does not list `jam` does not load the ledger.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import type { Catalog, CatalogDiagnostics } from "../catalog/Catalog.ts"
import type { Plugin } from "../catalog/plugin.ts"
import type { RunCatalog } from "../jam/catalog/RunCatalog.ts"
import type { JamCore, JamServices } from "../jam/layers.ts"
import type { ReviewDesk } from "../jam/runs/ReviewDesk.ts"
import type { CommandGroup, Kernel } from "../kernel/cli.ts"
import type { ToolError } from "../kernel/errors.ts"

/** The name the review desk submits under when the caller gives none. */
const AGENT = "jam"

type Ledger = RunCatalog["Service"]

/** The `jam` plugin reading runs through a ledger that is built when first asked for. */
const jamPlugin = (ledger: Effect.Effect<Ledger>): Effect.Effect<Plugin> =>
  Effect.promise(() => import("../jam/catalog/plugin.ts").then((module) => module.jamPlugin((use) => Effect.flatMap(ledger, use))))

/** The plugin's view of the run ledger, built on first use over the given jam services, for as long as `scope` lives. */
const ledgerOver = <R>(jam: Effect.Effect<Layer.Layer<JamCore, never, R>>): Effect.Effect<Effect.Effect<Ledger>, never, R | Kernel | Scope.Scope> =>
  Effect.gen(function*() {
    const services = yield* Effect.context<R | Kernel>()
    const scope = yield* Effect.scope
    return yield* Effect.cached(Effect.gen(function*() {
      const { RunCatalog } = yield* Effect.promise(() => import("../jam/catalog/RunCatalog.ts"))
      const built = yield* Layer.buildWithScope(RunCatalog.layerNoDeps.pipe(Layer.provide(yield* jam)), scope)
      return Context.get(built, RunCatalog)
    }).pipe(Effect.provideContext(services)))
  })

/** The `engine` plugin, running the engine adapter's inventory and previews over jam services built on first use. */
const enginePlugin = <R>(jam: Effect.Effect<Layer.Layer<JamCore, never, R>>, scope: Scope.Scope): Effect.Effect<Plugin, never, R | Kernel> =>
  Effect.gen(function*() {
    const services = yield* Effect.context<R | Kernel>()
    const core = yield* Effect.cached(Effect.gen(function*() {
      return yield* Layer.buildWithScope(yield* jam, scope)
    }).pipe(Effect.provideContext(services)))
    const { enginePlugin: make } = yield* Effect.promise(() => import("../jam/catalog/engine.ts"))
    // The engine host is loaded the first time the catalog asks for the inventory, the previews or an import.
    const host = yield* Effect.cached(Effect.promise(() => Promise.all([import("../jam/engine/inventory.ts"), import("../jam/engine/host.ts"), import("../jam/engine/previews.ts")])))
    const within = <A>(use: (modules: Effect.Success<typeof host>) => Effect.Effect<A, ToolError, JamCore | Kernel>) =>
      Effect.flatMap(Effect.zip(core, host), ([built, modules]) => use(modules).pipe(Effect.provideContext(Context.merge(services, built))))
    return make({
      inventory: (request) => within(([{ inventoryFor }]) => inventoryFor(request)),
      importFiles: (request) =>
        within(([, { importFor }]) =>
          Effect.map(importFor({ kind: request.kind, files: request.files, destination: request.destination }), ({ outcome }) =>
            outcome.status === "ran"
              ? { status: "ran", assets: (Array.isArray(outcome.receipt["assets"]) ? outcome.receipt["assets"] : []) as ReadonlyArray<{ id: string; kind: string; source?: string }> }
              : { status: outcome.status, assets: [], next: outcome.status === "manual" ? outcome.next : `${outcome.reason}; then: ${outcome.resume}` })),
      previews: {
        read: within(([, , { readPreviews }]) => readPreviews()),
        make: (request) => within(([, , { previewsFor }]) => previewsFor(request))
      }
    })
  })

/** The toolkit's own catalog plugins, by the names catalog.config.json lists them under. */
const builtins = <R>(ledger: Effect.Effect<Ledger>, jam: Effect.Effect<Layer.Layer<JamCore, never, R>>, scope: Scope.Scope): Effect.Effect<Record<string, Plugin>, never, R | Kernel> =>
  Effect.all({ jam: jamPlugin(ledger), engine: enginePlugin(jam, scope) })

const jamCore: Effect.Effect<Layer.Layer<JamCore, never, Kernel>> = Effect.promise(() => import("../jam/layers.ts").then((module) => module.jamCoreLayer))

/**
 * The catalog command group with the `jam` plugin registered by name. The group keeps its own
 * layer; what is added is the catalog's setup (`Catalog.layerWith` provides the same reference).
 */
export const withJamPlugin = (group: CommandGroup): CommandGroup => ({
  commands: group.commands,
  layer: Layer.provide(group.layer, Layer.unwrap(Effect.gen(function*() {
    const plugins = yield* builtins(yield* ledgerOver(jamCore), jamCore, yield* Effect.scope)
    const { CatalogSetup } = yield* Effect.promise(() => import("../catalog/CatalogConfig.ts"))
    // A jam project without its own catalog configuration lists its runs as well as the manifest.
    return Layer.succeed(CatalogSetup, { plugins, defaults: yield* jamDefaults, overrides: {} })
  })))
})

/** The default plugins: with `jam` when the project is set up for jam. */
const jamDefaults: Effect.Effect<ReadonlyArray<string> | undefined, never, Kernel> = Effect.gen(function*() {
  const { ProjectFiles } = yield* Effect.promise(() => import("../kernel/ProjectFiles.ts"))
  const files = yield* ProjectFiles
  const jam = yield* files.exists("jam.config.json").pipe(Effect.catch(() => Effect.succeed(false)))
  return jam ? ["manifest", "jam"] : undefined
})

/** The catalog with the `jam` plugin, for code that is not the command line. */
export const catalogWithJam: Layer.Layer<Catalog | CatalogDiagnostics, never, Kernel> = Layer.unwrap(Effect.gen(function*() {
  const plugins = yield* builtins(yield* ledgerOver(jamCore), jamCore, yield* Effect.scope)
  const { Catalog } = yield* Effect.promise(() => import("../catalog/Catalog.ts"))
  const defaults = yield* jamDefaults
  return Catalog.layerWith({ plugins, ...(defaults === undefined ? {} : { defaults }) })
}))

/**
 * The review desk of the jam services: the catalog, with the `jam` plugin reading through these
 * same services. It is built when a command first submits a step or has a pending review to ask
 * about; every other command pays nothing for it.
 */
const desk = (agent: string, Desk: typeof ReviewDesk): Layer.Layer<ReviewDesk, never, JamCore | Kernel> =>
  Layer.effect(Desk, Effect.gen(function*() {
    const services = yield* Effect.context<JamCore | Kernel>()
    const scope = yield* Effect.scope
    const ledger = yield* ledgerOver(Effect.succeed(Layer.succeedContext(services)))
    const real = yield* Effect.cached(Effect.gen(function*() {
      const [{ Catalog }, { catalogDesk }] = yield* Effect.promise(() => Promise.all([import("../catalog/Catalog.ts"), import("../jam/catalog/desk.ts")]))
      const defaults = yield* jamDefaults
      const catalog = Catalog.layerWith({ plugins: yield* builtins(ledger, Effect.succeed(Layer.succeedContext(services)), scope), ...(defaults === undefined ? {} : { defaults }) })
      return Context.get(yield* Layer.buildWithScope(catalogDesk(agent).pipe(Layer.provide(catalog)), scope), Desk)
    }).pipe(Effect.provideContext(services)))
    return {
      submit: (run, step, record) => Effect.flatMap(real, (built) => built.submit(run, step, record)),
      verdict: (submission) => Effect.flatMap(real, (built) => built.verdict(submission))
    }
  }))

/** The jam services with the catalog as the place people review work. */
export const jamWithCatalog = (agent: string = AGENT): Layer.Layer<JamServices, never, Kernel> =>
  Layer.unwrap(Effect.promise(async () => {
    const [{ makeJamLayer }, { ReviewDesk }] = await Promise.all([import("../jam/layers.ts"), import("../jam/runs/ReviewDesk.ts")])
    return makeJamLayer({ desk: desk(agent, ReviewDesk) })
  }))

/** The jam command group with the catalog-backed review desk. */
export const withReviewDesk = (group: CommandGroup, agent: string | undefined): CommandGroup => ({ commands: group.commands, layer: jamWithCatalog(agent) })
