// The catalog's plugin contract. This file is the only interface for plugin authors: everything a
// project or another part of the toolkit may rely on is exported here, and nothing else under
// src/catalog is. A plugin is a module whose default export is a plain object (see `definePlugin`);
// each of its functions may return a value, a promise or an Effect.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type { Actor, VerdictRecord } from "./model/types.ts"

// A project plugin cannot resolve the toolkit's packages from its own folder, so the two it needs
// (schemas for action inputs, and Effect for functions that want it) are handed on from here.
export { Effect, Schema }

export type { Actor, VerdictRecord } from "./model/types.ts"
/** Throw `toolError(code, message, { fix })` from a plugin function to fail with a specific error code. */
export { type ErrorCode, ToolError, toolError } from "../kernel/errors.ts"

/** What a plugin function may return. An Effect must need no services; its failure is reported. */
export type PluginResult<A> = A | PromiseLike<A> | Effect.Effect<A, unknown, never>

/** Confined reads of project files: project-relative forward-slash paths, never outside the project. */
export interface PluginFiles {
  exists(path: string): Promise<boolean>
  readText(path: string): Promise<string>
  readJson(path: string): Promise<unknown>
  readBytes(path: string): Promise<Uint8Array>
  /** Every file under a folder, sorted, as project-relative paths. A missing folder is empty. */
  walk(path: string): Promise<ReadonlyArray<string>>
}

export interface PluginContext {
  /** Absolute project root. */
  readonly root: string
  /** This plugin's entry under `options` in catalog.config.json (empty when absent). */
  readonly options: Readonly<Record<string, unknown>>
  readonly files: PluginFiles
}

// ---- Sources

export interface ProblemInput {
  readonly source?: string
  readonly error: string
  readonly recovery?: string | null
}

