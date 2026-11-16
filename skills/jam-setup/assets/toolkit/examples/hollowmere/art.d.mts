// Types of art.mjs, the procedural art generator of the Hollowmere sample project.
import type { Browser } from "playwright"

export type Palette =
  | "steel" | "rust" | "leather" | "ash" | "oak" | "fire" | "frost" | "shadow"
  | "stone" | "mire" | "matriarch" | "ridge" | "cinder" | "clay"

export type IconShape =
  | "helm" | "hood" | "chest" | "gloves" | "boots" | "sword" | "shield" | "buckler"
  | "flame" | "frost" | "dash" | "ward" | "ration" | "flask" | "bomb" | "herb"

export type CreatureShape = "lurker" | "wolf" | "moth" | "toad" | "warden"

export type MeshShape =
  | "mannequin" | "helm" | "hood" | "chest" | "gloves" | "boots" | "shield" | "buckler" | "sword"
  | "lurker" | "wolf" | "moth" | "toad"

/** A square PNG icon of one shape. */
export interface IconSpec {
  readonly g: "icon"
  readonly shape: IconShape
  readonly palette: Palette
  readonly crest?: boolean
}

/** A PNG portrait of one creature. */
export interface PortraitSpec {
  readonly g: "portrait"
  readonly shape: CreatureShape
  readonly palette: Palette
  readonly glow?: boolean
  readonly crown?: boolean
}

/** A PNG concept sheet: a row of icon shapes, or one creature with its line drawing. */
export interface SheetSpec {
  readonly g: "sheet"
  readonly title: string
  readonly palette: Palette
  readonly shapes?: ReadonlyArray<IconShape>
  readonly creature?: CreatureShape
  readonly crest?: boolean
}

/** A self-contained GLB model, optionally with a base-color texture and named animation clips. */
export interface MeshSpec {
  readonly g: "mesh"
  readonly shape: MeshShape
  readonly palette: Palette
  readonly crest?: boolean
  readonly horns?: boolean
  readonly bulky?: boolean
  readonly texture?: "scales"
  readonly clips?: ReadonlyArray<"Idle" | "Alert">
}

/** An MP4 effect clip made by ffmpeg. */
export interface VfxSpec {
  readonly g: "vfx"
  readonly look: "ember" | "frost"
  readonly speed: number
  readonly hot?: boolean
}

/** An MP4 turntable of a model rendered earlier in the same call or already in the folder. */
export interface TurntableSpec {
  readonly g: "turntable"
  /** The model's path relative to the output folder, with forward slashes. */
  readonly mesh: string
}

export type ArtSpec = IconSpec | PortraitSpec | SheetSpec | MeshSpec | VfxSpec | TurntableSpec

export interface RenderJob {
  /** Where the file goes, relative to the output folder, with forward slashes. */
  readonly path: string
  readonly spec: ArtSpec
}

/**
 * Render each job into `dir/<path>`. Video jobs (`vfx`, `turntable`) need ffmpeg and are skipped
 * when `videos` is false. The browser stays open; the caller closes it.
 */
export function renderAssets(jobs: ReadonlyArray<RenderJob>, dir: string, browser: Browser, options?: { readonly videos?: boolean }): Promise<void>

/** Whether ffmpeg can be run. */
export function hasFfmpeg(): boolean
