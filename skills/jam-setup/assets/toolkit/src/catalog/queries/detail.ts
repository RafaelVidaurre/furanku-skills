// Everything about one unit, collection or asset.
import * as Effect from "effect/Effect"
import { fail, type ToolError } from "../../kernel/errors.ts"
import { shortRef } from "../../kernel/Ids.ts"
import type { ProjectFiles } from "../../kernel/ProjectFiles.ts"
import type { Facts } from "../Facts.ts"
import { ensureHashed } from "../hashes.ts"
import type { MediaKinds } from "../MediaKinds.ts"
import { isItemEvidence, unitParts } from "../model/parts.ts"
import type { Actor, Target } from "../model/types.ts"
import { decisionOrder, decisionVerdicts } from "../model/verdicts.ts"
import { factsOf, type Projection, targetKey, typeOf } from "../Projection.ts"
import { assetRoute, collectionRoute, unitRoute } from "../routes.ts"
import { unique } from "../support.ts"
import { noteView } from "./notes.ts"
import { allTags, organizationOf } from "./organization.ts"
import { currentDigest, openItemsFor, partAssets, previewSpec, reviewOf, summaryOf } from "./review.ts"
import { assetRef, browserModuleOf, evidenceUrl, formatValue, missingRoles, moduleUrl, roleLabel, thumbOf, unitSummary } from "./summaries.ts"

type FactsService = Facts["Service"]
const newestFirst = <A extends { readonly at: string }>(list: Array<A>): Array<A> => list.sort((a, b) => b.at.localeCompare(a.at))

/** Decisions on a target, newest first, each with the content parts that changed since. */
const historyFor = (p: Projection, target: Target) =>
  [...(p.decisionsByTarget.get(targetKey(target)) ?? [])].sort(decisionOrder).reverse().map((decision) => {
    const { item, submission } = p.items.get(decision.item)!
    // A capture has no current version, so it never reads as content that changed.
    const changedParts = Object.keys(decisionVerdicts(decision)).filter((part) => !isItemEvidence(part)).filter((part) => {
      const frozen = item.parts.find((candidate) => candidate.id === part)?.evidence
      return !!frozen && frozen.digest !== currentDigest(p, target, part)
    })
    return { ...summaryOf(p, decision), title: submission.title, partLabels: Object.fromEntries(item.parts.map((part) => [part.id, part.label])), changedParts }
  })

const unitRefs = (p: Projection, ids: ReadonlyArray<string>) =>
  ids.map((id) => {
    const unit = p.snapshot.unitsById.get(id)
    return { id, name: unit?.name ?? id, exists: !!unit, thumb: unit ? thumbOf(p, unit) : null }
  })

/** Both directions of every registered relation: what this unit refers to and what refers to it. */
const relationsOf = (p: Projection, id: string) => {
  const { relations } = p.snapshot
  return relations.defs.flatMap((def) => {
    const out = relations.out.get(id)?.get(def.name) ?? []
    const into = relations.in.get(id)?.get(def.name) ?? []
    return [
      ...(out.length > 0 ? [{ name: def.name, direction: "out" as const, label: def.label, units: unitRefs(p, out) }] : []),
      ...(into.length > 0 ? [{ name: def.name, direction: "in" as const, label: def.inverseLabel, units: unitRefs(p, into) }] : [])
    ]
  })
}

