// Freezing what a submission shows: the exact bytes and attributes a reviewer will judge, so a
// verdict always refers to something that can be read again later.
import * as Effect from "effect/Effect"
import type { WriteEnv } from "../action.ts"
import { type AssetFiles } from "../assetFiles.ts"
import { Evidence } from "../Evidence.ts"
import { MediaKinds } from "../MediaKinds.ts"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { digest, extensionOf } from "../../kernel/hash.ts"
import { reviewAttrs, unitParts } from "../model/parts.ts"
import type { DefinitionEvidence, LeafEvidence, MediaFacts, Unit } from "../model/types.ts"
import { mediaDigest, type Sheet } from "../model/sheet.ts"
import { factsOf, typeOf } from "../Projection.ts"

export interface FreezeEnv extends WriteEnv {
  /** Confinement to the asset roots, shared by every file frozen in this action. */
  readonly within: AssetFiles
}

/** Freeze a media file whose facts are known. `asset` is what the evidence says it shows. */
export const freezeFile = (env: FreezeEnv, asset: string, path: string, kind: string | null, facts: MediaFacts): Effect.Effect<LeafEvidence, ToolError, Evidence | MediaKinds> =>
  Effect.gen(function*() {
    const { mime, size } = facts
    if (facts.state !== "ok") return yield* fail("invalid", `cannot submit ${path}: ${facts.error ?? facts.state}`)
    // Frozen evidence is named by its digest; this is where a file that was only listed gets hashed.
    const sha256 = facts.sha256 ?? (yield* (yield* MediaKinds).hash(path, env.within))
    if (sha256 === null) return yield* fail("invalid", `cannot submit ${path}: the file could not be read`)
    const located = yield* Effect.promise(() => env.within.locate(path))
    if ("code" in located) return yield* Effect.fail(located)
    const ref = yield* (yield* Evidence).freezeFile(path, located.full, sha256, extensionOf(path), env.checkout)
    if (ref === null) return yield* fail("conflict", `${path} changed while it was being captured; submit again`)
    return { digest: sha256, asset, path, kind: kind ?? facts.kind ?? "", ...(mime === undefined ? {} : { mime }), size: size ?? 0, sha256, ref }
  })

/** Media reviewed as an animation: the sheet is frozen with the bytes, and the digest covers both. */
export const withSheet = (leaf: LeafEvidence, sheet: Sheet | undefined): LeafEvidence =>
  sheet === undefined || leaf.sha256 === undefined ? leaf : { ...leaf, digest: mediaDigest(leaf.sha256, sheet), sheet }

export const freezeAsset = (env: FreezeEnv, assetId: string): Effect.Effect<LeafEvidence, ToolError, Evidence | MediaKinds> => {
  const asset = env.projection.snapshot.assetsById.get(assetId)
  return asset ? freezeFile(env, asset.id, asset.path, asset.kind, factsOf(env.projection, asset.id)) : fail("not_found", `asset ${assetId} is not in this checkout`)
}

export const attributesEvidence = (env: WriteEnv, unit: Unit): LeafEvidence => {
  const attrs = reviewAttrs(unit, typeOf(env.projection, unit))
  return { kind: "attributes", attrs, digest: digest(attrs) }
}

export const freezeDefinition = (env: WriteEnv, unit: Unit): Effect.Effect<DefinitionEvidence, ToolError, Evidence> =>
  Effect.flatMap(Evidence, (evidence) =>
    evidence.freezeJson({
      id: unit.id,
      type: unit.type,
      name: unit.name,
      attrs: reviewAttrs(unit, typeOf(env.projection, unit)),
      links: unit.links.map((link) => ({ ...link, path: env.projection.snapshot.assetsById.get(link.asset)?.path })),
      sources: unit.sources
    }))

/** Only the named parts' own dependencies are frozen; unrelated media cannot block a review. */
export const freezeUnitParts = (env: FreezeEnv, unit: Unit, partIds: ReadonlyArray<string>): Effect.Effect<Record<string, LeafEvidence>, ToolError, Evidence | MediaKinds> =>
  Effect.gen(function*() {
    const frozen: Record<string, LeafEvidence> = {}
    for (const part of unitParts(unit, typeOf(env.projection, unit))) {
      if (!partIds.includes(part.id)) continue
      frozen[part.id] = part.asset === undefined ? attributesEvidence(env, unit) : withSheet(yield* freezeAsset(env, part.asset), part.sheet)
    }
    return frozen
  })
