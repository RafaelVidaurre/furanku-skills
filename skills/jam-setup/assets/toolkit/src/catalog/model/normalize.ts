// Turning what sources produced into the catalog's own entries. Sources are trusted code, but
// their output is data: anything malformed becomes a problem naming where it came from, and
// nothing is invented to fill a gap.
import * as Effect from "effect/Effect"
import { isNonEmpty, isRecord } from "../../kernel/hash.ts"
import type { MergedSources, ProblemInput, RoleInput } from "../plugin.ts"
import type { Asset, CatalogSchema, CollectionKind, FieldDef, Link, Member, Problem, RoleDef, TypeDef, Unit } from "./types.ts"

export interface SourceCollection {
  readonly id: string
  readonly name: string
  readonly kind: string | null
  readonly members: ReadonlyArray<Member>
  readonly adapterTags: ReadonlyArray<string>
  readonly adapterCategory: string | null
}

export interface Normalized {
  readonly project: string | null
  readonly schema: CatalogSchema
  readonly assetRoots: ReadonlyArray<string>
  readonly units: ReadonlyArray<Unit>
  readonly assets: ReadonlyArray<Asset>
  readonly collections: ReadonlyArray<SourceCollection>
  readonly problems: ReadonlyArray<Problem>
}

export interface NormalizeRules {
  /** Registered scope ids; the first is the default. */
  readonly scopes: ReadonlyArray<string>
  /** Registered media kind ids. */
  readonly kinds: ReadonlyArray<string>
  kindOf(path: string): string | null
  /** Why a path may not be used as media (outside the asset roots, through a link), else null. */
  confine(path: string): Effect.Effect<string | null>
}

const strings = (values: unknown): Array<string> => (Array.isArray(values) ? values.filter(isNonEmpty) : [])
const METADATA = /(^|\/)(\.git|\.catalog)(\/|$)/

const normalizeSchema = (sources: MergedSources, rules: NormalizeRules, problems: Array<Problem>): CatalogSchema => {
  const report = (error: string): void => void problems.push({ source: "schema", error, recovery: null })
  const types: Record<string, TypeDef> = {}
  for (const [key, type] of Object.entries(sources.types)) {
    if (typeof type !== "object" || type === null || Array.isArray(type)) {
      report(`type ${key} is invalid`)
      continue
    }
    if (type.scope != null && !rules.scopes.includes(type.scope)) {
      report(`type ${key}: scope must be one of ${rules.scopes.join(", ")}`)
      continue
    }
    const roles: Array<RoleDef> = []
    for (const role of (type.roles ?? []) as ReadonlyArray<RoleInput | null>) {
      const valid = isNonEmpty(role?.key) && isNonEmpty(role?.label) && Array.isArray(role.kinds) && role.kinds.length > 0 &&
        role.kinds.every((kind) => rules.kinds.includes(kind)) && !role.key.includes(":")
      if (!valid || !role) {
        report(`type ${key}: role ${role?.key ?? "?"} is invalid`)
        continue
      }
      roles.push({ key: role.key, label: role.label, kinds: role.kinds, many: !!role.many, expected: !!role.expected, help: role.help ?? null })
    }
    const fields: Array<FieldDef> = (type.fields ?? []).filter((field) => isNonEmpty(field?.key) && isNonEmpty(field?.label)).map((field) => ({
      key: field.key,
      label: field.label,
      kind: field.kind ?? "text",
      unit: field.unit ?? null,
      help: field.help ?? null,
      group: field.group ?? null,
      filter: field.filter === true,
      derived: field.derived === true,
      summary: field.summary !== false
    }))
    types[key] = {
      scope: type.scope ?? rules.scopes[0] ?? "content",
      label: isNonEmpty(type.label) ? type.label : key,
      roles,
      fields,
      thumb: type.thumb ?? roles[0]?.key ?? null,
      help: type.help ?? null,
      audioTranscript: type.audioTranscript ?? null,
      reviewAttributes: type.reviewAttributes !== false
    }
  }
  const collectionKinds: Record<string, CollectionKind> = {}
  for (const [key, kind] of Object.entries(sources.collectionKinds)) {
    if (typeof kind !== "object" || kind === null) continue
    collectionKinds[key] = { label: kind.label ?? key, preview: kind.preview ?? null, memberField: kind.memberField ?? null, memberExtra: kind.memberExtra ?? null }
  }
  return { types, collectionKinds }
}

