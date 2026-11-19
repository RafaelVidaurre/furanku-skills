// Viewer controller: the same viewer instances the person sees expose state and controls to
// agent sessions (window.catalogViewer). No separate or simulated viewer exists.
//
// A viewer's `control(command)` returns any value other than `false` when it handled the command,
// `false` when the command is not one of its controls, and throws an Error when the command is
// wrong (the error's `code`, else `invalid`, is what the agent receives). A returned value is
// never a refusal, whatever its shape.
import { useEffect, useRef } from 'preact/hooks';
import { captureOf, kindsLoading } from './media-kinds.js';

const viewers = new Map();
const activeStack = [];
let selection = () => null;
let selectHandler = null;
let renderedHash = null;
export function markRendered(h) { renderedHash = h; }

/** An Error that refuses a command with a code. */
export const refusal = (code, message) => Object.assign(new Error(message), { code });

/** Report a viewer's state and controls; call it inside the viewer component, like a hook. */
export function useViewer(id, getState, control) {
  const ref = useRef();
  ref.current = { getState, control };
  useEffect(() => {
    if (!id) return;
    viewers.set(id, ref);
    return () => { if (viewers.get(id) === ref) viewers.delete(id); };
  }, [id]);
}
// The visible primary viewer: an open comparison (priority 1) always wins over the page stage (0),
// whatever order they mounted in.
export function useActiveViewer(id, enabled = true, priority = 0) {
  useEffect(() => {
    if (!enabled || !id) return;
    const entry = { id, priority };
    activeStack.push(entry);
    return () => { const i = activeStack.indexOf(entry); if (i >= 0) activeStack.splice(i, 1); };
  }, [id, enabled, priority]);
}
const topActive = () => { let best = null; for (const e of activeStack) if (!best || e.priority >= best.priority) best = e; return best?.id; };
export function setSelectionProvider(fn) { selection = fn; }
export function setSelectHandler(fn) { selectHandler = fn; }
export const isActive = (id) => topActive() === id;

// A viewer's state as `viewer.state` publishes it: `error`, `shows` and `controls` are always
// present (a media kind may leave them out of its own state).
const activeState = () => {
  const id = topActive();
  const ref = id && viewers.get(id);
  if (!ref) return null;
  const state = ref.current.getState();
  return { id, ...state, error: state.error ?? null, shows: state.shows ?? null, controls: state.controls ?? [] };
};

// Open a comparison (what evidence.compare takes) over the current page: the address's `cmp`.
function openComparison(compare) {
  const i = location.hash.indexOf('?');
  const query = new URLSearchParams(i < 0 ? '' : location.hash.slice(i + 1));
  query.set('cmp', JSON.stringify(compare));
  location.replace(`${i < 0 ? location.hash : location.hash.slice(0, i)}?${query}`);
}

// Apply a command to the showing viewer: its result, or a refusal thrown.
async function applyToViewer(cmd) {
  const id = topActive();
  const ref = id && viewers.get(id);
  if (!ref) throw refusal('unsupported', 'no viewer is showing media');
  const handled = ref.current.control ? await ref.current.control(cmd) : false;
  if (handled === false) throw refusal('unsupported', `the current ${ref.current.getState().kind ?? ''} viewer does not support this control`);
  return handled;
}
const later = (ms) => new Promise((done) => setTimeout(done, ms));

window.catalogViewer = {
  booted: true,
  state() {
    const sel = selection();
    return { route: location.hash, selection: sel, viewer: activeState() };
  },
  // Every mounted viewer (e.g. both sides of a comparison), for inspection.
  viewers() { return [...viewers].map(([id, ref]) => ({ id, ...ref.current.getState() })); },
  // Answers `{ ok: true, result }`, or `{ ok: false, code, error }` when the command was refused.
  async control(cmd) {
    try {
      if (!cmd.select) return { ok: true, result: await applyToViewer(cmd) };
      // A comparison opens over any page; a part or view is selected by the page itself.
      const { compare, ...select } = cmd.select;
      if (Object.keys(select).length) {
        if (!selectHandler) throw refusal('unsupported', 'nothing to select on this page');
        selectHandler(select);
      }
      const rest = { ...cmd }; delete rest.select;
      // After the page's own selection has landed in the address (a view is selected on the next tick).
      if (compare) { await later(0); openComparison(compare); }
      if (!Object.keys(rest).length) return { ok: true, result: true };
      await later(50);
      return { ok: true, result: await applyToViewer(rest) };
    } catch (e) {
      return { ok: false, code: typeof e?.code === 'string' ? e.code : 'invalid', error: e?.message ?? String(e), ...(e?.details === undefined ? {} : { details: e.details }) };
    }
  },
  // What a capture of the showing viewer is: said by the kind of media it shows, or by an inspector
  // (which names the renderer that draws it).
  capture() {
    const state = activeState();
    return state?.kind === 'inspector' ? { renderer: state.renderer ?? `catalog inspector ${state.inspector}`, blocked: null } : captureOf(state);
  },
  async settled(timeout = 15000) {
    const start = Date.now();
    let stable = 0;
    while (Date.now() - start < timeout) {
      const s = window.catalogViewer.state();
      const busy = renderedHash !== location.hash || s.selection?.loading || s.viewer?.status === 'loading' || kindsLoading();
      stable = busy ? 0 : stable + 1;
      if (stable >= 3) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  },
};
