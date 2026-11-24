// The catalog's `engine` plugin: the game engine's own content becomes catalog content. Listed by
// name in catalog.config.json (`{ "plugin": "engine", "options": { … } }`).
//
//   sources    one unit per engine file the adapter's inventory could read, typed by its main
//              asset's class, with the engine's metadata as attributes
//   enrich     links each unit to the source file the engine imported it from, when the catalog
//              can show that file
//   relations  uses / used by, from the references between engine files
//   actions    engine.refresh: read the engine's content again (all of it, or through the engine)
//              engine.previews: make the engine's previews of what changed (it may start the engine)
//
// The plugin never reads engine files itself: `jam engine inventory` does, through the project's
// engine adapter, and only for files whose size or modification time changed. Previews made by
// `jam engine previews` are linked from their index; loading never makes them. The composition
// (src/cli/compose.ts) hands this module a way to run both.
import {
  defineAction,
  definePlugin,
  defineSource,
  Effect,
  type EnrichPatch,
  type FieldInput,
  type LinkInput,
  type MergedSources,
  type Plugin,
  type PluginContext,
  type ProblemInput,
  Schema,
  type SheetInput,
  type SourceOutput,
  type ToolError,
  toolError,
  type TypeInput,
  type UnitInput
} from "../../catalog/plugin.ts"
import { ownsProjectDependencies } from "../../catalog/sourceInventory.ts"
import { createHash } from "node:crypto"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { InventoryResult } from "../engine/inventory.ts"
import type { PreviewsRequest, PreviewsResult } from "../engine/previews.ts"
import type { EngineInventory, EnginePreviews, InventoryAsset, InventoryFile } from "../engine/schema.ts"

/** Runs `jam engine inventory` for the catalog. The effect it returns needs no services, as plugin functions must. */
export type InventoryAccess = (request: { readonly full?: boolean; readonly engine?: boolean }) => Effect.Effect<InventoryResult, ToolError>

/** Reads the previews index (never starts the engine), and runs `jam engine previews`. */
export interface PreviewsAccess {
  readonly read: Effect.Effect<Previews, ToolError>
  readonly make: (request: PreviewsRequest) => Effect.Effect<PreviewsResult, ToolError>
}

/** The previews folder and its index, absent until previews were made. */
export interface Previews {
  readonly dir: string
  readonly index?: EnginePreviews
}

/** Runs `jam engine import` for the catalog: the adapter's outcome, with the engine ids it printed when it ran. */
export type ImportAccess = (request: { readonly kind: string; readonly files: ReadonlyArray<string>; readonly destination?: string | undefined }) =>
  Effect.Effect<{ readonly status: string; readonly assets: ReadonlyArray<{ readonly id: string; readonly kind: string; readonly source?: string }>; readonly next?: string }, ToolError>

export interface EngineAccess {
  readonly inventory: InventoryAccess
  readonly importFiles: ImportAccess
  readonly previews?: PreviewsAccess
}

/** Unit attributes the plugin writes; relations and enrich read them back. */
export const USES = "uses"
const SOURCE_FILES = "sourceFiles"
const PREVIEW = "preview"
const ANIMATION = "animation"
const UNIT_PREFIX = "engine:"
// Engine assets are source material for the content a project is about (its items, characters,
// levels): they go where other source material goes. Where content comes from is shown on the unit
// (its file, its class, what it was made from), never as a section of its own.
const DEFAULT_SCOPE = "material"

const ROLE_OF: ReadonlyArray<readonly [RegExp, string]> = [
  [/\.(glb)$/i, "model"],
  [/\.(png|jpe?g|webp|gif)$/i, "image"],
  [/\.(wav|ogg|flac|mp3)$/i, "audio"],
  [/\.(mp4|webm)$/i, "video"]
]

