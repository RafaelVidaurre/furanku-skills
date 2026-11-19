// What an action is. Every operation of the catalog, for people and for agents, is one of these:
// a name, an input schema and a handler. The same definitions serve the CLI, HTTP and the browser,
// so there is one place where an operation is validated and one place where it is described.
import * as Effect from "effect/Effect"
import * as JsonSchema from "effect/JsonSchema"
import * as Schema from "effect/Schema"
import { fail, type ToolError } from "../kernel/errors.ts"
import { type Checkout, Git } from "../kernel/Git.ts"
import { digest } from "../kernel/hash.ts"
import type { Ids } from "../kernel/Ids.ts"
import type { ProjectFiles } from "../kernel/ProjectFiles.ts"
import type { Evidence } from "./Evidence.ts"
import type { Facts } from "./Facts.ts"
import type { MediaKinds } from "./MediaKinds.ts"
import type { Actor, RecordKind, RecordsByKind, RequestBinding } from "./model/types.ts"
import type { Projection } from "./Projection.ts"
import type { Records } from "./Records.ts"

/** The services a handler may use. They are provided once, where the registry is built. */
export type ActionServices = Records | Evidence | Facts | MediaKinds | Ids | Git | ProjectFiles

export interface ReadEnv {
  /** The one view of the project this action reads. */
  readonly projection: Projection
  /** The checkout as it is now. Runs Git (never `git status`), so only actions that report it ask. */
  readonly currentCheckout: Effect.Effect<Checkout>
  /** Who a browser user is taken to be: the local Git user. */
  readonly defaultActor: Actor
  /** Run another action as part of this one. From a read, only reads. */
  run(action: string, input?: unknown): Effect.Effect<unknown, ToolError>
  /** Run a read action, whatever this action is: what code that must not write is handed (plugin checks). */
  runRead(action: string, input?: unknown): Effect.Effect<unknown, ToolError>
  /**
   * A new projection, for the rare action that changes project files and must report the state
   * after them (`doctor.fix`). Everything else reads `projection` only.
   */
  readonly refresh: Effect.Effect<Projection, ToolError>
}

export interface WriteEnv extends ReadEnv {
  readonly actor: Actor
  /** The checkout this write was checked against. */
  readonly checkout: Checkout
  readonly requestId: string | null
  /** What a request id is bound to; stored on created records so a lost journal cannot replay it elsewhere. */
  readonly requestBinding: RequestBinding | undefined
}

/**
 * An action's input or output as published (JSON Schema draft 2020-12): closed, as decoding
 * refuses unknown fields.
 */
export const publishedSchema = (schema: Schema.Top): Record<string, unknown> => {
  const document = Schema.toJsonSchemaDocument(schema, { onExcessProperty: "error" })
  return {
    $schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12,
    ...document.schema,
    ...(Object.keys(document.definitions).length > 0 ? { $defs: document.definitions } : {})
  }
}

/** Whether an action changes records or project files (`write`, which declares an actor) or only reads. */
export type Access = "read" | "write"

/** What an action needs besides its input: a declared actor (writes), or a running catalog server (viewer actions). */
export type Requirement = "actor" | "server"

/** What `discover` publishes for one action. */
export interface ActionInfo {
  readonly name: string
  readonly access: Access
  readonly requires: ReadonlyArray<Requirement>
  readonly description: string
  /** JSON Schema (draft 2020-12) of the input object. */
  readonly input: Record<string, unknown>
  /** JSON Schema (draft 2020-12) of the result; absent for a plugin action that declares none. */
  readonly output?: Record<string, unknown>
  /** The plugin that contributes the action; absent for built-in ones. */
  readonly plugin?: string
}

const requirementsOf = (access: Access): ReadonlyArray<Requirement> => (access === "write" ? ["actor"] : [])

/**
 * One action as `discover` lists it. `requires` defaults to what its access needs; `output`
 * replaces the definition's (`null`: none is published).
 */
export const infoOf = (
  def: { readonly name: string; readonly access: Access; readonly description: string; readonly input: Schema.Top; readonly output?: Schema.Top | undefined },
  extra: { readonly requires?: ReadonlyArray<Requirement>; readonly plugin?: string; readonly output?: Schema.Top | null } = {}
): ActionInfo => {
  const output = extra.output === undefined ? def.output : extra.output
  return {
    name: def.name,
    access: def.access,
    requires: extra.requires ?? requirementsOf(def.access),
    description: def.description,
    input: publishedSchema(def.input),
    ...(output == null ? {} : { output: publishedSchema(output) }),
    ...(extra.plugin === undefined ? {} : { plugin: extra.plugin })
  }
}

export interface ActionDef {
  readonly name: string
  readonly access: Access
  readonly description: string
  readonly input: Schema.Top
  /** What the action returns to its caller; decoded strictly when `CatalogOutputCheck` is on. */
  readonly output: Schema.Top
  /** The record lock a write holds while it runs; the projection is read after it is taken. */
  readonly lock?: ((input: never) => string) | undefined
  run(input: never, env: WriteEnv): Effect.Effect<unknown, ToolError, ActionServices>
}

