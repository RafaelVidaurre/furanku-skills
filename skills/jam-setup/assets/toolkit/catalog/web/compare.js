// Comparing two versions of the same thing: frozen evidence against current content, or against
// another frozen part, or a view's before side. How two pieces of media are compared is up to
// their kind (media-kinds.js); attributes are compared here as a table.
import { html, useState, useRef, useEffect, Icon, useDialog, shortHash, baseName, call, href, withQuery, ErrorLine } from './core.js';
import { refusal, useViewer, useActiveViewer } from './controller.js';
import { mediaKind, useMediaKinds } from './media-kinds.js';

export const sideLabel = (side, label) => html`<div class="cmp-cap"><b>${label}</b>${side.status === 'ok' && side.path ? html` <span class="mono">${baseName(side.path)}</span> <span class="mono muted">${shortHash(side.sha256)}</span>` : ''}</div>`;
export const SideError = ({ side }) => html`<div class="viewer"><div class="viewer-msg err" role="alert">${side.status === 'missing' ? 'Missing: ' : side.status === 'corrupt' ? 'Changed bytes: ' : ''}${side.error ?? side.status}</div></div>`;

// Rows come from the evidence.compare action or a submission view's before side; each side was
// resolved independently. `shows` identifies the comparison to agents; camera and state apply to
// both sides where the kind has them.
export function CompareRows({ rows, labels, viewerId = 'compare', shows, camera, state }) {
  useMediaKinds();
  const api = useRef();
  // A kind may compare its two sides in one viewer (two takes on one transport): then that viewer
  // is the comparison, both sides must be available, and it answers for state and controls.
  const one = rows.length === 1 && rows[0].a.kind === rows[0].b.kind && mediaKind(rows[0].a.kind)?.compareTogether ? rows[0].a.kind : null;
  const oneAvailable = !!one && rows[0].a.status === 'ok' && rows[0].b.status === 'ok';
  const [statuses, setStatuses] = useState({});
  const mark = (k) => (s) => setStatuses((x) => (x[k] === s ? x : { ...x, [k]: s }));
  const [modes, setModes] = useState({});
  useViewer(viewerId, () => {
    if (one && !oneAvailable) return { kind: 'compare', mediaKind: one, status: 'error', error: `Both ${one} sides must be available`, shows, controls: [] };
    if (oneAvailable && !api.current) return { kind: 'compare', mediaKind: one, status: 'loading', shows, controls: [] };
    if (oneAvailable && api.current) {
      const st = api.current.getState();
      return { ...st, kind: 'compare', mediaKind: one, shows: { ...shows, ...st.shows }, identical: rows.map((r) => r.identical) };
    }
    const sides = rows.flatMap((r, i) => ['a', 'b'].map((s) => ({ row: r.label, side: s, status: r[s].status === 'ok' ? statuses[`${i}${s}`] ?? (r[s].kind === 'attributes' ? 'ready' : 'loading') : 'error', error: r[s].error ?? null, sha256: r[s].sha256 ?? null, kind: r[s].kind })));
    return { kind: 'compare', status: sides.some((s) => s.status === 'loading') ? 'loading' : 'ready', sides, identical: rows.map((r) => r.identical), modes, shows: { a: labels[0], b: labels[1], ...shows }, controls: ['compare'] };
  }, (c) => { if (one) { if (!oneAvailable || !api.current) throw refusal('unavailable', `Both ${one} sides must be ready`); return api.current.control(c); } if (!c.compare) return false; setModes((m) => ({ ...m, ...c.compare })); return true; });
  if (!rows.length) return html`<p class="muted">Nothing to compare</p>`;
  return html`${rows.map((r, i) => html`<section class="cmp-item" key=${r.key}>
    ${rows.length > 1 && html`<h4>${r.label}</h4>`}
    ${r.identical && html`<div class="same">Identical content (${shortHash(r.a.sha256) || 'attributes'})</div>`}
    <${CompareRow} row=${r} labels=${labels} mark=${(s) => mark(`${i}${s}`)} control=${modes} camera=${camera} state=${state} apiRef=${rows.length === 1 ? api : undefined} />
  </section>`)}`;
}

