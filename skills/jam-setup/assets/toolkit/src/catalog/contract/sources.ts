// Sources and what they supply: types, units, assets, collections and problems, and the shaping
// that follows (enrich, relations). Data a plugin supplies is `*Input`; `SourceOutput` and
// `EnrichPatch` are named by the function that returns them.
import type { PluginContext, PluginResult } from "./context.ts"

export interface ProblemInput {
  /** What the problem is about: a path or a unit id. */
  readonly subject?: string
  readonly error: string
  readonly recovery?: string | null
}

export interface RoleInput {
  readonly key: string
  readonly label: string
  /** Media kind ids the role accepts (`image`, `video`, `model`, `audio`, or a plugin's own). */
  readonly mediaKinds: ReadonlyArray<string>
  readonly many?: boolean
  readonly expected?: boolean
  readonly help?: string | null
}

export interface FieldInput {
  readonly key: string
  readonly label: string
  readonly kind?: string
  readonly unit?: string | null
  readonly help?: string | null
  readonly group?: string | null
  readonly filter?: boolean
  readonly derived?: boolean
  readonly summary?: boolean
}

/**
 * A browser module mounted for one unit. Its export is `mount(host, ctx)`: framework-free, it
 * fills `host` and returns `{ dispose(), state?(), control?(command) }` (see the catalog README).
 */
export interface MountInput {
  readonly key: string
  readonly label: string
  /** A name under the plugin's `browserModules`. */
  readonly module: string
  /** The export to call (default: the default export). */
  readonly export?: string
  readonly help?: string | null
}

export interface TypeInput {
  readonly label?: string
  /** The label of several ("Characters"), where the page lists the type; the label when absent. */
  readonly plural?: string
  /** A registered scope id; the first registered scope when absent. */
  readonly scope?: string
  readonly fields?: ReadonlyArray<FieldInput>
  readonly roles?: ReadonlyArray<RoleInput>
  readonly thumb?: string | null
  readonly help?: string | null
  readonly audioTranscript?: unknown
  readonly reviewAttributes?: boolean
  /**
   * Inspectors in the unit's media strip, selected as `inspector:<key>`; `default: true` opens
   * first. `module` names a browser module the plugin declares under `browserModules`.
   */
  readonly inspectors?: ReadonlyArray<MountInput & { readonly default?: boolean }>
  /** Sidebar sections of the unit's page, from modules declared under `browserModules`. */
  readonly panels?: ReadonlyArray<MountInput>
  /** How this type's images are shown; without it, the project's `display` in catalog.config.json. */
  readonly display?: { readonly pixelArt?: boolean }
}

export interface CollectionKindInput {
  readonly label?: string
  readonly preview?: {
    readonly label?: string
    /** A name under a plugin's `browserModules`, or a preview the page provides (`assembled-mesh`). */
    readonly module?: string
    readonly roles?: ReadonlyArray<string>
    readonly base?: string
    readonly config?: Record<string, unknown>
    readonly represents?: string
  } | null
  readonly memberField?: string | null
  /** A member's own value shown beside it: `×N` (`count`, the default) or as written (`text`). */
  readonly memberExtra?: { readonly key?: string; readonly format?: "count" | "text" } | null
}

export interface AssetInput {
  readonly id: string
  /** Project-relative path under one of the asset roots. */
  readonly path: string
  readonly kind?: string
  readonly label?: string
  readonly tags?: ReadonlyArray<string>
  readonly category?: string | null
}

export interface LinkInput {
  readonly role: string
  /** An asset id, or a project-relative path that becomes an asset. */
  readonly asset: string
  /** Stable identity of this link within a many-role (default: the asset id). */
  readonly key?: string
  /**
   * What a person calls this file in this unit (an animation's name in the game: "Walk"); shown
   * instead of the file's name. Changing it keeps the review part, which `key` identifies.
   */
  readonly label?: string
  /** Per-link data such as a take number or word timings. Shown, never reviewed. */
  readonly meta?: Record<string, unknown>
  /**
   * An image cut into the frames of an animation (a sprite sheet): the page plays it, and a review
   * of this part covers the sheet with the image. See `SheetInput`.
   */
  readonly sheet?: SheetInput
}

/** A sprite sheet as a source gives it: a grid of equal cells, or one rectangle per frame. */
export interface SheetInput {
  /** Frames per second at duration 1. */
  readonly fps: number
  /** Play again from the first frame after the last (default true). */
  readonly loop?: boolean
  /** Equal cells in rows. Cells are counted along rows from the top-left one. */
  readonly grid?: {
    readonly columns: number
    readonly rows?: number
    /** The first cell of the animation (default 0). */
    readonly start?: number
    /** How many cells it plays (default: the rest of the grid). */
    readonly count?: number
    /** A cell's [width, height] in pixels (default: the image divided into columns and rows). */
    readonly cell?: readonly [number, number]
    /** The first cell's top-left corner (default [0, 0]). */
    readonly origin?: readonly [number, number]
    /** Pixels between cells (default [0, 0]). */
    readonly gap?: readonly [number, number]
  }
  /** A grid's per-frame durations, relative to 1 / fps. */
  readonly durations?: ReadonlyArray<number>
  /** One rectangle per frame, for packed or trimmed sheets. */
  readonly frames?: ReadonlyArray<{
    readonly region: readonly [number, number, number, number]
    /** Where the region's top-left sits in the frame (default [0, 0]). */
    readonly offset?: readonly [number, number]
    /** The frame's full [width, height] (default: the region's). */
    readonly size?: readonly [number, number]
    /** How long it shows, relative to 1 / fps (default 1). */
    readonly duration?: number
  }>
}

