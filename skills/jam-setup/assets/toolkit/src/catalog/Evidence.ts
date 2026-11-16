// Frozen review evidence. Each byte stream is identified by its SHA-256 and kept either as a
// content-addressed file under .catalog/evidence or, when the file is committed and unmodified,
// as a reference to its immutable Git blob. A read always verifies the digest and never falls
// back to what the working tree holds now.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as fsp from "node:fs/promises"
import * as nodePath from "node:path"
import type { ToolError } from "../kernel/errors.ts"
import { type Checkout, Git } from "../kernel/Git.ts"
import { canonical, sha256 } from "../kernel/hash.ts"
import { ProjectFiles } from "../kernel/ProjectFiles.ts"
import type { DefinitionEvidence, EvidenceRef, LeafEvidence } from "./model/types.ts"
import { Records } from "./Records.ts"
import { validRef } from "./records/schemas.ts"

const LFS_POINTER = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([0-9a-f]{64})\nsize (\d+)\n?$/

/** The object id a Git LFS pointer file names, when these bytes are one. */
export const lfsPointer = (bytes: Uint8Array): string | null =>
  LFS_POINTER.exec(Buffer.from(bytes.subarray(0, 300)).toString("latin1"))?.[1] ?? null

export type ReadResult =
  | { readonly status: "ok"; readonly bytes: Uint8Array; readonly sha256: string }
  | { readonly status: "missing" | "corrupt" | "unavailable"; readonly error: string }

export interface EvidenceStatus {
  readonly status: ReadResult["status"]
  readonly error?: string
}

type GitRef = Extract<EvidenceRef, { git: unknown }>["git"]

