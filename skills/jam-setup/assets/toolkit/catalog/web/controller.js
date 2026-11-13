// Viewer controller: the same viewer instances the person sees expose state and controls to
// agent sessions (window.catalogViewer). No separate or simulated viewer exists.
import { useEffect, useRef } from 'preact/hooks';

const viewers = new Map();
const activeStack = [];
let selection = () => null;
let selectHandler = null;
let renderedHash = null;
export function markRendered(h) { renderedHash = h; }

export function registerViewer(id, getState, control) {
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

const activeState = () => {
  const id = topActive();
  const ref = id && viewers.get(id);
  return ref ? { id, ...ref.current.getState() } : null;
};

window.catalogViewer = {
  booted: true,
  state() {
    const sel = selection();
    return { route: location.hash, selection: sel, viewer: activeState() };
  },
  // Every mounted viewer (e.g. both sides of a comparison), for inspection.
  viewers() { return [...viewers].map(([id, ref]) => ({ id, ...ref.current.getState() })); },
  control(cmd) {
    if (cmd.select) {
      if (!selectHandler) return { error: 'nothing to select on this page', code: 'unsupported' };
      const r = selectHandler(cmd.select);
      if (r?.error) return r;
      const rest = { ...cmd }; delete rest.select;
      if (!Object.keys(rest).length) return { ok: true };
      return new Promise((ok) => setTimeout(() => ok(window.catalogViewer.control(rest)), 50));
    }
    const id = topActive();
    const ref = id && viewers.get(id);
    if (!ref) return { error: 'no viewer is showing media', code: 'unsupported' };
    const r = ref.current.control?.(cmd);
    if (r === false || r == null) return { error: `the current ${ref.current.getState().kind ?? ''} viewer does not support this control`, code: 'unsupported' };
    return r === true ? { ok: true } : r;
  },
  async settled(timeout = 15000) {
    const start = Date.now();
    let stable = 0;
    while (Date.now() - start < timeout) {
      const s = window.catalogViewer.state();
      const busy = renderedHash !== location.hash || s.selection?.loading || s.viewer?.status === 'loading';
      stable = busy ? 0 : stable + 1;
      if (stable >= 3) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  },
};