interface Options {
  readonly types: Readonly<Record<string, { readonly type?: string; readonly label?: string }>>
  readonly exclude: ReadonlyArray<RegExp>
  readonly filters: ReadonlySet<string>
  /** Find a source file whose recorded path does not resolve by its MD5 among the catalog's media. */
  readonly currentPreviewsOnly: boolean
  readonly matchByMd5: boolean
  /** The project's own action for putting content into the engine, when it builds that content itself. */
  readonly importWith: string | null
  readonly scope: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const strings = (value: unknown): ReadonlyArray<string> => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [])

/** `**` any depth, `*` within one folder; matched against the whole project path. */
const glob = (pattern: string): RegExp =>
  new RegExp(`^${pattern.split("**").map((part) => part.split("*").map((text) => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*")}$`)

const optionsOf = (raw: Readonly<Record<string, unknown>>): Options => ({
  types: isRecord(raw["types"]) ? Object.fromEntries(Object.entries(raw["types"]).filter(([, value]) => isRecord(value))) as Options["types"] : {},
  exclude: strings(raw["exclude"]).map(glob),
  filters: new Set(strings(raw["filter"])),
  currentPreviewsOnly: raw["currentPreviewsOnly"] === true,
  matchByMd5: raw["matchSourcesByMd5"] === true,
  importWith: typeof raw["importWith"] === "string" && raw["importWith"] !== "" ? raw["importWith"] : null,
  scope: typeof raw["scope"] === "string" && raw["scope"] !== "" ? raw["scope"] : DEFAULT_SCOPE
})

/** `/Script/Engine.StaticMesh` -> `StaticMesh`; a Blueprint class `/Game/X/BP_Door.BP_Door_C` -> `BP_Door_C`. */
const className = (path: string): string => path.slice(path.lastIndexOf(".") + 1) || path
/** `StaticMesh` -> `Static Mesh`, `LODGroup` -> `LOD Group`, `UVChannels` -> `UV Channels`, `Texture2D` stays. */
const words = (name: string): string => name.replace(/_C$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/_/g, " ").trim()
const typeKeyOf = (cls: string): string => `engine-${words(className(cls)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`.slice(0, 64)

/**
 * A unit's name: the main asset's object name when the engine names it inside its file
 * (`/Game/Props/SM_Crate.SM_Crate`), else the file's own name (`res://sprites/hero.tres`).
 */
export const nameOf = (id: string, main: string): string =>
  main === id ? id.slice(id.lastIndexOf("/") + 1) : main.slice(main.lastIndexOf(".") + 1)

export const unitIdOf = (engineId: string): string => `${UNIT_PREFIX}${engineId}`

/** The files an asset was imported from, as the engine recorded them (relative to the asset's folder), made project-relative when they resolve inside it. */
const importedFrom = (file: string, tags: Readonly<Record<string, string>> | undefined): ReadonlyArray<{ path?: string; stored: string; md5?: string }> => {
  const raw = tags?.["AssetImportData"]
  if (raw === undefined) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const folder = file.split("/").slice(0, -1)
  return parsed.filter(isRecord).flatMap((entry) => {
    const stored = typeof entry["RelativeFilename"] === "string" ? entry["RelativeFilename"].replace(/\\/g, "/") : ""
    if (stored === "") return []
    const md5 = typeof entry["FileMD5"] === "string" && entry["FileMD5"] !== "" ? entry["FileMD5"] : undefined
    const parts = [...folder]
    let inside = !/^([A-Za-z]:|\/)/.test(stored)
    for (const part of stored.split("/")) {
      if (!inside) break
      if (part === "..") inside = parts.pop() !== undefined
      else if (part !== "." && part !== "") parts.push(part)
    }
    return [{ stored, ...(inside && parts.length > 0 ? { path: parts.join("/") } : {}), ...(md5 === undefined ? {} : { md5 }) }]
  })
}

/**
 * The engine file an object id names: the id itself when it is a file's id (`res://props/crate.tres`),
 * else the id without its object name (`/Game/Props/SM_Crate.SM_Crate` -> `/Game/Props/SM_Crate`). Null when neither is known.
 */
