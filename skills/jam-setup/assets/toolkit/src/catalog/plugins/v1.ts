// Version 1 adapters keep working: an adapter module becomes a plugin with one source.
import type { AdapterFactory, Plugin, PluginContext } from "../plugin.ts"

/**
 * Wrap `({ root, options }) => ({ name?, sources(), load() })`. The adapter is created once per
 * plugin load, as before, so state it keeps between `load()` and `sources()` still works.
 */
export const adapterPlugin = (ref: string, factory: AdapterFactory, options: Record<string, unknown>) =>
(context: PluginContext): Plugin => {
  const adapter = factory({ root: context.root, options })
  const name = typeof adapter.name === "string" && adapter.name !== "" ? adapter.name : ref
  return {
    name,
    sources: [{
      name,
      inputs: () => adapter.sources?.() ?? [],
      load: () => adapter.load()
    }]
  }
}
