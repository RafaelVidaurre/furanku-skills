// Upgrading a version 1 jam.config.json. Pure: the caller supplies what version 1 took for granted
// (shipped as data) and how the shipped recipes gate their steps.
import { isNonEmpty, isRecord } from "../../kernel/hash.ts"
import type { Gate, Recipe, Step } from "../recipes/schema.ts"

export interface MigrationDefaults {
  readonly toolkit: string
  readonly roots: { readonly scratch: string; readonly delivered: string; readonly scan: ReadonlyArray<string> }
  /** Recipes version 1 work maps to: every run (`legacy`), and new work by asset kind. */
  readonly recipes: { readonly legacy: string; readonly static: string; readonly deforming: string }
  /** The version 1 stage names, which are step ids of those recipes. */
  readonly stages: ReadonlyArray<string>
  /** Keys of a version 1 jam.local.json that named a provider's executable. */
  readonly localProviderKeys: ReadonlyArray<string>
}

export interface Shipped {
  readonly ids: ReadonlySet<string>
  /** How a shipped recipe gates a step, or undefined when it has no such step. */
  review(recipe: string, step: string): Gate | undefined
}

export interface Migration {
  readonly config: Record<string, unknown>
  /** Project recipes that carry the version 1 review policy; written only where no file exists. */
  readonly recipes: ReadonlyArray<Recipe>
  readonly notes: ReadonlyArray<string>
}

const AXES = new Set(["+X", "-X", "+Y", "-Y", "+Z", "-Z"])
const CONTEXT_FIELDS = ["platforms", "renderer", "camera", "cameraDistanceMeters", "screenCoveragePercent", "expectedInstances", "materialWorkflow"]
const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "profile"
const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {})
const positiveInt = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0

// Version 1: the run's own human stages, then the profile's policy, then the project's.
const reviewerFor = (review: Record<string, unknown>, profile: string | undefined, stage: string): Gate => {
  const pipeline = profile === undefined ? {} : record(record(review["profiles"])[profile])
  const chosen = record(pipeline["stages"])[stage] ?? pipeline["default"] ?? record(review["stages"])[stage] ?? review["default"]
  return chosen === "agent" ? "agent" : "human"
}

