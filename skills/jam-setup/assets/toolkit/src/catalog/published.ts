// The catalog's authored and recorded files with the schemas that validate them, for the command
// that writes JSON Schemas (`jam schemas write`). Each entry is the schema the engine itself
// decodes with, so the published contract cannot drift from what the engine accepts: the
// configuration is decoded strictly, records with unknown fields ignored (forward compatibility).
import type * as Schema from "effect/Schema"
import { CatalogConfigFile } from "./CatalogConfig.ts"
import { CategoriesRecord, CollectionRecord, DecisionRecord, NoteRecord, OrganizationRecord, SubmissionRecord } from "./records/schemas.ts"

export interface PublishedSchema {
  /** File name under the toolkit's `schemas/` folder. */
  readonly file: string
  readonly schema: Schema.Top
  /** Whether the engine refuses unknown fields in this file, so the published schema is closed to match. */
  readonly strict: boolean
}

export const publishedSchemas: ReadonlyArray<PublishedSchema> = [
  { file: "catalog.config.schema.json", schema: CatalogConfigFile, strict: true },
  { file: "catalog-note.schema.json", schema: NoteRecord, strict: false },
  { file: "catalog-organization.schema.json", schema: OrganizationRecord, strict: false },
  { file: "catalog-collection.schema.json", schema: CollectionRecord, strict: false },
  { file: "catalog-categories.schema.json", schema: CategoriesRecord, strict: false },
  { file: "catalog-submission.schema.json", schema: SubmissionRecord, strict: false },
  { file: "catalog-decision.schema.json", schema: DecisionRecord, strict: false }
]
