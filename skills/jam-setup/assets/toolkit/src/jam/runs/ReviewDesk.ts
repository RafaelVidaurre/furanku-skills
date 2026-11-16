// The seam between run gates and wherever a person reviews work. The catalog provides the real
// desk (src/jam/catalog/desk.ts); without it a human gate is satisfied only by an honestly
// labelled relay.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { fail, type ToolError } from "../../kernel/errors.ts"
import type { ResolvedStep } from "../recipes/schema.ts"
import type { RunContext } from "./Runs.ts"
import type { StepRecord } from "./schema.ts"

/** Where a person opens a review. */
export interface ReviewLink {
  /** The page's address after the server (`#/reviews/s/<id>`): the same on every machine, so it is what a run stores. */
  readonly route: string
  /** The full address, while a catalog server is running for this checkout. */
  readonly url?: string
  /** Without a server: how to get one. */
  readonly hint?: string
}

/** A review a person was asked for, and where they open it. */
export interface ReviewRequest extends ReviewLink {
  readonly submission: string
  /** Who is expected to decide, when the desk knows. */
  readonly reviewer?: string
}

export type Verdict =
  /** No decision by a person yet. `request` says where it can be opened now. */
  | { readonly state: "pending"; readonly request?: ReviewRequest }
  /** A person approved every part that was submitted. */
  | { readonly state: "accepted"; readonly by: string; readonly comment?: string; readonly relay?: Relayed }
  /** A person sent it back, in their words. `rejected`: they rejected it outright. */
  | { readonly state: "returned"; readonly by: string; readonly reason: string; readonly rejected: boolean; readonly relay?: Relayed }

/** The decision reached the catalog through an agent: where the person gave it, and their words. */
export interface Relayed {
  readonly channel: string
  readonly words: string
}

export const PENDING: Verdict = { state: "pending" }

export class ReviewDesk extends Context.Service<ReviewDesk, {
  /**
   * Put a step's record in front of a person. The request id is `jam:<record id>`, so submitting
   * the same record twice returns the same submission.
   */
  submit(run: RunContext, step: ResolvedStep, record: StepRecord): Effect.Effect<ReviewRequest, ToolError>
  /** What a person decided. An agent's verdict never counts. */
  verdict(submission: string): Effect.Effect<Verdict, ToolError>
}>()("jam/ReviewDesk") {
  /** No desk: the catalog bridge is not part of this build or not connected. */
  static readonly layerNone: Layer.Layer<ReviewDesk> = Layer.succeed(ReviewDesk, {
    submit: (run, step) =>
      fail("unavailable", `the catalog review bridge is not connected, so ${run.ref.run.id} ${step.id} cannot be submitted for review in the browser`, {
        fix: `ask the person directly and record their answer: jam run review ${run.ref.run.id} ${step.id} --accept --relay "<where they answered>: <their words>"`
      }),
    verdict: () => fail("unavailable", "the catalog review bridge is not connected, so no verdict can be read")
  })
}

export const requestIdOf = (record: StepRecord): string => `jam:${record.id}`
