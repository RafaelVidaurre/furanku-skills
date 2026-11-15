import { h } from 'preact';
import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import htm from 'htm';

export const html = htm.bind(h);
export { useEffect, useRef, useState, useCallback };
export const enc = encodeURIComponent;

// ---------- Server actions ----------
// Every write carries the context it was prepared in and a request id that a retry reuses.
export const session = { boot: null, ctx: null, rev: 0, changed: null };
const subs = new Set();
const notify = () => subs.forEach((f) => f());
export function useSession() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); subs.add(f); return () => subs.delete(f); }, []);
  return session;
}

export class ActionError extends Error { constructor(e, status) { super(e.message); this.code = e.code; this.details = e.details; this.status = status; } }
export async function call(action, input = {}, { requestId, write } = {}) {
  let r;
  try {
    r = await fetch(`/api/run/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-catalog-request': '1', 'x-catalog-client': 'web' },
      body: JSON.stringify({ input, ...(write ? { requestId, context: session.boot?.context.key } : {}) }),
    });
  } catch (e) { throw new ActionError({ code: 'offline', message: 'The local catalog server is not reachable. Your text is kept; retry when it is running.' }, 0); }
  const j = await r.json().catch(() => ({ error: { code: 'internal', message: `HTTP ${r.status}` } }));
  if (!r.ok) {
    const err = new ActionError(j.error, r.status);
    if (err.code === 'context_changed') { session.changed = err.details?.context ?? true; notify(); }
    throw err;
  }
  return j;
}
export const newRequestId = () => `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// A write with a stable request id: retrying after a lost response records the action once.
export async function write(action, input, requestId = newRequestId()) {
  const res = await call(action, input, { requestId, write: true });
  session.rev++; notify();
  return res;
}

export async function boot() {
  session.boot = await call('context');
  session.ctx = session.boot;
  notify();
  const poll = async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const c = await call('context');
      const prev = session.ctx;
      session.ctx = c;
      if (c.context.key !== session.boot.context.key) session.changed = c.context;
      if (prev && (c.version !== prev.version || c.records !== prev.records || c.context.dirty !== prev.context.dirty || c.context.head !== prev.context.head)) session.rev++;
      session.offline = false;
      notify();
    } catch { session.offline = true; notify(); }
  };
  setInterval(poll, 2500);
  document.addEventListener('visibilitychange', poll);
}

// Fetch an action result; keeps the previous data while refreshing and re-runs on catalog changes.
export function useQuery(action, input, enabled = true) {
  const s = useSession();
  const key = JSON.stringify([action, input]);
  const [state, set] = useState({ data: null, error: null, loading: true, key: null });
  const seq = useRef(0);
  const reload = useCallback(() => {
    if (!enabled) return;
    const mine = ++seq.current;
    set((x) => ({ ...x, loading: true }));
    call(action, input).then((data) => mine === seq.current && set({ data, error: null, loading: false, key }), (error) => mine === seq.current && set((x) => ({ data: x.key === key ? x.data : null, error, loading: false, key })));
  }, [key, enabled]);
  useEffect(reload, [key, s.rev, enabled]);
  return { ...state, data: state.key === key || state.data === null ? state.data : state.data, stale: state.key !== key, reload };
}

// ---------- Drafts: keyed by checkout context + stable target identity ----------
const draftKey = (k) => `catalog-draft:${session.boot?.context.key}:${k}`;
export let storageError = null;
export function useDraft(key, initial) {
  const full = draftKey(key);
  const read = () => { try { const v = localStorage.getItem(full); return v == null ? initial : JSON.parse(v); } catch { return initial; } };
  const [v, setV] = useState(read);
  useEffect(() => setV(read()), [full]);
  const set = (x) => {
    setV(x);
    try { if (x == null) localStorage.removeItem(full); else localStorage.setItem(full, JSON.stringify(x)); storageError = null; }
    catch (e) { storageError = 'Drafts cannot be saved in this browser; unsaved text will be lost on reload.'; toast(storageError, 'err'); }
  };
  return [v, set];
}
export function hasDraft(key) { try { return localStorage.getItem(draftKey(key)) != null; } catch { return false; } }
export function otherContextDrafts() {
  const out = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('catalog-draft:') && !k.startsWith(`catalog-draft:${session.boot?.context.key}:`)) out.push(k); } } catch {}
  return out;
}
const dirtyDrafts = new Set();
export function useUnsaved(id, dirty) {
  useEffect(() => { if (dirty) dirtyDrafts.add(id); else dirtyDrafts.delete(id); return () => dirtyDrafts.delete(id); }, [id, dirty]);
}
addEventListener('beforeunload', (e) => { if (dirtyDrafts.size && storageError) { e.preventDefault(); e.returnValue = ''; } });

