// Captures: evidence rendered outside the catalog (a game engine's screenshot, a recorded clip, a
// model as it was at a commit), frozen with one submission item. A capture is a file in the
// checkout, a before/after pair of files, or a file at a commit; its bytes say what media it is.
// Each capture is its own part of the item (`capture:<n>`) and never content of the catalog: it
// has no current version, so nothing about it can change after it is submitted.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { optional, Text } from "../action.ts"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { digest, extensionOf, isNonEmpty, portableProblem, sha256 } from "../../kernel/hash.ts"
import { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import { Evidence } from "../Evidence.ts"
import { sniffWith } from "../MediaKinds.ts"
import type { EvidenceRef, FrozenPart, LeafEvidence } from "../model/types.ts"
import type { MediaKind } from "../plugin.ts"
import { ensureLocal } from "../records/files.ts"
import { LOCAL_DIR } from "../records/layout.ts"
import { fromPlugin } from "../support.ts"
import type { FreezeEnv } from "./freeze.ts"

const MAX_CAPTURES = 100
const MAX_BYTES = 100 << 20

const CaptureFile = Schema.Union([
  Schema.String.annotate({ description: "A file in the checkout, project-relative" }),
  Schema.Struct({
    revision: Text.annotate({ description: "A commit id, branch or tag" }),
    path: Text.annotate({ description: "The file's path in that commit" })
  }).annotate({ description: "A file as committed; frozen as a reference to its Git blob" })
])

export const CaptureInput = Schema.Struct({
  label: Schema.String.annotate({ description: "What the capture shows (at most 300 characters)" }),
  caption: optional(Schema.String).annotate({ description: "Caption of its view (default: the label)" }),
  renderer: optional(Schema.String).annotate({ description: "Who rendered it, shown as a badge (for example a game engine)" }),
  file: optional(CaptureFile),
  before: optional(CaptureFile),
  after: optional(CaptureFile),
  labels: optional(Schema.Array(Schema.String)).annotate({ description: "Names of the before and after sides (default Before, After)" })
})
type CaptureSpec = typeof CaptureInput.Type
type FileSpec = typeof CaptureFile.Type

/** One file of a capture, read and checked; nothing is written yet. */
interface CaptureSource {
  readonly name: string
  readonly bytes: Uint8Array
  readonly sha256: string
  readonly kind: string
  readonly mime: string
  /** A file of the checkout (frozen like any media file), or a committed one (referenced as its blob). */
  readonly checkout?: { readonly path: string; readonly full: string }
  readonly committed?: Extract<EvidenceRef, { git: unknown }>
}

export interface PlannedCapture {
  readonly id: string
  readonly label: string
  readonly caption: string | null
  readonly renderer: string | null
  readonly file?: CaptureSource
  readonly pair?: { readonly before: CaptureSource; readonly after: CaptureSource; readonly labels: readonly [string, string] }
}

const text = (value: string | null | undefined, max: number, what: string): Effect.Effect<string | null, ToolError> =>
  value == null ? Effect.succeed(null) : isNonEmpty(value) && value.length <= max ? Effect.succeed(value.trim()) : fail("invalid", `${what} must be text of at most ${max} characters`)

const METADATA = /(^|\/)\.git(\/|$)/

/** The media kind of a capture, from its bytes and the kind's own check. */
const kindOf = (env: FreezeEnv, bytes: Uint8Array, name: string, validateAt: (kind: MediaKind) => Effect.Effect<string | null, ToolError>, what: string) =>
  Effect.gen(function*() {
    const kinds = env.projection.plugins.mediaKinds
    const sniffed = sniffWith(kinds, bytes.subarray(0, 64))
    if (sniffed === null) return yield* fail("invalid", `${what}: ${name} is not ${kinds.map((kind) => kind.label.toLowerCase()).join(", ")} media (checked from its bytes)`)
    if (bytes.length > MAX_BYTES) return yield* fail("invalid", `${what}: ${name} is larger than ${MAX_BYTES >> 20} MiB`)
    const kind = kinds.find((candidate) => candidate.id === sniffed.kind)!
    const refused = kind.validate ? yield* validateAt(kind) : null
    if (refused !== null) return yield* fail("unsupported", `${what}: ${name} cannot be shown: ${refused}`)
    return sniffed
  })

const validateFile = (kind: MediaKind, path: string, full: string, size: number): Effect.Effect<string | null, ToolError> =>
  fromPlugin(`validate ${path}`, () => kind.validate!({ path, absolutePath: full, size })).pipe(Effect.catch((error) => Effect.succeed(error.message)))

/** Read and check one file of a capture. */
const readSource = (env: FreezeEnv, spec: FileSpec, what: string): Effect.Effect<CaptureSource, ToolError, ProjectFiles | Evidence> =>
  Effect.gen(function*() {
    const files = yield* ProjectFiles
    if (typeof spec !== "string") {
      const committed = yield* (yield* Evidence).committed(spec.revision, spec.path)
      const name = `${spec.path} at ${committed.ref.git.commit.slice(0, 12)}`
      // A kind's check reads a file, so a committed one is checked from a machine-local copy.
      const sniffed = yield* kindOf(env, committed.bytes, name, (kind) =>
        Effect.gen(function*() {
          yield* ensureLocal(files)
          const copy = `${LOCAL_DIR}/tmp/capture-${committed.sha256.slice(0, 16)}.${extensionOf(spec.path) || "bin"}`
          yield* files.writeBytes(copy, committed.bytes, { noFollow: true })
          const full = yield* files.resolve(copy, { noFollow: true })
          return yield* validateFile(kind, copy, full, committed.bytes.length).pipe(Effect.ensuring(files.remove(copy, { noFollow: true }).pipe(Effect.catch(() => Effect.void))))
        }), what)
      return { name: spec.path.split("/").pop()!, bytes: committed.bytes, sha256: committed.sha256, kind: sniffed.kind, mime: sniffed.mime, committed: committed.ref }
    }
    const path = spec
    const problem = portableProblem(path)
    if (problem !== null) return yield* fail("invalid", `${what}: ${path} is not a file of this checkout (${problem})`)
    if (METADATA.test(path)) return yield* fail("forbidden", `${what}: repository metadata is not evidence`)
    // The catalog's own folder (where viewer captures are saved) is read without following links.
    const access = { noFollow: path.startsWith(".catalog/") }
    const stat = yield* files.stat(path, access)
    if (stat === null || stat.kind !== "file") return yield* fail("invalid", `${what}: ${path} is not a file of this checkout; paths are relative to its root`)
    const bytes = yield* files.readBytes(path, access)
    const full = yield* files.resolve(path, access)
    const sniffed = yield* kindOf(env, bytes, path, (kind) => validateFile(kind, path, full, bytes.length), what)
    return { name: path.split("/").pop()!, bytes, sha256: sha256(bytes), kind: sniffed.kind, mime: sniffed.mime, checkout: { path, full } }
  })

/** Check every capture of an item request completely; nothing is written. */
export const planCaptures = (env: FreezeEnv, specs: ReadonlyArray<CaptureSpec> | null | undefined): Effect.Effect<ReadonlyArray<PlannedCapture>, ToolError, ProjectFiles | Evidence> =>
  Effect.gen(function*() {
    if (specs == null) return []
    if (specs.length > MAX_CAPTURES) return yield* fail("invalid", `an item holds at most ${MAX_CAPTURES} captures`)
    return yield* Effect.forEach(specs, (spec, index) =>
      Effect.gen(function*() {
        const what = `capture ${index + 1}`
        const label = yield* text(spec.label, 300, `${what} label`)
        if (label === null) return yield* fail("invalid", `${what} needs a label`)
        const base = { id: `capture:${index + 1}`, label, caption: yield* text(spec.caption, 300, `${what} caption`), renderer: yield* text(spec.renderer, 100, `${what} renderer`) }
        const paired = spec.before != null || spec.after != null
        if ((spec.file != null) === paired) return yield* fail("invalid", `${what}: give either file, or before and after`)
        if (spec.file != null) {
          if (spec.labels != null) return yield* fail("invalid", `${what}: labels name the two sides of a before and after pair`)
          return { ...base, file: yield* readSource(env, spec.file, what) }
        }
        if (spec.before == null || spec.after == null) return yield* fail("invalid", `${what}: a pair needs both before and after`)
        const labels = spec.labels ?? ["Before", "After"]
        if (labels.length !== 2 || !labels.every((name) => isNonEmpty(name) && name.length <= 100)) {
          return yield* fail("invalid", `${what}: labels are two short names, for example ["Before", "After"]`)
        }
        const before = yield* readSource(env, spec.before, `${what} before`)
        const after = yield* readSource(env, spec.after, `${what} after`)
        if (before.kind !== after.kind) return yield* fail("invalid", `${what}: before is ${before.kind} and after is ${after.kind}; compare like with like`)
        if (before.sha256 === after.sha256) return yield* fail("invalid", `${what}: before and after are the same bytes (${before.name}, ${after.name})`)
        return { ...base, pair: { before, after, labels: [labels[0]!.trim(), labels[1]!.trim()] as const } }
      }))
  })

/** The leaves a view of a capture may name: none for one file, `before` or `after` for a pair. */
export const captureLeaves = (capture: PlannedCapture): ReadonlyArray<string> => (capture.pair ? ["before", "after"] : [""])

/** The kind of media a view of a capture shows on its own, when it is one file. */
export const captureKind = (capture: PlannedCapture, leaf: string | null | undefined): string | null =>
  capture.file ? capture.file.kind : leaf === "before" || leaf === "after" ? capture.pair![leaf].kind : null

/** Freeze a planned capture: committed files by their blob, everything else by its bytes. */
export const freezeCapture = (env: FreezeEnv, capture: PlannedCapture): Effect.Effect<FrozenPart, ToolError, Evidence> =>
  Effect.gen(function*() {
    const evidence = yield* Evidence
    const renderer = capture.renderer === null ? {} : { renderer: capture.renderer }
    const leaf = (source: CaptureSource, asset: string): Effect.Effect<LeafEvidence, ToolError> =>
      Effect.gen(function*() {
        let ref: EvidenceRef | null = source.committed ?? null
        if (ref === null) {
          const { full, path } = source.checkout!
          ref = yield* evidence.freezeFile(path, full, source.sha256, extensionOf(path), env.checkout)
          if (ref === null) return yield* fail("conflict", `${path} changed while it was being captured; submit again`)
        }
        return { kind: source.kind, digest: source.sha256, sha256: source.sha256, size: source.bytes.length, mime: source.mime, asset, path: source.committed?.git.path ?? source.checkout!.path, ref, ...renderer }
      })
    if (capture.file) return { id: capture.id, label: capture.label, ...renderer, evidence: yield* leaf(capture.file, capture.id) }
    const { after, before, labels } = capture.pair!
    const pair = { before: yield* leaf(before, `${capture.id}/before`), after: yield* leaf(after, `${capture.id}/after`) }
    return { id: capture.id, label: capture.label, ...renderer, evidence: { digest: digest({ before: before.sha256, after: after.sha256 }), pair, labels, ...renderer } }
  })
