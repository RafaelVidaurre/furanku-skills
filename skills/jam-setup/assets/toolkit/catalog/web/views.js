// Type views and panels: browser modules a plugin declares (`views`), mounted for one unit. A view
// is an inspector in the unit's visual strip (selected as part `view:<key>`); a panel is a section
// of its sidebar. A module export is framework-free:
//
//   export function inspector(host, ctx) { …; return { dispose(), state?(), control?(command) } }
//
//   ctx.unit             { id, name, type, attrs } of the unit shown
//   ctx.key              the view's or panel's key
//   ctx.call(a, input)   run a catalog action (a plugin's own included); a write acts as this page's person
//   ctx.assetUrl(id)     address of a current asset's bytes
//   ctx.state            a view's own state, kept in the page address so a link reopens it
//   ctx.setState(object) replace that state
//   ctx.markStage(el)    a view's element that captures photograph (default: the whole view)
//
// A view's controller reports `state()`: `status` ('loading' | 'ready' | 'error'), `error`,
// `renderer` (what draws it, named in captures) and anything else it wants an agent to read;
// `control(command)` answers `viewer.control { view: command }` with a result, or false when
// the view has no such control. Its own `source` is merged into what the viewer reports.
import { html, useEffect, useRef, useState, call, write, ErrorLine } from './core.js';
import { registerViewer } from './controller.js';

const loaded = new Map();
async function mountFunction(m) {
  if (!m.url) throw new Error(m.error ?? `The ${m.label} module is not available`);
  if (!loaded.has(m.url)) loaded.set(m.url, import(m.url).catch((e) => { loaded.delete(m.url); throw new Error(`The ${m.label} module could not be loaded: ${e.message}`); }));
  const fn = (await loaded.get(m.url))[m.export ?? 'default'];
  if (typeof fn !== 'function') throw new Error(`The ${m.label} module has no export "${m.export ?? 'default'}"`);
  return fn;
}

const contextOf = (unit, m, extra) => ({
  unit: { id: unit.id, name: unit.name, type: unit.type, attrs: unit.attrs },
  key: m.key,
  call: (action, input = {}, requestId) => (requestId ? write(action, input, requestId) : call(action, input)),
  assetUrl: (id) => `/media/asset/${encodeURIComponent(id)}`,
  ...extra,
});

// Mount one module into a host element while `identity` stays the same.
function useMounted(m, identity, makeContext, onError) {
  const host = useRef(); const controller = useRef(null);
  useEffect(() => {
    let live = true; let mounted = null;
    controller.current = null;
    onError(null);
    mountFunction(m)
      .then((mount) => (live ? mount(host.current, makeContext()) : null))
      .then((made) => { if (!live) { made?.dispose?.(); return; } mounted = made ?? {}; controller.current = mounted; })
      .catch((e) => live && onError(e));
    return () => { live = false; controller.current = null; mounted?.dispose?.(); host.current?.replaceChildren(); };
  }, [identity]);
  return { host, controller };
}

/** A view on the unit's stage: people and agents reach the same mounted instance. */
export function ViewHost({ unit, view, source, viewState, onState }) {
  const [error, setError] = useState(null);
  const { host, controller } = useMounted(view, `${view.url}#${unit.id}#${view.key}`, () => contextOf(unit, view, {
    state: viewState ?? {},
    setState: (next) => onState?.(next),
    // A capture photographs the last active viewer root in the page: the marked element, inside the stage.
    markStage: (el) => { el.setAttribute('data-viewer-root', ''); el.dataset.active = 'true'; },
  }), setError);
  registerViewer('stage', () => {
    if (error) return { kind: 'view', view: view.key, status: 'error', error: error.message, source, controls: [] };
    const state = controller.current?.state?.() ?? { status: controller.current ? 'ready' : 'loading' };
    return { kind: 'view', view: view.key, error: null, controls: controller.current?.control ? ['view'] : [], ...state, source: { ...source, ...(state.source ?? {}) } };
  }, (command) => {
    if (!command.view) return false;
    if (!controller.current?.control) return { error: `view ${view.key} takes no controls`, code: 'unsupported' };
    const mounted = controller.current;
    return Promise.resolve().then(() => mounted.control(command.view)).then(
      (result) => (result === false ? { error: `view ${view.key} does not support this control`, code: 'unsupported' } : result ?? { ok: true }),
      (e) => ({ error: e.message, code: 'invalid' }));
  });
  if (error) return html`<div class="view-host"><${ErrorLine} error=${error} /></div>`;
  return html`<div class="view-host" ref=${host}></div>`;
}

/** A panel in the unit's sidebar. */
export function PanelHost({ unit, panel }) {
  const [error, setError] = useState(null);
  const { host } = useMounted(panel, `${panel.url}#${unit.id}#${panel.key}`, () => contextOf(unit, panel, {}), setError);
  return html`<section class="block" aria-label=${panel.label}>
    <header class="block-h"><h3 title=${panel.help ?? ''}>${panel.label}</h3></header>
    ${error ? html`<${ErrorLine} error=${error} />` : html`<div class="panel-host" ref=${host}></div>`}
  </section>`;
}