export const migrateConfig = (v1: Record<string, unknown>, defaults: MigrationDefaults, shipped: Shipped): Migration => {
  const notes: Array<string> = []
  const budgets: Record<string, unknown> = {}
  const skeletons: Record<string, unknown> = {}
  const authoring: Record<string, unknown> = {}
  const unmigrated: Record<string, unknown> = {}
  const skeletonKeys = new Map<string, string>()
  const kinds = new Map<string, "static" | "deforming">()
  const names = new Map<string, string>()

  for (const [name, raw] of Object.entries(record(v1["profiles"]))) {
    const profile = record(raw)
    const id = slug(name)
    names.set(name, id)
    if (id !== name) notes.push(`profile ${name} is budget ${id} (ids are lowercase letters, digits and hyphens)`)
    const kind = profile["assetKind"] === "deforming" ? "deforming" : profile["assetKind"] === "static" ? "static" : null
    const complete = kind !== null && ["targetTriangles", "maxTriangles", "textureSize", "maxMaterials"].every((field) => positiveInt(profile[field])) &&
      typeof profile["maxTextureMiB"] === "number" && profile["maxTextureMiB"] > 0 &&
      (kind === "static" || (positiveInt(profile["maxInfluences"]) && isNonEmpty(profile["poseRequirements"])))
    if (!complete) {
      unmigrated[id] = profile
      notes.push(`profile ${name} is incomplete and did not become a budget; it is kept as written under engine.facts.extra.v1Profiles.${id}`)
      continue
    }
    kinds.set(id, kind)
    let skeleton: string | undefined
    if (isNonEmpty(profile["skeleton"])) {
      skeleton = skeletonKeys.get(profile["skeleton"])
      if (skeleton === undefined) {
        skeleton = id
        skeletonKeys.set(profile["skeleton"], id)
        // Version 1 described the skeleton in prose; its bone names per landmark are for the project or an adapter to fill in.
        skeletons[id] = { label: id, notes: profile["skeleton"], bones: {} }
      }
    }
    const context = Object.fromEntries(CONTEXT_FIELDS.filter((field) => profile[field] !== undefined).map((field) => [field, profile[field]]))
    budgets[id] = {
      kind,
      triangles: { target: profile["targetTriangles"], max: profile["maxTriangles"] },
      textureSize: profile["textureSize"],
      maxMaterials: profile["maxMaterials"],
      maxTextureMiB: profile["maxTextureMiB"],
      ...(skeleton === undefined ? {} : { skeleton }),
      ...(kind === "deforming" ? { maxInfluences: profile["maxInfluences"], poses: profile["poseRequirements"] } : {}),
      ...(Object.keys(context).length === 0 ? {} : { context })
    }
    const conventions = {
      ...(isNonEmpty(profile["units"]) ? { units: profile["units"] } : {}),
      ...(AXES.has(profile["up"] as string) ? { up: profile["up"] } : {}),
      ...(AXES.has(profile["forward"] as string) ? { forward: profile["forward"] } : {}),
      ...(isNonEmpty(profile["pivot"]) ? { pivot: profile["pivot"] } : {})
    }
    if (Object.keys(conventions).length > 0) authoring[id] = conventions
  }
  if (Object.keys(authoring).length > 0) {
    notes.push("units, axes and pivot of each profile are kept under engine.facts.authoring; an engine adapter's own facts replace them once one is chosen")
  }
  if (Object.keys(skeletons).length > 0) notes.push("skeleton descriptions are kept under skeletons.<id>.notes; add each skeleton's bone names per landmark, or name a skeleton an engine adapter provides")

  const spend: Record<string, unknown> = {}
  for (const [provider, raw] of Object.entries(record(v1["spend"]))) {
    const limit = record(raw)["limit"]
    spend[slug(provider)] = { perRun: typeof limit === "number" || limit === null ? limit : 0, total: null }
  }
  if (Object.keys(spend).length > 0) notes.push("spending limits became spend.<provider>.perRun with no total cap; units now come from the provider descriptor")

  const review = record(v1["review"])
  const profiles = [...kinds.keys()]
  const original = (id: string): string => [...names.entries()].find(([, mapped]) => mapped === id)?.[0] ?? id
  const everyGate = [
    ...defaults.stages.map((stage) => reviewerFor(review, undefined, stage)),
    ...profiles.flatMap((id) => defaults.stages.map((stage) => reviewerFor(review, original(id), stage)))
  ]
  const mode = everyGate.every((gate) => gate === "agent") ? "agent" : "recipe"

  const overrides = (base: string, profile: string | undefined): Array<Step> =>
    defaults.stages.flatMap((stage): Array<Step> => {
      const was = reviewerFor(review, profile, stage)
      const now = shipped.review(base, stage)
      return now === undefined || now === was ? [] : [{ id: stage, review: was }]
    })

  const recipes: Array<Recipe> = []
  const legacy = overrides(defaults.recipes.legacy, undefined)
  if (legacy.length > 0) {
    recipes.push({
      version: 1,
      id: defaults.recipes.legacy,
      title: "3D asset (project review policy)",
      description: "The project's version 1 review policy for runs without a profile of their own, and for runs started with version 1.",
      extends: `builtin:${defaults.recipes.legacy}`,
      steps: legacy
    })
  }
  for (const id of profiles) {
    const base = defaults.recipes[kinds.get(id)!]
    if (shipped.ids.has(id) && id !== base) {
      notes.push(`budget ${id} has the name of a shipped recipe of another kind, so no recipe was written for it; start its runs with "--budget ${id}"`)
      continue
    }
    const steps = overrides(base, original(id))
    if (id === base && steps.length === 0) continue
    recipes.push({
      version: 1,
      id,
      title: `${id} (${kinds.get(id)})`,
      description: `Runs with budget ${id}, gated as version 1 profile ${original(id)} was.`,
      extends: `builtin:${base}`,
      budget: id,
      steps
    })
  }
  if (recipes.length > 0) notes.push(`the review policy is now in the recipes: ${recipes.map((recipe) => recipe.id).join(", ")} (jam/recipes/); change a gate with "jam recipe set <recipe> <step> --review human|agent|none"`)

  const style = record(v1["style"])
  const routes = Object.fromEntries(Object.entries(record(v1["providers"])).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
  const facts = {
    ...(Object.keys(authoring).length === 0 ? {} : { authoring }),
    ...(Object.keys(unmigrated).length === 0 ? {} : { extra: { v1Profiles: unmigrated } })
  }
  return {
    config: {
      version: 2,
      toolkit: defaults.toolkit,
      roots: defaults.roots,
      style: {
        document: isNonEmpty(style["document"]) ? style["document"] : null,
        ...(isNonEmpty(style["revision"]) ? { revision: style["revision"] } : {}),
        references: Array.isArray(style["references"]) ? style["references"] : []
      },
      budgets,
      skeletons,
      engine: { adapter: null, facts },
      routes,
      spend,
      review: { mode },
      checks: {}
    },
    recipes,
    notes
  }
}

/** A version 1 jam.local.json kept provider executables as top-level keys. */
export const migrateLocal = (raw: Record<string, unknown>, defaults: MigrationDefaults): { readonly local: Record<string, unknown>; readonly changed: boolean } => {
  const moved = defaults.localProviderKeys.filter((key) => typeof raw[key] === "string")
  if (moved.length === 0) return { local: raw, changed: false }
  const rest = Object.fromEntries(Object.entries(raw).filter(([key]) => !moved.includes(key)))
  return { local: { ...rest, providers: { ...record(raw["providers"]), ...Object.fromEntries(moved.map((key) => [key, raw[key]])) } }, changed: true }
}
