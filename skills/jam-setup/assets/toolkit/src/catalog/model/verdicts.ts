// Verdict events and how they resolve to one current verdict per part. Events are immutable
// files; everything here is a deterministic reading of them.
import type { Actor, VerdictRecord } from "./types.ts"

export const VERDICTS = ["approved", "changes", "rejected"] as const
export type Verdict = (typeof VERDICTS)[number]

/** The per-part verdicts one event records. */
export const eventVerdicts = (event: VerdictRecord): Record<string, string> =>
  event.scope.kind === "whole"
    ? Object.fromEntries(event.scope.parts.map((part) => [part, event.exceptions?.[part] ?? event.verdict ?? ""]))
    : { ...event.verdicts }

/** The documented order: recorded UTC time, then event identity. */
export const eventOrder = (a: VerdictRecord, b: VerdictRecord): number =>
  a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0

/** Picks the deciding event among the ordered events that address one part. */
export type Resolver = (events: ReadonlyArray<VerdictRecord>, part: string) => VerdictRecord | null | undefined

const SEVERITY: Record<string, number> = { approved: 0, changes: 1, rejected: 2 }
const severity = (event: VerdictRecord, part: string): number => SEVERITY[eventVerdicts(event)[part] ?? ""] ?? -1
const actorKey = (actor: Actor): string => `${actor.kind}:${actor.name}`

export const RESOLVERS: Readonly<Record<string, Resolver>> = {
  /** The latest verdict addressing the part. */
  latest: (events) => events.at(-1) ?? null,
  /** Each actor's latest verdict counts; the most severe of those decides. */
  strictest: (events, part) => {
    const byActor = new Map<string, VerdictRecord>()
    for (const event of events) byActor.set(actorKey(event.by), event)
    let pick: VerdictRecord | null = null
    for (const event of byActor.values()) {
      if (
        !pick || severity(event, part) > severity(pick, part) ||
        (severity(event, part) === severity(pick, part) && eventOrder(event, pick) > 0)
      ) pick = event
    }
    return pick
  }
}

export interface Resolved {
  readonly verdict: string
  readonly event: VerdictRecord
}

export const resolveParts = (
  events: ReadonlyArray<VerdictRecord>,
  partIds: ReadonlyArray<string>,
  resolver: Resolver
): Record<string, Resolved | null> => {
  const sorted = [...events].sort(eventOrder)
  const out: Record<string, Resolved | null> = {}
  for (const part of partIds) {
    const addressing = sorted.filter((event) => eventVerdicts(event)[part])
    const event = addressing.length > 0 ? resolver(addressing, part) : null
    out[part] = event ? { verdict: eventVerdicts(event)[part] ?? "", event } : null
  }
  return out
}

export type ReviewState = "none" | "undecided" | "approved" | "partial" | "changes" | "rejected" | "mixed"

export interface Rollup {
  readonly total: number
  readonly approved: number
  readonly changes: number
  readonly rejected: number
  readonly undecided: number
  readonly changed: number
  readonly state: ReviewState
}

/** Roll per-part verdicts up into one state for a unit, collection or submission item. */
export const summarize = (
  parts: ReadonlyArray<{ readonly verdict: string | null; readonly changed?: boolean }>
): Rollup => {
  const count = { approved: 0, changes: 0, rejected: 0, undecided: 0 }
  let changed = 0
  for (const part of parts) {
    const key = (part.verdict ?? "undecided") as keyof typeof count
    if (key in count) count[key]++
    if (part.changed) changed++
  }
  const total = parts.length
  const state: ReviewState = total === 0
    ? "none"
    : count.undecided === total
    ? "undecided"
    : count.approved === total
    ? "approved"
    : !count.changes && !count.rejected
    ? "partial"
    : count.changes && !count.rejected
    ? "changes"
    : count.rejected && !count.changes
    ? "rejected"
    : "mixed"
  return { total, ...count, changed, state }
}

export const STATE_LABEL: Readonly<Record<ReviewState, string>> = {
  approved: "Approved",
  changes: "Changes requested",
  rejected: "Rejected",
  partial: "Partly approved",
  mixed: "Mixed",
  undecided: "Undecided",
  none: "No parts"
}
