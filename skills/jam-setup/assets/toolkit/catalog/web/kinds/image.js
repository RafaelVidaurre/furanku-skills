// The image kind: pan and zoom viewer, plain thumbnail, and side-by-side, divider and toggle
// comparison. Registered like any other kind (see media-kinds.js).
import { html, useEffect, useRef, useState, Icon, useDialog } from '../core.js';
import { useViewer } from '../controller.js';
import { registerMediaKind } from '../media-kinds.js';
import { Msg } from '../viewers.js';
import { sideLabel, SideError } from '../compare.js';
import { SpriteCompare, SpriteThumb, SpriteViewer } from './sprite.js';
import { TrimmedImage } from './trim.js';
import { cropFits, CroppedImage } from './crop.js';

// ---------- 2D image: fit, zoom around pointer, pan, 1:1; controlled or uncontrolled view ----------
// Magnified, an image shows its own pixels (nearest neighbour): smoothing would blur detail it does
// not have. Shown smaller, it is smoothed unless the project's display keeps hard texels.
export function ImageViewer({ src, crop, label, view: extView, onView, viewerId, shows, onStatus }) {
  const box = useRef();
  const [loaded, setLoaded] = useState({ src: null });
  const [failed, setFailed] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [localView, setLocalView] = useState(null);
  const source = loaded.src === src ? loaded : null;
  const outside = crop && source && !cropFits(crop, source.w, source.h);
  const natural = outside ? null : crop && source ? { w: crop[2], h: crop[3] } : source;
  const error = outside ? `Crop lies outside the ${source.w}×${source.h} image`
    : failed === src ? 'Image could not be decoded or loaded' : null;
  const status = error ? 'error' : natural ? 'ready' : 'loading';
  const view = extView !== undefined ? extView : localView;
  const setView = onView ?? setLocalView;
  const [, force] = useState(0);
  useEffect(() => { const ro = new ResizeObserver(() => force((n) => n + 1)); ro.observe(box.current); return () => ro.disconnect(); }, []);
  useEffect(() => { onStatus?.(status); }, [status]);
  const fit = () => {
    if (!natural || !box.current) return null;
    const r = box.current.getBoundingClientRect();
    // Magnified, an image fits in whole steps, so each of its pixels is drawn the same size.
    const room = Math.min((r.width - 24) / natural.w, (r.height - 24) / natural.h, 4);
    const scale = room >= 1 ? Math.floor(room) : room;
    return { scale, x: (r.width - natural.w * scale) / 2, y: (r.height - natural.h * scale) / 2 };
  };
  const v = view ?? fit();
  const imageStyle = () => {
    if (!v || !natural) return 'opacity:0';
    const pixelated = v.scale > 1 ? '; image-rendering: pixelated' : '';
    const [x, y, w, h] = crop ?? [0, 0, source.w, source.h];
    const clip = crop ? `; clip-path: inset(${y}px ${source.w - x - w}px ${source.h - y - h}px ${x}px)` : '';
    return `transform: translate(${v.x - x * v.scale}px, ${v.y - y * v.scale}px) scale(${v.scale}); opacity: 1${pixelated}${clip}`;
  };
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
  useViewer(viewerId, () => ({ kind: 'image', status, error, shows, ...(crop ? { crop } : {}), natural: natural ? { width: natural.w, height: natural.h } : null, zoom: v ? { scale: +v.scale.toFixed(4), x: Math.round(v.x), y: Math.round(v.y) } : null, controls: ['zoom'] }),
    (c) => { if (c.zoom) { if (c.zoom.fit) setView(null); else setView({ scale: c.zoom.scale ?? v?.scale ?? 1, x: c.zoom.x ?? v?.x ?? 0, y: c.zoom.y ?? v?.y ?? 0 }); return true; } return false; });
  return html`<div class="viewer viewer-2d" ref=${box} tabindex="0" data-viewer-input aria-label=${label ?? 'Image'} onPointerDown=${onDown} onDblClick=${() => (view ? setView(null) : natural && oneToOne())} onKeyDown=${onKey}>
    <${Msg} status=${status} error=${error} onRetry=${outside ? null : () => { setFailed(null); setNonce(nonce + 1); }} />
    <img key=${`${src}#${nonce}`} src=${src} draggable="false" alt="" style=${imageStyle()}
      onLoad=${async (e) => { const el = e.target; try { await el.decode(); setLoaded({ src, w: el.naturalWidth, h: el.naturalHeight }); } catch { setFailed(src); } }} onError=${() => setFailed(src)} />
    ${natural && html`<div class="viewer-tools">
      <button class="tool" onClick=${() => setView(null)} title="Fit (0)">Fit</button>
      <button class="tool" onClick=${oneToOne} title="Actual size">1:1</button>
      <span class="tool-readout">${Math.round((v?.scale ?? 1) * 100)}%</span>
    </div>`}
  </div>`;
}

// Image comparison: side by side (linked zoom), divider, or toggle; fullscreen keeps the mode.
// The mode and full-screen buttons sit over the bottom-left corner of the (first) image, clear of the
// viewers' own tools (top right), the toggle's side tag (top left) and the divider's handle (middle).
const MODES = [['side', 'Side by side', 'sideBySide'], ['divider', 'Divider', 'split'], ['toggle', 'Toggle', 'swap']];
export function ImageCompare({ a, b, labels, mark, control }) {
  const [dims, setDims] = useState({});
  const [mode, setModeState] = useState(null);
  const [explicit, setExplicit] = useState(false);
  const [divider, setDivider] = useState(50);
  const [showB, setShowB] = useState(true);
  const [full, setFull] = useState(false);
  const [view, setView] = useState(null);
  const key = JSON.stringify([a.url, a.crop, b.url, b.crop]);
  useEffect(() => {
    let live = true;
    for (const [k, side] of [['a', a], ['b', b]]) {
      if (side.status !== 'ok') continue;
      const image = new Image();
      const set = (value) => { if (live) setDims((d) => ({ ...(d.key === key ? d : { key }), [k]: value })); };
      image.onload = () => {
        const sourceSize = [image.naturalWidth, image.naturalHeight];
        if (side.crop && !cropFits(side.crop, ...sourceSize)) {
          set({ error: `Crop lies outside the ${sourceSize.join('×')} image` });
        } else {
          set({ sourceSize, size: side.crop?.slice(2) ?? sourceSize });
        }
      };
      image.onerror = () => set({ error: 'Image could not be decoded or loaded' });
      image.src = side.url;
    }
    return () => { live = false; };
  }, [key, a.status, b.status]);
  const dimA = dims.key === key ? dims.a : null;
  const dimB = dims.key === key ? dims.b : null;
  const both = a.status === 'ok' && b.status === 'ok' && !dimA?.error && !dimB?.error;
  const aligned = both && dimA?.size && dimB?.size && dimA.size[0] === dimB.size[0] && dimA.size[1] === dimB.size[1];
  const left = dimA?.error ? { ...a, status: 'invalid', error: dimA.error } : { ...a, sourceSize: dimA?.sourceSize };
  const right = dimB?.error ? { ...b, status: 'invalid', error: dimB.error } : { ...b, sourceSize: dimB?.sourceSize };
  // Unaligned or partial evidence defaults to side by side unless the reviewer chose otherwise.
  const m = both ? control?.mode ?? (explicit ? mode : aligned ? mode ?? 'divider' : 'side') : 'side';
  useEffect(() => { if (control?.divider != null) setDivider(Math.max(0, Math.min(100, control.divider))); if (control?.side) setShowB(control.side === 'b'); }, [control?.divider, control?.side]);
  const setMode = (x) => { setModeState(x); setExplicit(true); };
  // Inline, divider and toggle frames take the images' shape so neither letterboxes on a narrow
  // screen; full screen fills the window instead.
  const ratio = aligned ? `${dimA.size[0]} / ${dimA.size[1]}` : null;
  useEffect(() => {
    mark('a')(left.status !== 'ok' ? 'error' : dimA?.size ? 'ready' : 'loading');
    mark('b')(right.status !== 'ok' ? 'error' : dimB?.size ? 'ready' : 'loading');
  }, [left.status, right.status, dimA, dimB]);
  const modes = (inFull) => html`<div class="cmp-modes">
    <span role="radiogroup" aria-label="Comparison mode">${MODES.map(([k, l, icon]) => html`<button role="radio" aria-checked=${m === k} aria-label=${l} data-tip=${l} class=${m === k ? 'on' : ''} disabled=${k !== 'side' && !both} onClick=${() => setMode(k)}><${Icon} name=${icon} size=${15} /></button>`)}</span>
    <button class="full-btn" onClick=${() => setFull(!inFull)} aria-label=${inFull ? 'Exit full screen' : 'Full screen'} data-tip=${inFull ? 'Exit full screen' : 'Full screen'}><${Icon} name=${inFull ? 'collapse' : 'expand'} size=${15} /></button>
  </div>`;
  const body = (inFull) => html`<div class=${`cmp${inFull ? ' full' : ''}`}>
    ${both && !aligned && dimA?.size && dimB?.size && html`<div class="muted small cmp-dims">${dimA.size.join('×')} vs ${dimB.size.join('×')}</div>`}
    <div class="cmp-stage">
    ${m === 'side' && html`<div class="cmp-side">
      <div class="cmp-stage">${sideLabel(left, labels[0])}${left.status === 'ok' ? html`<${ImageViewer} src=${left.url} crop=${left.crop} view=${view} onView=${setView} />` : html`<${SideError} side=${left} />`}${modes(inFull)}</div>
      <div>${sideLabel(right, labels[1])}${right.status === 'ok' ? html`<${ImageViewer} src=${right.url} crop=${right.crop} view=${view} onView=${setView} />` : html`<${SideError} side=${right} />`}</div>
    </div>`}
    ${m === 'divider' && html`<${Divider} a=${left} b=${right} labels=${labels} value=${divider} onChange=${setDivider} ratio=${inFull ? null : ratio} />`}
    ${m === 'toggle' && html`<${Toggle} a=${left} b=${right} labels=${labels} showB=${showB} onFlip=${() => setShowB(!showB)} ratio=${inFull ? null : ratio} />`}
    ${m !== 'side' && modes(inFull)}
    </div>
  </div>`;
  return html`${body(false)}${full && html`<${FullScreen} onClose=${() => setFull(false)}>${body(true)}<//>`}`;
}

function FullScreen({ onClose, children }) {
  const ref = useDialog(onClose);
  return html`<div class="scrim dark fullscreen" onPointerDown=${(e) => e.target === e.currentTarget && onClose()}><div class="dialog full" ref=${ref} role="dialog" aria-modal="true" aria-label="Full screen comparison">
    <header class="dialog-h"><span class="push"></span><button class="icon-btn" onClick=${onClose} aria-label="Close full screen" autofocus><${Icon} name="x" /></button></header>
    <div class="compare-body">${children}</div></div></div>`;
}

function ComparisonImage({ side, label, style }) {
  if (!side.crop) return html`<img class="comparison-image" src=${side.url} alt=${label} draggable="false" style=${style} />`;
  return side.sourceSize ? html`<${CroppedImage} className="comparison-image" src=${side.url}
    crop=${side.crop} size=${side.sourceSize} label=${label} style=${style} />` : null;
}

// Toggle: one frame showing one side; clicking or tapping the image (or Space/Enter on it) shows the other.
function Toggle({ a, b, labels, showB, onFlip, ratio }) {
  const [label, other] = showB ? [labels[1], labels[0]] : [labels[0], labels[1]];
  const side = showB ? b : a;
  return html`<div class="cmp-one">
    <div class="toggle-caps">${sideLabel(side, label)}</div>
    <div class="frame flip" role="button" tabindex="0" aria-pressed=${showB} aria-label=${`Showing ${label}. Show ${other}`} title=${`Show ${other}`} style=${ratio ? `aspect-ratio: ${ratio}` : ''}
      onClick=${onFlip} onKeyDown=${(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) onFlip(); } }}>
      <${ComparisonImage} side=${side} label=${label} />
      <span class="frame-tag" aria-hidden="true"><span class=${`ab${showB ? '' : ' on'}`}></span><span class=${`ab${showB ? ' on' : ''}`}></span>${label}</span>
      <span class="frame-hint" aria-hidden="true">${matchMedia('(pointer: coarse)').matches ? 'Tap' : 'Click'} to show ${other}</span>
    </div>
  </div>`;
}

function Divider({ a, b, labels, value, onChange, ratio }) {
  const box = useRef();
  const drag = useRef(null);
  const set = (e) => { const r = box.current.getBoundingClientRect(); onChange(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100))); };
  return html`<div class="cmp-one"><div class="slider-caps">${sideLabel(a, labels[0])}${sideLabel(b, labels[1])}</div>
    <div class="slider" ref=${box} style=${ratio ? `aspect-ratio: ${ratio}` : ''}
      onPointerDown=${(e) => { drag.current = { x: e.clientX, moved: false }; box.current.setPointerCapture(e.pointerId); }}
      onPointerMove=${(e) => { if (!drag.current) return; if (Math.abs(e.clientX - drag.current.x) > 4) drag.current.moved = true; if (drag.current.moved) set(e); }}
      onPointerUp=${(e) => { if (drag.current && !drag.current.moved) set(e); drag.current = null; }} onPointerCancel=${() => { drag.current = null; }}>
      <${ComparisonImage} side=${a} label=${labels[0]} />
      <${ComparisonImage} side=${b} label=${labels[1]} style=${`clip-path: inset(0 0 0 ${value}%)`} />
      <div class="slider-bar" style=${`left:${value}%`}></div>
      <div class="slider-handle" role="slider" tabindex="0" aria-label=${`Divider: ${labels[0]} left, ${labels[1]} right`} aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(value)} style=${`left:${value}%`}
        onKeyDown=${(e) => { const d = e.key === 'ArrowLeft' ? -5 : e.key === 'ArrowRight' ? 5 : e.key === 'Home' ? -100 : e.key === 'End' ? 100 : 0; if (d) { onChange(Math.max(0, Math.min(100, value + d))); e.preventDefault(); e.stopPropagation(); } }}></div>
    </div></div>`;
}


// An image that carries a `sheet` is an animation cut from it (sprite.js): it plays, compares in
// step and shows its first frame as a thumbnail.
registerMediaKind('image', {
  icon: 'M3 4h14v12H3z M3 13l4-4 3 3 2-2 5 5',
  controls: ['zoom', 'animation', 'sprite'],
  viewer: ({ media, label, ...rest }) => media.sheet
    ? html`<${SpriteViewer} src=${media.url} sheet=${media.sheet} label=${label ?? media.id} ...${rest} />`
    : html`<${ImageViewer} src=${media.url} crop=${media.crop} label=${label ?? media.id} ...${rest} />`,
  thumbnail: ({ asset }) => asset.sheet ? html`<${SpriteThumb} asset=${asset} />` : html`<${TrimmedImage} key=${JSON.stringify([asset.url, asset.crop])} src=${asset.url} crop=${asset.crop} />`,
  compare: (props) => (props.a.sheet || props.b.sheet ? html`<${SpriteCompare} ...${props} />` : html`<${ImageCompare} ...${props} />`),
  components: { ImageViewer, SpriteViewer },
});
