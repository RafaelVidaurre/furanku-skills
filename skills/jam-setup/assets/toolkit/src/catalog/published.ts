// The catalog's authored and recorded files with the schemas that validate them, for the command
// that writes JSON Schemas (`jam schemas write`). Each entry is the schema the engine itself
// decodes with, so the published contract cannot drift from what the engine accepts.
import type * as Schema from "effect/Schema"
import { ConfigV2 } from "./CatalogConfig.ts"
import { CategoriesRecord, CollectionRecord, LabelRecord, NoteRecord, SubmissionRecord, VerdictRecord } from "./records/schemas.ts"

export interface PublishedSchema {
  /** File name under the toolkit's `schemas/` folder. */
  readonly file: string
  readonly schema: Schema.Top
}

export const publishedSchemas: ReadonlyArray<PublishedSchema> = [
  { file: "catalog.config.schema.json", schema: ConfigV2 },
  { file: "catalog-note.schema.json", schema: NoteRecord },
  { file: "catalog-label.schema.json", schema: LabelRecord },
  { file: "catalog-collection.schema.json", schema: CollectionRecord },
  { file: "catalog-categories.schema.json", schema: CategoriesRecord },
  { file: "catalog-submission.schema.json", schema: SubmissionRecord },
  { file: "catalog-verdict.schema.json", schema: VerdictRecord }
]
