// The action registry: the built-in actions plus the ones the current plugins contribute. The CLI,
// HTTP and the browser all look actions up here, so a project action is listed, validated and
// attributed exactly like a built-in one.
import * as Context from "effect/Context"
import * as JsonSchema from "effect/JsonSchema"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import type { ActionDef, WriteEnv } from "./action.ts"
import { builtinActions } from "./builtinActions.ts"
import { CONFIG_FILE } from "./CatalogConfig.ts"
import type { Problem } from "./model/types.ts"
import type { Owned, PluginSet } from "./Plugins.ts"
import type { PluginAction } from "./plugin.ts"
import { fromPlugin, toPromise } from "./support.ts"

/** What `discover` publishes for one action. */
export interface ActionInfo {
  readonly name: string
  /** `viewer` actions run in a catalog server; the others run wherever the catalog is opened. */
  readonly kind: "read" | "write" | "viewer"
  readonly description: string
  /** JSON Schema (draft 2020-12) of the input object. */
  readonly input: Record<string, unknown>
  /** The plugin that contributes the action; absent for built-in ones. */
  readonly plugin?: string
}

export interface Registry {
  readonly actions: ReadonlyMap<string, ActionDef>
  readonly info: ReadonlyArray<ActionInfo>
  readonly problems: ReadonlyArray<Problem>
}

const inputSchema = (schema: Schema.Top): Record<string, unknown> => {
  const document = Schema.toJsonSchemaDocument(schema, { onExcessProperty: "error" })
  return {
    $schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12,
    ...document.schema,
    ...(Object.keys(document.definitions).length > 0 ? { $defs: document.definitions } : {})
  }
}

/** A plugin's action as the registry runs it: same decoding, actor and request-id rules as built-ins. */
const fromPluginAction = ({ context, value: action }: Owned<PluginAction>): ActionDef => ({
  name: action.name,
  kind: action.kind,
  description: action.description,
  input: action.input,
  run: (input: never, env: WriteEnv) =>
    fromPlugin(`action ${action.name}`, () =>
      action.run(input, {
        ...context,
        actor: action.kind === "write" ? env.actor : null,
        requestId: action.kind === "write" ? env.requestId : null,
        run: (name, nested) => toPromise(env.run(name, nested))
      }), "internal")
})

export class Actions extends Context.Service<Actions, {
  /** The registry for a plugin set; built once per plugin set. */
  for(plugins: PluginSet): Registry
}>()("jam/catalog/Actions") {
  static readonly layer: Layer.Layer<Actions> = Layer.sync(Actions, () => {
    const builtin = builtinActions.map((action) => ({ action, info: { name: action.name, kind: action.kind, description: action.description, input: inputSchema(action.input) } }))
    let last: { readonly signature: string; readonly registry: Registry } | null = null
    return {
      for: (plugins) => {
        if (last?.signature === plugins.signature) return last.registry
        const actions = new Map(builtin.map(({ action }) => [action.name, action]))
        const info: Array<ActionInfo> = builtin.map((entry) => entry.info)
        const problems: Array<Problem> = []
        for (const owned of plugins.actions) {
          const { name } = owned.value
          const refused = actions.has(name) ? "has the name of a built-in action" : !Schema.isSchema(owned.value.input) ? "has no input schema" : null
          if (refused !== null) {
            problems.push({ source: CONFIG_FILE, error: `plugin ${owned.plugin}: action ${name} ${refused}`, recovery: `rename it, for example ${owned.plugin}.${name}` })
            continue
          }
          actions.set(name, fromPluginAction(owned))
          info.push({ name, kind: owned.value.kind, description: owned.value.description, input: inputSchema(owned.value.input), plugin: owned.plugin })
        }
        last = { signature: plugins.signature, registry: { actions, info, problems } }
        return last.registry
      }
    }
  })
}
