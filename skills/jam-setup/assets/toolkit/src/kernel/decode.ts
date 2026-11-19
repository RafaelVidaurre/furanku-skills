// Decoding authored files and command input with Effect Schema, reporting every problem at once in
// words a person or agent can act on.
import * as Effect from "effect/Effect"
import * as JsonSchema from "effect/JsonSchema"
import * as Schema from "effect/Schema"
import { type ErrorCode, type ToolError, toolError } from "./errors.ts"

export interface DecodeOptions {
  /** What is being read, for the message: "jam.config.json", "recipe prop", "input of review.decide". */
  readonly what: string
  readonly code?: ErrorCode
  readonly fix?: string
  /** Refuse fields the schema does not name (default true: a typo should not pass silently). */
  readonly strict?: boolean
}

/** Turn "Expected X\n  at [\"a\"][0]" blocks into "a[0]: expected X". */
const readable = (message: string): ReadonlyArray<string> => {
  const lines = message.split("\n")
  const out: Array<string> = []
  for (let i = 0; i < lines.length; i++) {
    const text = (lines[i] ?? "").trim()
    if (text === "") continue
    const at = /^at (.+)$/.exec((lines[i + 1] ?? "").trim())
    if (at) {
      i++
      const path = (at[1] ?? "").replace(/\["([^"]+)"\]/g, ".$1").replace(/^\./, "")
      out.push(`${path}: ${text.charAt(0).toLowerCase()}${text.slice(1)}`)
    } else out.push(text)
  }
  return out
}

/** Decode an unknown value, failing with a ToolError that lists each problem with its field path. */
export const decode = <S extends Schema.Top>(schema: S, options: DecodeOptions) =>
(value: unknown): Effect.Effect<S["Type"], ToolError, S["DecodingServices"]> =>
  Schema.decodeUnknownEffect(schema)(value, { errors: "all", onExcessProperty: options.strict === false ? "ignore" : "error" }).pipe(
    Effect.mapError((error) => {
      const problems = readable(error.message)
      return toolError(options.code ?? "invalid", `${options.what}: ${problems.join("; ")}`, { fix: options.fix, details: { problems } })
    })
  )

/**
 * A publishable JSON Schema (draft 2020-12) for an authored file. `strict` closes every object, as
 * decoding with unknown fields refused does; without it objects stay open.
 */
export const jsonSchemaOf = (schema: Schema.Top, id?: string, options?: { readonly strict?: boolean }): Record<string, unknown> => {
  const document = Schema.toJsonSchemaDocument(schema, options?.strict === true ? { onExcessProperty: "error" } : undefined)
  return {
    $schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12,
    ...(id === undefined ? {} : { $id: id }),
    ...document.schema,
    ...(Object.keys(document.definitions).length > 0 ? { $defs: document.definitions } : {})
  }
}