export const fileIdOf = (id: string, known: (fileId: string) => boolean): string | null => {
  if (known(id)) return id
  const dot = id.lastIndexOf(".")
  return dot > id.lastIndexOf("/") && known(id.slice(0, dot)) ? id.slice(0, dot) : null
}

/** A property value as a unit attribute: references to engine files become their unit ids, other structure stays JSON. */
const attributeOf = (value: unknown, unitOf: ReadonlyMap<string, string>): { value: unknown; refs: boolean } => {
  const reference = (item: unknown): string | undefined => {
    if (!isRecord(item)) return undefined
    const id = typeof item["object"] === "string" ? item["object"] : typeof item["soft"] === "string" ? item["soft"] : undefined
    if (id === undefined) return undefined
    const file = fileIdOf(id, (candidate) => unitOf.has(candidate))
    return file === null ? id : unitOf.get(file)!
  }
  const list = Array.isArray(value) ? value : [value]
  const ids = list.map(reference)
  if (list.length > 0 && ids.every((id) => id !== undefined)) return { value: Array.isArray(value) ? ids : ids[0], refs: true }
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return { value, refs: false }
  return { value: JSON.stringify(value), refs: false }
}

const COMPONENTS = "components"
const COMPONENT_DETAILS = "componentValues"

/** An asset's components as attributes: the component classes, for filters and archetype rules, and the details. */
const componentsOf = (asset: InventoryAsset): Record<string, unknown> | undefined => {
  if (asset.components === undefined || asset.components.length === 0) return undefined
  return {
    [COMPONENTS]: [...new Set(asset.components.map((component) => className(component.class)))].sort(),
    [COMPONENT_DETAILS]: JSON.stringify(asset.components.map((component) => ({
      name: component.name,
      class: component.class,
      ...(component.inherited === true ? { inherited: true } : {}),
      ...(component.fields === undefined ? {} : { fields: component.fields })
    })))
  }
}

const BASE_FIELDS: ReadonlyArray<FieldInput> = [
  { key: "class", label: "Engine class", filter: true },
  { key: "engineId", label: "Engine id", kind: "code" },
  { key: "file", label: "File", kind: "code", summary: false },
  { key: "saved", label: "Saved by", summary: false, derived: true },
  { key: "modules", label: "Code modules", summary: false, derived: true },
  { key: "external", label: "Uses outside the project", summary: false, derived: true },
  { key: "names", label: "Searchable names", summary: false, derived: true },
  { key: PREVIEW, label: "Preview", summary: false, derived: true },
  { key: SOURCE_FILES, label: "Imported from (as the engine recorded it)", summary: false, derived: true, help: "Each file the engine imported this asset from: the path it stored, the project path when that file is in this checkout, and its MD5" }
]

/** The version a preview is made for (the index's `version`): the engine's content hash, else the size and modification time the inventory read. */
const fileVersion = (file: InventoryFile): string => file.hash ?? `${file.size}:${file.mtimeMs}`

/** The index only says a sheet is an object; the catalog checks its fields when it loads the link and reports a bad one. */
const sheetOf = (sheet: Readonly<Record<string, unknown>>): SheetInput => sheet as unknown as SheetInput

/**
 * The unit's preview links and what to say about them: how they were made, that they are out of
 * date, or why there are none. An animation resource's named animations each get a link of their
 * own, which the catalog plays from its sheet.
 */
