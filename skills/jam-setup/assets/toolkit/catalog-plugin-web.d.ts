// Types of the catalog page's contract for browser modules, for plugin authors. Browser modules are
// plain `.js`/`.mjs` files; they use these types through JSDoc, from a project's catalog/ folder:
//
//   /** @type {import('../tools/jam/catalog-plugin-web.d.ts').MountFunction} */
//   export function placement(host, ctx) { … }
//
// There are two contracts.
//
// 1. Mount modules (inspectors and panels) are framework-free: a named export (`export` in the
//    declaration, default `default`) `mount(host, ctx)` fills `host` and returns a `Controller`.
// 2. Page-integrated modules embed the page's viewer components: a media kind's module
//    (`MediaKind.web`) default-exports `(catalog: CatalogApi) => void` and calls
//    `catalog.registerMediaKind(id, definition)`; a collection preview module default-exports a
//    `PreviewFunction`.
//
// A plugin declares inspector, panel and preview modules under `browserModules`; the page loads
// each from `/project/module/<name>?v=<digest>`, and a media kind's from `/project/kind/<kind>`.

/** Markup the page renders: what `html` returns (a Preact element), a string, or nothing. */
type Markup = unknown
/** A component of the page: a function of its props that returns markup. */
type Component<P = Record<string, unknown>> = (props: P) => Markup

/**
 * What a viewer reports, through `useViewer`: what a person's page and an agent's viewer session
 * (`viewer.state`) read. A capture is taken only while `status` is `ready`.
 */
export interface ViewerState {
  /** The media kind shown (or `compare`, `inspector`). */
  readonly kind: string | null
  readonly status: "loading" | "ready" | "error"
  readonly error?: string | null
  /** The identity of what is shown: unit, part, asset digest, submission view, as `viewer.capture` returns it. */
  readonly shows?: Readonly<Record<string, unknown>>
  /** The names of the controls `viewer.control` may send this viewer; never `session`, `select` or `inspector`. */
  readonly controls?: ReadonlyArray<string>
  /** Whatever else the kind wants an agent to see. */
  readonly [key: string]: unknown
}

/** One piece of media a viewer shows: an asset's current bytes or frozen evidence. */
interface MediaRef {
  readonly kind: string
  readonly url: string
  readonly id?: string
  readonly path?: string
  readonly sha256?: string | null
  readonly version?: string
  /** A still image region in source pixels. */
  readonly crop?: readonly [number, number, number, number]
  /** `ok`, or why it cannot be shown (`missing`, `invalid`, …); with `error`. */
  readonly state?: string
  readonly error?: string | null
}

/** One side of a comparison. */
interface CompareSide {
  readonly status: string
  readonly url?: string
  readonly kind?: string
  readonly sha256?: string | null
  readonly path?: string
  readonly crop?: readonly [number, number, number, number]
  readonly error?: string | null
}

/** How a media kind is shown in the page: the argument of `registerMediaKind`. */
export interface MediaKindDefinition {
  /** Required. Shows one piece of media and reports itself with `useViewer(viewerId, …)`, passing `shows` on. */
  readonly viewer: Component<{
    readonly media: MediaRef
    readonly viewerId?: string
    readonly shows?: Readonly<Record<string, unknown>>
    readonly label?: string
    readonly onStatus?: (status: ViewerState["status"]) => void
    /** On a unit's page: the unit, its type and the link shown. */
    readonly context?: { readonly unit: unknown; readonly type: unknown; readonly link: unknown }
    /** For kinds that use them (`framing`, `reuse`). */
    readonly initialCamera?: unknown
    readonly initialState?: unknown
    readonly keepCamera?: boolean
    readonly [option: string]: unknown
  }>
  /** The control names its viewer's state lists. `registerMediaKind` throws for `session`, `select` or `inspector`. */
  readonly controls?: ReadonlyArray<string>
  /** Drawn inside the square thumbnail; without it the kind's icon is shown. */
  readonly thumbnail?: Component<{ readonly asset: MediaRef; readonly size: number }>
  /** Both sides of a comparison; without it the viewer is shown twice, side by side. */
  readonly compare?: Component<{
    readonly a: CompareSide
    readonly b: CompareSide
    readonly labels: readonly [string, string]
    readonly mark: (side: "a" | "b") => (status: ViewerState["status"]) => void
    readonly control?: Readonly<Record<string, unknown>>
    readonly camera?: unknown
    readonly state?: unknown
    readonly apiRef?: { current: { getState(): ViewerState; control(command: Record<string, unknown>): unknown } | undefined }
  }>
  /** Both sides are one viewer (two takes on one transport), which answers through `apiRef`. */
  readonly compareTogether?: boolean
  /** How a capture of this kind describes itself, and an optional reason to refuse one. */
  readonly capture?: { readonly renderer: string | ((state: ViewerState) => string); readonly blocked?: (state: ViewerState) => string | null }
  /** SVG path data for a 20×20 glyph. */
  readonly icon?: string
  /** Keep one viewer instance when the media changes (a model keeps its camera). */
  readonly reuse?: boolean
  /** The viewer has a camera a submitter can save with a view; its state then reports `camera` and `view`. */
  readonly framing?: boolean
  /** Named viewer components offered to preview modules as `ctx.viewers`. */
  readonly components?: Readonly<Record<string, Component<any>>>
}