export const unitGet = (p: Projection, facts: FactsService, id: string): Effect.Effect<unknown, ToolError, MediaKinds | ProjectFiles> =>
  Effect.gen(function*() {
    const unit = p.snapshot.unitsById.get(id)
    if (!unit) return yield* fail("not_found", `unit ${id} is not in this checkout`)
    // A detail page names exact bytes (and probes are cached by digest): hash this unit's files.
    yield* ensureHashed(p, unit.links.map((link) => link.asset))
    const { assetsById, unitsById } = p.snapshot
    const type = typeOf(p, unit)
    const links = yield* Effect.forEach(unit.links, (link) =>
      Effect.gen(function*() {
        const asset = assetsById.get(link.asset)!
        const others = new Map((p.usage.get(asset.id) ?? []).filter((use) => use.unit !== id).map((use) => [use.unit, { unit: use.unit, role: use.role, name: unitsById.get(use.unit)?.name, roleLabel: roleLabel(p, use.role) }]))
        return {
          role: link.role,
          roleLabel: type.roles.find((role) => role.key === link.role)?.label ?? link.role,
          asset: assetRef(p, asset),
          alsoUsedBy: [...others.values()],
          ...(link.key === undefined ? {} : { key: link.key }),
          meta: link.meta ?? null,
          facts: yield* facts.forAsset(asset, factsOf(p, asset.id), p.plugins.probes)
        }
      }))
    const linkedAssets = unique(unit.links.map((link) => link.asset))
    return {
      route: unitRoute(unit.scope, unit.id),
      unit: { id: unit.id, scope: unit.scope, name: unit.name, type: unit.type, attrs: unit.attrs, aliases: unit.aliases, sources: unit.sources, explain: unit.explain },
      type,
      organization: organizationOf(p, "unit", id),
      tags: allTags(p, "unit", id),
      links,
      missing: missingRoles(p, unit),
      review: reviewOf(p, { kind: "unit", id }),
      history: historyFor(p, { kind: "unit", id }),
      memberships: (p.memberships.get(id) ?? []).map((collectionId) => {
        const collection = p.collectionsById.get(collectionId)!
        const part = reviewOf(p, { kind: "collection", id: collectionId }).parts.find((candidate) => candidate.id === `member:${id}`)
        return { id: collectionId, name: collection.name, category: organizationOf(p, "collection", collectionId).category, verdict: part?.verdict ?? null, position: collection.members.findIndex((member) => member.unit === id), count: collection.members.length }
      }),
      notes: newestFirst([...(p.notesByTarget.get(`unit:${id}`) ?? []), ...linkedAssets.flatMap((asset) => p.notesByTarget.get(`asset:${asset}`) ?? [])].map((note) => noteView(p, note))),
      refs: Object.fromEntries(Object.entries(unit.attrs).filter(([key]) => type.fields.find((field) => field.key === key)?.kind === "refs").map(([key, value]) => [key, unitRefs(p, (Array.isArray(value) ? value : [value]).map(String))])),
      relations: relationsOf(p, id),
      waiting: openItemsFor(p, { kind: "unit", id }),
      // Inspectors and sidebar sections the type mounts for this unit, each with where its module loads from.
      inspectors: type.inspectors.filter((inspector) => unit.inspectors === null || unit.inspectors.includes(inspector.key)).map((inspector) => ({ ...inspector, ...browserModuleOf(p, inspector.module) })),
      panels: type.panels.map((panel) => ({ ...panel, ...browserModuleOf(p, panel.module) })),
      display: type.display ?? p.plugins.config.display
    }
  })

export const collectionGet = (p: Projection, id: string): Effect.Effect<unknown, ToolError, MediaKinds | ProjectFiles> =>
  Effect.gen(function*() {
    const collection = p.collectionsById.get(id)
    if (!collection) return yield* fail("not_found", `collection ${id} is not in this checkout`)
    // The preview is what gets captured and frozen: its inputs are named by digest.
    yield* ensureHashed(p, partAssets(p, { kind: "collection", id }, "preview"))
    const { assetsById, schema, unitsById } = p.snapshot
    const kind = collection.kind ? schema.collectionKinds[collection.kind] ?? null : null
    const review = reviewOf(p, { kind: "collection", id })
    const spec = previewSpec(p, collection)
    const refOf = (assetId: string) => assetRef(p, assetsById.get(assetId)!)
    const preview = spec && {
      label: spec.label,
      module: spec.module,
      moduleUrl: spec.moduleSha && spec.moduleSha !== "missing" ? moduleUrl(spec.module, spec.moduleSha) : null,
      moduleError: spec.moduleSha === "missing" ? `Preview module "${spec.module}" is declared but its file is missing` : null,
      represents: spec.represents,
      config: spec.config,
      roles: spec.roles,
      base: spec.base ? refOf(spec.base) : spec.baseDeclared ? { id: spec.baseDeclared, state: "missing", error: `base ${spec.baseDeclared} is not an asset in this checkout` } : null,
      members: Object.entries(spec.members).flatMap(([unit, parts]) => parts.map((part) => ({ unit, part: part.part, role: part.role, asset: refOf(part.asset) })))
    }
    const extraKey = kind?.memberExtra?.key
    return {
      route: collectionRoute(collection.id),
      collection: { id: collection.id, name: collection.name, kind: collection.kind, kindLabel: kind?.label ?? null, owner: collection.owner, revision: collection.owner === "catalog" ? collection.revision : null, createdBy: collection.createdBy ?? null },
      organization: organizationOf(p, "collection", id),
      tags: allTags(p, "collection", id),
      members: collection.members.map((member, position) => {
        const unit = unitsById.get(member.unit)
        if (!unit) return { id: member.unit, name: member.unit, missingTarget: true, position }
        const value = extraKey === undefined ? null : member[extraKey]
        const extra = kind?.memberField ? formatValue(p, unit.attrs[kind.memberField]) : value == null ? null : kind?.memberExtra?.format === "text" ? String(value) : `×${String(value)}`
        return { ...unitSummary(p, unit), position, extra, inCollection: review.parts.find((part) => part.id === `member:${unit.id}`) ?? null }
      }),
      preview,
      review,
      history: historyFor(p, { kind: "collection", id }),
      notes: newestFirst((p.notesByTarget.get(`collection:${id}`) ?? []).map((note) => noteView(p, note))),
      waiting: openItemsFor(p, { kind: "collection", id })
    }
  })

