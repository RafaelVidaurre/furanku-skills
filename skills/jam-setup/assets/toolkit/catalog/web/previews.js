// Collection preview modules. The project declares a module per collection kind; built-ins live
// here and project modules are trusted files named in catalog.config.json `previewModules`.
// A module is `export default function (ctx) { return ctx.html`...` }` and receives:
//   ctx.html, ctx.viewers ({ ModelViewer, ImageViewer, VideoViewer }), ctx.members
//   ([{ unit, part, role, asset: { url, kind, sha256, state, error } }]), ctx.base (asset or null),
//   ctx.config (declared object), ctx.label, ctx.viewerId and ctx.source (pass both to the viewer
//   so people and agents share its state and controls).
import { html, useEffect, useState } from './core.js';
import { ModelViewer, ImageViewer, VideoViewer, UnavailableViewer } from './viewers.js';

const BUILTIN = {
  // Member models in one shared space, with the optional base shown in grey.
  'assembled-mesh': (ctx) => {
    const models = ctx.members.filter((m) => m.asset.kind === 'model');
    if (!models.length) return html`<${UnavailableViewer} viewerId=${ctx.viewerId} source=${ctx.source} asset=${{ kind: 'model' }} message="No member models" />`;
    return html`<${ModelViewer} srcs=${models.map((m) => m.asset.url)} ghost=${ctx.base ? [ctx.base.url] : []} viewerId=${ctx.viewerId} source=${ctx.source} label=${ctx.label}
      initialCamera=${ctx.initialCamera} initialState=${ctx.initialState} />`;
  },
};
const loaded = new Map();

// Every declared input (members and base) must be available, and a project module must be the
// expected revision; otherwise the preview is an explicit error that cannot be captured.
export function PreviewHost({ module, moduleUrl, moduleError, ...ctx }) {
  const missing = [...ctx.members.filter((m) => m.asset?.state !== 'ok').map((m) => `${m.unit} ${m.role ?? ''}`.trim() + ` (${m.asset?.error ?? m.asset?.state ?? 'missing'})`), ...(ctx.base && ctx.base.state !== 'ok' ? [`base (${ctx.base.error ?? ctx.base.state})`] : [])];
  const blocked = moduleError ?? (missing.length ? `Preview inputs unavailable: ${missing.join('; ')}` : null);
  return blocked ? html`<${UnavailableViewer} viewerId=${ctx.viewerId} source=${ctx.source} asset=${{ kind: 'model' }} message=${blocked} />` : html`<${LoadedPreview} module=${module} moduleUrl=${moduleUrl} ...${ctx} />`;
}

function LoadedPreview({ module, moduleUrl, ...ctx }) {
  const [fn, setFn] = useState(() => BUILTIN[module] ?? loaded.get(moduleUrl) ?? null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (BUILTIN[module]) { setFn(() => BUILTIN[module]); return; }
    if (!moduleUrl) { setError(`Preview module "${module}" is not available in this checkout`); return; }
    if (loaded.has(moduleUrl)) { setFn(() => loaded.get(moduleUrl)); return; }
    let live = true;
    import(moduleUrl).then((m) => { if (typeof m.default !== 'function') throw new Error('module has no default export'); loaded.set(moduleUrl, m.default); if (live) setFn(() => m.default); }, (e) => live && setError(`Preview module "${module}" failed to load: ${e.message}`));
    return () => { live = false; };
  }, [module, moduleUrl]);
  if (error) return html`<${UnavailableViewer} viewerId=${ctx.viewerId} source=${ctx.source} message=${error} />`;
  if (!fn) return html`<div class="viewer"><div class="viewer-msg"><span class="spin"></span></div></div>`;
  return fn({ html, viewers: { ModelViewer, ImageViewer, VideoViewer }, ...ctx });
}
