// The catalog's `jam` plugin: runs become catalog content. Listed by name in catalog.config.json
// (`"plugins": ["manifest", "jam"]`).
//
//   sources    one unit per subject, typed by its recipe, linking what its steps produced
//   enrich     "made from": the units a subject's inputs came from, whichever plugin lists them
//   relations  made-from, so the unit an input came from shows "used by"
//   probes     the toolkit's own measurements, for every model and image in the catalog
//   checks     what `jam catalog doctor` reports about runs
//
// This module only describes the plugin. Everything it does goes through `RunCatalog`, which the
// composition (src/cli/compose.ts) builds the first time the catalog asks: a catalog that does
// not list `jam` never loads the run ledger.
import { defineCheck, definePlugin, defineProbe, defineSource, Effect, type EnrichPatch, type MergedSources, type Plugin, type Probe, type ToolError } from "../../catalog/plugin.ts"
import type { RunCatalog } from "./RunCatalog.ts"

/** Reaches the run ledger. The effect it returns needs no services, as plugin functions must. */
export type RunCatalogAccess = <A>(use: (runs: RunCatalog["Service"]) => Effect.Effect<A, ToolError>) => Effect.Effect<A, ToolError>

/** Unit attributes: the units a subject was made from, and the files its steps consumed. */
export const MADE_FROM = "madeFrom"
export const INPUTS = "inputs"

/** The doctor checks, by name. Labels are what `doctor` prints as headings. */
export const CHECKS = {
  "jam-delivered-files": "Delivered runs with missing or Git-ignored files",
  "jam-unsettled-jobs": "Provider jobs that are not settled",
  "jam-review-not-requested": "Steps waiting on a person whom nobody asked",
  "jam-not-imported": "Delivered subjects the engine has not imported",
  "jam-superseded-scratch": "Scratch runs superseded by a delivery"
} as const
export type CheckName = keyof typeof CHECKS

const strings = (value: unknown): ReadonlyArray<string> => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [])

/**
 * A subject's inputs may be media another plugin's unit shows (a hand-registered kit piece, a
 * reference sheet). After the sources merge, every input is traced to the units that link it.
 */
const traceInputs = (merged: MergedSources, own: ReadonlySet<string>): EnrichPatch | void => {
  const pathOf = new Map(merged.assets.map((asset) => [asset.id, asset.path]))
  const shownBy = new Map<string, Array<string>>()
  for (const unit of merged.units) {
    for (const link of unit.links ?? []) {
      const path = pathOf.get(link.asset) ?? link.asset
      shownBy.set(path, [...(shownBy.get(path) ?? []), unit.id])
    }
  }
  const units: Record<string, { attrs: Record<string, unknown> }> = {}
  for (const unit of merged.units) {
    if (!own.has(unit.id)) continue
    const known = strings(unit.attrs?.[MADE_FROM])
    const traced = strings(unit.attrs?.[INPUTS]).flatMap((path) => shownBy.get(path) ?? []).filter((id) => id !== unit.id && !known.includes(id))
    if (traced.length > 0) units[unit.id] = { attrs: { ...unit.attrs, [MADE_FROM]: [...known, ...new Set(traced)] } }
  }
  return Object.keys(units).length > 0 ? { units } : undefined
}

const PROBES: ReadonlyArray<Omit<Probe, "measure">> = [
  {
    name: "jam-geometry",
    version: "1",
    mediaKinds: ["model"],
    fields: [
      { key: "triangles", label: "Triangles" },
      { key: "materials", label: "Materials" },
      { key: "textureMiB", label: "Texture memory", unit: "MiB" },
      { key: "textures", label: "Textures" },
      { key: "vertices", label: "Exported vertices" },
      { key: "drawPrimitives", label: "Draw primitives" }
    ]
  },
  { name: "jam-pixels", version: "1", mediaKinds: ["image"], fields: [{ key: "width", label: "Width", unit: "px" }, { key: "height", label: "Height", unit: "px" }] }
]

export const jamPlugin = (runs: RunCatalogAccess): Plugin => {
  // The subjects the source loaded last, so enrich touches only the units this plugin made.
  let subjects: ReadonlySet<string> = new Set()
  return definePlugin({
    name: "jam",
    sources: [defineSource({
      name: "runs",
      inputs: ({ options }) => options.includeRuns === false ? [] : runs((ledger) => ledger.inputs),
      scans: ({ options }) => options.includeRuns === false ? [] : runs((ledger) => ledger.scans),
      load: ({ options }) => {
        if (options.includeRuns === false) {
          subjects = new Set()
          return {}
        }
        return Effect.tap(runs((ledger) => ledger.load), (output) => Effect.sync(() => void (subjects = new Set((output.units ?? []).map((unit) => unit.id)))))
      }
    })],
    enrich: (merged) => subjects.size ? traceInputs(merged, subjects) : undefined,
    relations: [{ name: "made-from", label: "Made from", inverseLabel: "Used by", from: (unit) => strings(unit.attrs[MADE_FROM]) }],
    probes: PROBES.map((probe) => defineProbe({ ...probe, measure: (file) => runs((ledger) => ledger.measure(file.path)) })),
    checks: Object.entries(CHECKS).map(([name, label]) => defineCheck({ name, label, run: () => runs((ledger) => ledger.check(name as CheckName)) }))
  })
}
