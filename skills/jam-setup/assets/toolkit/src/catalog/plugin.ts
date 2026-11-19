// The catalog's plugin contract, as plugin code inside `src/` imports it. Projects import the same
// exports from the toolkit root's `catalog-plugin.ts`, the stable path. Everything a project or
// another part of the toolkit may rely on is exported here, and nothing else under src/catalog is.
// A plugin is a module whose default export is a plain object (see `definePlugin`); each of its
// functions may return a value, a promise or an Effect.
//
//   contract/context.ts  what every plugin function receives and returns
//   contract/sources.ts  sources and the data they supply; enrich; relations
//   contract/media.ts    media kinds and probes
//   contract/actions.ts  project actions and checks
//   contract/review.ts   actors, decisions and resolvers
//   contract/page.ts     scopes
//
// Data a plugin supplies is `*Input`; objects it implements are bare nouns (`Source`, `Check`);
// what it receives is `*Context`. `define<Thing>` helpers return their argument unchanged.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type { Check, PluginAction } from "./contract/actions.ts"
import type { PluginContext, PluginResult } from "./contract/context.ts"
import type { MediaKind, Probe } from "./contract/media.ts"
import type { ScopeInput } from "./contract/page.ts"
import type { Resolver } from "./contract/review.ts"
import type { EnrichPatch, MergedSources, Relation, Source } from "./contract/sources.ts"

// A project plugin cannot resolve the toolkit's packages from its own folder, so the two it needs
// (schemas for action inputs, and Effect for functions that want it) are handed on from here.
export { Effect, Schema }

export * from "./contract/actions.ts"
export * from "./contract/context.ts"
export * from "./contract/media.ts"
export * from "./contract/page.ts"
export * from "./contract/review.ts"
export * from "./contract/sources.ts"

export interface Plugin {
  readonly name: string
  readonly sources?: ReadonlyArray<Source>
  /** Runs after sources merge, in plugin order; each sees the previous plugins' changes. */
  enrich?(merged: MergedSources, context: PluginContext): PluginResult<EnrichPatch | void>
  readonly relations?: ReadonlyArray<Relation>
  readonly mediaKinds?: ReadonlyArray<MediaKind>
  readonly probes?: ReadonlyArray<Probe>
  readonly checks?: ReadonlyArray<Check>
  readonly actions?: ReadonlyArray<PluginAction>
  readonly scopes?: ReadonlyArray<ScopeInput>
  /** Resolvers by the name `review.resolver` selects. */
  readonly resolvers?: Readonly<Record<string, Resolver>>
  /**
   * Browser modules for the page, by name: inspector and panel modules (a type's `inspectors` and
   * `panels` name one with `module`) and collection preview modules (a collection kind's
   * `preview.module`). Each is a `.js`/`.mjs` file: a project-relative path, or a `file:` URL for
   * a module that ships beside the plugin (`new URL("./my-plugin.web.js", import.meta.url).href`). A media
   * kind declares its own module with `web`. Types: `catalog-plugin-web.d.ts`.
   */
  readonly browserModules?: Readonly<Record<string, string>>
}

/** Declares a plugin. It returns its argument; it exists so editors check the shape. */
export const definePlugin = <P extends Plugin>(plugin: P): P => plugin
