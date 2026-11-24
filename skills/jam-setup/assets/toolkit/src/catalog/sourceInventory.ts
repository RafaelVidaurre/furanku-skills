import type {
  EnrichPatch, FieldInput, LinkInput, MergedSources, Relation, RelationUnit, SourceOutput, TypeInput, UnitInput
} from "./contract/sources.ts"

export interface SourceInventoryFile {
  readonly targets?: ReadonlyArray<string>
  readonly uses?: ReadonlyArray<string>
}

export interface SourceInventoryOptions {
  readonly type?: string
  readonly idPrefix?: string
  readonly label?: string
  readonly plural?: string
  /** Project-relative paths conveyed by project-owned link metadata. */
  readonly linkSourcePaths?: (link: LinkInput) => ReadonlyArray<string>
}

interface InventoryProjection {
  readonly patch: EnrichPatch
  /** Original unit selected for each inventory path, for any project-specific enrichment. */
  readonly files: ReadonlyMap<string, UnitInput>
}

const targetsField: FieldInput = { key: "targets", label: "Build targets", filter: true }
const usesField: FieldInput = { key: "uses", label: "Uses", kind: "refs", summary: false }
const materialField: FieldInput = { key: "material", label: "Source files", kind: "refs", derived: true, summary: false }
const strings = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []

// Relation ownership follows enrichment without appearing in the unit's serialized attributes.
const projectDependencies = Symbol("project dependencies")
export const ownsProjectDependencies = (unit: RelationUnit): boolean => Reflect.get(unit.attrs, projectDependencies) === true

/**
 * Use a project's authoritative source file list. Where the built-in engine plugin also supplies
 * a row for a path, that row keeps its id and type and incorporates the project's file metadata.
 */
export function defineSourceInventory(options: SourceInventoryOptions = {}) {
  const {
    type = "source-file", idPrefix = "source:", label = "Source file", plural = "Source files",
    linkSourcePaths = () => []
  } = options
  const contentSources = Symbol("project source files")
  const fileType: TypeInput = {
    label, plural, scope: "material", reviewAttributes: false,
    fields: [{ key: "file", label: "File" }, targetsField, usesField],
    roles: [{ key: "source", label: "Source", mediaKinds: ["image", "audio", "video", "model"], many: true }]
  }

  const source = (files: Readonly<Record<string, SourceInventoryFile>>): Required<Pick<SourceOutput, "types" | "units">> => ({
    types: { [type]: fileType },
    units: Object.entries(files).map(([file, record]) => ({
      id: idPrefix + file,
      type,
      name: file.slice(file.lastIndexOf("/") + 1),
      attrs: {
        file,
        ...(record.targets === undefined ? {} : { targets: record.targets }),
        ...(record.uses === undefined ? {} : { uses: record.uses })
      },
      sources: [file]
    }))
  })

  const project = (merged: MergedSources): InventoryProjection => {
    const files = new Map<string, UnitInput>()
    if (!Object.hasOwn(merged.types, type)) return { files, patch: {} }

    const rows = new Map<string, UnitInput>()
    const engine = new Map<string, Array<UnitInput>>()
    for (const unit of merged.units) {
      const file = unit.attrs?.["file"]
      if (typeof file !== "string") continue
      if (unit.type === type && unit.id === idPrefix + file) {
        rows.set(file, unit)
      } else if (unit.id.startsWith("engine:")) {
        if (!engine.has(file)) engine.set(file, [])
        engine.get(file)!.push(unit)
      }
    }
    const units: Record<string, Partial<UnitInput> | null> = Object.create(null)
    const types: Record<string, TypeInput> = Object.create(null)
    const aliases = new Map<string, string>()
    const pruned = new Set<string>()
    for (const [file, row] of rows) {
      const available = engine.get(file)
      if (available === undefined) {
        files.set(file, row)
        continue
      }
      available.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      const [first, ...duplicates] = available
      files.set(file, first!)
      units[row.id] = null
      for (const unit of duplicates) {
        units[unit.id] = null
        aliases.set(unit.id, first!.id)
      }
    }

    const withField = (key: string, field: FieldInput): void => {
      const definition = types[key] ?? merged.types[key]
      if (definition === undefined || definition.fields?.some((existing) => existing.key === field.key)) return
      types[key] = { ...definition, fields: [...(definition.fields ?? []), field] }
    }
    const unitsFor = (paths: Iterable<string>): ReadonlyArray<string> => {
      const ids = new Set<string>()
      for (const path of paths) {
        const unit = files.get(path)
        if (unit !== undefined) ids.add(unit.id)
      }
      return [...ids]
    }

    for (const [file, available] of engine) {
      if (files.has(file)) continue
      for (const unit of available) {
        units[unit.id] = null
        pruned.add(unit.id)
      }
    }
    for (const [file, row] of rows) {
      const unit = files.get(file)!
      const targets = row.attrs?.["targets"]
      const uses = row.attrs?.["uses"]
      const attrs: Record<string, unknown> = {
        ...unit.attrs,
        ...(targets === undefined ? {} : { targets: strings(targets) }),
        ...(uses === undefined ? {} : { uses: unitsFor(strings(uses)), [projectDependencies]: true })
      }
      if (targets !== undefined) withField(unit.type, targetsField)
      if (uses !== undefined) {
        delete attrs["external"]
        withField(unit.type, usesField)
      } else if (aliases.size > 0 || pruned.size > 0) {
        const inheritedUses = (engine.get(file) ?? []).flatMap((entry) => strings(entry.attrs?.[usesField.key]))
        if (inheritedUses.length > 0) {
          attrs["uses"] = [...new Set(inheritedUses.map((id) => aliases.get(id) ?? id).filter((id) => !pruned.has(id)))]
          withField(unit.type, usesField)
        }
      }
      units[unit.id] = { attrs }
    }

    const assetPaths = new Map(merged.assets.map(({ id, path }) => [id, path]))
    for (const unit of merged.units) {
      if (unit.id.startsWith("engine:") || unit.type === type) continue
      const paths = [
        ...(unit.sources ?? []),
        ...(unit.links ?? []).flatMap((link) => [assetPaths.get(link.asset) ?? link.asset, ...linkSourcePaths(link)])
      ]
      const material = unitsFor(paths)
      if (material.length === 0) continue
      units[unit.id] = { attrs: { ...unit.attrs, material, [contentSources]: true } }
      withField(unit.type, materialField)
    }
    return { files, patch: { types, units } }
  }

  const relations: ReadonlyArray<Relation> = [
    {
      name: "source-files",
      label: materialField.label,
      inverseLabel: "Content",
      from: (unit) => Reflect.get(unit.attrs, contentSources) === true ? strings(unit.attrs[materialField.key]) : []
    },
    {
      name: "source-file-uses",
      label: usesField.label,
      inverseLabel: "Used by",
      from: (unit) => ownsProjectDependencies(unit) ? strings(unit.attrs[usesField.key]) : []
    }
  ]
  return { source, project, relations }
}
