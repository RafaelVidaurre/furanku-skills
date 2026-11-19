// Organizing content in the catalog: categories and tags on units, assets and collections. These
// records are catalog-owned; a source's own tags and categories are never changed here.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { ExpectedRevision, optional, refOf, write } from "../action.ts"
import { fail, type ToolError } from "../../kernel/errors.ts"
import type { CollectionRecord, OrganizationRecord } from "../model/types.ts"
import { type Projection, targetKey } from "../Projection.ts"
import { organizationOf, organizationWith, type OrganizedKind } from "../queries/organization.ts"
import { type RecordOp, Records } from "../Records.ts"
import { isCategory, isTag } from "../records/schemas.ts"
import { Organization, Written } from "../results.ts"
import { unique } from "../support.ts"
import { targetExists } from "./notes.ts"

const LOCK = "organization"
const Organized = refOf(["unit", "asset", "collection"])
// Tags and categories are cleaned and checked by the rules below, so the reason names the value.
const TagList = Schema.Array(Schema.Unknown)
const CategoryInput = Schema.Unknown.annotate({ description: 'A category path such as "Props/Lighting"; null or "" clears it' })

interface Org {
  readonly category: string | null
  readonly tags: ReadonlyArray<string>
}

export const cleanTag = (value: unknown): Effect.Effect<string, ToolError> => {
  if (typeof value !== "string") return fail("invalid", "tags must be text")
  const tag = value.trim().toLowerCase()
  return tag !== "" && isTag(tag) ? Effect.succeed(tag) : fail("invalid", `invalid tag "${value}": use lowercase letters, digits and : . _ / + - (1-64 characters)`)
}
export const cleanTags = (tags: ReadonlyArray<unknown>): Effect.Effect<Array<string>, ToolError> => Effect.map(Effect.forEach(tags, cleanTag), unique)
export const cleanCategory = (value: unknown): Effect.Effect<string | null, ToolError> => {
  if (value == null || value === "") return Effect.succeed(null)
  if (typeof value !== "string") return fail("invalid", "category must be text")
  const path = value.split("/").map((level) => level.trim()).filter(Boolean).join("/")
  return isCategory(path) ? Effect.succeed(path) : fail("invalid", `invalid category "${value}" (at most 8 levels of 64 characters)`)
}
const requiredCategory = (value: unknown): Effect.Effect<string, ToolError> =>
  Effect.flatMap(cleanCategory(value), (path) => (path === null ? fail("invalid", "category path is required") : Effect.succeed(path)))

/** The record operation that sets one target's organization (not yet applied). */
const organizationOp = (p: Projection, target: typeof Organized.Type, change: (current: Org) => Org, expectedRevision?: number | null) =>
  Effect.gen(function*() {
    if (!targetExists(p, target)) return yield* fail("not_found", `organization target ${target.kind}:${target.id} not found`)
    // A catalog-owned collection keeps its organization in its own record.
    if (target.kind === "collection" && p.collectionsById.get(target.id)?.owner === "catalog") {
      const record = p.records.collection.find((candidate) => candidate.id === target.id)!
      return { type: "update", kind: "collection", record: { ...record, ...change({ category: record.category ?? null, tags: record.tags }) }, expectedRevision } satisfies RecordOp
    }
    const current = p.organization.get(targetKey(target))
    if (current) return { type: "update", kind: "organization", record: { ...current, ...change({ category: current.category, tags: current.tags }) }, expectedRevision } satisfies RecordOp
    if (expectedRevision) return yield* fail("conflict", "organization changed since it was read")
    const record: OrganizationRecord = { target: { kind: target.kind, id: target.id }, ...change({ category: null, tags: [] }), revision: 1 }
    return { type: "create", kind: "organization", record } satisfies RecordOp
  })

const sameOrg = (a: Org, b: Org): boolean => a.category === b.category && a.tags.join("\n") === b.tags.join("\n")