interface Version {
  readonly sha256: string
  readonly size: number | undefined
  readonly firstSeen: string
  readonly submissions: Array<Record<string, unknown>>
}

export const assetGet = (p: Projection, facts: FactsService, id: string): Effect.Effect<unknown, ToolError, MediaKinds | ProjectFiles> =>
  Effect.gen(function*() {
    const asset = p.snapshot.assetsById.get(id)
    if (!asset) return yield* fail("not_found", `asset ${id} is not in this checkout`)
    yield* ensureHashed(p, [id])
    const { unitsById } = p.snapshot
    const current = assetRef(p, asset)
    const usage = (p.usage.get(id) ?? []).flatMap((use) => {
      const unit = unitsById.get(use.unit)
      if (!unit) return []
      const type = typeOf(p, unit)
      return [{
        unit: unit.id,
        name: unit.name,
        typeLabel: type.label,
        role: use.role,
        roleLabel: type.roles.find((role) => role.key === use.role)?.label ?? use.role,
        part: unitParts(unit, type).find((part) => part.role === use.role && part.asset === id)?.id ?? use.role,
        thumb: thumbOf(p, unit)
      }]
    })
    // Versions: the current file plus every distinct frozen version that review evidence refers to.
    const versions = new Map<string, Version>()
    const verdicts: Array<{ at: string; by: Actor } & Record<string, unknown>> = []
    for (const { item, submission } of p.items.values()) {
      for (const part of item.parts) {
        // Captures are files of a submission, not versions of a catalog asset.
        if (isItemEvidence(part.id)) continue
        const direct = part.evidence.asset === id
        const refs = direct
          ? [{ evidence: part.evidence, leaf: "" }]
          : Object.entries(part.evidence.parts ?? {}).filter(([, leaf]) => leaf.asset === id).map(([key, leaf]) => ({ evidence: leaf, leaf: `${part.evidence.unit}/${key}` }))
        for (const { evidence, leaf } of refs) {
          const sha = evidence.sha256
          if (sha === undefined) continue
          const version = versions.get(sha) ?? { sha256: sha, size: evidence.size, firstSeen: submission.at, submissions: [] }
          versions.set(sha, version)
          version.submissions.push({ submission: submission.id, ref: shortRef(submission.id), item: item.id, part: part.id, leaf, url: evidenceUrl(submission.id, item.id, part.id, leaf) })
          if (!direct) continue
          for (const decision of p.decisionsByItem.get(item.id) ?? []) {
            const verdict = decisionVerdicts(decision)[part.id]
            if (verdict) {
              verdicts.push({ decision: decision.id, submission: submission.id, ref: shortRef(submission.id), item: item.id, part: part.id, partLabel: part.label, target: item.target, targetName: item.title, verdict, partComment: decision.partComments?.[part.id] ?? "", by: decision.by, at: decision.at, sha256: sha })
            }
          }
        }
      }
    }
    return {
      route: assetRoute(id),
      asset: { ...current, label: asset.label },
      organization: organizationOf(p, "asset", id),
      tags: allTags(p, "asset", id),
      usage,
      versions: [
        ...(current.sha256 ? [{ sha256: current.sha256, size: current.size, current: true }] : []),
        ...[...versions.values()].filter((version) => version.sha256 !== current.sha256).sort((a, b) => b.firstSeen.localeCompare(a.firstSeen))
      ],
      verdicts: newestFirst(verdicts),
      facts: yield* facts.forAsset(asset, factsOf(p, id), p.plugins.probes),
      notes: newestFirst((p.notesByTarget.get(`asset:${id}`) ?? []).map((note) => noteView(p, note)))
    }
  })