const previewOf = (path: string, file: InventoryFile, previews: Previews | undefined, files: EngineInventory["files"], currentOnly: boolean): { links: ReadonlyArray<LinkInput>; note?: string } => {
  const entry = previews?.index?.files[path]
  if (previews === undefined || entry === undefined) return { links: [] }
  // Current when the file and every file it was made from are at the versions it was made for.
  const current = entry.version === fileVersion(file) &&
    Object.entries(entry.inputs ?? {}).every(([input, version]) => files[input] !== undefined && fileVersion(files[input]!) === version)
  if (!current && currentOnly) return { links: [], note: "preview is out of date (run jam engine previews)" }
  const animations = (entry.animations ?? []).map((animation): LinkInput => ({
    role: ANIMATION,
    asset: `${previews.dir}/${animation.file}`,
    key: animation.name,
    sheet: sheetOf(animation.sheet),
    ...(animation.source === undefined ? {} : { meta: { source: animation.source } })
  }))
  if (entry.file === undefined && animations.length === 0) return current && entry.failed !== undefined ? { links: [], note: `none: ${entry.failed}` } : { links: [] }
  const how = entry.how ?? "made by the engine adapter"
  return {
    links: [
      ...(entry.file === undefined ? [] : [{ role: PREVIEW, asset: `${previews.dir}/${entry.file}`, ...(entry.sheet === undefined ? {} : { sheet: sheetOf(entry.sheet) }) }]),
      ...animations
    ],
    note: current ? how : `${how}, for an earlier version of the file (run jam engine previews)`
  }
}

