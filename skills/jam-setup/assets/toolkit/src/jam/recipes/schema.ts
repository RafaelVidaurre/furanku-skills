// A recipe: a named, ordered set of steps that turns a brief into delivered content.
import * as Schema from "effect/Schema"
import { Id, PortablePath, PositiveInt, Text } from "../common.ts"

const opt = Schema.optionalKey

export const MEDIA_KINDS = ["image", "model", "audio", "video", "text", "data", "any"] as const
export type MediaKind = typeof MEDIA_KINDS[number]

export const GATES = ["human", "agent", "none"] as const
export type Gate = typeof GATES[number]

export const Produces = Schema.Struct({
  role: Id.pipe(Schema.annotate({ description: "What the file is for, e.g. concept, view, model" })),
  kind: Schema.Literals(MEDIA_KINDS),
  min: opt(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)), Schema.annotate({ description: "Fewest files with this role (default 1)" }))),
  max: opt(PositiveInt),
  keys: opt(Schema.NonEmptyArray(Id).pipe(Schema.annotate({ description: "Exactly one file per key, e.g. the named views of a turnaround" })))
})
export type Produces = typeof Produces.Type

/** When a step applies. Every part given must hold. */
export const Condition = Schema.Struct({
  engine: opt(Id.pipe(Schema.annotate({ description: "The project's engine adapter provides this command: import, inspect, conform-skeleton, or one of the adapter's own" }))),
  kind: opt(Id.pipe(Schema.annotate({ description: "With engine: that command takes this kind, e.g. {\"engine\": \"import\", \"kind\": \"animation\"} (an adapter command's kinds field says which it takes)" }))),
  budget: opt(Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.annotate({ description: "The run's budget has these field values, e.g. {\"kind\": \"deforming\"}" })))
}).pipe(
  // Annotations go before the check: one given after it is not published in the JSON schema.
  Schema.annotate({ description: "The step applies only when this holds; otherwise it is skipped automatically and later steps treat it as satisfied" }),
  Schema.check(Schema.makeFilter((condition) => (condition.kind !== undefined && condition.engine === undefined ? "kind needs engine: the command whose kinds it is" : undefined))))
export type Condition = typeof Condition.Type

export const Step = Schema.Struct({
  id: Id,
  title: opt(Text),
  skill: opt(Text.pipe(Schema.annotate({ description: "The skill that knows how to do the step" }))),
  guide: opt(Text.pipe(Schema.annotate({
    description: "Document with the step's instructions and an optional #anchor: a project-relative path, or toolkit:<path> for one the toolkit ships"
  }))),
  run: opt(Schema.NonEmptyArray(Schema.String).pipe(Schema.annotate({
    description: "The jam command that does the step. {id}, {run} and {dir} are substituted; parts in <angle brackets> are for the caller to fill in. Paid calls it makes go through the ledger by themselves."
  }))),
  needs: opt(Schema.Array(Id).pipe(Schema.annotate({ description: "Steps that must be accepted (or skipped, when optional) first" }))),
  produces: opt(Schema.Array(Produces)),
  checks: opt(Schema.Array(Id).pipe(Schema.annotate({ description: "Named checks that must pass when the step is recorded" }))),
  review: opt(Schema.Literals(GATES).pipe(Schema.annotate({ description: "Who must accept the step (default agent)" }))),
  reviewer: opt(Text.pipe(Schema.annotate({
    description: "Who decides a human gate, as a person or a role (\"art lead\", \"audio director\"). Shown wherever the step waits for review; the catalog records who actually decided."
  }))),
  paid: opt(Schema.Boolean.pipe(Schema.annotate({ description: "The step may open provider jobs" }))),
  maxJobs: opt(PositiveInt.pipe(Schema.annotate({ description: "Most provider jobs the step may open in one run" }))),
  optional: opt(Schema.Boolean.pipe(Schema.annotate({ description: "The step may be skipped with a recorded reason" }))),
  when: opt(Condition),
  remove: opt(Schema.Boolean.pipe(Schema.annotate({ description: "In an extending recipe: drop the inherited step with this id" }))),
  after: opt(Id.pipe(Schema.annotate({ description: "In an extending recipe: place the step after this one (default: at the end)" })))
})
export type Step = typeof Step.Type

export const Recipe = Schema.Struct({
  $schema: opt(Schema.String),
  version: Schema.Literal(1),
  id: Id,
  title: opt(Text),
  description: opt(Schema.String),
  when: opt(Text.pipe(Schema.annotate({ description: "One or two sentences: which requests this recipe is for. Shown by `jam recipe list`." }))),
  extends: opt(Schema.String.pipe(
    Schema.check(Schema.isPattern(/^(?:builtin:)?[a-z0-9]+(?:-[a-z0-9]+)*$/u, { message: "expected a recipe id, or builtin:<id> for one the toolkit ships" })),
    Schema.annotate({ description: "Base recipe whose steps this one inherits: builtin:<id> or a project recipe id" })
  )),
  budget: opt(Id.pipe(Schema.annotate({ description: "Budget in jam.config.json that runs of this recipe use unless they name another" }))),
  roots: opt(Schema.Struct({ scratch: opt(PortablePath), delivered: opt(PortablePath) }).pipe(Schema.annotate({
    description: "Where runs of this recipe work and deliver, when not the project's roots"
  }))),
  style: opt(Schema.Boolean.pipe(Schema.annotate({ description: "Runs need the project's style document to be set" }))),
  deliverable: opt(Schema.Boolean.pipe(Schema.annotate({ description: "false for exploration and tests: results are never delivered or reused as paid results" }))),
  catalog: opt(Schema.Struct({
    scope: opt(Id.pipe(Schema.annotate({ description: "Catalog scope the subjects are listed under (default: material)" })))
  }).pipe(Schema.annotate({ description: "How subjects made with this recipe appear in the content catalog" }))),
  steps: Schema.Array(Step)
}).pipe(Schema.annotate({ identifier: "Recipe", title: "Recipe (jam/recipes/<id>.json)" }))
export type Recipe = typeof Recipe.Type

/** A step with inheritance applied and defaults filled in. */
export interface ResolvedStep {
  readonly id: string
  readonly title: string
  readonly skill?: string
  readonly guide?: string
  /** Guides of base recipes this step's own guide was layered over, nearest base first. Followed after `guide`. */
  readonly baseGuides: ReadonlyArray<string>
  readonly run?: ReadonlyArray<string>
  readonly needs: ReadonlyArray<string>
  readonly produces: ReadonlyArray<Produces>
  readonly checks: ReadonlyArray<string>
  readonly review: Gate
  readonly reviewer?: string
  readonly paid: boolean
  readonly maxJobs?: number
  readonly optional: boolean
  readonly when?: Condition
  /** Which recipe file each field came from: `builtin:<id>` or `project:<id>`. */
  readonly origin: Readonly<Record<string, string>>
}

export interface ResolvedRecipe {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly when?: string
  readonly budget?: string
  readonly roots: { readonly scratch?: string; readonly delivered?: string }
  readonly style: boolean
  readonly deliverable: boolean
  /** How subjects made with this recipe appear in the content catalog. */
  readonly catalog: { readonly scope?: string }
  readonly steps: ReadonlyArray<ResolvedStep>
  /** `builtin:<id>` or `project:<id>` of the file the recipe was asked for, then its bases. */
  readonly chain: ReadonlyArray<string>
}
