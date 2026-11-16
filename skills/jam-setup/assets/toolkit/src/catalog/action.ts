// What an action is. Every operation of the catalog, for people and for agents, is one of these:
// a name, an input schema and a handler. The same definitions serve the CLI, HTTP and the browser,
// so there is one place where an operation is validated and one place where it is described.
import * as Effect from "effect/Effect"
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

export interface ActionDef {
  readonly name: string
  readonly kind: "read" | "write"
  readonly description: string
  readonly input: Schema.Top
  /** The record lock a write holds while it runs; the projection is read after it is taken. */
  readonly lock?: ((input: never) => string) | undefined
  run(input: never, env: WriteEnv): Effect.Effect<unknown, ToolError, ActionServices>
}

export const read = <S extends Schema.Top>(
  name: string,
  description: string,
  input: S,
  run: (input: S["Type"], env: ReadEnv) => Effect.Effect<unknown, ToolError, ActionServices>
): ActionDef => ({ name, kind: "read", description, input, run: run as ActionDef["run"] })

export const write = <S extends Schema.Top>(
  name: string,
  description: string,
  input: S,
  lock: string | ((input: S["Type"]) => string) | null,
  run: (input: S["Type"], env: WriteEnv) => Effect.Effect<unknown, ToolError, ActionServices>
): ActionDef => ({ name, kind: "write", description, input, lock: (lock === null ? undefined : typeof lock === "string" ? () => lock : lock) as ActionDef["lock"], run: run as ActionDef["run"] })

// ---- Schema pieces shared by action inputs

/** An optional field. JSON clients send `null` for "not given", so both forms are accepted. */
export const optional = <S extends Schema.Top>(schema: S) => Schema.optionalKey(Schema.NullOr(schema))
export const Text = Schema.String.check(Schema.isNonEmpty())
export const Page = { page: optional(Schema.Finite), pageSize: optional(Schema.Finite) }
export const Empty = Schema.Struct({})
export const targetOf = <const K extends ReadonlyArray<string>>(kinds: K) => Schema.Struct({ kind: Schema.Literals(kinds), id: Text })
export const UnitOrCollection = targetOf(["unit", "collection"])
export const ExpectedRevision = optional(Schema.Int).annotate({ description: "The revision that was read; a stale value fails with conflict" })

export const requestFields = (env: WriteEnv): { requestId?: string; requestBinding?: RequestBinding } =>
  env.requestId !== null && env.requestBinding ? { requestId: env.requestId, requestBinding: env.requestBinding } : {}

/**
 * A committed record carrying this request id. Records outlive the local replay journal, so their
 * binding must still match: the same id for another action, input, actor or checkout is refused.
 */
export const priorRequest = <K extends "note" | "collection" | "submission" | "verdict">(
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
        return yield* fail("conflict", "request id was already used for a different action, input, actor or checkout context", { fix: "use a new request id for a new request" })
      }
    }
    return matches[0] as RecordsByKind[K] | undefined
  })

/** Uncommitted changes outside .catalog, recorded with a submission. Runs `git status`. */
export const dirtyCount: Effect.Effect<number, never, Git> = Effect.flatMap(Git, (git) => git.dirtyCount([".catalog/"]))
