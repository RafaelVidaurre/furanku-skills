// Rendering of the JSON Schemas the toolkit publishes. Each comes from the Effect Schema that also
// validates the file, so the published contract cannot drift from what the tool accepts.
import type * as Schema from "effect/Schema"
import { jsonSchemaOf } from "../kernel/decode.ts"
import { isRecord } from "../kernel/hash.ts"

export interface Published {
  /** File name under the toolkit's `schemas/` folder. */
  readonly file: string
  readonly schema: Schema.Top
}

// Authored files are decoded strictly, so the published schema refuses unknown fields too.
const closed = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(closed)
  if (!isRecord(node)) return node
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) out[key] = closed(value)
  if (isRecord(out["properties"]) && out["additionalProperties"] === true) out["additionalProperties"] = false
  return out
}

export const renderSchema = (entry: Published): string => {
  const document = closed(jsonSchemaOf(entry.schema, entry.file))
  return `${JSON.stringify(document, null, 2)}\n`
}
