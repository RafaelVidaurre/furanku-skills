// How reviews are read in this project: which verdicts exist, which roles are only reference
// material, and which resolver turns verdict events into one current verdict per part.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { ToolError } from "../kernel/errors.ts"
import { partRole } from "./model/parts.ts"
import { RESOLVERS, type Resolver, VERDICTS } from "./model/verdicts.ts"
import { Plugins, type PluginSet } from "./Plugins.ts"

export interface Policy {
  readonly resolverName: string
  readonly resolver: Resolver
  /** The verdicts reviewers may give, in display order. */
  readonly verdicts: ReadonlyArray<string>
  readonly referenceRoles: ReadonlyArray<string>
  /** False for supporting material: shown with a submission, never counted or decided. */
  reviewable(part: { readonly id: string; readonly role?: string | null | undefined }): boolean
}

export const policyOf = (plugins: PluginSet): Policy => {
  const { referenceRoles, resolver, verdicts } = plugins.config.review
  return {
    resolverName: resolver,
    resolver: plugins.resolvers[resolver] ?? RESOLVERS["latest"]!,
    verdicts: verdicts.filter((verdict) => (VERDICTS as ReadonlyArray<string>).includes(verdict)),
    referenceRoles,
    reviewable: (part) => !referenceRoles.includes(partRole(part))
  }
}

export class ReviewPolicy extends Context.Service<ReviewPolicy, {
  /** The policy of the current checkout; it changes with catalog.config.json and the plugins. */
  readonly current: Effect.Effect<Policy, ToolError>
  for(plugins: PluginSet): Policy
}>()("jam/catalog/ReviewPolicy") {
  static readonly layerNoDeps: Layer.Layer<ReviewPolicy, never, Plugins> = Layer.effect(
    ReviewPolicy,
    Effect.gen(function*() {
      const plugins = yield* Plugins
      let last: { readonly signature: string; readonly policy: Policy } | null = null
      const of = (set: PluginSet): Policy => {
        if (last?.signature !== set.signature) last = { signature: set.signature, policy: policyOf(set) }
        return last.policy
      }
      return { current: Effect.map(plugins.current, of), for: of }
    })
  )
}