function CompareRow({ row, labels, mark, control, camera, state, apiRef }) {
  const { a, b } = row;
  if (a.kind === 'attributes' || b.kind === 'attributes') return html`<${AttrDiff} a=${a} b=${b} labels=${labels} />`;
  const kind = mediaKind(a.status === 'ok' ? a.kind : b.kind);
  const together = kind?.compareTogether;
  // A kind that compares in one viewer needs both sides; anything it cannot show is said per side.
  if (kind?.compare && (!together || (a.kind === b.kind && a.status === 'ok' && b.status === 'ok'))) {
    return html`<${kind.compare} a=${a} b=${b} labels=${labels} mark=${mark} control=${control} camera=${camera} state=${state} apiRef=${apiRef} />`;
  }
  return html`<${SideBySide} a=${a} b=${b} labels=${labels} mark=${mark} kind=${together ? null : kind} />`;
}

// The comparison of a kind that registered none: its viewer twice, or what is wrong with a side.
function SideBySide({ a, b, labels, mark, kind }) {
  useEffect(() => { if (a.status !== 'ok' || !kind) mark('a')('error'); if (b.status !== 'ok' || !kind) mark('b')('error'); }, [a.status, b.status, kind]);
  const side = (s, k, label) => html`<div>${sideLabel(s, label)}${s.status === 'ok' && kind ? html`<${kind.viewer} media=${{ ...s, state: 'ok' }} shows=${{ side: k, sha256: s.sha256 }} onStatus=${mark(k)} />` : html`<${SideError} side=${s} />`}</div>`;
  return html`<div class="cmp"><div class="cmp-side">${side(a, 'a', labels[0])}${side(b, 'b', labels[1])}</div></div>`;
}

function AttrDiff({ a, b, labels }) {
  const A = a.attrs ?? {}, B = b.attrs ?? {};
  const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])];
  const f = (v) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return html`<table class="attr-diff"><thead><tr><th></th><th>${labels[0]}</th><th>${labels[1]}</th></tr></thead><tbody>
    ${a.status !== 'ok' && html`<tr><td colspan="3" class="c-bad">${labels[0]}: ${a.error}</td></tr>`}
    ${b.status !== 'ok' && html`<tr><td colspan="3" class="c-bad">${labels[1]}: ${b.error}</td></tr>`}
    ${keys.map((k) => { const d = JSON.stringify(A[k]) !== JSON.stringify(B[k]); return html`<tr class=${d ? 'diff' : ''}><td>${k}</td><td>${f(A[k])}</td><td>${f(B[k])}</td></tr>`; })}
  </tbody></table>`;
}

// Overlay driven by `cmp=<comparison>` in the URL: the JSON of what evidence.compare takes,
// `{ a: { submission, item, part }, b?: "current" | { submission, item, part } }`.
export function CompareOverlay({ route }) {
  const spec = route.query.get('cmp');
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);
  const close = () => { location.hash = href(withQuery(route, { cmp: null })).slice(1); };
  useEffect(() => {
    if (!spec) return;
    setRes(null); setError(null);
    let comparison;
    try { comparison = JSON.parse(spec); } catch { setError(new Error('The comparison in this address is not valid JSON')); return; }
    call('evidence.compare', comparison).then(setRes, setError);
  }, [spec]);
  useActiveViewer('compare', !!spec, 1);
  // Until the comparison's rows arrive, the overlay itself is the viewer agents read.
  useViewer(spec && !res ? 'compare' : null, () => ({ kind: 'compare', status: error ? 'error' : 'loading', error: error?.message ?? null, shows: {}, controls: [] }), () => false);
  if (!spec) return null;
  return html`<${Overlay} title=${res ? res.title : 'Compare'} onClose=${close}>
    <${ErrorLine} error=${error} />
    ${!res && !error && html`<div class="viewer-msg"><span class="spin"></span></div>`}
    ${res && html`<${CompareRows} rows=${res.rows} labels=${[res.b === 'current' ? 'Reviewed' : 'Earlier', res.b === 'current' ? 'Current' : 'Later']} />`}
  <//>`;
}

export function Overlay({ title, onClose, children }) {
  const ref = useDialog(onClose);
  return html`<div class="scrim dark" onPointerDown=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="dialog compare" ref=${ref} role="dialog" aria-modal="true" aria-label=${title} data-viewer-root data-active="true">
      <header class="dialog-h"><h2>${title}</h2><button class="icon-btn" onClick=${onClose} aria-label="Close" autofocus><${Icon} name="x" /></button></header>
      <div class="compare-body">${children}</div>
    </div>
  </div>`;
}