/**
 * What a media kind's module receives. `control(command)` passed to `useViewer` returns any value
 * other than `false` when it handled the command, `false` when the command is not one of its
 * controls, and throws an Error when the command is wrong (the Error's `code` if set, else
 * `invalid`). A returned `{ error, code }` is a result like any other, not a refusal.
 */
export interface CatalogApi {
  /** htm bound to Preact: html`<div>${value}</div>`. */
  readonly html: (strings: TemplateStringsArray, ...values: ReadonlyArray<unknown>) => Markup
  readonly hooks: {
    readonly useState: <S>(initial: S | (() => S)) => [S, (next: S | ((previous: S) => S)) => void]
    readonly useEffect: (effect: () => void | (() => void), dependencies?: ReadonlyArray<unknown>) => void
    readonly useLayoutEffect: (effect: () => void | (() => void), dependencies?: ReadonlyArray<unknown>) => void
    readonly useRef: <T>(initial?: T) => { current: T }
    readonly useCallback: <F extends (...args: Array<any>) => unknown>(callback: F, dependencies: ReadonlyArray<unknown>) => F
  }
  /** The one call that makes a kind known to the page; the built-in kinds make it too. */
  registerMediaKind(id: string, definition: MediaKindDefinition): void
  /** A preview the page provides under a name a collection kind may give as `preview.module`. */
  registerPreview(name: string, render: PreviewFunction): void
  /** Call inside a viewer component, like a hook: report its state and accept its controls. */
  useViewer(viewerId: string | null | undefined, getState: () => ViewerState, control: (command: Record<string, unknown>) => unknown): void
  /** The loading and error overlay. */
  readonly Msg: Component<{ readonly status: ViewerState["status"]; readonly error?: string | null; readonly onRetry?: () => void; readonly name?: string }>
  /** Shows any registered kind. */
  readonly MediaViewer: Component<{ readonly media: MediaRef; readonly [option: string]: unknown }>
  /** The viewer shown when media cannot be shown. */
  readonly UnavailableViewer: Component<{ readonly viewerId?: string; readonly shows?: Readonly<Record<string, unknown>>; readonly message?: string; readonly asset?: MediaRef }>
  readonly Icon: Component<{ readonly name: string; readonly size?: number }>
}

/** What a mount module's export returns. */
export interface Controller {
  /** Take down what `mount` built. */
  dispose(): void
  /**
   * An inspector's state: `status` (`loading`, `ready` or `error`), `error`, `renderer` (named in
   * captures), its own `shows`, and anything else an agent should see.
   */
  state?(): Readonly<Record<string, unknown>>
  /**
   * Answers `viewer.control { inspector: command }`: any value other than `false` when handled,
   * `false` when it has no such control; throw an Error for a wrong command (its `code`, else `invalid`).
   */
  control?(command: Record<string, unknown>): unknown
}

/** What a mount module's export receives for one unit. */
export interface MountContext {
  readonly unit: { readonly id: string; readonly name: string; readonly type: string; readonly attrs: Readonly<Record<string, unknown>> }
  /** The inspector's or panel's key. */
  readonly key: string
  /** Run a catalog action (a plugin's own included); with a request id it is a write by the page's person. Resolves to the action's output. */
  call(action: string, input?: unknown, requestId?: string): Promise<any>
  /** The address of a current asset's bytes. */
  assetUrl(id: string): string
}

/** What an inspector's export receives. */
export interface InspectorContext extends MountContext {
  /** Its own state, kept in the page address (`vs`) so a link reopens it as it was. */
  readonly state: Readonly<Record<string, unknown>>
  /** Replace that state. */
  setState(state: Record<string, unknown>): void
  /** The element a capture photographs (default: the whole inspector). */
  markStage(element: HTMLElement): void
}

/** A mount module's export: inspectors receive an `InspectorContext`, panels a `MountContext`. */
export type MountFunction<C extends MountContext = MountContext> = (host: HTMLElement, ctx: C) => Controller | Promise<Controller>

/** One member of a collection, as a preview receives it. */
interface PreviewMember {
  readonly unit: string
  readonly part: string
  readonly role: string
  readonly asset: MediaRef
}

/** What a collection preview module receives. */
export interface PreviewContext {
  readonly html: CatalogApi["html"]
  readonly MediaViewer: CatalogApi["MediaViewer"]
  /** The viewer components the registered kinds offer (`ModelViewer`, …). */
  readonly viewers: Readonly<Record<string, Component<any>>>
  readonly members: ReadonlyArray<PreviewMember>
  /** The declared base asset, or null. */
  readonly base: MediaRef | null
  /** The collection kind's `preview.config`. */
  readonly config: Readonly<Record<string, unknown>>
  readonly label: string
  /** Pass both to the viewer, so people and agents share its state and controls. */
  readonly viewerId: string
  readonly shows: Readonly<Record<string, unknown>>
  /** A submission view's saved camera and viewer state, when one is shown. */
  readonly initialCamera?: unknown
  readonly initialState?: unknown
}

/** A collection preview module's default export. */
export type PreviewFunction = (ctx: PreviewContext) => Markup

// Only the exported names above are the contract.
export {}
