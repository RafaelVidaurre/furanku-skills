// The action registry: the built-in actions plus the ones the current plugins contribute. The CLI,
// HTTP and the browser all look actions up here, so a project action is listed, validated and
// attributed exactly like a built-in one.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { decode } from "../kernel/decode.ts"
import type { ToolError } from "../kernel/errors.ts"
import { type ActionDef, type ActionInfo, infoOf, type WriteEnv } from "./action.ts"
import { builtinActions } from "./builtinActions.ts"
import { CONFIG_FILE } from "./CatalogConfig.ts"
import type { Problem } from "./model/types.ts"
import type { Owned, PluginSet } from "./Plugins.ts"
import type { PluginAction, RunAction } from "./plugin.ts"
import { Written } from "./results.ts"
import { fromPlugin, toPromise } from "./support.ts"

export type { ActionInfo, Requirement } from "./action.ts"

export interface Registry {
  readonly actions: ReadonlyMap<string, ActionDef>
  readonly info: ReadonlyArray<ActionInfo>
  readonly problems: ReadonlyArray<Problem>
}

/**
 * Whether every action result is decoded against its declared output, unknown fields refused; a
 * result that does not match fails `internal`. Off by default; the tests turn it on.
 */
export const CatalogOutputCheck = Context.Reference<boolean>("jam/catalog/OutputCheck", { defaultValue: () => false })

/** Decode an action's result against its declared output (see `CatalogOutputCheck`). */
export const checkOutput = (name: string, output: Schema.Top, result: unknown): Effect.Effect<unknown, ToolError> =>
  Effect.as(decode(output, { what: `result of ${name}`, code: "internal" })(result) as Effect.Effect<unknown, ToolError>, result)

/**
 * Names that no longer run, with what replaced them. Used only to say so when one is called.
 */
export const RENAMED: Readonly<Record<string, string>> = {
  context: "summary",
  "catalog.search": "unit.search, collection.search or asset.search",
  "notes.list": "note.list",
  "reviews.list": "review.list",
  "locks.list": "lock.list",
  unlock: "lock.remove",
  "collections.membership": "collection.membership",
  "organize.set": "organization.set",
  "organize.bulk": "organization.setMany"
}

/** The fix of a `not_found` for an action name. */
export const unknownActionFix = (name: string): string =>
  Object.hasOwn(RENAMED, name) ? `${name} is now ${RENAMED[name]}` : "list the actions with: jam catalog actions"

/**
 * Namespaces of the catalog's own actions and vocabulary. A plugin with one of these names would
 * make a project action look built-in, so its actions are refused.
 */
export const RESERVED_PLUGIN_NAMES: ReadonlyArray<string> = [
  "asset", "catalog", "category", "checkout", "collection", "decision", "doctor", "evidence", "inbox", "lock",
  "note", "organization", "problems", "project", "review", "schema", "summary", "tag", "unit", "viewer"
]

/**
 * A write's output as a caller receives it: a repeated request id returns the first result with
 * `replayed: true`, so each object it may return allows that field. Null when the output is not an
 * object (`Schema.Struct`) or a union of objects, which could not carry it.
 */
const replayable = (output: Schema.Top): Schema.Top | null => {
  if (output.ast._tag === "Objects" && "fields" in output) return Written((output as Schema.Struct<Schema.Struct.Fields>).fields)
  if (output.ast._tag === "Union" && "members" in output && Array.isArray(output.members)) {
    const members = (output.members as ReadonlyArray<Schema.Top>).map(replayable)
    return members.every((member) => member !== null) ? Schema.Union(members as ReadonlyArray<Schema.Top>) : null
  }
  return null
}

/** What a plugin action publishes as its output: what it declares, made replayable for a write. */
const pluginOutput = (action: PluginAction): Schema.Top | undefined =>
  action.output === undefined || action.access !== "write" ? action.output : replayable(action.output) ?? action.output

