// The catalog's domain vocabulary: what sources produce after normalization, and what the
// records under `.catalog/` hold. Types only; the rules live beside them in this folder.

export interface Actor {
  readonly name: string
  readonly kind: "human" | "agent"
}

/** Something that could not be used, scoped to the file or source it came from. */
export interface Problem {
  readonly source: string
  readonly error: string
  readonly recovery: string | null
}

export interface RoleDef {
  readonly key: string
  readonly label: string
  /** Media kind ids this role accepts. */
  readonly kinds: ReadonlyArray<string>
  readonly many: boolean
  readonly expected: boolean
  readonly help: string | null
}

export interface FieldDef {
  readonly key: string
  readonly label: string
  readonly kind: string
  readonly unit: string | null
  readonly help: string | null
  readonly group: string | null
  readonly filter: boolean
  /** A live fact shown beside content; never part of what a verdict approves. */
  readonly derived: boolean
  readonly summary: boolean
}

export interface TypeDef {
  readonly scope: string
  readonly label: string
  readonly roles: ReadonlyArray<RoleDef>
  readonly fields: ReadonlyArray<FieldDef>
  readonly thumb: string | null
  readonly help: string | null
  readonly audioTranscript: unknown
  /** False when the fields are provenance and reviewers judge only the media. */
  readonly reviewAttributes: boolean
}

export interface PreviewDecl {
  readonly label?: string
  readonly module?: string
  readonly roles?: ReadonlyArray<string>
  readonly base?: string
  readonly config?: Record<string, unknown>
  readonly represents?: string
}

export interface CollectionKind {
  readonly label: string
  readonly preview: PreviewDecl | null
  readonly memberField: string | null
  readonly memberExtra: { readonly key?: string } | null
}

export interface CatalogSchema {
  readonly types: Readonly<Record<string, TypeDef>>
  readonly collectionKinds: Readonly<Record<string, CollectionKind>>
}

export interface Link {
  readonly role: string
  readonly asset: string
  readonly key?: string
  /** Per-link data from the source (take number, word timings); never review evidence. */
  readonly meta?: Record<string, unknown>
}

export interface Unit {
  readonly id: string
  readonly scope: string
  readonly type: string
  readonly name: string
  readonly attrs: Record<string, unknown>
  readonly links: ReadonlyArray<Link>
  readonly aliases: ReadonlyArray<string>
  readonly search: ReadonlyArray<string>
  readonly sources: ReadonlyArray<string>
  readonly adapterTags: ReadonlyArray<string>
  readonly adapterCategory: string | null
  readonly explain: Record<string, unknown>
}

export interface Asset {
  readonly id: string
  readonly path: string
  readonly kind: string | null
  readonly declaredKind: string | null
  readonly label: string | null
  readonly adapterTags: ReadonlyArray<string>
  readonly adapterCategory: string | null
}

export interface Member {
  readonly unit: string
  readonly [extra: string]: unknown
}

/** A collection as the catalog shows it: defined by a source ("adapter") or by a record ("catalog"). */
export interface Collection {
  readonly id: string
  readonly name: string
  readonly kind: string | null
  readonly members: ReadonlyArray<Member>
  readonly owner: "adapter" | "catalog"
  readonly adapterTags: ReadonlyArray<string>
  readonly adapterCategory: string | null
  readonly category: string | null
  readonly tags: ReadonlyArray<string>
  readonly revision: number | null
  readonly createdBy?: Actor | undefined
}

/** What is known about a media file's bytes. */
export interface MediaFacts {
  readonly state: "ok" | "missing" | "invalid" | "unsupported" | "forbidden"
  readonly error?: string
  /** Changes when the file's size or modification time does. Known without reading the file. */
  readonly token?: string
  /** Present once something needed the digest (a detail page, freezing, comparing, a verdict to check). */
  readonly sha256?: string
  readonly size?: number
  readonly mime?: string
  readonly kind?: string
  readonly mtime?: number
}

export type TargetKind = "unit" | "collection" | "asset" | "submission"

export interface Target {
  readonly kind: TargetKind
  readonly id: string
}

export interface Part {
  readonly id: string
  readonly label: string
  readonly role?: string
  readonly asset?: string
  readonly member?: string
}

// ---- Records (the JSON files under .catalog). Field order is the order they are written in.

export interface RequestBinding {
  readonly action: string
  readonly digest: string
  readonly context: string
}

export interface NoteTarget extends Target {
  readonly item?: string
  readonly part?: string
}