/** What the catalog shows of one inventory. Pure, so it is tested without an engine. */
export const contentOf = (inventory: EngineInventory, options: Options, previews?: Previews): SourceOutput => {
  const entries = Object.entries(inventory.files).filter(([path]) => !options.exclude.some((pattern) => pattern.test(path)))
  const unitOf = new Map(entries.filter(([, file]) => file.unread === undefined && file.main !== undefined).map(([, file]) => [file.id, unitIdOf(file.id)]))
  const types: Record<string, TypeInput> = {}
  const tagKeys = new Map<string, Set<string>>()
  const propertyKeys = new Map<string, Map<string, boolean>>()
  const composed = new Set<string>()
  const units: Array<UnitInput> = []
  const problems: Array<ProblemInput> = []
  for (const [path, file] of entries) {
    if (file.unread !== undefined) {
      problems.push({ subject: path, error: `the engine adapter could not read ${file.id}: ${file.unread}`, recovery: "jam engine docs inventory says how this adapter reads such files; an adapter that can start the engine reads more with the catalog action engine.refresh and engine: true" })
      continue
    }
    const main = (file.assets ?? []).find((asset) => asset.id === file.main)
    if (main === undefined) continue
    const configured = options.types[main.class]
    const type = configured?.type ?? typeKeyOf(main.class)
    if (types[type] === undefined) {
      types[type] = {
        label: configured?.label ?? words(className(main.class)),
        scope: options.scope,
        roles: [
          { key: PREVIEW, label: "Engine preview", mediaKinds: ["image", "model", "audio", "video"], help: "What the engine shows of this asset, made by jam engine previews" },
          { key: "source", label: "Imported from", mediaKinds: ["model", "image", "audio", "video"], many: true, help: "The file the engine imported this asset from" },
          { key: ANIMATION, label: "Animation", mediaKinds: ["image"], many: true, help: "An animation the asset holds, played from its frames" }
        ],
        thumb: PREVIEW,
        reviewAttributes: false
      }
      tagKeys.set(type, new Set())
      propertyKeys.set(type, new Map())
    }
    const properties: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(main.fields ?? {})) {
      const { value, refs } = attributeOf(raw, unitOf)
      properties[key] = value
      const known = propertyKeys.get(type)!
      known.set(key, (known.get(key) ?? true) && refs && (Array.isArray(value) || typeof value === "string"))
    }
    const components = componentsOf(main)
    if (components !== undefined) composed.add(type)
    const tags = main.tags ?? {}
    for (const key of Object.keys(tags)) tagKeys.get(type)?.add(key)
    const references = file.references ?? []
    const uses = [...new Set(references.filter((ref) => ref.kind !== "native" && unitOf.has(ref.to)).map((ref) => unitOf.get(ref.to)!))]
    const sources = (file.assets ?? []).flatMap((asset) => importedFrom(path, asset.tags))
    const preview = previewOf(path, file, previews, inventory.files, options.currentPreviewsOnly)
    units.push({
      id: unitIdOf(file.id),
      type,
      name: nameOf(file.id, file.main!),
      attrs: {
        ...Object.fromEntries(Object.entries(tags).filter(([key]) => key !== "AssetImportData")),
        ...properties,
        ...(main.fieldsError === undefined ? {} : { fieldsError: main.fieldsError }),
        ...(main.fieldsSource === undefined ? {} : { fieldsSource: main.fieldsSource }),
        ...(main.fieldsEngineError === undefined ? {} : { fieldsEngineError: main.fieldsEngineError }),
        ...(components === undefined ? {} : components),
        class: main.class,
        engineId: file.id,
        file: path,
        ...(file.saved === undefined ? {} : { saved: file.saved }),
        [USES]: uses,
        modules: references.filter((ref) => ref.kind === "native").map((ref) => ref.to),
        external: references.filter((ref) => ref.kind !== "native" && !unitOf.has(ref.to)).map((ref) => ref.to),
        ...(file.names === undefined ? {} : { names: file.names.flatMap((group) => group.values) }),
        ...(sources.length === 0 ? {} : { [SOURCE_FILES]: sources }),
        ...(preview.note === undefined ? {} : { [PREVIEW]: preview.note })
      },
      ...(preview.links.length === 0 ? {} : { links: preview.links }),
      search: [file.id, main.class],
      sources: [path]
    })
  }
  for (const [type, keys] of tagKeys) {
    const properties = propertyKeys.get(type) ?? new Map<string, boolean>()
    const own = [...keys].filter((key) => key !== "AssetImportData" && !properties.has(key)).sort()
    types[type] = {
      ...types[type],
      fields: [
        ...BASE_FIELDS,
        { key: USES, label: "Uses", kind: "refs", summary: false },
        ...[...properties].sort(([a], [b]) => a.localeCompare(b)).map(([key, refs]): FieldInput => ({ key, label: words(key), group: "Properties", ...(refs ? { kind: "refs" } : {}), ...(options.filters.has(key) ? { filter: true } : {}) })),
        ...(composed.has(type)
          ? [
            { key: COMPONENTS, label: "Components", group: "Properties", filter: true, help: "The classes of the components the asset holds, inherited ones included" },
            { key: COMPONENT_DETAILS, label: "Component values", group: "Properties", summary: false, help: "Each component's name, class and the property values its file or the engine gives" }
          ] satisfies ReadonlyArray<FieldInput>
          : []),
        ...(properties.size > 0
          ? [
            { key: "fieldsSource", label: "Property values from", summary: false, derived: true, help: "file: what the file itself sets. engine: effective values, inherited and native defaults included" },
            { key: "fieldsError", label: "Properties could not be read", summary: false },
            { key: "fieldsEngineError", label: "The engine could not give effective values", summary: false }
          ] satisfies ReadonlyArray<FieldInput>
          : []),
        ...own.map((key): FieldInput => ({ key, label: words(key), group: "Engine metadata", derived: true, summary: false, ...(options.filters.has(key) ? { filter: true } : {}) }))
      ]
    }
  }
  return { types, units, problems, ...(previews?.index === undefined ? {} : { assetRoots: [previews.dir] }) }
}

const shownSource = (path: string | undefined): path is string => path !== undefined && ROLE_OF.some(([pattern]) => pattern.test(path))

/** Links each engine unit to the files it was imported from that the catalog can show. */
/**
 * MD5 of every media file under the asset roots, cached by size and modification time in
 * `.catalog/.local/engine/md5.json`, so each file version is hashed once on a machine.
 */
