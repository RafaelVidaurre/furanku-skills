// Hand-registered content: a project describes its types, media and entries in JSON files it
// already versions. Options: `file` (default catalog.manifest.json).
import { definePlugin, type PluginContext, type ProblemInput, type SourceOutput, type UnitInput } from "../plugin.ts"
import { message } from "../support.ts"

interface Manifest {
  readonly version?: unknown
  readonly project?: string
  readonly assetRoots?: ReadonlyArray<string>
  readonly types?: SourceOutput["types"]
  readonly collectionKinds?: SourceOutput["collectionKinds"]
  readonly assets?: SourceOutput["assets"]
  readonly units?: ReadonlyArray<UnitInput>
  readonly unitFiles?: ReadonlyArray<unknown>
  readonly collections?: SourceOutput["collections"]
}

const manifestFile = (context: PluginContext): string =>
  typeof context.options["file"] === "string" ? context.options["file"] : "catalog.manifest.json"

const readJson = async (context: PluginContext, path: string): Promise<unknown> => {
  const text = await context.files.readText(path)
  if (/^(<{7}|>{7})( |$)/m.test(text)) throw new Error("unresolved Git merge conflict")
  return JSON.parse(text) as unknown
}

const unitFolders = (manifest: Manifest): Array<string> =>
  (manifest.unitFiles ?? []).filter((folder): folder is string => typeof folder === "string")

/** The `*.json` files of a unit folder, skipping hidden files and folders. */
const unitFilesIn = async (context: PluginContext, folder: string): Promise<Array<string>> =>
  (await context.files.walk(folder)).filter((path) =>
    path.endsWith(".json") && !path.slice(folder.length + 1).split("/").some((segment) => segment.startsWith("."))
  )

export const manifest = definePlugin({
  name: "manifest",
  sources: [{
    name: "manifest",
    // The unit folders are named by the manifest itself, so the inputs are read from it.
    inputs: async (context) => {
      const file = manifestFile(context)
      try {
        return [file, ...unitFolders((await readJson(context, file)) as Manifest)]
      } catch {
        return [file]
      }
    },
    load: async (context): Promise<SourceOutput> => {
      const file = manifestFile(context)
      if (!(await context.files.exists(file))) {
        return { problems: [{ source: file, error: "manifest not found", recovery: `create ${file} or list other plugins in catalog.config.json` }] }
      }
      let doc: Manifest
      try {
        doc = (await readJson(context, file)) as Manifest
      } catch (cause) {
        throw new Error(`${file}: ${message(cause)}`)
      }
      if (doc.version !== 1) throw new Error(`${file}: unsupported manifest version`)
      const problems: Array<ProblemInput> = []
      const units: Array<UnitInput> = (doc.units ?? []).map((unit) => ({ ...unit, sources: [file] }))
      for (const folder of unitFolders(doc)) {
        for (const path of await unitFilesIn(context, folder)) {
          try {
            const entry = (await readJson(context, path)) as UnitInput | { units: ReadonlyArray<UnitInput> }
            const list = Array.isArray((entry as { units?: unknown }).units) ? (entry as { units: ReadonlyArray<UnitInput> }).units : [entry as UnitInput]
            for (const unit of list) units.push({ ...unit, sources: [path] })
          } catch (cause) {
            problems.push({ source: path, error: message(cause), recovery: "fix this file; its entries are skipped until it parses" })
          }
        }
      }
      return {
        project: doc.project ?? null,
        types: doc.types ?? {},
        collectionKinds: doc.collectionKinds ?? {},
        assetRoots: doc.assetRoots ?? [""],
        assets: doc.assets ?? [],
        units,
        collections: doc.collections ?? [],
        problems
      }
    }
  }]
})
