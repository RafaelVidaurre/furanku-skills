import { html, useState, useRef, useEffect, Icon, useDialog, shortHash, baseName, call, href, withQuery, ErrorLine } from './core.js';
import { ImageViewer, ModelViewer, VideoViewer, createCameraSync } from './viewers.js';
import { registerViewer, useActiveViewer } from './controller.js';

const sideLabel = (side, label) => html`<div class="cmp-cap"><b>${label}</b>${side.status === 'ok' && side.path ? html` <span class="mono">${baseName(side.path)}</span> <span class="mono muted">${shortHash(side.sha256)}</span>` : ''}</div>`;
const SideError = ({ side }) => html`<div class="viewer"><div class="viewer-msg err" role="alert">${side.status === 'missing' ? 'Missing: ' : side.status === 'corrupt' ? 'Changed bytes: ' : ''}${side.error ?? side.status}</div></div>`;

// Rows come from the evidence.compare action or a submission view's before side; each side was
// resolved independently. `source` identifies the comparison to agents; camera and state apply to
// both sides of a model comparison.
export function CompareRows({ rows, labels, viewerId = 'compare', source, camera, state }) {
  const [statuses, setStatuses] = useState({});
  const mark = (k) => (s) => setStatuses((x) => (x[k] === s ? x : { ...x, [k]: s }));
  const [modes, setModes] = useState({});
  registerViewer(viewerId, () => {
    const sides = rows.flatMap((r, i) => ['a', 'b'].map((s) => ({ row: r.label, side: s, status: r[s].status === 'ok' ? statuses[`${i}${s}`] ?? (r[s].kind === 'attributes' ? 'ready' : 'loading') : 'error', error: r[s].error ?? null, sha256: r[s].sha256 ?? null, kind: r[s].kind })));
    return { kind: 'compare', status: sides.some((s) => s.status === 'loading') ? 'loading' : 'ready', sides, identical: rows.map((r) => r.identical), modes, source: { a: labels[0], b: labels[1], ...source }, controls: ['compare'] };
  }, (c) => { if (!c.compare) return false; setModes((m) => ({ ...m, ...c.compare })); return true; });
  if (!rows.length) return html`<p class="muted">Nothing to compare</p>`;
  return html`${rows.map((r, i) => html`<section class="cmp-item" key=${r.key}>
    ${rows.length > 1 && html`<h4>${r.label}</h4>`}
    ${r.identical && html`<div class="same">Identical evidence (${shortHash(r.a.sha256) || 'attributes'})</div>`}
    <${CompareRow} row=${r} labels=${labels} mark=${(s) => mark(`${i}${s}`)} control=${modes} camera=${camera} state=${state} />
  </section>`)}`;
}