export class Evidence extends Context.Service<Evidence, {
  /**
   * Freeze a file whose current SHA-256 is known. Null when its bytes changed while freezing.
   * `full` is the confined absolute path of the project-relative `path`.
   */
  freezeFile(path: string, full: string, expectedSha: string, extension: string, checkout: Checkout): Effect.Effect<EvidenceRef | null, ToolError>
  /** Freeze a definition as canonical JSON. */
  freezeJson(value: unknown): Effect.Effect<DefinitionEvidence, ToolError>
  /** The referenced bytes, verified against the expected digest. Never fails: a problem is a status. */
  readRef(ref: unknown, expectedSha: unknown): Effect.Effect<ReadResult>
  /** Whether a frozen leaf is still readable; verified once per place its bytes live. */
  status(leaf: LeafEvidence): Effect.Effect<EvidenceStatus>
}>()("jam/catalog/Evidence") {
  static readonly layerNoDeps: Layer.Layer<Evidence, never, Records | Git | ProjectFiles> = Layer.effect(
    Evidence,
    Effect.gen(function*() {
      const records = yield* Records
      const git = yield* Git
      const files = yield* ProjectFiles
      const verified = new Map<string, EvidenceStatus>()
      const pointers = new Map<string, string | null>()

      const commonDir = yield* Effect.cached(Effect.map(git.text(["rev-parse", "--git-common-dir"]), (dir) =>
        dir ? (nodePath.isAbsolute(dir) ? dir : nodePath.resolve(files.root, dir)) : null))
      const lfsObject = (oid: string): Effect.Effect<string | null> =>
        Effect.map(commonDir, (common) => (common === null ? null : nodePath.join(common, "lfs", "objects", oid.slice(0, 2), oid.slice(2, 4), oid)))
      const readFile = (path: string): Effect.Effect<Uint8Array | null> =>
        Effect.promise(() => fsp.readFile(path).then((bytes): Uint8Array | null => bytes, () => null))

      /** Committed and unmodified relative to HEAD: the immutable blob can stand for the file. */
      const committedBlob = (path: string, checkout: Checkout): Effect.Effect<GitRef | null> =>
        Effect.gen(function*() {
          if (!checkout.git || !checkout.head) return null
          if (!(yield* git.text(["ls-files", "--", path]))) return null
          if ((yield* git.bytes(["diff", "--quiet", "HEAD", "--", path])) === null) return null
          const blob = yield* git.text(["rev-parse", `HEAD:${path}`])
          return blob ? { commit: checkout.head, path, blob } : null
        })

      const readGit = (ref: GitRef, expectedSha: string): Effect.Effect<ReadResult> =>
        Effect.gen(function*() {
          if (!/^[0-9a-f]{40,64}$/.test(ref.blob)) return { status: "unavailable", error: "invalid Git reference" }
          let bytes = yield* git.bytes(["cat-file", "blob", ref.blob])
          if (bytes === null) {
            return { status: "missing", error: `Git object ${ref.blob.slice(0, 12)} (${ref.path} at ${ref.commit.slice(0, 12)}) is not available in this clone` }
          }
          const oid = lfsPointer(bytes)
          if (oid !== null) {
            const object = yield* lfsObject(oid)
            bytes = object === null ? null : yield* readFile(object)
            if (bytes === null) {
              return { status: "missing", error: `Git LFS object ${oid.slice(0, 12)} for ${ref.path} is not available locally; fetch LFS data for ${ref.commit.slice(0, 12)}` }
            }
          }
          return verify(bytes, expectedSha)
        })
      const verify = (bytes: Uint8Array, expectedSha: string): ReadResult => {
        const actual = sha256(bytes)
        return actual === expectedSha
          ? { status: "ok", bytes, sha256: actual }
          : { status: "corrupt", error: `evidence bytes changed (expected ${expectedSha.slice(0, 12)}, found ${actual.slice(0, 12)})` }
      }

      const readRef = (ref: unknown, expectedSha: unknown): Effect.Effect<ReadResult> =>
        Effect.gen(function*() {
          if (!validRef(ref, expectedSha)) return { status: "unavailable", error: "evidence reference is incomplete or invalid" } satisfies ReadResult
          const valid = ref as EvidenceRef
          const sha = expectedSha as string
          if ("git" in valid) return yield* readGit(valid.git, sha)
          const bytes = yield* Effect.result(records.readBlob(valid.store))
          if (bytes._tag === "Failure") return { status: "unavailable", error: bytes.failure.message } satisfies ReadResult
          if (bytes.success === null) return { status: "missing", error: `evidence file is missing: ${valid.store}` } satisfies ReadResult
          return verify(bytes.success, sha)
        })

      const freezeFile = (path: string, full: string, expectedSha: string, extension: string, checkout: Checkout) =>
        Effect.gen(function*() {
          const blob = yield* committedBlob(path, checkout)
          // Use the Git object only when it really yields these bytes (directly or through LFS).
          if (blob && (yield* readGit(blob, expectedSha)).status === "ok") return { git: blob } satisfies EvidenceRef
          const bytes = yield* readFile(full)
          if (bytes === null || sha256(bytes) !== expectedSha) return null
          return { store: (yield* records.putBlob(bytes, extension)).path } satisfies EvidenceRef
        })

      const freezeJson = (value: unknown) =>
        Effect.map(records.putBlob(Buffer.from(canonical(value)), "json"), (blob): DefinitionEvidence => ({ sha256: blob.sha256, ref: { store: blob.path } }))

      /** Where the bytes live right now; a change means they must be verified again. */
      const storageKey = (ref: EvidenceRef): Effect.Effect<string> =>
        Effect.gen(function*() {
          if ("store" in ref) return `s:${ref.store}:${yield* records.blobState(ref.store)}`
          const blob = ref.git.blob
          if (!pointers.has(blob)) {
            // An absent object may arrive with a later fetch, so only a found one is remembered.
            const size = yield* git.text(["cat-file", "-s", blob])
            if (size === null) return `g:${blob}:absent`
            // A pointer file is a few lines; anything larger is the content itself.
            const small = Number(size) <= 1024 ? yield* git.bytes(["cat-file", "blob", blob]) : null
            pointers.set(blob, small === null ? null : lfsPointer(small))
          }
          const oid = pointers.get(blob) ?? null
          if (oid === null) return `g:${blob}`
          const object = yield* lfsObject(oid)
          const stat = object === null ? null : yield* Effect.promise(() => fsp.stat(object).catch(() => null))
          return `g:${blob}:lfs:${stat ? stat.mtimeMs : "absent"}`
        })

      const status = (leaf: LeafEvidence): Effect.Effect<EvidenceStatus> =>
        Effect.gen(function*() {
          if (!validRef(leaf.ref, leaf.sha256)) return { status: "unavailable", error: "evidence reference is incomplete or invalid" } satisfies EvidenceStatus
          const key = `${leaf.sha256}:${yield* storageKey(leaf.ref as EvidenceRef)}`
          const known = verified.get(key)
          if (known) return known
          const read = yield* readRef(leaf.ref, leaf.sha256)
          const value: EvidenceStatus = read.status === "ok" ? { status: "ok" } : { status: read.status, error: read.error }
          // A Git object that is absent is asked for again next time; everything else is settled
          // for as long as its storage key stays the same.
          if (!key.endsWith(":absent")) verified.set(key, value)
          return value
        })

      return { freezeFile, freezeJson, readRef, status }
    })
  )
}
