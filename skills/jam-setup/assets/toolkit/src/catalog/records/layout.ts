// Where each record kind lives under .catalog and what identifies a record. Projects carry these
// files in Git; `.catalog/format.json` names the layout, and `jam catalog migrate` moves an older
// one to it.
import { sha256 } from "../../kernel/hash.ts"
import type { AnyRecord, CollectionRecord, DecisionRecord, NoteRecord, OrganizationRecord, RecordKind, SubmissionRecord } from "../model/types.ts"

export const RECORDS_DIR = ".catalog"
export const LOCAL_DIR = ".catalog/.local"
/** The tracked marker naming the layout of .catalog: `{ "format": 2 }`. */
export const FORMAT_FILE = ".catalog/format.json"
/** The layout this toolkit reads and writes. Format 1 (before the marker existed) had no marker. */
export const FORMAT = 2
export const FORMAT_TEXT = `${JSON.stringify({ format: FORMAT }, null, 2)}\n`
export const GITIGNORE = "# Machine-local catalog state: locks, request journal, captures.\n.local/\n"
/** Written inside .catalog/.local so the folder ignores itself without touching any tracked file. */
export const LOCAL_GITIGNORE = "# Machine-local catalog state; never committed.\n*\n"
/** A stored evidence blob: `.catalog/evidence/<aa>/<sha256>[.<ext>]`. */
export const EVIDENCE_PATH = /^\.catalog\/evidence\/([0-9a-f]{2})\/([0-9a-f]{64})(\.[a-z0-9]{1,8})?$/

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "x"
/** A file name for an arbitrary key: readable, and unique through a hash of the whole key. */
export const fileKey = (key: string): string => `${slug(key)}-${sha256(key).slice(0, 10)}`

export interface KindLayout<R> {
  /** Path below .catalog. */
  file(record: R): string
  readonly match: RegExp
  /** Immutable kinds can only be created. */
  readonly mutable: boolean
  key(record: R): string
}

export const KINDS: { readonly [K in RecordKind]: KindLayout<Extract<AnyRecord, unknown> & Record<string, unknown>> } = {
  note: {
    file: (r) => `notes/${(r as unknown as NoteRecord).id}.json`,
    match: /^notes\/[^/]+\.json$/,
    mutable: true,
    key: (r) => (r as unknown as NoteRecord).id
  },
  organization: {
    file: (r) => { const t = (r as unknown as OrganizationRecord).target; return `organization/${t.kind}/${fileKey(t.id)}.json` },
    match: /^organization\/(unit|asset|collection)\/[^/]+\.json$/,
    mutable: true,
    key: (r) => { const t = (r as unknown as OrganizationRecord).target; return `${t.kind}:${t.id}` }
  },
  collection: {
    file: (r) => `collections/${fileKey((r as unknown as CollectionRecord).id)}.json`,
    match: /^collections\/[^/]+\.json$/,
    mutable: true,
    key: (r) => (r as unknown as CollectionRecord).id
  },
  categories: { file: () => "categories.json", match: /^categories\.json$/, mutable: true, key: () => "categories" },
  submission: {
    file: (r) => `reviews/${(r as unknown as SubmissionRecord).id}/submission.json`,
    match: /^reviews\/[^/]+\/submission\.json$/,
    mutable: false,
    key: (r) => (r as unknown as SubmissionRecord).id
  },
  decision: {
    file: (r) => { const d = r as unknown as DecisionRecord; return `reviews/${d.submission}/decisions/${d.id}.json` },
    match: /^reviews\/[^/]+\/decisions\/[^/]+\.json$/,
    mutable: true,
    key: (r) => (r as unknown as DecisionRecord).id
  }
}

export const RECORD_KINDS = Object.keys(KINDS) as ReadonlyArray<RecordKind>
/** The folders under .catalog that hold records (categories.json sits beside them), and format 1's `labels`. */
export const RECORD_FOLDERS = ["notes", "organization", "collections", "reviews", "labels"] as const

export const kindOfPath = (relative: string): RecordKind | null => RECORD_KINDS.find((kind) => KINDS[kind].match.test(relative)) ?? null
export const recordPath = (kind: RecordKind, record: object): string => `${RECORDS_DIR}/${KINDS[kind].file(record as never)}`
export const recordKey = (kind: RecordKind, record: object): string => KINDS[kind].key(record as never)
export const blobPath = (hash: string, extension: string): string =>
  `${RECORDS_DIR}/evidence/${hash.slice(0, 2)}/${hash}${extension ? `.${extension}` : ""}`
