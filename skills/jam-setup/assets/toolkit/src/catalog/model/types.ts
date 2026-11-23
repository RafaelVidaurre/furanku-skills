// The catalog's domain vocabulary: what sources produce after normalization, and what the
// records under `.catalog/` hold. Types only; the rules live beside them in this folder.

export interface Actor {
  readonly name: string
  readonly kind: "human" | "agent"
}

/** Something that could not be used, with what it is about (a path or a unit id). */
export interface Problem {
  readonly subject: string
  readonly error: string
  readonly recovery: string | null
}

export interface RoleDef {
  readonly key: string
  readonly label: string
  /** Media kind ids this role accepts. */
  readonly mediaKinds: ReadonlyArray<string>
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

/** A browser module mounted for a unit of a type: an inspector in its media strip, or a sidebar panel. */
export interface MountDef {
  readonly key: string
  readonly label: string
  /** The name a plugin declared the module under (`views`). */
  readonly module: string
  /** The module's export that mounts it (default: the default export). */
  readonly export: string
  readonly help: string | null
}

export interface InspectorDef extends MountDef {
  /** Opens first, before any media of the unit. */
  readonly default: boolean
}

/** How a type's images are shown. */
export interface DisplayDef {
  /** Hard texels and whole images (contain, not cover) in thumbnails and image viewers. */
  readonly pixelArt: boolean
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
  readonly inspectors: ReadonlyArray<InspectorDef>
  readonly panels: ReadonlyArray<MountDef>
  /** The type's own display policy, or null to follow the project's. */
  readonly display: DisplayDef | null
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
  /** A member's own value shown beside it: `×N` (count, the default) or as written (`text`). */
  readonly memberExtra: { readonly key?: string; readonly format?: "count" | "text" } | null
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
  /** Keys of the type's inspectors this unit shows; null for all of them. */
  readonly inspectors: ReadonlyArray<string> | null
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

/** A collection as the catalog shows it: project-owned (defined by a source) or catalog-owned (a record). */
export interface Collection {
  readonly id: string
  readonly name: string
  readonly kind: string | null
  readonly members: ReadonlyArray<Member>
  readonly owner: "project" | "catalog"
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
  readonly checkout: string
}

export interface NoteTarget extends Target {
  readonly item?: string
  readonly part?: string
  /** A view of a submission item: the way of showing that makes the point. */
  readonly view?: string
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

export interface OrganizationRecord {
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
  /** Who rendered a capture (for example a game engine); captures only. */
  readonly renderer?: string
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
  /** A before/after capture: two frozen files and their labels. */
  readonly pair?: { readonly before: LeafEvidence; readonly after: LeafEvidence }
  readonly labels?: ReadonlyArray<string>
}

export interface FrozenPart {
  readonly id: string
  readonly label: string
  readonly role?: string | null
  readonly asset?: string | null
  readonly member?: string
  /** Who rendered a capture part. */
  readonly renderer?: string
  /**
   * On a capture: the part it shows, or null for the whole item. A capture with this key is a way
   * of showing, never decided; captures recorded before it existed were decided as parts.
   */
  readonly shows?: string | null
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
  /** Null for work that is not catalog content: the item holds captures and/or text only. */
  readonly target: Target | null
  readonly title: string
  /** Shown above the item's evidence. */
  readonly text?: string
  readonly kind: "unit" | "collection" | "work"
  readonly definition: DefinitionEvidence
  readonly parts: ReadonlyArray<FrozenPart>
  readonly views: ReadonlyArray<FrozenView>
  readonly attributes?: unknown
  readonly preview?: { readonly module: string; readonly label?: string; readonly represents?: string } | null
  /** "one": the parts are options and the person picks one of them, or none. */
  readonly choose?: "one"
}

export interface SubmissionRecord {
  readonly id: string
  readonly title: string
  readonly by: Actor
  readonly at: string
  readonly checkout: { readonly branch: string | null; readonly head: string | null; readonly dirty: number }
  readonly supersedes: string | null
  /** The one question the person answers, in a sentence. */
  readonly ask?: string | null
  /** Markdown for every item: how the work was made and how to read the views. */
  readonly brief: string | null
  /** Markdown: what changed since the person last looked, and why. */
  readonly changes?: string | null
  /** Markdown: known defects and what is not done. */
  readonly limits?: string | null
  readonly items: ReadonlyArray<SubmissionItem>
  readonly requestId?: string
  /** Taken back by its submitter or a person: it waits on nobody and stays readable. */
  readonly withdrawn?: { readonly by: Actor; readonly at: string; readonly reason: string }
  /** Set once its words or framing are edited. */
  readonly revision?: number
  readonly editedAt?: string
  readonly editedBy?: Actor
  readonly lastRequestId?: string
  readonly lastRequestBinding?: RequestBinding
  readonly requestBinding?: RequestBinding
}

/** One reviewer's verdicts on one submission item: immutable. */
export interface DecisionRecord {
  readonly id: string
  readonly submission: string
  readonly item: string
  readonly by: Actor
  readonly at: string
  readonly comment?: string
  readonly requestId?: string
  readonly requestBinding?: RequestBinding
  readonly covers: { readonly kind: "whole" | "parts"; readonly parts: ReadonlyArray<string> }
  readonly verdict?: string
  readonly exceptions?: Readonly<Record<string, string>>
  readonly verdicts?: Readonly<Record<string, string>>
  readonly partComments?: Readonly<Record<string, string>>
  /** An agent recording a person's decision given outside the catalog, in their words. */
  readonly relay?: { readonly by: string; readonly channel: string; readonly words: string }
  /** On an item that chooses one option: the option picked, or null for none of them. */
  readonly pick?: { readonly option: string | null }
  /** Set once the decision is edited: its revision, and who changed it when. */
  readonly revision?: number
  readonly editedAt?: string
  readonly editedBy?: Actor
  readonly lastRequestId?: string
  readonly lastRequestBinding?: RequestBinding
}

export interface RecordsByKind {
  readonly note: NoteRecord
  readonly organization: OrganizationRecord
  readonly collection: CollectionRecord
  readonly categories: CategoriesRecord
  readonly submission: SubmissionRecord
  readonly decision: DecisionRecord
}
export type RecordKind = keyof RecordsByKind
export type AnyRecord = RecordsByKind[RecordKind]