function CompareRow({ row, labels, mark, control, camera, state }) {
  const { a, b } = row;
  if (a.kind === 'attributes' || b.kind === 'attributes') return html`<${AttrDiff} a=${a} b=${b} labels=${labels} />`;
  const kind = a.status === 'ok' ? a.kind : b.kind;
  if (kind === 'image') return html`<${ImageCompare} a=${a} b=${b} labels=${labels} mark=${mark} control=${control} />`;
  if (kind === 'model') return html`<${ModelCompare} a=${a} b=${b} labels=${labels} mark=${mark} control=${control} camera=${camera} state=${state} />`;
  if (kind === 'video') return html`<${VideoCompare} a=${a} b=${b} labels=${labels} mark=${mark} />`;
  return html`<div class="cmp-side"><div>${sideLabel(a, labels[0])}<${SideError} side=${a} /></div><div>${sideLabel(b, labels[1])}<${SideError} side=${b} /></div></div>`;
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

// Image comparison: side by side (linked zoom), divider, or fixed-frame toggle; fullscreen keeps the mode.
export function ImageCompare({ a, b, labels, mark, control }) {
  const [dims, setDims] = useState({});
  const [mode, setModeState] = useState(null);
  const [explicit, setExplicit] = useState(false);
  const [divider, setDivider] = useState(50);
  const [showB, setShowB] = useState(true);
  const [full, setFull] = useState(false);
  const [view, setView] = useState(null);
  useEffect(() => {
    for (const [k, s] of [['a', a], ['b', b]]) if (s.status === 'ok') { const im = new Image(); im.onload = () => setDims((d) => ({ ...d, [k]: [im.naturalWidth, im.naturalHeight] })); im.onerror = () => setDims((d) => ({ ...d, [k]: 'error' })); im.src = s.url; }
  }, [a.url, b.url]);
  const both = a.status === 'ok' && b.status === 'ok';
  const aligned = both && Array.isArray(dims.a) && Array.isArray(dims.b) && dims.a[0] === dims.b[0] && dims.a[1] === dims.b[1];
  // Unaligned or partial evidence defaults to side by side unless the reviewer chose otherwise.
  const m = control?.mode ?? (explicit ? mode : aligned ? mode ?? 'divider' : 'side');
  useEffect(() => { if (control?.divider != null) setDivider(Math.max(0, Math.min(100, control.divider))); if (control?.side) setShowB(control.side === 'b'); }, [control?.divider, control?.side]);
  const setMode = (x) => { setModeState(x); setExplicit(true); };
  useEffect(() => { for (const k of ['a', 'b']) { const s = k === 'a' ? a : b; if (s.status !== 'ok') mark(k)('error'); else if (dims[k] === 'error') mark(k)('error'); else if (dims[k]) mark(k)('ready'); else mark(k)('loading'); } }, [dims.a, dims.b]);
  const body = (inFull) => html`<div class=${`cmp${inFull ? ' full' : ''}`}>
    <div class="cmp-tools">
      <span class="seg" role="radiogroup" aria-label="Comparison mode">${[['side', 'Side by side'], ['divider', 'Divider'], ['toggle', 'Toggle']].map(([k, l]) => html`<button role="radio" aria-checked=${m === k} class=${`seg-b${m === k ? ' on' : ''}`} disabled=${k !== 'side' && !both} onClick=${() => setMode(k)}>${l}</button>`)}</span>
      ${both && !aligned && Array.isArray(dims.a) && Array.isArray(dims.b) && html`<span class="muted small">${dims.a.join('×')} vs ${dims.b.join('×')}</span>`}
      <button class="btn sm push" onClick=${() => setFull(!inFull)} aria-label=${inFull ? 'Exit full screen' : 'Full screen'}><${Icon} name="expand" size=${12} />${inFull ? 'Exit' : 'Full screen'}</button>
    </div>
    ${m === 'side' && html`<div class="cmp-side">
      <div>${sideLabel(a, labels[0])}${a.status === 'ok' ? html`<${ImageViewer} src=${a.url} view=${view} onView=${setView} />` : html`<${SideError} side=${a} />`}</div>
      <div>${sideLabel(b, labels[1])}${b.status === 'ok' ? html`<${ImageViewer} src=${b.url} view=${view} onView=${setView} />` : html`<${SideError} side=${b} />`}</div>
    </div>`}
    ${m === 'divider' && html`<${Divider} a=${a} b=${b} labels=${labels} value=${divider} onChange=${setDivider} />`}
    ${m === 'toggle' && html`<div class="cmp-one">
      <div class="toggle-bar"><button class="btn sm toggle-btn" aria-pressed=${showB} onClick=${() => setShowB(!showB)} onKeyDown=${(e) => { if (e.repeat && (e.key === ' ' || e.key === 'Enter')) e.preventDefault(); }}>Showing ${showB ? labels[1] : labels[0]} <span class="muted">· Space to flip</span></button>${sideLabel(showB ? b : a, showB ? labels[1] : labels[0])}</div>
      <div class="frame"><img src=${showB ? b.url : a.url} alt=${showB ? labels[1] : labels[0]} draggable="false" /></div>
    </div>`}
  </div>`;
  return html`${body(false)}${full && html`<${FullScreen} onClose=${() => setFull(false)}>${body(true)}<//>`}`;
}

function FullScreen({ onClose, children }) {
  const ref = useDialog(onClose);
  return html`<div class="scrim dark fullscreen" onPointerDown=${(e) => e.target === e.currentTarget && onClose()}><div class="dialog full" ref=${ref} role="dialog" aria-modal="true" aria-label="Full screen comparison">
    <header class="dialog-h"><span class="push"></span><button class="icon-btn" onClick=${onClose} aria-label="Close full screen" autofocus><${Icon} name="x" /></button></header>
    <div class="compare-body">${children}</div></div></div>`;
}

function Divider({ a, b, labels, value, onChange }) {
  const box = useRef();
  const drag = useRef(null);
  const set = (e) => { const r = box.current.getBoundingClientRect(); onChange(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100))); };
  return html`<div class="cmp-one"><div class="slider-caps">${sideLabel(a, labels[0])}${sideLabel(b, labels[1])}</div>
    <div class="slider" ref=${box}
      onPointerDown=${(e) => { drag.current = { x: e.clientX, moved: false }; box.current.setPointerCapture(e.pointerId); }}
      onPointerMove=${(e) => { if (!drag.current) return; if (Math.abs(e.clientX - drag.current.x) > 4) drag.current.moved = true; if (drag.current.moved) set(e); }}
      onPointerUp=${(e) => { if (drag.current && !drag.current.moved) set(e); drag.current = null; }} onPointerCancel=${() => { drag.current = null; }}>
      <img src=${a.url} alt=${labels[0]} draggable="false" /><img src=${b.url} alt=${labels[1]} draggable="false" style=${`clip-path: inset(0 0 0 ${value}%)`} />
      <div class="slider-bar" style=${`left:${value}%`}></div>
      <div class="slider-handle" role="slider" tabindex="0" aria-label=${`Divider: ${labels[0]} left, ${labels[1]} right`} aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(value)} style=${`left:${value}%`}
        onKeyDown=${(e) => { const d = e.key === 'ArrowLeft' ? -5 : e.key === 'ArrowRight' ? 5 : e.key === 'Home' ? -100 : e.key === 'End' ? 100 : 0; if (d) { onChange(Math.max(0, Math.min(100, value + d))); e.preventDefault(); e.stopPropagation(); } }}></div>
    </div></div>`;
}