/** A plugin's action as the registry runs it: same decoding, actor and request-id rules as built-ins. */
const fromPluginAction = ({ context, value: action }: Owned<PluginAction>): ActionDef => ({
  name: action.name,
  access: action.access,
  description: action.description,
  input: action.input,
  output: pluginOutput(action) ?? Schema.Unknown,
  run: (input: never, env: WriteEnv) =>
    fromPlugin(`action ${action.name}`, () => {
      const run = ((name: string, nested?: unknown) => toPromise(env.run(name, nested))) as RunAction
      // A read is handed no actor: it has none to act as.
      return action.access === "write"
        ? action.run(input, { ...context, actor: env.actor, requestId: env.requestId, run })
        : action.run(input, { ...context, run })
    }, "internal")
})

/** Why a plugin's action is refused, or null when it is registered. */
const refusal = (owned: Owned<PluginAction>, taken: ReadonlyMap<string, ActionDef>): Problem | null => {
  const { plugin } = owned
  const { name } = owned.value
  if (RESERVED_PLUGIN_NAMES.includes(plugin)) {
    return { subject: CONFIG_FILE, error: `plugin ${plugin}: action ${name} is refused because "${plugin}" is a name the catalog reserves for its own actions`, recovery: "give the plugin another name" }
  }
  if (taken.has(name)) return { subject: CONFIG_FILE, error: `plugin ${plugin}: action ${name} has the name of a built-in action`, recovery: `rename it, for example ${plugin}.${name}` }
  if (!Schema.isSchema(owned.value.input)) return { subject: CONFIG_FILE, error: `plugin ${plugin}: action ${name} has no input schema`, recovery: "give it an input Schema.Struct" }
  const { access, output } = owned.value as { readonly access: unknown; readonly output?: unknown }
  if (access !== "read" && access !== "write") return { subject: CONFIG_FILE, error: `plugin ${plugin}: action ${name} has no access`, recovery: 'declare access: "read" or "write"' }
  if (output !== undefined && !Schema.isSchema(output)) return { subject: CONFIG_FILE, error: `plugin ${plugin}: action ${name} has an output that is not a schema`, recovery: "give it an output Schema, or none" }
  if (access === "write" && output !== undefined && replayable(output as Schema.Top) === null) {
    return {
      subject: CONFIG_FILE,
      error: `plugin ${plugin}: action ${name} is a write whose output is not an object or a union of objects`,
      recovery: "declare its output as a Schema.Struct, or a Schema.Union of them: a replayed write adds replayed: true to its result"
    }
  }
  return null
}

export class Actions extends Context.Service<Actions, {
  /** The registry for a plugin set; built once per plugin set. */
  for(plugins: PluginSet): Registry
}>()("jam/catalog/Actions") {
  static readonly layer: Layer.Layer<Actions> = Layer.sync(Actions, () => {
    // Published schemas are built when something lists the actions, not for every command.
    let builtinInfo: ReadonlyArray<ActionInfo> | null = null
    const builtin = (): ReadonlyArray<ActionInfo> => (builtinInfo ??= builtinActions.map((action) => infoOf(action)))
    let last: { readonly signature: string; readonly registry: Registry } | null = null
    return {
      for: (plugins) => {
        if (last?.signature === plugins.signature) return last.registry
        const actions = new Map<string, ActionDef>(builtinActions.map((action) => [action.name, action]))
        const added: Array<Owned<PluginAction>> = []
        const problems: Array<Problem> = []
        for (const owned of plugins.actions) {
          const { name } = owned.value
          const refused = refusal(owned, actions)
          if (refused !== null) {
            problems.push(refused)
            continue
          }
          // A plugin action is named `<plugin>.<operation>`; another name still runs, and is listed as a problem.
          if (!name.startsWith(`${owned.plugin}.`)) {
            problems.push({ subject: CONFIG_FILE, error: `plugin ${owned.plugin}: action ${name} should be named ${owned.plugin}.${name}`, recovery: `rename it to ${owned.plugin}.${name}` })
          }
          actions.set(name, fromPluginAction(owned))
          added.push(owned)
        }
        let info: ReadonlyArray<ActionInfo> | null = null
        const registry: Registry = {
          actions,
          get info() {
            return (info ??= [
              ...builtin(),
              ...added.map(({ plugin, value }) => infoOf(value, { plugin, output: pluginOutput(value) ?? null }))
            ])
          },
          problems
        }
        last = { signature: plugins.signature, registry }
        return registry
      }
    }
  })
}
