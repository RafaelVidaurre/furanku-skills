// Kinds of media, recognised by bytes, and probes that measure media files.
import type { PluginContext, PluginResult } from "./context.ts"

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
   * `(catalog) => void` and calls `catalog.registerMediaKind(id, { viewer, thumbnail, compare, capture })`
   * (types: `catalog-plugin-web.d.ts`). The server hands out exactly this file, by kind id.
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
  readonly mediaKinds: ReadonlyArray<string>
  /** How to label the facts it returns. */
  readonly fields?: ReadonlyArray<{ readonly key: string; readonly label: string; readonly unit?: string }>
  measure(file: ProbeFile, context: PluginContext): PluginResult<Readonly<Record<string, unknown>>>
}

/** Declares a media kind. It returns its argument; it exists so a type error points at the wrong property. */
export const defineMediaKind = (kind: MediaKind): MediaKind => kind

/** Declares a probe. It returns its argument; it exists so a type error points at the wrong property. */
export const defineProbe = (probe: Probe): Probe => probe