export const normalize = (sources: MergedSources, reported: ReadonlyArray<ProblemInput>, rules: NormalizeRules): Effect.Effect<Normalized> =>
  Effect.gen(function*() {
    const problems: Array<Problem> = reported.map((p) => ({ source: p.source ?? "source", error: p.error ?? String(p), recovery: p.recovery ?? null }))
    const report = (source: string, error: string): void => void problems.push({ source, error, recovery: null })
    const schema = normalizeSchema(sources, rules, problems)
    const assets = new Map<string, Asset>()

    const addAsset = (input: { readonly id?: unknown; readonly path?: unknown; readonly kind?: string; readonly label?: string; readonly tags?: ReadonlyArray<string>; readonly category?: string | null } | null, from: string) =>
      Effect.gen(function*() {
        const name = String(input?.id ?? input?.path ?? "?")
        if (!isNonEmpty(input?.id) || !isNonEmpty(input?.path)) return report(from, `asset ${name}: asset needs id and path`), null
        if (METADATA.test(input.path)) return report(from, `asset ${name}: repository metadata and catalog records are not assets`), null
        const refused = yield* rules.confine(input.path)
        if (refused !== null) return report(from, `asset ${name}: ${refused}`), null
        const existing = assets.get(input.id)
        if (existing) return existing
        const asset: Asset = {
          id: input.id,
          path: input.path,
          kind: input.kind ?? rules.kindOf(input.path),
          declaredKind: input.kind ?? null,
          label: input.label ?? null,
          adapterTags: input.tags ?? [],
          adapterCategory: input.category ?? null
        }
        assets.set(asset.id, asset)
        return asset
      })

    for (const asset of sources.assets) yield* addAsset(asset, "assets")
    // A preview base declared by a collection kind is an asset in its own right.
    for (const [key, kind] of Object.entries(schema.collectionKinds)) {
      const base = kind.preview?.base
      if (typeof base === "string" && !assets.has(base)) yield* addAsset({ id: base, path: base }, `collection kind ${key}`)
    }

    const units = new Map<string, Unit>()
    for (const unit of sources.units) {
      const from = unit?.sources?.[0] ?? "source"
      if (!isNonEmpty(unit?.id) || !isNonEmpty(unit?.type)) {
        report(from, "content entry without id or type")
        continue
      }
      const earlier = units.get(unit.id)
      if (earlier) {
        report(from, `duplicate content id ${unit.id} (also from ${earlier.sources[0] ?? "another source"})`)
        continue
      }
      const type = schema.types[unit.type]
      if (!type) {
        report(from, `${unit.id}: unknown type ${unit.type}`)
        continue
      }
      const links: Array<Link> = []
      for (const link of unit.links ?? []) {
        const role = type.roles.find((candidate) => candidate.key === link?.role)
        if (!role) {
          report(from, `${unit.id}: unknown visual role ${link?.role}`)
          continue
        }
        const asset = assets.get(link.asset) ?? (typeof link.asset === "string" ? yield* addAsset({ id: link.asset, path: link.asset }, from) : null)
        if (!asset) continue
        if (asset.kind && !role.kinds.includes(asset.kind)) {
          report(from, `${unit.id}: ${role.label} does not accept ${asset.kind} (${asset.id})`)
          continue
        }
        if (!role.many && links.some((other) => other.role === role.key)) {
          report(from, `${unit.id}: ${role.label} takes one asset`)
          continue
        }
        if (links.some((other) => other.role === role.key && other.asset === asset.id)) continue
        if (link.key != null && (!isNonEmpty(link.key) || link.key.length > 100 || links.some((other) => other.role === role.key && other.key === link.key))) {
          report(from, `${unit.id}: invalid or duplicate visual key for ${role.key}`)
          continue
        }
        links.push({ role: role.key, asset: asset.id, ...(link.key == null ? {} : { key: link.key }), ...(isRecord(link.meta) ? { meta: link.meta } : {}) })
      }
      units.set(unit.id, {
        id: unit.id,
        scope: type.scope,
        type: unit.type,
        name: isNonEmpty(unit.name) ? unit.name : unit.id,
        attrs: isRecord(unit.attrs) ? unit.attrs : {},
        links,
        aliases: strings(unit.aliases),
        search: strings(unit.search),
        sources: strings(unit.sources),
        adapterTags: strings(unit.tags),
        adapterCategory: unit.category ?? null,
        explain: isRecord(unit.explain) ? unit.explain : {}
      })
    }

    const collections: Array<SourceCollection> = []
    for (const collection of sources.collections) {
      if (!isNonEmpty(collection?.id) || !isNonEmpty(collection?.name)) {
        report("collections", "source collection without id or name")
        continue
      }
      collections.push({
        id: collection.id,
        name: collection.name,
        kind: collection.kind ?? null,
        members: (collection.members ?? []).filter((member) => units.has(member?.unit)),
        adapterTags: collection.tags ?? [],
        adapterCategory: collection.category ?? null
      })
    }
    return {
      project: sources.project,
      schema,
      assetRoots: sources.assetRoots.filter((root) => root === "" || isNonEmpty(root)),
      units: [...units.values()],
      assets: [...assets.values()],
      collections,
      problems
    }
  })
