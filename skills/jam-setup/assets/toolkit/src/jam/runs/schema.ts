// The run record (run.json): one attempt of a recipe for one subject. Written only by the tool.
import * as Schema from "effect/Schema"
import { Amount, Id, PortablePath, PositiveInt, Stamp, SubjectId } from "../common.ts"
import { EngineAsset } from "../engine/schema.ts"

const opt = Schema.optionalKey
const Size = Schema.Tuple([Schema.Int, Schema.Int])

export const FileEntry = Schema.Struct({
  role: Id,
  key: opt(Id),
  path: PortablePath,
  sha256: Schema.String,
  size: opt(Size.pipe(Schema.annotate({ description: "Pixel width and height, measured, for images" })))
})
export type FileEntry = typeof FileEntry.Type

export const Evidence = Schema.Struct({ label: opt(Id), path: PortablePath, sha256: Schema.String })
export type Evidence = typeof Evidence.Type

export const DECISIONS = ["accept", "revise", "reject"] as const
export type Decision = typeof DECISIONS[number]

export const Review = Schema.Struct({
  decision: Schema.Literals(DECISIONS),
  actor: Schema.Literals(["human", "agent"]),
  via: Schema.Literals(["direct", "relay", "catalog", "v1"]).pipe(Schema.annotate({
    description: "direct: decided by whoever ran the command. relay: an agent recording a person's words. catalog: the person's own decision in the catalog. v1: carried over from a version 1 record."
  })),
  reason: Schema.String,
  by: opt(Schema.String),
  channel: opt(Schema.String.pipe(Schema.annotate({ description: "For a relay: where the person answered" }))),
  words: opt(Schema.String.pipe(Schema.annotate({ description: "For a relay: what the person said, verbatim" }))),
  submission: opt(Schema.String),
  at: Schema.String
})
export type Review = typeof Review.Type

export const Provenance = Schema.Struct({
  kind: Schema.Literals(["tool", "job", "imported"]),
  tool: opt(Schema.String),
  job: opt(Schema.String),
  run: opt(Schema.String.pipe(Schema.annotate({ description: "For a job of another run: that run as <id>:<n>" }))),
  provider: opt(Schema.String),
  source: opt(Schema.String),
  sourceEvidence: opt(PortablePath)
})
export type Provenance = typeof Provenance.Type

export const Metrics = Schema.Struct({
  model: opt(PortablePath),
  basis: opt(Schema.Literals(["measured", "report"]).pipe(Schema.annotate({
    description: "measured: decoded by the tool. report: taken from a measurement report bound to the model's hash."
  }))),
  triangles: opt(Schema.Finite),
  materials: opt(Schema.Finite),
  exportedVertices: opt(Schema.Finite),
  drawPrimitives: opt(Schema.Finite),
  textureDimensions: opt(Schema.Array(Size)),
  textureMiB: opt(Schema.Finite),
  memoryBasis: opt(Schema.String),
  ignoredExtensions: opt(Schema.Array(Schema.String))
})
export type Metrics = typeof Metrics.Type

/** A request for a person's review in the catalog. */
export const Submission = Schema.Struct({
  id: Schema.String,
  route: Schema.String.pipe(Schema.annotate({ description: "Where the review is in the catalog: the page's address after the server, the same on every machine" })),
  at: Schema.String
})

export const StepRecord = Schema.Struct({
  id: Schema.String,
  at: Schema.String,
  files: Schema.Array(FileEntry),
  inputs: Schema.Array(Stamp),
  evidence: Schema.Array(Evidence),
  dependencies: Schema.Record(Schema.String, Schema.String).pipe(Schema.annotate({
    description: "The exact record of each needed step this one was built on, or \"skipped\""
  })),
  entry: opt(Schema.Literal("imported").pipe(Schema.annotate({
    description: "The work entered the run here from outside, with origin evidence, so earlier steps were not needed"
  }))),
  note: Schema.String,
  provenance: opt(Provenance),
  metrics: opt(Metrics),
  symmetric: opt(Schema.Boolean),
  checks: Schema.Array(Schema.Struct({ id: Schema.String, at: Schema.String })),
  engineAssets: opt(Schema.Array(EngineAsset)),
  arguments: opt(Schema.Array(Schema.String).pipe(Schema.annotate({ description: "Arguments given to the engine adapter's command that performed the step, files left out" }))),
  submission: opt(Submission),
  reviews: Schema.Array(Review)
})
export type StepRecord = typeof StepRecord.Type

export const StepLog = Schema.Struct({
  records: Schema.Array(StepRecord),
  skip: opt(Schema.Struct({
    reason: Schema.String,
    at: Schema.String,
    auto: opt(Schema.Boolean.pipe(Schema.annotate({ description: "Skipped because the step's condition did not hold, not by a person's or agent's choice" })))
  }))
})
export type StepLog = typeof StepLog.Type

/** open: intent recorded, not yet sent. lost: sent, response lost. not-submitted: confirmed never created. */
export const JOB_STATES = ["open", "lost", "submitted", "succeeded", "failed", "cancelled", "not-submitted"] as const
export type JobState = typeof JOB_STATES[number]

export const Job = Schema.Struct({
  id: Schema.String,
  step: Schema.String,
  provider: Schema.String,
  operation: Schema.String,
  request: Stamp,
  estimate: Amount,
  unit: Schema.String,
  price: Schema.Struct({ kind: Schema.Literals(["quote", "list", "estimate"]), source: Schema.String, date: Schema.String }),
  authorization: Schema.String,
  transport: opt(Schema.String),
  scope: opt(Schema.String),
  state: Schema.Literals(JOB_STATES),
  providerJob: opt(Schema.String),
  actual: opt(Amount),
  created: Schema.String,
  history: Schema.Array(Schema.Struct({
    state: Schema.Literals(JOB_STATES),
    at: Schema.String,
    evidence: opt(Schema.String),
    providerJob: opt(Schema.String),
    actual: opt(Amount)
  }))
})
export type Job = typeof Job.Type

export const Run = Schema.Struct({
  $schema: opt(Schema.String),
  version: Schema.Literal(2),
  id: SubjectId,
  n: PositiveInt.pipe(Schema.annotate({ description: "Which attempt for this subject this is" })),
  recipe: Id,
  budget: Schema.NullOr(Id),
  created: Schema.String,
  brief: Stamp,
  style: Schema.Struct({ revision: Schema.NullOr(Schema.String) }),
  human: Schema.Array(Id).pipe(Schema.annotate({ description: "Steps this run requires a person to accept, whatever the recipe or review mode says" })),
  entry: opt(Id.pipe(Schema.annotate({ description: "The step this run starts at, from existing work; the steps before it are not needed" }))),
  steps: Schema.Record(Schema.String, StepLog),
  jobs: Schema.Array(Job),
  delivered: opt(Schema.Struct({ at: Schema.String, from: PortablePath, files: Schema.Int })),
  deliveredTo: opt(PortablePath),
  migratedFrom: opt(Schema.Literal(1))
}).pipe(Schema.annotate({ identifier: "Run", title: "Run record (run.json). Written by the tool; do not edit by hand." }))
export type Run = typeof Run.Type

export const latestRecord = (run: Run, step: string): StepRecord | undefined => run.steps[step]?.records.at(-1)

/** `<id>:<n>`, the way one run names another. */
export const runKey = (run: { readonly id: string; readonly n: number }): string => `${run.id}:${run.n}`

/** Job states that still hold their estimate and block a second submission of the same request. */
export const UNRESOLVED: ReadonlyArray<JobState> = ["open", "lost", "submitted"]