export interface RoleInput {
  readonly key: string
  readonly label: string
  /** Media kind ids the role accepts (`image`, `video`, `model`, `audio`, or a plugin's own). */
  readonly kinds: ReadonlyArray<string>
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

export interface TypeInput {
  readonly label?: string
  /** A registered scope id; the first registered scope when absent. */
  readonly scope?: string
  readonly fields?: ReadonlyArray<FieldInput>
  readonly roles?: ReadonlyArray<RoleInput>
  readonly thumb?: string | null
  readonly help?: string | null
  readonly audioTranscript?: unknown
  readonly reviewAttributes?: boolean
  /**
   * Inspectors in the unit's visual strip, selected as part `view:<key>`; `default: true` opens
   * first. `module` names a browser module the plugin declares under `views`.
   */
  readonly views?: ReadonlyArray<MountInput & { readonly default?: boolean }>
  /** Sidebar sections of the unit's page, from modules declared under `views`. */
  readonly panels?: ReadonlyArray<MountInput>
  /** How this type's images are shown; without it, the project's `display` in catalog.config.json. */
  readonly display?: { readonly pixelArt?: boolean }
}

/**
 * A browser module mounted for one unit. Its export is `mount(host, ctx)`: framework-free, it
 * fills `host` and returns `{ dispose(), state?(), control?(command) }` (see the catalog README).
 */
export interface MountInput {
  readonly key: string
  readonly label: string
  /** A name under the plugin's `views`. */
  readonly module: string
  /** The export to call (default: the default export). */
  readonly export?: string
  readonly help?: string | null
}

export interface CollectionKindInput {
  readonly label?: string
  readonly preview?: {
    readonly label?: string
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
  /** Per-link data such as a take number or word timings. Shown, never reviewed. */
  readonly meta?: Record<string, unknown>
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
  /** Keys of its type's views this unit shows (default: all of them). */
  readonly views?: ReadonlyArray<string>
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
  /** Version 1 adapters nest `types` and `collectionKinds` here. */
  readonly schema?: { readonly types?: Readonly<Record<string, TypeInput>>; readonly collectionKinds?: Readonly<Record<string, CollectionKindInput>> }
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

// ---- Media

export interface MediaKind {
  readonly id: string
  readonly label: string
  /** Lower-case extensions without the dot; used to name a kind before bytes are read. */
  readonly extensions: ReadonlyArray<string>
  /** The MIME type when the first bytes (at most 64) are this kind, else null. Extensions are not trusted. */
  sniff(head: Uint8Array): string | null
  /** A reason the file cannot be shown although its bytes are this kind, else null. */
  validate?(file: { readonly path: string; readonly absolutePath: string; readonly size: number }): PluginResult<string | null>
  /**
   * The browser module that registers this kind's viewer, thumbnail and comparison in the page: a
   * project-relative `.js`/`.mjs` path, or a `file:` URL for a module that ships beside the
   * plugin (`new URL("./viewer.js", import.meta.url).href`). It default-exports
   * `(catalog) => void` and calls `catalog.registerMediaKind(id, { viewer, thumbnail, compare, capture })`.
   * The server hands out exactly this file, by kind id.
   */
  readonly web?: string
}

export interface ProbeFile {
  readonly asset: string
  readonly path: string
  readonly absolutePath: string
  readonly sha256: string
  readonly size: number
  readonly mime: string
  readonly kind: string
}

/**
 * Measures facts of a media file. Results are cached by probe name, version and the file's
 * SHA-256, so a file is measured once per version of the probe; raise `version` to measure again.
 * Facts are shown beside content as derived values and are never part of review evidence.
 */
export interface Probe {
  readonly name: string
  readonly version: string
  /** Media kind ids this probe measures. */
  readonly kinds: ReadonlyArray<string>
  /** How to label the facts it returns. */
  readonly fields?: ReadonlyArray<{ readonly key: string; readonly label: string; readonly unit?: string }>
  measure(file: ProbeFile, context: PluginContext): PluginResult<Readonly<Record<string, unknown>>>
}

// ---- Checks and actions

/** Runs a catalog action from inside a plugin. Writes keep the calling action's actor. */
export type RunAction = (action: string, input?: unknown) => Promise<unknown>

export interface CheckProblem {
  readonly message: string
  /** What the problem is about: a path, a unit id. */
  readonly subject?: string
  /** `info` is worth knowing (work waiting on a person) but does not make the check fail. */
  readonly severity?: "problem" | "info"
  /** A repair `doctor.fix` (`jam catalog doctor --fix`) may apply. Without `apply`, the label is advice for a person. */
  readonly fix?: { readonly label: string; apply?(): PluginResult<void> }
}

export interface CheckContext extends PluginContext {
  /** Read actions only, also while repairs are being applied. */
  readonly run: RunAction
}

export interface Check {
  readonly name: string
  readonly label?: string
  run(context: CheckContext): PluginResult<ReadonlyArray<CheckProblem>>
}

export interface ActionContext extends PluginContext {
  /** The declared actor of a write action; null for reads. */
  readonly actor: Actor | null
  readonly requestId: string | null
  readonly run: RunAction
}

/**
 * An action the project adds to the catalog's registry. It is listed by `catalog actions`, takes
 * the same actor and request-id rules as built-in writes, and its input is decoded with `input`.
 */
export interface PluginAction<S extends Schema.Top = Schema.Top> {
  readonly name: string
  readonly kind: "read" | "write"
  readonly description: string
  /** A `Schema.Struct`; published as JSON Schema. */
  readonly input: S
  run(input: S["Type"], context: ActionContext): PluginResult<unknown>
}

/** Typed constructor for an action, so `run` sees the decoded input type. */
export const defineAction = <S extends Schema.Top>(action: PluginAction<S>): PluginAction => action as unknown as PluginAction

// ---- Review and layout

/** One side of the top-level split of units (which a type selects with `scope`). */
export interface ScopeDef {
  readonly id: string
  readonly label: string
  readonly description: string
}

/** Picks the deciding verdict among the time-ordered events that address one part. */
export type VerdictResolver = (events: ReadonlyArray<VerdictRecord>, part: string) => VerdictRecord | null | undefined

export interface Plugin {
  readonly name: string
  readonly sources?: ReadonlyArray<Source>
  /** Runs after sources merge, in plugin order; each sees the previous plugins' changes. */
  enrich?(merged: MergedSources, context: PluginContext): PluginResult<EnrichPatch | void>
  readonly relations?: ReadonlyArray<Relation>
  readonly mediaKinds?: ReadonlyArray<MediaKind>
  readonly probes?: ReadonlyArray<Probe>
  readonly checks?: ReadonlyArray<Check>
  readonly actions?: ReadonlyArray<PluginAction>
  readonly scopes?: ReadonlyArray<ScopeDef>
  /** Verdict resolvers by the name `review.resolver` selects. */
  readonly resolvers?: Readonly<Record<string, VerdictResolver>>
  /**
   * Collection preview modules by name: browser modules (`.js` or `.mjs`), each a project-relative
   * path or a `file:` URL beside the plugin, as for a media kind's `web`.
   */
  readonly previews?: Readonly<Record<string, string>>
  /**
   * Modules of type views and panels by name, declared like `previews`. A module exports
   * `mount(host, ctx)` functions; a type's view or panel names one with `module` and `export`.
   */
  readonly views?: Readonly<Record<string, string>>
}

/** Declares a plugin. It returns its argument; it exists so editors check the shape. */
export const definePlugin = <P extends Plugin>(plugin: P): P => plugin

/** A version 1 adapter module: `export default ({ root, options }) => ({ name?, sources(), load() })`. */
export type AdapterFactory = (input: { readonly root: string; readonly options: Record<string, unknown> }) => {
  readonly name?: string
  sources?(): ReadonlyArray<string>
  load(): SourceOutput | PromiseLike<SourceOutput>
}
