// Where the browser shows each thing. Results that create or name a review or a catalog page
// carry the page's `route` (the part of the address after the server), and gain a clickable `url`
// when a server for this checkout is running: people ask for "the review link", and it should
// come back without anyone assembling it.
import type { Target } from "./model/types.ts"
import type { Projection } from "./Projection.ts"

const enc = encodeURIComponent

/** Sections of the page that are not unit scopes. A scope cannot take one of these ids. */
export const RESERVED_SECTIONS: ReadonlyArray<string> = ["collections", "assets", "reviews", "notes", "organization", "inbox"]

export const unitRoute = (scope: string, id: string): string => `#/${enc(scope)}/u/${enc(id)}`
export const collectionRoute = (id: string): string => `#/collections/c/${enc(id)}`
export const assetRoute = (id: string): string => `#/assets/a/${enc(id)}`
export const reviewRoute = (submission: string, item?: string): string => `#/reviews/s/${enc(submission)}${item === undefined ? "" : `/${enc(item)}`}`

/** The page of a note's or decision's target; null when the target is not in this checkout. */
export const targetRoute = (p: Projection, target: Target & { readonly item?: string | undefined }): string | null => {
  if (target.kind === "submission") return reviewRoute(target.id, target.item)
  if (target.kind === "collection") return collectionRoute(target.id)
  if (target.kind === "asset") return assetRoute(target.id)
  const unit = p.snapshot.unitsById.get(target.id)
  return unit ? unitRoute(unit.scope, unit.id) : null
}

export const OPEN_HINT = "No catalog server is running for this checkout. Run `jam catalog open` to start one; it prints the address these routes follow."

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)

/** Whether a result names a page anywhere inside it. */
export const hasRoutes = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.some(hasRoutes)
    : isRecord(value) && ((typeof value["route"] === "string" && value["route"].startsWith("#/")) || Object.values(value).some(hasRoutes))

const withUrls = (value: unknown, base: string): unknown => {
  if (Array.isArray(value)) return value.map((entry) => withUrls(entry, base))
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    out[key] = withUrls(entry, base)
    if (key === "route" && typeof entry === "string" && entry.startsWith("#/")) out["url"] = `${base}${entry}`
  }
  return out
}

/**
 * Add a `url` beside every `route` in an action's result when a server is known (`base` is its
 * address, ending in `/`); otherwise add one `hint` saying how to get one.
 */
export const linked = (result: unknown, base: string | null): unknown => {
  if (!isRecord(result) || !hasRoutes(result)) return result
  return base === null ? { ...result, hint: OPEN_HINT } : withUrls(result, base)
}
