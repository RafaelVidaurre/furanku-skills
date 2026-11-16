// Catalog-owned collections: named, ordered references to units. Collections a source defines
// are read-only here and are changed in the project's own files.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { ExpectedRevision, optional, priorRequest, read, requestFields, Text, write } from "../action.ts"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { isNonEmpty } from "../../kernel/hash.ts"
import { nowIso } from "../../kernel/Ids.ts"
import type { Collection, CollectionRecord, Member } from "../model/types.ts"
import type { Projection } from "../Projection.ts"
import { Records } from "../Records.ts"
import { cleanCategory, cleanTags } from "./organization.ts"

const LOCK = "organization"
const MemberInput = Schema.Union([Text, Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Finite, Schema.Boolean]))])
  .annotate({ description: 'A unit id, or { "unit": id, …extra } to carry per-member data' })

const toMembers = (members: ReadonlyArray<typeof MemberInput.Type>): Array<Member> =>
  members.map((member) => (typeof member === "string" ? { unit: member } : (member as unknown as Member)))

const slug = (name: string): string => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "collection"

/** A collection the catalog owns, with its record; source-defined ones are refused. */
const owned = (p: Projection, id: string, refusal: (collection: Collection) => string): Effect.Effect<CollectionRecord, ToolError> => {
  const collection = p.collectionsById.get(id)
  if (!collection) return fail("not_found", `collection ${id} not found`)
  const record = collection.owner === "catalog" ? p.records.collection.find((candidate) => candidate.id === id) : undefined
  return record ? Effect.succeed(record) : fail("forbidden", refusal(collection))
}

export const collectionActions = [
  read(
    "collections.membership",
    "Catalog-owned collections with how many of the given units each contains",
    Schema.Struct({ units: Schema.Array(Schema.String), q: optional(Schema.String) }),
    (input, env) => {
      const q = (input.q ?? "").toLowerCase()
      return Effect.succeed({
        collections: env.projection.collections
          .filter((collection) => collection.owner === "catalog" && `${collection.name} ${collection.category ?? ""} ${collection.tags.join(" ")}`.toLowerCase().includes(q))
          .sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || a.name.localeCompare(b.name))
          .map((collection) => ({
            id: collection.id,
            name: collection.name,
            category: collection.category ?? null,
            contains: input.units.filter((unit) => collection.members.some((member) => member.unit === unit)).length,
            revision: collection.revision
          }))
      })
    }
  ),
  write(
    "collection.create",
    "Create a collection; members are references to content units",
    Schema.Struct({
      name: Schema.String,
      id: optional(Text),
      kind: optional(Text),
      category: Schema.optionalKey(Schema.Unknown),
      tags: optional(Schema.Array(Schema.Unknown)),
      members: optional(Schema.Array(MemberInput))
    }),
    LOCK,
    (input, env) =>
      Effect.gen(function*() {
        const p = env.projection
        if (!isNonEmpty(input.name)) return yield* fail("invalid", "collection name is required")
        const prior = yield* priorRequest(p, "collection", env.requestId, env.requestBinding)
        if (prior) return { collection: prior, replayed: true }
        if (input.kind && !p.snapshot.schema.collectionKinds[input.kind]) return yield* fail("invalid", `unknown collection kind ${input.kind}`)
        // A named id must be free; a generated one gets a number until it is.
        let id = input.id ?? `col/${slug(input.name)}`
        for (let n = 2; p.collectionsById.has(id); n++) {
          if (input.id) return yield* fail("conflict", `collection ${input.id} already exists`)
          id = `col/${slug(input.name)}-${n}`
        }
        const members = toMembers(input.members ?? [])
        for (const member of members) if (!p.snapshot.unitsById.has(member.unit)) return yield* fail("not_found", `content ${member.unit} not found`)
        const record: CollectionRecord = {
          id,
          name: input.name.trim(),
          kind: input.kind ?? null,
          category: yield* cleanCategory(input.category),
          tags: input.tags ? yield* cleanTags(input.tags) : [],
          members,
          revision: 1,
          createdBy: env.actor,
          createdAt: yield* nowIso,
          ...requestFields(env)
        }
        const [created] = yield* (yield* Records).apply([{ type: "create", kind: "collection", record }])
        return { collection: created }
      })
  ),
  write(
    "collection.update",
    "Rename, reorder, add or remove members of a catalog-owned collection",
    Schema.Struct({
      id: Text,
      name: optional(Schema.String),
      members: optional(Schema.Array(MemberInput)),
      add: optional(Schema.Array(Text)),
      remove: optional(Schema.Array(Text)),
      expectedRevision: ExpectedRevision
    }),
    LOCK,
    (input, env) =>
      Effect.gen(function*() {
        const p = env.projection
        const record = yield* owned(p, input.id, (collection) => `${collection.name} is defined by the project's sources; change it in the project's own files`)
        let members = input.members ? toMembers(input.members) : [...record.members]
        for (const unit of input.add ?? []) if (!members.some((member) => member.unit === unit)) members = [...members, { unit }]
        if (input.remove) members = members.filter((member) => !input.remove!.includes(member.unit))
        // A member that was already there may have left the project since; only new ones must exist.
        for (const member of members) {
          if (!record.members.some((existing) => existing.unit === member.unit) && !p.snapshot.unitsById.has(member.unit)) return yield* fail("not_found", `content ${member.unit} not found`)
        }
        const next = { ...record, name: isNonEmpty(input.name) ? input.name.trim() : record.name, members }
        const [updated] = yield* (yield* Records).apply([{ type: "update", kind: "collection", record: next, expectedRevision: input.expectedRevision }])
        return { collection: updated }
      })
  ),
  write(
    "collection.delete",
    "Delete a catalog-owned collection (members are untouched)",
    Schema.Struct({ id: Text, expectedRevision: ExpectedRevision }),
    LOCK,
    (input, env) =>
      Effect.gen(function*() {
        const record = yield* owned(env.projection, input.id, (collection) => `${collection.name} is defined by the project's sources`)
        yield* (yield* Records).apply([{ type: "remove", kind: "collection", record, expectedRevision: input.expectedRevision }])
        return { deleted: input.id }
      })
  )
]
