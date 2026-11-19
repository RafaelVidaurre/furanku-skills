// Inspectors and panels: browser modules a plugin declares, mounted for one unit. An inspector
// is shown in the unit's media strip (selected as part `inspector:<key>`); a panel is a section
// of its sidebar. A module export is framework-free:
//
//   export function inspector(host, ctx) { …; return { dispose(), state?(), control?(command) } }
//
//   ctx.unit             { id, name, type, attrs } of the unit shown
//   ctx.key              the inspector's or panel's key
//   ctx.call(a, input)   run a catalog action (a plugin's own included); a write acts as this page's person
//   ctx.assetUrl(id)     address of a current asset's bytes
//   ctx.state            an inspector's own state, kept in the page address so a link reopens it
//   ctx.setState(object) replace that state
//   ctx.markStage(el)    an inspector's element that captures photograph (default: the whole inspector)
//
// An inspector's controller reports `state()`: `status` ('loading' | 'ready' | 'error'), `error`,
// `renderer` (what draws it, named in captures) and anything else it wants an agent to read;
// `control(command)` answers `viewer.control { inspector: command }`: any value but false when it
// handled the command, false when it has no such control, and a thrown Error when the command is
// wrong (its `code`, else `invalid`). Its own `shows` is merged into what the viewer reports.
// Types: catalog-plugin-web.d.ts (`MountFunction`, `InspectorContext`, `Controller`).
import { html, useEffect, useRef, useState, call, write, ErrorLine } from './core.js';
import { refusal, useViewer } from './controller.js';

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

/** An inspector on the unit's stage: people and agents reach the same mounted instance. */
export function InspectorHost({ unit, inspector, shows, inspectorState, onState }) {
  const [error, setError] = useState(null);
  const { host, controller } = useMounted(inspector, `${inspector.url}#${unit.id}#${inspector.key}`, () => contextOf(unit, inspector, {
    state: inspectorState ?? {},
    setState: (next) => onState?.(next),
    // A capture photographs the last active viewer root in the page: the marked element, inside the stage.
    markStage: (el) => { el.setAttribute('data-viewer-root', ''); el.dataset.active = 'true'; },
  }), setError);
  useViewer('stage', () => {
    if (error) return { kind: 'inspector', inspector: inspector.key, status: 'error', error: error.message, shows, controls: [] };
    const state = controller.current?.state?.() ?? { status: controller.current ? 'ready' : 'loading' };
    return { kind: 'inspector', inspector: inspector.key, status: 'ready', error: null, controls: controller.current?.control ? ['inspector'] : [], ...state, shows: { ...shows, ...(state.shows ?? {}) } };
  }, async (command) => {
    if (!command.inspector) return false;
    if (!controller.current?.control) throw refusal('unsupported', `inspector ${inspector.key} takes no controls`);
    const result = await controller.current.control(command.inspector);
    if (result === false) throw refusal('unsupported', `inspector ${inspector.key} does not support this control`);
    return result;
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
