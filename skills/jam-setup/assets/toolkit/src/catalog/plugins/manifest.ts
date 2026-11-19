// Hand-registered content: a project describes its types, media and units in JSON files it
// already versions. Options: `file` (default catalog.manifest.json).
import { definePlugin, type PluginContext, type ProblemInput, type SourceOutput, type UnitInput } from "../plugin.ts"
import { retiredInManifest, retiredInUnitFile, retiredMessage, withoutRetired } from "../model/retired.ts"
import { hasConflictMarkers } from "../records/files.ts"
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

/** The manifest version this plugin reads; `jam catalog migrate` moves version 1 to it. */
export const MANIFEST_VERSION = 2

/** The manifest file read when the plugin's options name none. */
export const DEFAULT_MANIFEST = "catalog.manifest.json"

const manifestFile = (context: PluginContext): string =>
  typeof context.options["file"] === "string" ? context.options["file"] : DEFAULT_MANIFEST

const readJson = async (context: PluginContext, path: string): Promise<unknown> => {
  const text = await context.files.readText(path)
  if (hasConflictMarkers(text)) throw new Error("unresolved Git merge conflict")
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
        return { problems: [{ subject: file, error: "manifest not found", recovery: `create ${file} or list other plugins in catalog.config.json` }] }
      }
      let doc: Manifest
      try {
        doc = (await readJson(context, file)) as Manifest
      } catch (cause) {
        throw new Error(`${file}: ${message(cause)}`)
      }
      if (doc.version === 1) {
        return { problems: [{ subject: file, error: `${file} was written by an older toolkit (manifest version 1)`, recovery: "run: jam catalog migrate" }] }
      }
      if (doc.version !== MANIFEST_VERSION) throw new Error(`${file}: unsupported manifest version`)
      const problems: Array<ProblemInput> = []
      // A key from before version 2 is named once here, and left out so nothing else names it again.
      const retired = (subject: string, value: unknown, find: (value: unknown) => ReturnType<typeof retiredInManifest>): void => {
        for (const key of find(value)) problems.push({ subject, error: retiredMessage(key), recovery: "run: jam catalog migrate" })
      }
      retired(file, doc, retiredInManifest)
      const units: Array<UnitInput> = (doc.units ?? []).map((unit) => ({ ...withoutRetired.unit(unit), sources: [file] }))
      for (const folder of unitFolders(doc)) {
        for (const path of await unitFilesIn(context, folder)) {
          try {
            const entry = (await readJson(context, path)) as UnitInput | { units: ReadonlyArray<UnitInput> }
            const list = Array.isArray((entry as { units?: unknown }).units) ? (entry as { units: ReadonlyArray<UnitInput> }).units : [entry as UnitInput]
            retired(path, entry, retiredInUnitFile)
            for (const unit of list) units.push({ ...withoutRetired.unit(unit), sources: [path] })
          } catch (cause) {
            problems.push({ subject: path, error: message(cause), recovery: "fix this file; its units are skipped until it parses" })
          }
        }
      }
      return {
        project: doc.project ?? null,
        types: Object.fromEntries(Object.entries(doc.types ?? {}).map(([key, type]) => [key, withoutRetired.type(type)])),
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