/** Rewrite every catalog-owned organization record through one mapping, as one operation. */
const organizationOps = (p: Projection, map: (current: Org) => Org): Array<RecordOp> => {
  const ops: Array<RecordOp> = []
  for (const record of p.records.organization) {
    const current = { category: record.category, tags: record.tags }
    const next = map(current)
    if (!sameOrg(current, next)) ops.push({ type: "update", kind: "organization", record: { ...record, ...next } })
  }
  for (const collection of p.records.collection) {
    const current = { category: collection.category ?? null, tags: collection.tags }
    const next = map(current)
    if (!sameOrg(current, next)) ops.push({ type: "update", kind: "collection", record: { ...collection, ...next } })
  }
  return ops
}

const categoriesOp = (p: Projection, map: (categories: ReadonlyArray<string>) => ReadonlyArray<string> | null): Array<RecordOp> => {
  const current = p.records.categories[0]
  const next = current ? map(current.categories) : null
  return current && next ? [{ type: "update", kind: "categories", record: { ...current, categories: next } }] : []
}
const organized = (ops: ReadonlyArray<RecordOp>): number => ops.filter((op) => op.kind !== "categories").length

export const OrganizationSetInput = Schema.Struct({ target: Organized, category: Schema.optionalKey(CategoryInput), tags: optional(TagList), expectedRevision: ExpectedRevision })
export const OrganizationSetOutput = Written({ organization: Organization, revision: Schema.Number })
export const OrganizationSetManyInput = Schema.Struct({ targets: Schema.Array(Organized), addTags: optional(TagList), removeTags: optional(TagList), category: Schema.optionalKey(CategoryInput) })
export const OrganizationSetManyOutput = Written({ updated: Schema.Number })
export const CategoryPathInput = Schema.Struct({ path: Schema.String })
export const CategoryCreateOutput = Written({ category: Schema.String })
export const RenameInput = Schema.Struct({ from: Schema.String, to: Schema.String })
export const CategoryRenameOutput = Written({ renamed: Schema.Number, projectOwnedUnchanged: Schema.Number })
export const CategoryDeleteOutput = Written({ cleared: Schema.Number })
export const TagRenameOutput = Written({ renamed: Schema.Number })
export const TagDeleteInput = Schema.Struct({ tag: Schema.String })
export const TagDeleteOutput = Written({ removed: Schema.Number })