/** An action definition that keeps its name and schemas in its type, so `actionMap.ts` derives the typed map from the definitions. */
export interface TypedActionDef<N extends string, I extends Schema.Top, O extends Schema.Top> extends ActionDef {
  readonly name: N
  readonly input: I
  readonly output: O
}

// A handler's result is checked against `output` at run time (`CatalogOutputCheck`), not by type:
// results are assembled from projections whose TypeScript types are wider than the published shape.
export const read = <const N extends string, S extends Schema.Top, O extends Schema.Top>(
  name: N,
  description: string,
  input: S,
  output: O,
  run: (input: S["Type"], env: ReadEnv) => Effect.Effect<unknown, ToolError, ActionServices>
): TypedActionDef<N, S, O> => ({ name, access: "read", description, input, output, run: run as ActionDef["run"] })

export const write = <const N extends string, S extends Schema.Top, O extends Schema.Top>(
  name: N,
  description: string,
  input: S,
  output: O,
  lock: string | ((input: S["Type"]) => string) | null,
  run: (input: S["Type"], env: WriteEnv) => Effect.Effect<unknown, ToolError, ActionServices>
): TypedActionDef<N, S, O> => ({ name, access: "write", description, input, output, lock: (lock === null ? undefined : typeof lock === "string" ? () => lock : lock) as ActionDef["lock"], run: run as ActionDef["run"] })

// ---- Schema pieces shared by action inputs

/** An optional field. JSON clients send `null` for "not given", so both forms are accepted. */
export const optional = <S extends Schema.Top>(schema: S) => Schema.optionalKey(Schema.NullOr(schema))
export const Text = Schema.String.check(Schema.isNonEmpty())
export const Page = { page: optional(Schema.Finite), pageSize: optional(Schema.Finite) }
/** The input of an action that takes none: an object with no fields. (`Schema.Struct({})` would accept anything but null.) */
export const Empty = Schema.Record(Schema.String, Schema.Never.annotate({ message: "this action takes no fields" }))
const RefMembers = {
  item: optional(Text).annotate({ description: "A submission item id (with kind submission)" }),
  part: optional(Text).annotate({ description: "A part id of the unit, collection or submission item" }),
  leaf: optional(Text).annotate({ description: "One evidence leaf inside a member or preview part: <unit>/<part>, or base" })
}
type RefMember = keyof typeof RefMembers

/**
 * A reference to what an input addresses: `{ kind, id, item?, part?, leaf? }`, closed, with the
 * kinds and optional members the action accepts. Parts stay strings.
 */
export const refOf = <const K extends ReadonlyArray<"unit" | "collection" | "asset" | "submission">, const M extends { readonly [P in RefMember]?: boolean } = {}>(
  kinds: K,
  members: M = {} as M
) =>
  Schema.Struct({
    kind: Schema.Literals(kinds),
    id: Text,
    ...(Object.fromEntries((Object.keys(RefMembers) as Array<RefMember>).filter((key) => members[key] === true).map((key) => [key, RefMembers[key]])) as {
      readonly [P in RefMember as M[P] extends true ? P : never]: (typeof RefMembers)[P]
    })
  })
export const ExpectedRevision = optional(Schema.Int).annotate({ description: "The revision that was read; a stale value fails with conflict" })

export const requestFields = (env: WriteEnv): { requestId?: string; requestBinding?: RequestBinding } =>
  env.requestId !== null && env.requestBinding ? { requestId: env.requestId, requestBinding: env.requestBinding } : {}

/**
 * A committed record carrying this request id. Records outlive the local replay journal, so their
 * binding must still match: the same id for another action, input, actor or checkout is refused.
 */
export const priorRequest = <K extends "note" | "collection" | "submission" | "decision">(
  p: Projection,
  kind: K,
  requestId: string | null,
  binding: RequestBinding | undefined,
  field: "requestId" | "lastRequestId" = "requestId"
): Effect.Effect<RecordsByKind[K] | undefined, ToolError> =>
  Effect.gen(function*() {
    if (requestId === null) return undefined
    const bindingField = field === "lastRequestId" ? "lastRequestBinding" : "requestBinding"
    const matches = (p.records[kind as RecordKind] as unknown as ReadonlyArray<Record<string, unknown>>).filter((record) => record[field] === requestId)
    for (const prior of matches) {
      // A record from before bindings were recorded matches no binding, so its id is never replayed.
      if (prior[bindingField] == null || digest(prior[bindingField]) !== digest(binding)) {
        return yield* fail("conflict", "request id was already used for a different action, input, actor or checkout", { fix: "use a new request id for a new request" })
      }
    }
    return matches[0] as RecordsByKind[K] | undefined
  })

/** Uncommitted changes outside .catalog, recorded with a submission. Runs `git status`. */
export const dirtyCount: Effect.Effect<number, never, Git> = Effect.flatMap(Git, (git) => git.dirtyCount([".catalog/"]))
