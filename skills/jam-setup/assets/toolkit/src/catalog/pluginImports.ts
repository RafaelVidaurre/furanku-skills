// A project plugin is imported again when its code changes. Node caches every module by URL, so
// the modules a plugin imports from the project (its own package, helpers beside it) would keep
// their first version. A resolve hook gives each of them the plugin's version in its URL, which
// makes them load again with it, and records them so their bytes count in the plugin's version.
// Modules of the toolkit itself and of node_modules are left alone: they are shared, not reloaded.
import { registerHooks } from "node:module"
import { fileURLToPath } from "node:url"

const PARAM = "jam-plugin"
const TOOLKIT = new URL("../../", import.meta.url).href
const graphs = new Map<string, Set<string>>()
let installed = false

const install = (): void => {
  if (installed) return
  installed = true
  registerHooks({
    resolve(specifier, context, next) {
      const resolved = next(specifier, context)
      const parent = context.parentURL
      if (parent === undefined || !parent.startsWith("file:")) return resolved
      const version = new URL(parent).searchParams.get(PARAM)
      const url = resolved.url
      if (version === null || !url.startsWith("file:") || url.includes("?") || url.includes("/node_modules/") || url.startsWith(TOOLKIT)) return resolved
      const graph = graphs.get(version) ?? new Set<string>()
      graph.add(fileURLToPath(url))
      graphs.set(version, graph)
      return { ...resolved, url: `${url}?${PARAM}=${version}` }
    }
  })
}

/** The URL to import a plugin module at, for this version of it and of what it imports. */
export const pluginUrl = (fileUrl: string, version: string): string => {
  install()
  return `${fileUrl}?${PARAM}=${version}`
}

/** Absolute paths of the project modules a plugin version imported. */
export const importsOf = (version: string): ReadonlyArray<string> => [...(graphs.get(version) ?? [])]