export const organizationActions = [
  write(
    "organization.set",
    "Set category and/or tags of a unit, asset or collection",
    OrganizationSetInput,
    OrganizationSetOutput,
    LOCK,
    (input, env) =>
      Effect.gen(function*() {
        const p = env.projection
        const category = input.category !== undefined ? yield* cleanCategory(input.category) : undefined
        const tags = input.tags ? yield* cleanTags(input.tags) : undefined
        const op = yield* organizationOp(p, input.target, (current) => ({ category: category !== undefined ? category : current.category, tags: tags ?? current.tags }), input.expectedRevision)
        const [written] = (yield* (yield* Records).apply([op])) as ReadonlyArray<OrganizationRecord | CollectionRecord>
        const kind: OrganizedKind = input.target.kind
        const before = organizationOf(p, kind, input.target.id)
        // Answer from the record just written; the projection still shows the state before it.
        const entity = kind === "unit" ? p.snapshot.unitsById.get(input.target.id) : kind === "asset" ? p.snapshot.assetsById.get(input.target.id) : undefined
        const organization = before.owner === undefined
          ? organizationWith(entity, { category: written!.category ?? null, tags: written!.tags, revision: written!.revision })
          : { ...before, category: written!.category ?? before.projectCategory, tags: written!.tags, revision: written!.revision }
        return { organization, revision: written!.revision }
      })
  ),
  write(
    "organization.setMany",
    "Add/remove tags or set the category of many targets at once",
    OrganizationSetManyInput,
    OrganizationSetManyOutput,
    LOCK,
    (input, env) =>
      Effect.gen(function*() {
        const { targets } = input
        if (targets.length === 0 || targets.length > 1000) return yield* fail("invalid", "give 1-1000 targets")
        const add = input.addTags ? yield* cleanTags(input.addTags) : []
        const remove = input.removeTags ? yield* cleanTags(input.removeTags) : []
        const category = input.category !== undefined ? yield* cleanCategory(input.category) : undefined
        if (new Set(targets.map(targetKey)).size !== targets.length) return yield* fail("invalid", "a target appears twice")
        const ops = yield* Effect.forEach(targets, (target) =>
          organizationOp(env.projection, target, (current) => ({
            category: category !== undefined ? category : current.category,
            tags: unique([...current.tags.filter((tag) => !remove.includes(tag)), ...add])
          })))
        yield* (yield* Records).apply(ops)
        return { updated: ops.length }
      })
  ),
  write("category.create", "Register a category path (Parent/Child)", CategoryPathInput, CategoryCreateOutput, LOCK, (input, env) =>
    Effect.gen(function*() {
      const path = yield* requiredCategory(input.path)
      const current = env.projection.records.categories[0]
      const categories = unique([...(current?.categories ?? []), path]).sort()
      yield* (yield* Records).apply([current ? { type: "update", kind: "categories", record: { ...current, categories } } : { type: "create", kind: "categories", record: { categories, revision: 1 } }])
      return { category: path }
    })),
  write(
    "category.rename",
    "Rename a category path (applies to catalog-owned organization; descendants follow)",
    RenameInput,
    CategoryRenameOutput,
    LOCK,
    (input, env) =>
      Effect.gen(function*() {
        const p = env.projection
        const from = yield* requiredCategory(input.from)
        const to = yield* requiredCategory(input.to)
        const rename = <C extends string | null>(category: C): C | string => (category === from || category?.startsWith(`${from}/`) ? to + category.slice(from.length) : category)
        const ops = [
          ...organizationOps(p, (current) => ({ category: rename(current.category), tags: current.tags })),
          ...categoriesOp(p, (categories) => unique(categories.map(rename)).sort())
        ]
        yield* (yield* Records).apply(ops)
        const projectOwned = [...p.snapshot.units, ...p.snapshot.assets].filter((entity) => rename(entity.adapterCategory) !== entity.adapterCategory).length
        return { renamed: organized(ops), projectOwnedUnchanged: projectOwned }
      })
  ),
  write("category.delete", "Remove a category path from catalog-owned organization", CategoryPathInput, CategoryDeleteOutput, LOCK, (input, env) =>
    Effect.gen(function*() {
      const path = yield* requiredCategory(input.path)
      const hit = (category: string | null): boolean => category === path || !!category?.startsWith(`${path}/`)
      const ops = [
        ...organizationOps(env.projection, (current) => ({ category: hit(current.category) ? null : current.category, tags: current.tags })),
        ...categoriesOp(env.projection, (categories) => (categories.some(hit) ? categories.filter((category) => !hit(category)) : null))
      ]
      yield* (yield* Records).apply(ops)
      return { cleared: organized(ops) }
    })),
  write(
    "tag.rename",
    "Rename a catalog-owned tag; renaming onto an existing tag merges them",
    RenameInput,
    TagRenameOutput,
    LOCK,
    (input, env) =>
      Effect.gen(function*() {
        const from = yield* cleanTag(input.from)
        const to = yield* cleanTag(input.to)
        const ops = organizationOps(env.projection, (current) => ({ category: current.category, tags: unique(current.tags.map((tag) => (tag === from ? to : tag))) }))
        yield* (yield* Records).apply(ops)
        return { renamed: ops.length }
      })
  ),
  write("tag.delete", "Remove a catalog-owned tag everywhere", TagDeleteInput, TagDeleteOutput, LOCK, (input, env) =>
    Effect.gen(function*() {
      const tag = yield* cleanTag(input.tag)
      const ops = organizationOps(env.projection, (current) => ({ category: current.category, tags: current.tags.filter((existing) => existing !== tag) }))
      yield* (yield* Records).apply(ops)
      return { removed: ops.length }
    }))
]