export interface UnitInput {
  readonly id: string
  readonly type: string
  readonly name?: string
  readonly attrs?: Record<string, unknown>
  readonly links?: ReadonlyArray<LinkInput>
  readonly aliases?: ReadonlyArray<string>
  readonly search?: ReadonlyArray<string>
  readonly sources?: ReadonlyArray<string>
  readonly tags?: ReadonlyArray<string>
  readonly category?: string | null
  readonly explain?: Record<string, unknown>
  /** Keys of its type's inspectors this unit shows (default: all of them). */
  readonly inspectors?: ReadonlyArray<string>
}

export interface CollectionInput {
  readonly id: string
  readonly name: string
  readonly kind?: string | null
  readonly members?: ReadonlyArray<{ readonly unit: string; readonly [extra: string]: unknown }>
  readonly tags?: ReadonlyArray<string>
  readonly category?: string | null
}

/** What a source loads. Every field is optional; several sources are merged in plugin order. */
export interface SourceOutput {
  readonly project?: string | null
  readonly types?: Readonly<Record<string, TypeInput>>
  readonly collectionKinds?: Readonly<Record<string, CollectionKindInput>>
  /** Folders that may hold media (default: the whole project). */
  readonly assetRoots?: ReadonlyArray<string>
  readonly assets?: ReadonlyArray<AssetInput>
  readonly units?: ReadonlyArray<UnitInput>
  readonly collections?: ReadonlyArray<CollectionInput>
  readonly problems?: ReadonlyArray<ProblemInput>
}

export interface Source {
  readonly name: string
  /**
   * Project-relative files and folders this source reads. The source is loaded again only when
   * one of them changes: authored data (.json, .yaml, .toml, .csv, …) by bytes, anything else by
   * size and modification time. Called before every load and again after it, so the list may
   * depend on what was loaded.
   */
  inputs(context: PluginContext): PluginResult<ReadonlyArray<string>>
  /**
   * Project-relative folders `inputs` walks to find its files; `[]` when `inputs` depends only
   * on what was loaded. A running catalog asks `inputs` again only after a change under one of
   * these folders or to an input. Without it, `inputs` is asked after any change in the project.
   */
  scans?(context: PluginContext): PluginResult<ReadonlyArray<string>>
  load(context: PluginContext): PluginResult<SourceOutput>
}

// ---- Shaping what sources produced

export interface MergedSources {
  readonly project: string | null
  readonly types: Readonly<Record<string, TypeInput>>
  readonly collectionKinds: Readonly<Record<string, CollectionKindInput>>
  readonly assetRoots: ReadonlyArray<string>
  readonly assets: ReadonlyArray<AssetInput>
  readonly units: ReadonlyArray<UnitInput>
  readonly collections: ReadonlyArray<CollectionInput>
}

/** Changes applied to the merged sources before they are validated. */
export interface EnrichPatch {
  /** Types added or replaced, by key. */
  readonly types?: Readonly<Record<string, TypeInput>>
  readonly collectionKinds?: Readonly<Record<string, CollectionKindInput>>
  /** By unit id: an object replaces the fields it names; `null` removes the unit. */
  readonly units?: Readonly<Record<string, Partial<Omit<UnitInput, "id">> | null>>
  readonly assets?: ReadonlyArray<AssetInput>
  readonly collections?: ReadonlyArray<CollectionInput>
  readonly problems?: ReadonlyArray<ProblemInput>
}

export interface RelationUnit {
  readonly id: string
  readonly type: string
  readonly name: string
  readonly attrs: Readonly<Record<string, unknown>>
  readonly links: ReadonlyArray<LinkInput>
}

/**
 * A named reference from one unit to others. The catalog computes the reverse side, so
 * `unit.get` shows both "uses" and "used by" without either unit storing the other.
 */
export interface Relation {
  readonly name: string
  readonly label: string
  readonly inverseLabel: string
  from(unit: RelationUnit): ReadonlyArray<string>
}

/** Declares a source. It returns its argument; it exists so a type error points at the wrong property. */
export const defineSource = (definition: Source): Source => definition

/** Declares a type. It returns its argument; it exists so a type error points at the wrong property. */
export const defineType = (type: TypeInput): TypeInput => type