function ModelCompare({ a, b, labels, mark, control, camera, state }) {
  const [mode, setMode] = useState('side');
  const sync = useRef(createCameraSync()).current;
  const m = control?.mode === 'overlay' || control?.mode === 'side' ? control.mode : mode;
  useEffect(() => { if (a.status !== 'ok') mark('a')('error'); if (b.status !== 'ok') mark('b')('error'); }, [a.status, b.status]);
  const both = a.status === 'ok' && b.status === 'ok';
  return html`<div class="cmp">
    <div class="cmp-tools">
      <span class="seg" role="radiogroup" aria-label="Comparison mode">${[['side', 'Side by side'], ['overlay', 'Overlay']].map(([k, l]) => html`<button role="radio" aria-checked=${m === k} class=${`seg-b${m === k ? ' on' : ''}`} disabled=${k === 'overlay' && !both} onClick=${() => setMode(k)}>${l}</button>`)}</span>
      ${m === 'side' && both && html`<span class="muted small">Cameras and animation linked</span>`}
    </div>
    ${m === 'overlay' && both ? html`<div class="cmp-one">${sideLabel(b, `${labels[1]} over ${labels[0]} (grey)`)}<${ModelViewer} srcs=${[b.url]} ghost=${[a.url]} initialCamera=${camera} initialState=${state} onStatus=${(s) => { mark('a')(s); mark('b')(s); }} /></div>`
      : html`<div class="cmp-side">
        <div>${sideLabel(a, labels[0])}${a.status === 'ok' ? html`<${ModelViewer} srcs=${[a.url]} sync=${sync} initialCamera=${camera} initialState=${state} onStatus=${mark('a')} viewerId=${`cmp-a-${a.sha256}`} source=${{ side: 'a', sha256: a.sha256 }} />` : html`<${SideError} side=${a} />`}</div>
        <div>${sideLabel(b, labels[1])}${b.status === 'ok' ? html`<${ModelViewer} srcs=${[b.url]} sync=${sync} initialCamera=${camera} initialState=${state} onStatus=${mark('b')} viewerId=${`cmp-b-${b.sha256}`} source=${{ side: 'b', sha256: b.sha256 }} />` : html`<${SideError} side=${b} />`}</div>
      </div>`}
  </div>`;
}

function VideoCompare({ a, b, labels, mark }) {
  const vids = [useRef(), useRef()];
  useEffect(() => { if (a.status !== 'ok') mark('a')('error'); if (b.status !== 'ok') mark('b')('error'); }, [a.status, b.status]);
  return html`<div class="cmp">
    <div class="cmp-tools"><button class="btn sm" onClick=${() => vids.forEach((r) => { if (r.current) { r.current.currentTime = 0; r.current.play(); } })}>Restart both</button></div>
    <div class="cmp-side">
      <div>${sideLabel(a, labels[0])}${a.status === 'ok' ? html`<${VideoViewer} src=${a.url} videoRef=${vids[0]} onStatus=${mark('a')} />` : html`<${SideError} side=${a} />`}</div>
      <div>${sideLabel(b, labels[1])}${b.status === 'ok' ? html`<${VideoViewer} src=${b.url} videoRef=${vids[1]} onStatus=${mark('b')} />` : html`<${SideError} side=${b} />`}</div>
    </div></div>`;
}

// Overlay driven by `cmp=<sub>~<item>~<part>[~<sub2>~<item2>~<part2>]` in the URL.
export function CompareOverlay({ route }) {
  const spec = route.query.get('cmp');
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);
  const close = () => { location.hash = href(withQuery(route, { cmp: null })).slice(1); };
  useEffect(() => {
    if (!spec) return;
    setRes(null); setError(null);
    const [s, i, p, s2, i2, p2] = spec.split('~');
    call('evidence.compare', { a: { submission: s, item: i, part: p }, b: s2 ? { submission: s2, item: i2, part: p2 } : 'current' }).then(setRes, setError);
  }, [spec]);
  useActiveViewer('compare', !!spec, 1);
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
