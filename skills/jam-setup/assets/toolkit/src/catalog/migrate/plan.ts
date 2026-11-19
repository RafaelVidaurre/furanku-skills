// What `jam catalog migrate` changes, computed from the files alone. Each file kind has its own
// pure function from the old form to the current one; a file already in the current form comes
// back unchanged, so planning the same project twice plans nothing the second time. Nothing here
// reads or writes a file: the command gathers the inputs and `apply.ts` writes the plan.
import { isRecord } from "../../kernel/hash.ts"
import { unitPath } from "../model/retired.ts"
import { RENAMED } from "../Actions.ts"
import { CONFIG_FILE } from "../CatalogConfig.ts"
import { ITEM_PART } from "../model/parts.ts"
import type { RecordKind } from "../model/types.ts"
import { DEFAULT_MANIFEST } from "../plugins/manifest.ts"
import { hasConflictMarkers } from "../records/files.ts"
import { FORMAT, FORMAT_FILE, KINDS, RECORDS_DIR } from "../records/layout.ts"

type Json = Record<string, unknown>

/** A file as read: its project-relative path and its text. */
export interface SourceFile {
  readonly path: string
  readonly text: string
}

export interface Change {
  readonly file: string
  readonly action: "rewrite" | "move" | "create" | "delete"
  /** Where a moved file goes. */
  readonly to?: string
  readonly why: string
}

/** A file the migration writes: its new content, and what to validate it as. */
export interface Output {
  readonly path: string
  readonly value: unknown
  readonly as: RecordKind | "config" | "manifest" | "unit" | "marker"
}

export interface Plan {
  readonly format: { readonly from: number; readonly to: number }
  readonly changes: ReadonlyArray<Change>
  readonly warnings: ReadonlyArray<string>
  readonly writes: ReadonlyArray<Output>
  /** Files and folders removed after every write is in place (moved files, the request journal). */
  readonly removals: ReadonlyArray<string>
  /** Files it cannot read or migrate; any of these refuses the whole migration. */
  readonly errors: ReadonlyArray<{ readonly file: string; readonly error: string }>
}

export interface Inputs {
  readonly config: SourceFile | null
  readonly manifest: SourceFile | null
  readonly unitFiles: ReadonlyArray<SourceFile>
  /** Every `.json` file under the record folders of `.catalog/` and `.catalog/categories.json`. */
  readonly records: ReadonlyArray<SourceFile>
  readonly marker: SourceFile | null
  /** Whether `.catalog/.local/requests/` exists. */
  readonly journal: boolean
  /** Files and folders in scope that could not be read (a symbolic link, no permission). */
  readonly unreadable?: ReadonlyArray<{ readonly file: string; readonly error: string }>
}

export const JOURNAL_DIR = `${RECORDS_DIR}/.local/requests`
const OLD_PART = "decision"
const GUIDE = "check it against docs/catalog-migration.md"

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const at = (where: string, key: string): string => (where === "" ? key : `${where}.${key}`)

/**
 * Rename one key in place, keeping the order of the others; unchanged when the old key is absent.
 * When the new key exists too (a hand edit, or a merge after a migration), the old one is dropped
 * if both hold the same value and refused otherwise, as a record present in both forms is.
 */