const md5Index = async (context: PluginContext, roots: ReadonlyArray<string>): Promise<ReadonlyMap<string, string>> => {
  const cacheFile = join(context.root, ".catalog", ".local", "engine", "md5.json")
  let cache: Record<string, string> = {}
  try {
    cache = JSON.parse(await readFile(cacheFile, "utf8")) as Record<string, string>
  } catch {
    cache = {}
  }
  const next: Record<string, string> = {}
  const byMd5 = new Map<string, string>()
  for (const root of roots.length === 0 ? [""] : roots) {
    for (const path of await context.files.walk(root)) {
      if (!ROLE_OF.some(([pattern]) => pattern.test(path))) continue
      const full = join(context.root, path)
      const info = await stat(full).catch(() => null)
      if (info === null) continue
      const key = `${path}:${info.size}:${info.mtimeMs}`
      const md5 = cache[key] ?? createHash("md5").update(await readFile(full)).digest("hex")
      next[key] = md5
      if (!byMd5.has(md5)) byMd5.set(md5, path)
    }
  }
  await mkdir(dirname(cacheFile), { recursive: true }).then(() => writeFile(cacheFile, JSON.stringify(next))).catch(() => undefined)
  return byMd5
}

const linkSources = async (merged: MergedSources, context: PluginContext): Promise<EnrichPatch | void> => {
  const roots = merged.assetRoots.map((root) => root.replace(/\/+$/, ""))
  const shown = (path: string): boolean => roots.length === 0 || roots.some((root) => root === "" || root === "." || path === root || path.startsWith(`${root}/`))
  const engineUnits = merged.units.filter((unit) => unit.id.startsWith(UNIT_PREFIX))
  const sourcesOf = (unit: UnitInput) => (Array.isArray(unit.attrs?.[SOURCE_FILES]) ? unit.attrs[SOURCE_FILES] as ReadonlyArray<{ path?: string; md5?: string }> : [])
  const unresolved = engineUnits.some((unit) => sourcesOf(unit).some((source) => source.path === undefined && source.md5 !== undefined))
  const byMd5 = optionsOf(context.options).matchByMd5 && unresolved ? await md5Index(context, roots) : new Map<string, string>()
  const units: Record<string, Partial<UnitInput>> = {}
  for (const unit of engineUnits) {
    const links: Array<LinkInput> = []
    for (const source of sourcesOf(unit)) {
      const path = source.path ?? (source.md5 === undefined ? undefined : byMd5.get(source.md5))
      if (path === undefined || !shown(path) || !ROLE_OF.some(([pattern]) => pattern.test(path))) continue
      if (!links.some((link) => link.asset === path)) links.push({ role: "source", asset: path })
    }
    if (links.length > 0) units[unit.id] = { links: [...(unit.links ?? []), ...links] }
  }
  return Object.keys(units).length > 0 ? { units } : undefined
}

const inventoryFile = (inventory: InventoryResult): EngineInventory | undefined => inventory.inventory

const isUnder = (root: string, path: string): boolean => path === root || path.startsWith(`${root}/`)

/**
 * Keeps a source file's project path only when the file is there: engines often import from
 * temporary folders. The folders of those files are media folders, as the previews folder is.
 */
const existingSources = async (output: SourceOutput, context: PluginContext): Promise<SourceOutput> => {
  const exists = new Map<string, Promise<boolean>>()
  const check = (path: string): Promise<boolean> => {
    if (!exists.has(path)) exists.set(path, context.files.exists(path).catch(() => false))
    return exists.get(path)!
  }
  const units = await Promise.all((output.units ?? []).map(async (unit) => {
    const sources = unit.attrs?.[SOURCE_FILES]
    if (!Array.isArray(sources)) return unit
    const kept = await Promise.all((sources as ReadonlyArray<{ path?: string; stored: string; md5?: string }>).map(async ({ path, ...rest }) =>
      path !== undefined && await check(path) ? { ...rest, path } : rest))
    return { ...unit, attrs: { ...unit.attrs, [SOURCE_FILES]: kept } }
  }))
  const folders = units.flatMap((unit) => (Array.isArray(unit.attrs?.[SOURCE_FILES]) ? unit.attrs[SOURCE_FILES] as ReadonlyArray<{ path?: string }> : []))
    .map((source) => source.path).filter(shownSource).map((path) => path.split("/").slice(0, -1).join("/")).filter((folder) => folder !== "")
  const named = [...new Set([...(output.assetRoots ?? []), ...folders])]
  const roots = named.filter((root) => !named.some((other) => other !== root && isUnder(other, root)))
  return { ...output, units, ...(roots.length === 0 ? {} : { assetRoots: roots }) }
}

