// Schema atoms shared by every authored file and record.
import * as Schema from "effect/Schema"

/** Stable id of a recipe, step, check, provider, budget or adapter. */
export const Id = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, { message: "expected a lowercase id: letters, digits and single hyphens" })),
  Schema.check(Schema.isMaxLength(64))
)

/** What a run is about (an asset, a sound, a line). It names a folder, so it stays file-name safe. */
export const SubjectId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u, { message: "expected a file-name-safe id: letters, digits, dot, underscore, hyphen" })),
  Schema.check(Schema.isMaxLength(80))
)

export const Text = Schema.String.pipe(Schema.check(Schema.isPattern(/\S/u, { message: "expected text, not an empty string" })))

/** Project-relative path with forward slashes. */
export const PortablePath = Schema.String.pipe(
  // The same rule as `portableProblem` in the kernel, as a pattern so it reaches the JSON Schema.
  Schema.check(Schema.isPattern(/^(?![A-Za-z]:)(?!\/)(?!.*\\)(?!.*(?:^|\/)\.{0,2}(?:\/|$)).+$/u, {
    message: "expected a project-relative path with forward slashes and no . or .. parts"
  })),
  Schema.annotate({ description: "Project-relative path with forward slashes" })
)

export const Amount = Schema.Finite.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
export const PositiveInt = Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)))
export const Positive = Schema.Finite.pipe(Schema.check(Schema.isGreaterThan(0)))

/** A file as it was when recorded. */
export const Stamp = Schema.Struct({ path: PortablePath, sha256: Schema.String })
export type Stamp = typeof Stamp.Type

/** What a check or validation found, with what to do about it when that is known. */
export interface Problem {
  readonly message: string
  readonly fix?: string | undefined
}

export const problemText = (problem: Problem): string => (problem.fix === undefined ? problem.message : `${problem.message} (fix: ${problem.fix})`)