// ---------- Router: #/<section>[/<kind>/<id>[/<member>]][?query] ----------
export function parseHash() {
  const raw = location.hash.slice(1) || '/content';
  const i = raw.indexOf('?');
  const p = i < 0 ? raw : raw.slice(0, i); const q = i < 0 ? '' : raw.slice(i + 1);
  let seg;
  try { seg = p.split('/').filter(Boolean).map(decodeURIComponent); } catch { seg = ['content']; }
  return { section: seg[0] ?? 'content', kind: seg[1], id: seg[2], member: seg[3], query: new URLSearchParams(q) };
}
export function href({ section, kind, id, member, query }) {
  let p = `#/${section}`;
  if (kind) p += `/${kind}/${enc(id)}`;
  if (member) p += `/${enc(member)}`;
  const q = query?.toString();
  return q ? `${p}?${q}` : p;
}
export function useRoute() {
  const [r, set] = useState(parseHash);
  useEffect(() => { const f = () => set(parseHash()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return r;
}
export const go = (r) => { location.hash = href(r).slice(1); };
export const replace = (r) => { location.replace(href(r)); };
export function withQuery(r, changes) {
  const q = new URLSearchParams(r.query);
  for (const [k, v] of Object.entries(changes)) (v == null || v === '' ? q.delete(k) : q.set(k, v));
  return { ...r, query: q };
}
export const listParams = (q) => new URLSearchParams([...q].filter(([k]) => k === 'q' || k === 'page' || k.startsWith('f.')));
const SECTION = { unit: ['content', 'u'], collection: ['collections', 'c'], asset: ['assets', 'a'] };
export function entityHref(kind, id, extra = {}) {
  if (kind === 'submission') return href({ section: 'reviews', kind: 's', id, member: extra.item, query: new URLSearchParams(Object.entries(extra).filter(([k]) => k !== 'item')) });
  const cur = parseHash();
  const [section, k] = SECTION[kind];
  const query = cur.section === section ? listParams(cur.query) : new URLSearchParams();
  for (const [a, b] of Object.entries(extra)) query.set(a, b);
  return href({ section, kind: k, id, query });
}

// ---------- Formatting ----------
export function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 60) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}
export const fmtSize = (n) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const shortHash = (h) => (h ? h.slice(0, 8) : '');
export const baseName = (p) => String(p).split('/').pop();
export function isTyping(e) { return !!e.target.closest?.('input, textarea, select, [contenteditable], [role="slider"], video, [data-viewer-input]'); }
export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Toasts ----------
let toastFn = () => {};
export function toast(msg, kind) { toastFn(msg, kind); }
export function Toasts() {
  const [items, set] = useState([]);
  toastFn = (msg, kind) => { const id = Math.random(); set((x) => [...x, { id, msg, kind }]); setTimeout(() => set((x) => x.filter((t) => t.id !== id)), kind === 'err' ? 6000 : 2600); };
  return html`<div class="toasts" role="status" aria-live="polite">${items.map((t) => html`<div class=${`toast ${t.kind ?? ''}`} key=${t.id}>${t.msg}</div>`)}</div>`;
}

// ---------- Glyphs ----------
const G = {
  image: 'M3 4h14v12H3z M3 13l4-4 3 3 2-2 5 5', model: 'M10 2l7 4v8l-7 4-7-4V6z M3 6l7 4 7-4 M10 10v8', video: 'M3 4h14v12H3z M8 7.5v5l4.5-2.5z',
  note: 'M4 3h12v10l-4 4H4z M12 17v-4h4', check: 'M4 10.5l4 4 8-9', x: 'M5 5l10 10 M15 5L5 15', copy: 'M7 7h10v10H7z M3 13V3h10', plus: 'M10 4v12 M4 10h12',
  chev: 'M7 4l6 6-6 6', back: 'M13 4l-6 6 6 6', search: 'M8.5 3a5.5 5.5 0 1 1 0 11a5.5 5.5 0 0 1 0-11z M13 13l4 4',
  branch: 'M6 3v10 M6 13a2 2 0 1 0 0 4a2 2 0 0 0 0-4z M14 3a2 2 0 1 0 0 4a2 2 0 0 0 0-4z M14 7c0 4-8 3-8 6',
  link: 'M8 12l4-4 M7 9l-2 2a2.5 2.5 0 0 0 4 4l2-2 M13 11l2-2a2.5 2.5 0 0 0-4-4l-2 2', grid: 'M3 3h6v6H3z M11 3h6v6h-6z M3 11h6v6H3z M11 11h6v6h-6z', rows: 'M3 4h14 M3 10h14 M3 16h14',
  agent: 'M5 7h10v8H5z M10 3v4 M8 11h.01 M12 11h.01', trash: 'M4 6h12 M8 6V4h4v2 M6 6l1 11h6l1-11', edit: 'M4 16l1-4 8-8 3 3-8 8z', delta: 'M10 4l7 12H3z',
  stop: 'M10 3a7 7 0 1 1 0 14a7 7 0 0 1 0-14z M5 5l10 10', warn: 'M10 3l8 14H2z M10 8v4 M10 14.5v.01', expand: 'M3 8V3h5 M17 8V3h-5 M3 12v5h5 M17 12v5h-5', send: 'M3 10l14-6-6 14-2-6z',
  split: 'M3 4h14v12H3z M10 2v16',
};
export function Icon({ name, size = 14, cls = '' }) {
  return html`<svg class=${`ic ${cls}`} width=${size} height=${size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${G[name]} /></svg>`;
}

// ---------- Small components ----------
export function Person({ by }) {
  if (!by) return null;
  const me = by.kind === 'human' && by.name === session.ctx?.actor;
  return html`<span class="person" title=${by.kind === 'agent' ? `${by.name} (agent)` : by.name}>${by.kind === 'agent' && html`<${Icon} name="agent" size=${12} />`}${me ? 'You' : by.name}</span>`;
}
export const VERDICT = { approved: 'Approved', changes: 'Changes requested', rejected: 'Rejected' };
export const STATE_LABEL = { approved: 'Approved', changes: 'Changes requested', rejected: 'Rejected', partial: 'Partly approved', mixed: 'Mixed', undecided: 'Undecided', none: '' };
const VICON = { approved: 'check', changes: 'x', rejected: 'stop' };
export function Verdict({ v, short }) {
  if (!v) return html`<span class="verdict none">—</span>`;
  return html`<span class=${`verdict ${v}`}><${Icon} name=${VICON[v]} size=${12} />${short ? '' : VERDICT[v]}</span>`;
}
export function VerdictBar({ parts }) {
  if (!parts?.length) return null;
  const t = parts.map((p) => `${p.label}: ${p.verdict ? VERDICT[p.verdict] : 'undecided'}${p.changed ? ' (changed since)' : ''}`).join('\n');
  return html`<span class="vbar" title=${t} role="img" aria-label=${t}>${parts.map((p) => html`<i class=${(p.verdict ?? 'none') + (p.changed ? ' changed' : '')}></i>`)}</span>`;
}
export const kindIcon = (k) => ({ image: 'image', model: 'model', video: 'video' }[k] ?? 'image');

// Thumbnail of an asset reference ({kind,url,sha256,state}). Models render through thumbs.js.
export function Thumb({ asset, size = 40, label, fill }) {
  const style = fill ? '' : `width:${size}px;height:${size}px`;
  if (!asset) return html`<span class=${`thumb empty${fill ? ' fill' : ''}`} style=${style}>${label ?? ''}</span>`;
  if (asset.state && asset.state !== 'ok') return html`<span class=${`thumb err${fill ? ' fill' : ''}`} style=${style} title=${asset.error ?? asset.state}><${Icon} name="warn" size=${Math.min(18, size / 2 || 18)} /></span>`;
  if (asset.kind === 'model') return html`<span class=${`thumb${fill ? ' fill' : ''}`} style=${style}><model-thumb src=${asset.url} sha=${asset.sha256}></model-thumb></span>`;
  if (asset.kind === 'video') return html`<span class=${`thumb${fill ? ' fill' : ''}`} style=${style}><video src=${`${asset.url}#t=0.5`} muted playsinline preload="metadata" tabindex="-1" aria-hidden="true"></video></span>`;
  return html`<span class=${`thumb${fill ? ' fill' : ''}`} style=${style}><img src=${asset.url} alt="" loading="lazy" decoding="async" /></span>`;
}
export function CopyId({ id, label }) {
  return html`<button class="id" title="Copy reference" onClick=${() => { navigator.clipboard?.writeText(id).then(() => toast(`Copied ${id}`), () => toast(`Copy failed; select ${id}`, 'err')); }}>${label ?? id}<${Icon} name="copy" size=${11} /></button>`;
}

// Anchored popover. Closes on outside click or Escape; returns focus to the trigger.
export function Popover({ trigger, children, align = 'left', label }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(); const btn = useRef();
  useEffect(() => {
    if (!open) return;
    const off = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setOpen(false); btn.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', off); document.addEventListener('keydown', key, true);
    requestAnimationFrame(() => ref.current?.querySelector('.pop input, .pop button, .pop [tabindex]')?.focus());
    return () => { document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', key, true); };
  }, [open]);
  const close = () => { setOpen(false); btn.current?.querySelector('button')?.focus(); };
  return html`<span class="pop-wrap" ref=${ref}>
    <span ref=${btn} onClick=${() => setOpen(!open)} aria-expanded=${open} aria-label=${label}>${trigger(open)}</span>
    ${open && html`<div class=${`pop ${align}`} role="dialog" aria-label=${label}>${typeof children === 'function' ? children(close) : children}</div>`}
  </span>`;
}

// Dialog stack: Escape and Tab always act on the topmost open dialog, wherever focus is.
const dialogs = [];
document.addEventListener('keydown', (e) => {
  while (dialogs.length && !dialogs.at(-1).ref.current?.isConnected) dialogs.pop();
  const top = dialogs.at(-1);
  if (!top) return;
  if (e.key === 'Escape' && !e.defaultPrevented) { e.stopPropagation(); e.preventDefault(); top.close(); return; }
  if (e.key === 'Tab') {
    const el = top.ref.current;
    const f = [...el.querySelectorAll('button, input, textarea, select, a[href], video, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent && !x.closest('.dialog')?.isSameNode(el) === false);
    if (!f.length) return;
    if (!el.contains(document.activeElement)) { f[0].focus(); e.preventDefault(); return; }
    if (e.shiftKey && document.activeElement === f[0]) { f.at(-1).focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === f.at(-1)) { f[0].focus(); e.preventDefault(); }
  }
}, true);
export function useDialog(onClose) {
  const ref = useRef();
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement;
    const entry = { ref, close: () => closeRef.current() };
    if (ref.current?.isConnected) dialogs.push(entry);
    requestAnimationFrame(() => (ref.current?.querySelector('[autofocus]') ?? ref.current?.querySelector('button, input, textarea, [tabindex]'))?.focus());
    return () => { const i = dialogs.indexOf(entry); if (i >= 0) dialogs.splice(i, 1); if (prev?.isConnected) prev.focus?.(); };
  }, []);
  return ref;
}

export function Tags({ tags, projectTags = [], onChange, all }) {
  const own = tags.filter((t) => !projectTags.includes(t));
  return html`<span class="tags">
    ${projectTags.map((t) => html`<span class="tag project" key=${`p${t}`} title="Defined by the project">${t}</span>`)}
    ${own.map((t) => html`<span class="tag" key=${t}>${t}${onChange && html`<button class="tag-x" title=${`Remove ${t}`} aria-label=${`Remove tag ${t}`} onClick=${() => onChange(own.filter((x) => x !== t))}><${Icon} name="x" size=${10} /></button>`}</span>`)}
    ${onChange && html`<${Popover} label="Add tag" trigger=${() => html`<button class="tag add" title="Add tag" aria-label="Add tag"><${Icon} name="plus" size=${11} /></button>`}>
      ${(close) => html`<${TagPicker} all=${all} exclude=${[...own, ...projectTags]} onPick=${(t) => { onChange([...own, t]); close(); }} />`}
    <//>`}
  </span>`;
}

export function useOrganization() { return useQuery('organization.list', {}); }

export function TagPicker({ exclude = [], onPick }) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const { data } = useOrganization();
  const t = q.trim().toLowerCase();
  const all = (data?.tags ?? []).filter((x) => !exclude.includes(x.tag) && x.tag.includes(t));
  const exact = all.some((x) => x.tag === t);
  const opts = [...all.slice(0, 12).map((x) => ({ t: x.tag, n: x.units + x.collections + x.assets })), ...(t && !exact ? [{ t, create: true }] : [])];
  return html`<div class="picker">
    <input value=${q} placeholder="Tag" aria-label="Tag" onInput=${(e) => { setQ(e.target.value); setHi(0); }}
      onKeyDown=${(e) => {
        if (e.key === 'ArrowDown') { setHi(Math.min(hi + 1, opts.length - 1)); e.preventDefault(); }
        if (e.key === 'ArrowUp') { setHi(Math.max(hi - 1, 0)); e.preventDefault(); }
        if (e.key === 'Enter' && opts[hi]) onPick(opts[hi].t);
      }} />
    <div class="picker-list" role="listbox">${opts.map((o, i) => html`<button role="option" aria-selected=${i === hi} class=${`picker-item${i === hi ? ' hi' : ''}`} onClick=${() => onPick(o.t)}>
      ${o.create ? html`<span class="muted">New</span> ${o.t}` : html`${o.t}<span class="count">${o.n}</span>`}</button>`)}</div>
  </div>`;
}

export function CategoryPicker({ value, projectValue, onChange }) {
  return html`<${Popover} label="Category" trigger=${() => html`<button class=${`cat${value ? '' : ' unset'}`} title=${projectValue && value === projectValue ? 'Category (from the project)' : 'Category'}>${value ? value.split('/').join(' / ') : 'Category'}</button>`}>
    ${(close) => html`<${CategoryList} value=${value} onPick=${(c) => { onChange(c); close(); }} />`}
  <//>`;
}
function CategoryList({ value, onPick }) {
  const [q, setQ] = useState('');
  const { data } = useOrganization();
  const t = q.trim().toLowerCase();
  const cats = (data?.categories ?? []).map((c) => c.path).filter((c) => c.toLowerCase().includes(t));
  const exact = (data?.categories ?? []).some((c) => c.path.toLowerCase() === t);
  return html`<div class="picker">
    <input value=${q} placeholder="Category or New/Path" aria-label="Category" onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && q.trim()) onPick(cats.length === 1 && !exact ? cats[0] : q.trim()); }} />
    <div class="picker-list">
      ${value && html`<button class="picker-item" onClick=${() => onPick(null)}><span class="muted">None</span></button>`}
      ${cats.map((c) => html`<button class=${`picker-item${c === value ? ' sel' : ''}`} onClick=${() => onPick(c)} style=${`padding-left:${10 + (c.split('/').length - 1) * 12}px`}>${c.split('/').at(-1)}<span class="count">${c.includes('/') ? c.split('/').slice(0, -1).join('/') : ''}</span></button>`)}
      ${t && !exact && html`<button class="picker-item" onClick=${() => onPick(q.trim())}><span class="muted">New</span> ${q.trim()}</button>`}
    </div>
  </div>`;
}

export function NoteCount({ n }) {
  return n ? html`<span class="notecount" title=${`${n} open note${n > 1 ? 's' : ''}`}><${Icon} name="note" size=${12} />${n}</span>` : null;
}
export function ErrorLine({ error, onRetry }) {
  if (!error) return null;
  return html`<div class="errline" role="alert"><${Icon} name="warn" size=${13} /><span>${error.message}</span>${onRetry && html`<button class="btn xs" onClick=${onRetry}>Retry</button>`}</div>`;
}
