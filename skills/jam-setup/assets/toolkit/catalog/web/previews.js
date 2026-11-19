// A collection preview is one picture of a whole collection, made from its members' media. A
// collection kind names its preview; the page's kinds and the project's plugins (as browser
// modules) supply them. A preview is `(ctx) => markup` (`PreviewFunction` in
// catalog-plugin-web.d.ts) and receives:
//   ctx.html, ctx.MediaViewer and ctx.viewers (the viewer components the registered kinds offer,
//   by name), ctx.members ([{ unit, part, role, asset: { url, kind, sha256, state, error } }]),
//   ctx.base (asset or null), ctx.config (the declared object), ctx.label, and ctx.viewerId and
//   ctx.shows (pass both to the viewer so people and agents share its state and controls).
// A project module is a declared file that default-exports such a function.
import { html, useEffect, useState } from './core.js';
import { registeredKinds, mediaKind, useMediaKinds } from './media-kinds.js';
import { MediaViewer, UnavailableViewer } from './viewers.js';

const builtin = new Map();
const loaded = new Map();

/** Add a preview the page itself provides, under the name a collection kind refers to. */
export function registerPreview(name, render) {
  if (typeof render !== 'function') throw new Error(`preview ${name} must be a function`);
  builtin.set(name, render);
}

const viewerComponents = () => Object.assign({}, ...registeredKinds().map((id) => mediaKind(id).components ?? {}));

// Every declared input (members and base) must be available, and a project module must be the
// expected revision; otherwise the preview is an explicit error that cannot be captured.
export function PreviewHost({ module, moduleUrl, moduleError, ...ctx }) {
  const missing = [...ctx.members.filter((m) => m.asset?.state !== 'ok').map((m) => `${m.unit} ${m.role ?? ''}`.trim() + ` (${m.asset?.error ?? m.asset?.state ?? 'missing'})`), ...(ctx.base && ctx.base.state !== 'ok' ? [`base (${ctx.base.error ?? ctx.base.state})`] : [])];
  const blocked = moduleError ?? (missing.length ? `Preview inputs unavailable: ${missing.join('; ')}` : null);
  return blocked ? html`<${UnavailableViewer} viewerId=${ctx.viewerId} shows=${ctx.shows} message=${blocked} />` : html`<${LoadedPreview} module=${module} moduleUrl=${moduleUrl} ...${ctx} />`;
}

function LoadedPreview({ module, moduleUrl, ...ctx }) {
  useMediaKinds();
  const [fn, setFn] = useState(() => builtin.get(module) ?? loaded.get(moduleUrl) ?? null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (builtin.has(module)) { setFn(() => builtin.get(module)); return; }
    if (!moduleUrl) { setError(`Preview module "${module}" is not available in this checkout`); return; }
    if (loaded.has(moduleUrl)) { setFn(() => loaded.get(moduleUrl)); return; }
    let live = true;
    import(moduleUrl).then((m) => { if (typeof m.default !== 'function') throw new Error('module has no default export'); loaded.set(moduleUrl, m.default); if (live) setFn(() => m.default); }, (e) => live && setError(`Preview module "${module}" failed to load: ${e.message}`));
    return () => { live = false; };
  }, [module, moduleUrl]);
  if (error) return html`<${UnavailableViewer} viewerId=${ctx.viewerId} shows=${ctx.shows} message=${error} />`;
  if (!fn) return html`<div class="viewer"><div class="viewer-msg"><span class="spin"></span></div></div>`;
  return fn({ html, MediaViewer, viewers: viewerComponents(), ...ctx });
}
