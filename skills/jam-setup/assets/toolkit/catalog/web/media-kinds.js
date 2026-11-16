// The media kind registry: the one place the page learns which kinds of media exist and how each
// is shown. A kind registers under its id (the id the project's `schema` gives it):
//
//   registerMediaKind('image', {
//     icon,       // SVG path data for a 20×20 glyph (optional)
//     viewer,     // component: ({ media, viewerId, source, label, onStatus, context, ... }) => markup
//     thumbnail,  // component: ({ asset, size }) => markup shown inside a square thumbnail
//     compare,    // component: ({ a, b, labels, mark, control, camera, state, apiRef }) => markup
//     capture,    // { renderer: string | (state) => string, blocked?: (state) => string | null }
//   });
//
// The built-in kinds (kinds/*.js) and a plugin's browser module make the same call. Everything
// that shows media (viewers, thumbnails, comparisons, captures, labels) asks this registry and
// falls back to a plain "no viewer" answer for a kind nothing registered.
import { useEffect, useState } from 'preact/hooks';

const kinds = new Map();
const subscribers = new Set();
const loaded = new Map(); // module URL -> promise
let pending = 0;
let problems = [];

const changed = () => subscribers.forEach((f) => f());

export function registerMediaKind(id, definition) {
  if (typeof id !== 'string' || !id) throw new Error('registerMediaKind needs the kind id');
  if (!definition || typeof definition.viewer !== 'function') throw new Error(`media kind ${id} needs a viewer component`);
  kinds.set(id, { ...definition, id });
  changed();
}

/** What a kind registered, or null when nothing shows this kind. */
export const mediaKind = (id) => kinds.get(id) ?? null;
export const registeredKinds = () => [...kinds.keys()];

/** Re-render when a kind registers (a plugin module finished loading). */
export function useMediaKinds() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); subscribers.add(f); return () => subscribers.delete(f); }, []);
  return kinds;
}

/** True while a kind's module is still being fetched: a viewer may be about to appear. */
export const kindsLoading = () => pending > 0;
/** Modules that could not be loaded, as { kind, error }. */
export const kindProblems = () => problems;

// A kind's browser module default-exports `(catalog) => void` and registers itself through
// `catalog.registerMediaKind`. `api` is that object; it is handed in so this module stays free of
// components.
export function loadKindModules(mediaKinds, api) {
  const jobs = [];
  for (const [id, kind] of Object.entries(mediaKinds ?? {})) {
    if (!kind.web || loaded.has(kind.web)) continue;
    pending++;
    const job = import(kind.web)
      .then((module) => { if (typeof module.default !== 'function') throw new Error('the module has no default export'); return module.default(api); })
      .then(() => { problems = problems.filter((p) => p.kind !== id); }, (e) => { problems = [...problems.filter((p) => p.kind !== id), { kind: id, error: `The viewer for ${kind.label ?? id} media could not be loaded: ${e.message}` }]; })
      .finally(() => { pending--; changed(); });
    loaded.set(kind.web, job);
    jobs.push(job);
  }
  return Promise.all(jobs);
}

/** How the showing viewer's kind describes a capture of it (see controller.js `capture`). */
export function captureOf(state) {
  // A comparison is captured as the kind of media it compares.
  const id = state?.kind === 'compare' ? state.mediaKind ?? state.sides?.find((s) => s.kind && s.kind !== 'attributes')?.kind : state?.kind;
  const capture = mediaKind(id)?.capture ?? {};
  const renderer = typeof capture.renderer === 'function' ? capture.renderer(state) : capture.renderer;
  return { renderer: renderer ?? 'catalog browser viewer', blocked: capture.blocked?.(state) ?? null };
}