export interface NoteRecord {
  readonly id: string
  readonly target: NoteTarget
  readonly body: string
  readonly by: Actor
  readonly at: string
  readonly revision: number
  readonly editedAt?: string
  readonly resolved?: { readonly by: Actor; readonly at: string; readonly explanation?: string }
  readonly requestId?: string
  readonly requestBinding?: RequestBinding
  readonly lastRequestId?: string
  readonly lastRequestBinding?: RequestBinding
}

export interface LabelRecord {
  readonly target: Target
  readonly category: string | null
  readonly tags: ReadonlyArray<string>
  readonly revision: number
}

export interface CollectionRecord {
  readonly id: string
  readonly name: string
  readonly kind: string | null
  readonly category: string | null
  readonly tags: ReadonlyArray<string>
  readonly members: ReadonlyArray<Member>
  readonly revision: number
  readonly createdBy?: Actor
  readonly createdAt?: string
  readonly requestId?: string
  readonly requestBinding?: RequestBinding
}

export interface CategoriesRecord {
  readonly categories: ReadonlyArray<string>
  readonly revision: number
}

/** Where frozen bytes live: a content-addressed file under .catalog/evidence, or a Git blob. */
export type EvidenceRef =
  | { readonly store: string }
  | { readonly git: { readonly commit: string; readonly path: string; readonly blob: string } }

/** Frozen evidence of one byte stream or one attribute set. */
export interface LeafEvidence {
  readonly digest: string
  readonly kind?: string
  readonly attrs?: Record<string, unknown>
  readonly asset?: string
  readonly path?: string
  readonly mime?: string
  readonly size?: number
  readonly sha256?: string
  readonly ref?: EvidenceRef
}

export interface DefinitionEvidence {
  readonly sha256: string
  readonly ref: EvidenceRef
}

/** Evidence of a part: a leaf, a collection member (its own parts), or a combined preview. */
export interface PartEvidence extends LeafEvidence {
  readonly unit?: string
  readonly definition?: DefinitionEvidence
  readonly parts?: Readonly<Record<string, LeafEvidence>>
  readonly members?: Readonly<Record<string, Readonly<Record<string, LeafEvidence>>>>
  readonly base?: LeafEvidence | null
  readonly module?: string
  readonly moduleSha?: string
  readonly config?: Record<string, unknown>
  readonly roles?: ReadonlyArray<string>
}

export interface FrozenPart {
  readonly id: string
  readonly label: string
  readonly role?: string | null
  readonly asset?: string | null
  readonly member?: string
  readonly evidence: PartEvidence
}

export interface ViewBefore {
  readonly label: string
  readonly evidence: LeafEvidence
  readonly from?: { readonly submission: string; readonly item: string; readonly part: string; readonly leaf?: string }
}

export interface FrozenView {
  readonly id: string
  readonly part: string
  readonly leaf: string | null
  readonly caption: string
  readonly camera: unknown
  readonly state: unknown
  readonly before?: ViewBefore
  readonly afterLabel?: string
}

export interface SubmissionItem {
  readonly id: string
  readonly target: Target
  readonly title: string
  readonly kind: "unit" | "collection"
  readonly definition: DefinitionEvidence
  readonly parts: ReadonlyArray<FrozenPart>
  readonly views: ReadonlyArray<FrozenView>
  readonly attributes?: unknown
  readonly preview?: { readonly module: string; readonly label?: string; readonly represents?: string } | null
}

export interface SubmissionRecord {
  readonly id: string
  readonly title: string
  readonly by: Actor
  readonly at: string
  readonly context: { readonly branch: string | null; readonly head: string | null; readonly dirty: number }
  readonly supersedes: string | null
  readonly note: string | null
  readonly items: ReadonlyArray<SubmissionItem>
  readonly requestId?: string
  readonly requestBinding?: RequestBinding
}

export interface VerdictRecord {
  readonly id: string
  readonly submission: string
  readonly item: string
  readonly by: Actor
  readonly at: string
  readonly comment?: string
  readonly requestId?: string
  readonly requestBinding?: RequestBinding
  readonly scope: { readonly kind: "whole" | "parts"; readonly parts: ReadonlyArray<string> }
  readonly verdict?: string
  readonly exceptions?: Readonly<Record<string, string>>
  readonly verdicts?: Readonly<Record<string, string>>
  readonly partNotes?: Readonly<Record<string, string>>
  /** An agent recording a person's decision given outside the catalog, in their words. */
  readonly relay?: { readonly by: string; readonly channel: string; readonly words: string }
}

export interface RecordsByKind {
  readonly note: NoteRecord
  readonly label: LabelRecord
  readonly collection: CollectionRecord
  readonly categories: CategoriesRecord
  readonly submission: SubmissionRecord
  readonly verdict: VerdictRecord
}
export type RecordKind = keyof RecordsByKind
export type AnyRecord = RecordsByKind[RecordKind]