const sourceOutput = (result: InventoryResult, context: PluginContext, previews: Previews | undefined): SourceOutput => {
  if (result.outcome.status !== "ran") {
    return {
      problems: [{
        subject: "engine",
        error: `the engine adapter ${result.outcome.adapter} cannot list the engine's content (it has no inventory command)`,
        recovery: "install a full adapter for the project's engine (jam engine install), or leave the engine plugin out of catalog.config.json"
      }]
    }
  }
  const inventory = inventoryFile(result)
  return inventory === undefined ? {} : contentOf(inventory, optionsOf(context.options), previews)
}

const IMPORTABLE = /\.(glb|gltf|fbx|obj|png|jpe?g|tga|exr|wav|ogg|flac)$/i

const noPreviews: PreviewsAccess = {
  read: Effect.succeed({ dir: "" }),
  make: () => Effect.die(new Error("this catalog was composed without engine previews"))
}

export const enginePlugin = ({ inventory, importFiles, previews = noPreviews }: EngineAccess): Plugin => {
  // The inventory file, the folders it covers and the previews index, from the last load: a change in any reloads.
  let inputs: ReadonlyArray<string> = []
  let index: ReadonlyArray<string> = []
  const remember = (result: InventoryResult): InventoryResult => {
    inputs = [result.path, ...(result.inventory?.roots ?? []).map((root) => root.path)]
    return result
  }
  const shown = (found: Previews): Previews => {
    index = found.dir === "" ? [] : [`${found.dir}/index.json`]
    return found
  }
  return definePlugin({
    name: "engine",
    sources: [defineSource({
      name: "inventory",
      inputs: () => [...inputs, ...index],
      // The inputs follow from the last load alone.
      scans: () => [],
      load: (context) =>
        Effect.flatMap(Effect.zip(inventory({}), Effect.map(previews.read, shown)), ([result, found]) =>
          Effect.promise(() => existingSources(sourceOutput(remember(result), context, found), context)))
    })],
    enrich: linkSources,
    relations: [{
      name: "engine-uses",
      label: "Uses",
      inverseLabel: "Used by",
      from: (unit) => ownsProjectDependencies(unit) ? [] : strings(unit.attrs[USES])
    }],
    actions: [defineAction({
      name: "engine.import",
      access: "write",
      description: "Put files into the engine through its adapter (jam engine import): a unit's linked files, or the project files named. The engine's content is read again afterwards, so the new assets appear as engine units. A project whose engine content is generated from its own data overrides this with its own action.",
      input: Schema.Struct({
        unit: Schema.optionalKey(Schema.String),
        role: Schema.optionalKey(Schema.String),
        files: Schema.optionalKey(Schema.Array(Schema.String)),
        kind: Schema.String,
        destination: Schema.optionalKey(Schema.String)
      }),
      output: Schema.Struct({
        status: Schema.String,
        units: Schema.Array(Schema.String),
        assets: Schema.Array(Schema.Struct({ id: Schema.String, kind: Schema.String, source: Schema.optionalKey(Schema.String) })),
        next: Schema.optionalKey(Schema.String)
      }),
      run: (input, context) =>
        Effect.gen(function*() {
          const own = optionsOf(context.options).importWith
          if (own !== null) {
            return yield* Effect.fail(toolError("conflict", `this project puts content into the engine with ${own}, not file by file`, { fix: `run the catalog action ${own}` }))
          }
          let files = [...(input.files ?? [])]
          if (input.unit !== undefined) {
            const found = (yield* Effect.promise(() => context.run("unit.get", { id: input.unit! }))) as { links?: ReadonlyArray<{ role: string; asset?: { path?: string } }> }
            files.push(...(found.links ?? []).filter((link) => input.role === undefined || link.role === input.role).flatMap((link) => (link.asset?.path === undefined ? [] : [link.asset.path])))
          }
          files = [...new Set(files)].filter((path) => IMPORTABLE.test(path))
          if (files.length === 0) {
            return yield* Effect.fail(toolError("invalid", "nothing to import: name files, or a unit with linked model, image or audio files", { fix: "pass files, or unit (and role) of a unit whose files the engine can import" }))
          }
          const imported = yield* importFiles({ kind: input.kind, files, destination: input.destination })
          if (imported.status !== "ran") return { status: imported.status, units: [], assets: [], ...(imported.next === undefined ? {} : { next: imported.next }) }
          const read = remember(yield* inventory({}))
          // The units of the imported assets: the engine files that hold them, as the fresh inventory lists them.
          const fileIds = new Set(Object.values(read.inventory?.files ?? {}).map((file) => file.id))
          const units = imported.assets.flatMap((asset) => {
            const file = fileIdOf(asset.id, (id) => fileIds.has(id))
            return file === null ? [] : [unitIdOf(file)]
          })
          return { status: "ran", units: [...new Set(units)], assets: imported.assets }
        })
    }), defineAction({
      name: "engine.refresh",
      access: "read",
      description: "Read the engine's content again: changed files only by default, every file with full; with engine, through the engine what files cannot give (unreadable files, effective property values). It rewrites only the machine-local inventory, never catalog records.",
      input: Schema.Struct({ full: Schema.optionalKey(Schema.Boolean), engine: Schema.optionalKey(Schema.Boolean) }),
      output: Schema.Struct({ inventory: Schema.String, files: Schema.Number, unread: Schema.Number }),
      run: (input) =>
        Effect.map(inventory({ full: input.full ?? false, engine: input.engine ?? false }), (result) => {
          remember(result)
          const files = Object.values(result.inventory?.files ?? {}) as ReadonlyArray<InventoryFile>
          return { inventory: result.path, files: files.length, unread: files.filter((file) => file.unread !== undefined).length }
        })
    }), defineAction({
      name: "engine.previews",
      access: "read",
      description: "Make the engine's previews (images, models, sounds) of the engine files whose content changed since their preview, or of every file with full. It may start the engine and take minutes; engine: false makes only the previews the files hold themselves. It writes only the machine-local previews folder, never catalog records.",
      input: Schema.Struct({
        full: Schema.optionalKey(Schema.Boolean),
        engine: Schema.optionalKey(Schema.Boolean),
        only: Schema.optionalKey(Schema.Array(Schema.String)),
        limit: Schema.optionalKey(Schema.Int)
      }),
      output: Schema.Struct({ index: Schema.String, previews: Schema.Number, made: Schema.Number, failed: Schema.Number, waiting: Schema.Number }),
      run: (input) =>
        Effect.flatMap(previews.make({ full: input.full ?? false, engine: input.engine ?? true, only: input.only ?? [], limit: input.limit }), (result) => {
          if (result.outcome.status !== "ran") {
            return Effect.fail(toolError("unavailable", `the engine adapter ${result.outcome.adapter} makes no previews`, { fix: "install a full adapter for the project's engine (jam engine install)" }))
          }
          const receipt = result.outcome.receipt
          const count = (key: string): number => (typeof receipt[key] === "number" ? receipt[key] : 0)
          return Effect.succeed({ index: `${result.dir}/index.json`, previews: count("previews"), made: count("made"), failed: count("failed"), waiting: count("waiting") })
        })
    })]
  })
}