const renameKey = (value: Json, from: string, to: string, where = ""): Json => {
  if (!Object.hasOwn(value, from)) return value
  if (Object.hasOwn(value, to)) {
    if (same(value[from], value[to])) return Object.fromEntries(Object.entries(value).filter(([key]) => key !== from))
    throw new Error(`${at(where, from)} and ${at(where, to)} both exist with different values; keep one and run the migration again`)
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key === from ? to : key, entry]))
}
const isModuleRef = (ref: string): boolean => ref.startsWith("./") || /\.(m?js|ts|mts)$/.test(ref)
/** A project path as written in configuration (`./x` or `x`), as the project reads it. */
const relativeOf = (path: string): string => path.replace(/^\.\//, "")
const stem = (ref: string): string => (ref.split("/").pop() ?? ref).replace(/\.[^.]+$/, "")

// ---- catalog.config.json

export interface Migrated {
  readonly value: unknown
  readonly why: ReadonlyArray<string>
  readonly warnings: ReadonlyArray<string>
}

const REVIEW_V3 = ["resolver", "referenceRoles", "verdicts"]
const CONFIG_V3 = ["$schema", "version", "plugins", "review", "display"]

/** Keep the keys version 3 knows; name the others in a warning. */
const knownKeys = (value: Json, keys: ReadonlyArray<string>, where: string, warnings: Array<string>): Json => {
  const dropped = Object.keys(value).filter((key) => !keys.includes(key))
  for (const key of dropped) warnings.push(`${CONFIG_FILE}: ${where}${key} is not part of version 3 and was dropped`)
  return Object.fromEntries(Object.entries(value).filter(([key]) => keys.includes(key)))
}

const refOfEntry = (entry: unknown): string | null =>
  typeof entry === "string" ? entry : isRecord(entry) && typeof entry["plugin"] === "string" ? entry["plugin"] : null

/** Whether a configuration of any version lists project plugin modules (or a version 1 adapter module). */
export const listsProjectModules = (config: unknown): boolean => {
  if (!isRecord(config)) return false
  const refs = config["version"] === 1 ? [config["adapter"]] : Array.isArray(config["plugins"]) ? config["plugins"].map(refOfEntry) : []
  return refs.some((ref) => typeof ref === "string" && ref !== "manifest" && isModuleRef(ref))
}

const pluginWarnings = (plugins: ReadonlyArray<unknown>): Array<string> =>
  plugins.flatMap((entry) => {
    const ref = refOfEntry(entry)
    return ref !== null && isModuleRef(ref)
      ? [`${CONFIG_FILE}: plugin module ${ref} is project code the migration does not change (the plugin contract changed: its import path is tools/jam/catalog-plugin.ts, views and previews are browserModules, an action's kind is access, browser modules report shows); ${GUIDE}`]
      : []
  })

/** Version 1 or 2 to version 3; null when the file is already version 3. */
export const migrateConfig = (value: unknown): Migrated | null => {
  if (!isRecord(value)) throw new Error("expected a JSON object")
  const version = value["version"]
  if (version === 3) return null
  const warnings: Array<string> = []
  const review = isRecord(value["review"]) ? value["review"] : undefined
  if (version === 1) {
    const adapter = typeof value["adapter"] === "string" && value["adapter"] !== "" ? value["adapter"] : "manifest"
    const options = isRecord(value["options"]) ? value["options"] : {}
    let entry: unknown
    if (adapter === "manifest") entry = typeof options["manifest"] === "string" ? { plugin: "manifest", options: { file: options["manifest"] } } : "manifest"
    else {
      entry = Object.keys(options).length > 0 ? { plugin: adapter, options } : adapter
      warnings.push(`${CONFIG_FILE}: adapter ${adapter} is a version 1 adapter module; rewrite it as a plugin (${GUIDE})`)
    }
    if (isRecord(value["previewModules"])) {
      warnings.push(`${CONFIG_FILE}: previewModules (${Object.keys(value["previewModules"]).join(", ")}) was dropped; declare these modules under a plugin's browserModules (${GUIDE})`)
    }
    if (review !== undefined && review["resolverModule"] !== undefined) {
      warnings.push(`${CONFIG_FILE}: review.resolverModule (${String(review["resolverModule"])}) was dropped; register the resolver in a plugin (${GUIDE})`)
    }
    if (value["$schema"] !== undefined) {
      warnings.push(`${CONFIG_FILE}: $schema (${String(value["$schema"])}) was dropped: it described version 1; the version 3 schema is tools/jam/schemas/catalog.config.schema.json`)
    }
    const { resolverModule: _module, ...reviewRest } = review ?? {}
    knownKeys(value, ["version", "adapter", "options", "previewModules", "review", "display", "$schema"], "", warnings)
    const next: Json = {
      version: 3,
      plugins: [entry],
      ...(review === undefined ? {} : { review: knownKeys(reviewRest, REVIEW_V3, "review.", warnings) }),
      ...(value["display"] === undefined ? {} : { display: value["display"] })
    }
    return { value: next, why: ["configuration version 1 → 3: the adapter is a plugins entry"], warnings }
  }
  if (version === 2) {
    const options = isRecord(value["options"]) ? value["options"] : {}
    const listed = Array.isArray(value["plugins"]) ? value["plugins"] : Object.keys(options).length > 0 ? ["manifest"] : null
    const used = new Set<string>()
    // An option set belongs to the entry with its name, or to the project module with that file name.
    const plugins = listed?.map((entry) => {
      if (typeof entry !== "string") return entry
      const key = Object.hasOwn(options, entry) ? entry : isModuleRef(entry) && Object.hasOwn(options, stem(entry)) ? stem(entry) : null
      if (key === null || used.has(key)) return entry
      used.add(key)
      return { plugin: entry, options: options[key] }
    })
    for (const key of Object.keys(options).filter((name) => !used.has(name))) {
      warnings.push(`${CONFIG_FILE}: options.${key} was dropped: no plugin entry is named ${key}`)
    }
    if (plugins) warnings.push(...pluginWarnings(plugins))
    const rest = knownKeys(value, [...CONFIG_V3, "options"], "", warnings)
    const next: Json = {}
    for (const [key, entry] of Object.entries(rest)) {
      if (key === "options") continue
      next[key] = key === "version" ? 3 : key === "plugins" ? plugins : entry
    }
    if (!("plugins" in next) && plugins) next["plugins"] = plugins
    return { value: next, why: [Object.keys(options).length > 0 ? "configuration version 2 → 3: options moved into their plugin entries" : "configuration version 2 → 3"], warnings }
  }
  throw new Error(`unsupported version ${JSON.stringify(version)}`)
}

/**
 * The manifest file the configuration names: option `file` of the `manifest` plugin (version 1:
 * `options.manifest`), `catalog.manifest.json` by default; null when no manifest plugin is listed.
 */
export const manifestPathOf = (config: unknown): string | null => {
  if (config === null || config === undefined) return DEFAULT_MANIFEST
  if (!isRecord(config)) return null
  if (config["version"] === 1) {
    const adapter = config["adapter"] ?? "manifest"
    const options = isRecord(config["options"]) ? config["options"] : {}
    return adapter === "manifest" ? (typeof options["manifest"] === "string" ? relativeOf(options["manifest"]) : DEFAULT_MANIFEST) : null
  }
  const plugins = Array.isArray(config["plugins"]) ? config["plugins"] : ["manifest"]
  const entry = plugins.find((candidate) => candidate === "manifest" || (isRecord(candidate) && candidate["plugin"] === "manifest"))
  if (entry === undefined) return null
  const options = config["version"] === 2
    ? (isRecord(config["options"]) && isRecord(config["options"]["manifest"]) ? config["options"]["manifest"] : {})
    : (isRecord(entry) && isRecord(entry["options"]) ? entry["options"] : {})
  return typeof options["file"] === "string" ? relativeOf(options["file"]) : DEFAULT_MANIFEST
}

// ---- The manifest and its unit files

/** The folders a manifest lists under `unitFiles`. */
export const unitFoldersOf = (manifest: unknown): Array<string> =>
  isRecord(manifest) && Array.isArray(manifest["unitFiles"]) ? manifest["unitFiles"].filter((folder): folder is string => typeof folder === "string").map((folder) => folder.replace(/^\.\//, "").replace(/\/$/, "")) : []

const migrateUnit = (unit: unknown, where: string): unknown => (isRecord(unit) ? renameKey(unit, "views", "inspectors", where) : unit)
const migrateUnits = (units: ReadonlyArray<unknown>): Array<unknown> => units.map((unit, index) => migrateUnit(unit, unitPath("units", index, unit)))

/** One unit file: a unit or `{ units: [...] }`; `views` → `inspectors`. Null when unchanged. */
export const migrateUnitFile = (value: unknown): Migrated | null => {
  const next = isRecord(value) && Array.isArray(value["units"]) ? { ...value, units: migrateUnits(value["units"]) } : migrateUnit(value, "")
  return same(next, value) ? null : { value: next, why: ["unit views → inspectors"], warnings: [] }
}

/** The default scopes were renamed: a type naming an old one would be dropped as naming no scope. */
const OLD_SCOPES: Readonly<Record<string, string>> = { content: "main", assets: "material" }

export interface ManifestContext {
  /** The manifest's project path, for warnings. */
  readonly file: string
  /** Whether the configuration lists project plugin modules, which may define a scope of their own. */
  readonly projectModules: boolean
}

/**
 * Version 1 to version 2: type and unit `views` → `inspectors`, role `kinds` → `mediaKinds`, and a
 * type's old default scope (`content` → `main`, `assets` → `material`). Null when unchanged.
 */
export const migrateManifest = (value: unknown, context: ManifestContext = { file: DEFAULT_MANIFEST, projectModules: false }): Migrated | null => {
  if (!isRecord(value)) throw new Error("expected a JSON object")
  if (value["version"] !== 1 && value["version"] !== 2) throw new Error(`unsupported manifest version ${JSON.stringify(value["version"])}`)
  const why = new Set<string>()
  const warnings: Array<string> = []
  const types = isRecord(value["types"])
    ? Object.fromEntries(Object.entries(value["types"]).map(([key, type]) => {
      if (!isRecord(type)) return [key, type]
      const where = `types.${key}`
      let next = renameKey(type, "views", "inspectors", where)
      if (next !== type) why.add("views → inspectors")
      if (Array.isArray(next["roles"])) {
        const roles = next["roles"].map((role, index) => (isRecord(role) ? renameKey(role, "kinds", "mediaKinds", `${where}.roles[${index}]`) : role))
        if (!same(roles, next["roles"])) why.add("role kinds → mediaKinds")
        next = { ...next, roles }
      }
      const scope = next["scope"]
      if (typeof scope === "string" && Object.hasOwn(OLD_SCOPES, scope)) {
        const renamed = OLD_SCOPES[scope]!
        next = { ...next, scope: renamed }
        why.add(`default scope ${scope} → ${renamed}`)
        if (scope === "content" && context.projectModules) {
          warnings.push(`${context.file}: ${where}.scope was content and is now main; if a project plugin defines its own scope content, set it back (${GUIDE})`)
        }
      }
      return [key, next]
    }))
    : value["types"]
  const next: Json = {}
  for (const [key, entry] of Object.entries(value)) {
    next[key] = key === "version" ? 2 : key === "types" ? types : key === "units" && Array.isArray(entry) ? migrateUnits(entry) : entry
  }
  if (same(next, value)) return null
  if (Array.isArray(value["units"]) && !same(next["units"], value["units"])) why.add("views → inspectors")
  const reasons = [...why].join(", ")
  return {
    value: next,
    why: [value["version"] === 1 ? `manifest version 1 → 2${reasons === "" ? "" : `: ${reasons}`}` : reasons],
    warnings
  }
}

// ---- Records under .catalog

interface Parsed {
  readonly file: SourceFile
  /** Path below .catalog. */
  readonly relative: string
  readonly value: Json
}

/** Items whose one part is the text of work (part `decision` in format 1, `item` in format 2), as `<submission>/<item>`. */
const textItemsOf = (submissions: ReadonlyArray<Json>): Set<string> => {
  const out = new Set<string>()
  for (const submission of submissions) {
    for (const item of Array.isArray(submission["items"]) ? submission["items"] : []) {
      if (!isRecord(item) || item["target"] !== null || !Array.isArray(item["parts"])) continue
      if (item["parts"].length === 1 && isRecord(item["parts"][0]) && [OLD_PART, ITEM_PART].includes(item["parts"][0]["id"] as string)) out.add(`${String(submission["id"])}/${String(item["id"])}`)
    }
  }
  return out
}

const part = (id: unknown, isText: boolean): unknown => (isText && id === OLD_PART ? ITEM_PART : id)
const partKeys = (map: unknown, isText: boolean, where: string): unknown => (isText && isRecord(map) ? renameKey(map, OLD_PART, ITEM_PART, where) : map)

const binding = (value: unknown, where: string): unknown => {
  if (!isRecord(value)) return value
  const next = renameKey(value, "context", "checkout", where)
  const action = next["action"]
  // Only a name that became one other action is rewritten (a split search records nothing).
  const renamed = typeof action === "string" && Object.hasOwn(RENAMED, action) && /^[a-zA-Z.]+$/.test(RENAMED[action]!) ? RENAMED[action] : undefined
  return renamed === undefined ? next : { ...next, action: renamed }
}
const bindings = (record: Json): Json => {
  let next = record
  for (const key of ["requestBinding", "lastRequestBinding"]) if (isRecord(next[key])) next = { ...next, [key]: binding(next[key], key) }
  return next
}

type Step = readonly [why: string, apply: (record: Json) => Json]

/** Apply steps in order; the reasons are those of the steps that changed something. */
const stepwise = (record: Json, steps: ReadonlyArray<Step>): { readonly value: Json; readonly why: ReadonlyArray<string> } => {
  let value = record
  const why: Array<string> = []
  for (const [reason, apply] of steps) {
    const next = apply(value)
    if (!same(next, value)) why.push(reason)
    value = next
  }
  return { value, why }
}

const BINDING: Step = ["request binding context → checkout", bindings]

const textParts = (record: Json, textItems: ReadonlySet<string>): Json => {
  if (!Array.isArray(record["items"])) return record
  return {
    ...record,
    items: record["items"].map((item) => {
      if (!isRecord(item)) return item
      const isText = textItems.has(`${String(record["id"])}/${String(item["id"])}`)
      return {
        ...item,
        parts: Array.isArray(item["parts"]) ? item["parts"].map((p) => (isRecord(p) ? { ...p, id: part(p["id"], isText) } : p)) : item["parts"],
        views: Array.isArray(item["views"])
          ? item["views"].map((view) => {
            if (!isRecord(view)) return view
            const before = view["before"]
            const from = isRecord(before) ? before["from"] : undefined
            const fromText = isRecord(from) && textItems.has(`${String(from["submission"])}/${String(from["item"])}`)
            return {
              ...view,
              part: part(view["part"], isText),
              ...(isRecord(before) && isRecord(from) ? { before: { ...before, from: { ...from, part: part(from["part"], fromText) } } } : {})
            }
          })
          : item["views"]
      }
    })
  }
}

const migrateSubmission = (record: Json, textItems: ReadonlySet<string>) =>
  stepwise(record, [
    ["context → checkout", (r) => renameKey(r, "context", "checkout")],
    ["note → brief", (r) => renameKey(r, "note", "brief")],
    ["work item part decision → item", (r) => textParts(r, textItems)],
    BINDING
  ])

const migrateDecision = (record: Json, textItems: ReadonlySet<string>) => {
  const isText = textItems.has(`${String(record["submission"])}/${String(record["item"])}`)
  return stepwise(record, [
    ["verdict event → decision (id dc_…)", (r) => (typeof r["id"] === "string" ? { ...r, id: r["id"].replace(/^vd_/, "dc_") } : r)],
    ["scope → covers", (r) => renameKey(r, "scope", "covers")],
    ["partNotes → partComments", (r) => renameKey(r, "partNotes", "partComments")],
    ["work item part decision → item", (r) => {
      if (!isText) return r
      const covers = r["covers"]
      return {
        ...r,
        ...(isRecord(covers) && Array.isArray(covers["parts"]) ? { covers: { ...covers, parts: covers["parts"].map((id) => part(id, true)) } } : {}),
        ...Object.fromEntries(["exceptions", "verdicts", "partComments"].filter((key) => isRecord(r[key])).map((key) => [key, partKeys(r[key], true, key)]))
      }
    }],
    BINDING
  ])
}

const migrateNote = (record: Json, textItems: ReadonlySet<string>) =>
  stepwise(record, [
    ["target part decision → item", (r) => {
      const target = r["target"]
      const isText = isRecord(target) && target["kind"] === "submission" && textItems.has(`${String(target["id"])}/${String(target["item"])}`)
      return isText && isRecord(target) ? { ...r, target: { ...target, part: part(target["part"], true) } } : r
    }],
    BINDING
  ])

/** Which record a file under .catalog is, in either format; null for any other file. */
const recordKindOf = (relative: string): { readonly kind: RecordKind; readonly format: 1 | 2 } | null => {
  if (/^labels\/(unit|asset|collection)\/[^/]+\.json$/.test(relative)) return { kind: "organization", format: 1 }
  if (/^reviews\/[^/]+\/verdicts\/[^/]+\.json$/.test(relative)) return { kind: "decision", format: 1 }
  for (const kind of Object.keys(KINDS) as Array<RecordKind>) if (KINDS[kind].match.test(relative)) return { kind, format: 2 }
  return null
}


/** Plan the whole migration. Pure: the same inputs always give the same plan. */
export const planMigration = (inputs: Inputs): Plan => {
  const changes: Array<Change> = []
  const warnings: Array<string> = []
  const writes: Array<Output> = []
  const removals: Array<string> = []
  const errors: Array<{ file: string; error: string }> = [...(inputs.unreadable ?? [])]
  // Each file is parsed once, so one that cannot be is named once.
  const seen = new Map<SourceFile, unknown>()
  const parse = (file: SourceFile): unknown => {
    if (seen.has(file)) return seen.get(file)
    let value: unknown
    try {
      if (hasConflictMarkers(file.text)) throw new Error("unresolved Git merge conflict")
      value = JSON.parse(file.text) as unknown
    } catch (cause) {
      errors.push({ file: file.path, error: cause instanceof Error ? cause.message : String(cause) })
      value = undefined
    }
    seen.set(file, value)
    return value
  }
  const attempt = (file: SourceFile, migrate: (value: unknown) => Migrated | null, as: Output["as"]): void => {
    const value = parse(file)
    if (value === undefined) return
    try {
      const migrated = migrate(value)
      if (migrated === null) return
      writes.push({ path: file.path, value: migrated.value, as })
      changes.push({ file: file.path, action: "rewrite", why: migrated.why.join("; ") })
      warnings.push(...migrated.warnings)
    } catch (cause) {
      errors.push({ file: file.path, error: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  const config = inputs.config && parse(inputs.config)
  if (inputs.config) attempt(inputs.config, migrateConfig, "config")
  const manifest = inputs.manifest
  if (manifest) attempt(manifest, (value) => migrateManifest(value, { file: manifest.path, projectModules: listsProjectModules(config) }), "manifest")
  for (const file of inputs.unitFiles) attempt(file, migrateUnitFile, "unit")

  // Records: read every one first, since a work item's part is named in other records.
  const parsed: Array<Parsed & { readonly kind: RecordKind; readonly format: 1 | 2 }> = []
  for (const file of inputs.records) {
    const relative = file.path.slice(RECORDS_DIR.length + 1)
    const known = recordKindOf(relative)
    if (known === null) continue
    const value = parse(file)
    if (value === undefined) continue
    if (!isRecord(value)) {
      errors.push({ file: file.path, error: "record must be a JSON object" })
      continue
    }
    parsed.push({ file, relative, value, ...known })
  }
  const textItems = textItemsOf(parsed.filter((entry) => entry.kind === "submission").map((entry) => entry.value))
  const existing = new Map(parsed.map((entry) => [entry.relative, entry]))
  let oldFormat = parsed.some((entry) => entry.format === 1)
  const migrateRecord = (entry: (typeof parsed)[number]) =>
    entry.kind === "submission"
      ? migrateSubmission(entry.value, textItems)
      : entry.kind === "decision"
      ? migrateDecision(entry.value, textItems)
      : entry.kind === "note"
      ? migrateNote(entry.value, textItems)
      : entry.kind === "collection"
      ? stepwise(entry.value, [BINDING])
      : { value: entry.value, why: [] }
  for (const entry of parsed) {
    let migrated: ReturnType<typeof migrateRecord>
    try {
      migrated = migrateRecord(entry)
    } catch (cause) {
      errors.push({ file: entry.file.path, error: cause instanceof Error ? cause.message : String(cause) })
      continue
    }
    const next = migrated.value
    const why = [...(entry.kind === "organization" && entry.format === 1 ? ["label record → organization record"] : []), ...migrated.why].join("; ")
    const target = KINDS[entry.kind].file(next as never)
    if (target === entry.relative) {
      if (!same(next, entry.value)) {
        oldFormat = true
        writes.push({ path: entry.file.path, value: next, as: entry.kind })
        changes.push({ file: entry.file.path, action: "rewrite", why })
      }
      continue
    }
    if (entry.format === 2) {
      // A current record whose path does not match its identity is not the migration's to fix.
      errors.push({ file: entry.file.path, error: `record identity does not match its path (expected ${RECORDS_DIR}/${target})` })
      continue
    }
    const to = `${RECORDS_DIR}/${target}`
    const already = existing.get(target)
    if (already !== undefined) {
      // A branch merged after migration can carry both forms of one record.
      if (same(already.value, next)) {
        removals.push(entry.file.path)
        changes.push({ file: entry.file.path, action: "delete", why: `already migrated as ${to}` })
      } else errors.push({ file: entry.file.path, error: `${to} exists with different content; keep one of the two and run the migration again` })
      continue
    }
    writes.push({ path: to, value: next, as: entry.kind })
    removals.push(entry.file.path)
    changes.push({ file: entry.file.path, action: "move", to, why })
  }

  // The marker: written once any record exists, so the engine knows the layout.
  const marker = inputs.marker === null ? null : parse(inputs.marker)
  const markerFormat = isRecord(marker) && typeof marker["format"] === "number" ? marker["format"] : null
  if (inputs.marker !== null && marker !== undefined && markerFormat === null) errors.push({ file: FORMAT_FILE, error: `expected { "format": <n> }` })
  if (markerFormat !== null && markerFormat > FORMAT) errors.push({ file: FORMAT_FILE, error: `format ${markerFormat} is newer than this toolkit's (${FORMAT}); update the toolkit` })
  const from = oldFormat || (markerFormat !== null && markerFormat < FORMAT) || (inputs.marker === null && parsed.length > 0) ? 1 : markerFormat ?? FORMAT
  if (parsed.length > 0 && (inputs.marker === null || (markerFormat !== null && markerFormat < FORMAT))) {
    writes.push({ path: FORMAT_FILE, value: { format: FORMAT }, as: "marker" })
    changes.push({ file: FORMAT_FILE, action: inputs.marker === null ? "create" : "rewrite", why: `records are in format ${FORMAT}` })
  }
  // Request ids recorded before cannot be replayed after: their journal entries name the old forms.
  if (inputs.journal && changes.length > 0) {
    removals.push(JOURNAL_DIR)
    changes.push({ file: `${JOURNAL_DIR}/`, action: "delete", why: "request ids recorded before the migration cannot be replayed after it" })
  }
  return { format: { from, to: FORMAT }, changes, warnings, writes, removals, errors }
}
