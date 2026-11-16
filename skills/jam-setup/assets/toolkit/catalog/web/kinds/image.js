// The image kind: pan and zoom viewer, plain thumbnail, and side-by-side, divider and toggle
// comparison. Registered like any other kind (see media-kinds.js).
import { html, useEffect, useRef, useState, Icon, useDialog } from '../core.js';
import { registerViewer } from '../controller.js';
import { registerMediaKind } from '../media-kinds.js';
import { Msg } from '../viewers.js';
import { sideLabel, SideError } from '../compare.js';

// ---------- 2D image: fit, zoom around pointer, pan, 1:1; controlled or uncontrolled view ----------
export function ImageViewer({ src, label, view: extView, onView, viewerId, source, onStatus }) {
  const box = useRef(); const img = useRef();
  const [loaded, setLoaded] = useState({ src: null });
  const [failed, setFailed] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [localView, setLocalView] = useState(null);
  const natural = loaded.src === src ? loaded : null;
  const status = failed === src ? 'error' : natural ? 'ready' : 'loading';
  const view = extView !== undefined ? extView : localView;
  const setView = onView ?? setLocalView;
  const [, force] = useState(0);
  useEffect(() => { const ro = new ResizeObserver(() => force((n) => n + 1)); ro.observe(box.current); return () => ro.disconnect(); }, []);
  useEffect(() => { onStatus?.(status); }, [status]);
  const fit = () => {
    if (!natural || !box.current) return null;
    const r = box.current.getBoundingClientRect();
    const scale = Math.min((r.width - 24) / natural.w, (r.height - 24) / natural.h, 4);
    return { scale, x: (r.width - natural.w * scale) / 2, y: (r.height - natural.h * scale) / 2 };
  };
  const v = view ?? fit();
  const center = () => { const r = box.current.getBoundingClientRect(); return [r.width / 2, r.height / 2]; };
  const zoomAt = (factor, cx, cy) => { if (!v) return; const scale = Math.min(32, Math.max(0.05, v.scale * factor)); const k = scale / v.scale; setView({ scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }); };
  const oneToOne = () => { const [cx, cy] = center(); setView({ scale: 1, x: cx - natural.w / 2, y: cy - natural.h / 2 }); };
  useEffect(() => {
    const el = box.current;
    const wheel = (e) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });
  const onDown = (e) => {
    if (!v || e.button !== 0 || e.target.closest('.viewer-tools')) return;
    const el = box.current; const start = { x: e.clientX, y: e.clientY, v };
    el.setPointerCapture(e.pointerId);
    const move = (m) => setView({ ...start.v, x: start.v.x + m.clientX - start.x, y: start.v.y + m.clientY - start.y });
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  const onKey = (e) => {
    if (e.key === '+' || e.key === '=') zoomAt(1.25, ...center());
    else if (e.key === '-') zoomAt(0.8, ...center());
    else if (e.key === '0') setView(null);
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  registerViewer(viewerId, () => ({ kind: 'image', status, error: status === 'error' ? `Failed to load ${source?.path ?? src}` : null, source, natural: natural ? { width: natural.w, height: natural.h } : null, zoom: v ? { scale: +v.scale.toFixed(4), x: Math.round(v.x), y: Math.round(v.y) } : null, controls: ['zoom'] }),
    (c) => { if (c.zoom) { if (c.zoom.fit) setView(null); else setView({ scale: c.zoom.scale ?? v?.scale ?? 1, x: c.zoom.x ?? v?.x ?? 0, y: c.zoom.y ?? v?.y ?? 0 }); return true; } return false; });
  return html`<div class="viewer viewer-2d" ref=${box} tabindex="0" data-viewer-input aria-label=${label ?? 'Image'} onPointerDown=${onDown} onDblClick=${() => (view ? setView(null) : natural && oneToOne())} onKeyDown=${onKey}>
    <${Msg} status=${status} error=${status === 'error' ? 'Image could not be decoded or loaded' : null} onRetry=${() => { setFailed(null); setNonce(nonce + 1); }} />
    <img ref=${img} key=${`${src}#${nonce}`} src=${src} draggable="false" alt="" style=${v ? `transform: translate(${v.x}px, ${v.y}px) scale(${v.scale}); opacity: 1` : 'opacity:0'}
      onLoad=${async (e) => { const el = e.target; try { await el.decode(); setLoaded({ src, w: el.naturalWidth, h: el.naturalHeight }); } catch { setFailed(src); } }} onError=${() => setFailed(src)} />
    ${natural && html`<div class="viewer-tools">
      <button class="tool" onClick=${() => setView(null)} title="Fit (0)">Fit</button>
      <button class="tool" onClick=${oneToOne} title="Actual size">1:1</button>
      <span class="tool-readout">${Math.round((v?.scale ?? 1) * 100)}%</span>
    </div>`}
  </div>`;
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


registerMediaKind('image', {
  icon: 'M3 4h14v12H3z M3 13l4-4 3 3 2-2 5 5',
  viewer: ({ media, label, ...rest }) => html`<${ImageViewer} src=${media.url} label=${label ?? media.id} ...${rest} />`,
  thumbnail: ({ asset }) => html`<img src=${asset.url} alt="" loading="lazy" decoding="async" />`,
  compare: ImageCompare,
  components: { ImageViewer },
});
