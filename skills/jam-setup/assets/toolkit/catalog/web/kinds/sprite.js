// Images cut into animation frames (sprite sheets): a player, a synced comparison and a
// first-frame thumbnail. The image kind (image.js) hands media that carries a `sheet` here; the
// sheet's form is the catalog's (src/catalog/model/sheet.ts): { fps, loop, grid | frames, durations? }.
//
// One transport drives every frame shown: a viewer's own, or one shared by both sides of a
// comparison, so two versions of an animation play in step.
import { useLayoutEffect, useMemo } from 'preact/hooks';
import { html, useEffect, useRef, useState, prefersReducedMotion } from '../core.js';
import { useViewer, refusal } from '../controller.js';
import { Msg } from '../viewers.js';
import { sideLabel, SideError } from '../compare.js';
import { drawnPart, drawPart } from './trim.js';
import { cropFits, CroppedImage } from './crop.js';

const SPEEDS = [0.25, 0.5, 1, 2];
const P = {
  play: 'M6 4l10 6-10 6z',
  pause: 'M6 4v12 M14 4v12',
  prev: 'M14 4l-7 6 7 6 M5 4v12',
  next: 'M6 4l7 6-7 6 M15 4v12',
  loop: 'M4 9V8a3 3 0 0 1 3-3h9 M13 2l3 3-3 3 M16 11v1a3 3 0 0 1-3 3H4 M7 18l-3-3 3-3',
  onion: 'M7 5h9v9H7z M4 8v9h9',
  sheet: 'M3 3h14v14H3z M3 10h14 M8 3v14 M13 3v14',
  frame: 'M3 7V3h4 M13 3h4v4 M17 13v4h-4 M7 17H3v-4',
};
const Glyph = ({ d }) => html`<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${d} /></svg>`;

/**
 * The frames a sheet cuts from an image of this size: each with its rectangle in the image, its
 * place in the frame, its size, and when it starts. Problems that keep it from playing are `error`;
 * a grid that does not divide the image evenly is a `note`.
 */
export function resolveSheet(sheet, width, height) {
  const out = { frames: [], box: [0, 0], total: 0, error: null, note: null };
  const raw = [];
  if (sheet.grid) {
    const g = sheet.grid;
    const [ox, oy] = g.origin ?? [0, 0];
    const [gx, gy] = g.gap ?? [0, 0];
    let cell = g.cell;
    if (!cell) {
      const free = [width - ox - gx * (g.columns - 1), height - oy - gy * (g.rows - 1)];
      cell = [Math.floor(free[0] / g.columns), Math.floor(free[1] / g.rows)];
      if (free[0] % g.columns || free[1] % g.rows) out.note = `${width}×${height} does not divide evenly into ${g.columns}×${g.rows} cells`;
    }
    for (let i = 0; i < g.count; i++) {
      const c = g.start + i;
      const col = c % g.columns, row = Math.floor(c / g.columns);
      raw.push({ region: [ox + col * (cell[0] + gx), oy + row * (cell[1] + gy), cell[0], cell[1]], duration: sheet.durations?.[i] ?? 1 });
    }
  } else {
    for (const f of sheet.frames ?? []) raw.push({ region: f.region, offset: f.offset, size: f.size, duration: f.duration ?? 1 });
  }
  let start = 0;
  for (const [i, f] of raw.entries()) {
    const [x, y, w, h] = f.region;
    if (w < 1 || h < 1 || x + w > width || y + h > height) { out.error = `Frame ${i + 1} lies outside the ${width}×${height} image`; return out; }
    const size = f.size ?? [w, h];
    out.frames.push({ region: f.region, offset: f.offset ?? [0, 0], size, start: start / sheet.fps, duration: f.duration / sheet.fps });
    start += f.duration;
    out.box = [Math.max(out.box[0], size[0]), Math.max(out.box[1], size[1])];
  }
  out.total = start / sheet.fps;
  if (!out.frames.length) out.error = 'The sheet has no frames';
  return out;
}

/** The frame showing at `time` seconds; past the end, a looping sheet starts again and another stays on its last frame. */
export function frameAt(resolved, time, loop) {
  const { frames, total } = resolved;
  if (!frames.length || !(total > 0)) return 0;
  const t = loop ? ((time % total) + total) % total : Math.min(Math.max(time, 0), total);
  if (!loop && t >= total) return frames.length - 1;
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (frames[mid].start <= t + 1e-9) lo = mid; else hi = mid - 1; }
  return lo;
}

// ---------- Loading an image once per address ----------
function useImage(src) {
  const [state, setState] = useState({ src: null, img: null, error: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!src) return;
    let live = true;
    const img = new Image();
    img.decoding = 'async';
    img.onload = async () => { try { await img.decode(); } catch { /* drawn anyway */ } if (live) setState({ src, img, error: null }); };
    img.onerror = () => { if (live) setState({ src, img: null, error: 'Image could not be decoded or loaded' }); };
    img.src = src;
    return () => { live = false; };
  }, [src, nonce]);
  const current = state.src === src ? state : { src, img: null, error: null };
  return { ...current, retry: () => setNonce((n) => n + 1) };
}

/** The frames of a sheet once its image is loaded; worked out again only when either changes. */
function useResolved(sheet, img) {
  const key = sheet ? JSON.stringify(sheet) : '';
  return useMemo(() => (sheet && img ? resolveSheet(sheet, img.naturalWidth, img.naturalHeight) : null), [key, img]);
}

// ---------- The transport: time, playing, speed, loop ----------
export function useTransport({ total, loop: loop0 = true, initial }) {
  const init = initial ?? {};
  const [playing, setPlayingState] = useState(init.playing ?? !prefersReducedMotion());
  // Pausing takes effect at once: a frame already scheduled must not move the time after it.
  const live = useRef(playing);
  const [time, setTime] = useState(init.time ?? 0);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(loop0);
  const clock = useRef({ time: init.time ?? 0, last: null });
  clock.current.time = time;
  const seek = (t) => { const v = Math.max(0, Math.min(total, t)); clock.current.time = v; setTime(v); };
  // Playing again after an animation that does not loop ran out starts it over.
  const setPlaying = (on) => {
    if (on && !loop && clock.current.time >= total) seek(0);
    live.current = on;
    setPlayingState(on);
  };
  useEffect(() => setLoop(loop0), [loop0]);
  useEffect(() => {
    if (!playing || !(total > 0)) return;
    let raf = 0;
    clock.current.last = null;
    const tick = (now) => {
      const c = clock.current;
      if (!live.current) return;
      if (c.last !== null) {
        let next = c.time + ((now - c.last) / 1000) * speed;
        if (!loop && next >= total) { next = total; setPlaying(false); }
        else if (loop && next >= total) next %= total;
        c.time = next;
        setTime(next);
      }
      c.last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, loop, total]);
  return { playing, setPlaying, time, seek, speed, setSpeed, loop, setLoop, total };
}

// ---------- Drawing frames ----------
function draw(canvas, img, resolved, index, onion) {
  if (!canvas || !img) return;
  const [bw, bh] = resolved.box;
  if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, bw, bh);
  const one = (f, alpha) => {
    const [x, y, w, h] = f.region;
    // A frame of another size than the largest is centred, as engines centre sprites.
    const dx = Math.round((bw - f.size[0]) / 2) + f.offset[0], dy = Math.round((bh - f.size[1]) / 2) + f.offset[1];
    g.globalAlpha = alpha;
    g.drawImage(img, x, y, w, h, dx, dy, w, h);
  };
  const n = resolved.frames.length;
  if (onion && n > 1) one(resolved.frames[(index - 1 + n) % n], 0.3);
  one(resolved.frames[index], 1);
  g.globalAlpha = 1;
}

/**
 * The part of the frame box that any frame draws into (its opaque pixels), with a small margin, as
 * [x, y, width, height]: a small sprite in a large cell then fills the view, and because it is one
 * box for every frame, movement inside the cell still shows. Null when the pixels cannot be read.
 */
export function contentBox(img, resolved) {
  if (!img || !resolved || resolved.error) return null;
  const W = img.naturalWidth, H = img.naturalHeight;
  if (W * H > 64e6) return null;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  let data;
  try { data = g.getImageData(0, 0, W, H).data; } catch { return null; }
  const [bw, bh] = resolved.box;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of resolved.frames) {
    const [rx, ry, rw, rh] = f.region;
    const dx = Math.round((bw - f.size[0]) / 2) + f.offset[0] - rx, dy = Math.round((bh - f.size[1]) / 2) + f.offset[1] - ry;
    for (let y = ry; y < ry + rh; y++) {
      const row = y * W;
      for (let x = rx; x < rx + rw; x++) {
        if (data[(row + x) * 4 + 3] <= 8) continue;
        if (x + dx < x0) x0 = x + dx;
        if (x + dx > x1) x1 = x + dx;
        if (y + dy < y0) y0 = y + dy;
        if (y + dy > y1) y1 = y + dy;
      }
    }
  }
  if (x1 < x0) return null;
  const pad = Math.max(2, Math.round(Math.max(x1 - x0, y1 - y0) * 0.04));
  const left = Math.max(0, x0 - pad), top = Math.max(0, y0 - pad);
  return [left, top, Math.min(bw, x1 + pad + 1) - left, Math.min(bh, y1 + pad + 1) - top];
}

function useContent(img, resolved) {
  return useMemo(() => contentBox(img, resolved), [img, resolved]);
}

/** Two boxes' smallest common box: both sides of a comparison framed alike. */
const union = (a, b) => {
  if (!a || !b) return a ?? b;
  const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
  return [x, y, Math.max(a[0] + a[2], b[0] + b[2]) - x, Math.max(a[1] + a[3], b[1] + b[3]) - y];
};

/** One frame of a sheet on a canvas, scaled by CSS so pixel art stays pixelated; `crop` shows part of the frame box. */
function FrameCanvas({ img, resolved, index, onion, scale, ghost, crop }) {
  const ref = useRef();
  // Drawn before the browser paints, so what is on screen always matches the reported frame.
  useLayoutEffect(() => draw(ref.current, img, resolved, index, onion), [img, resolved, index, onion]);
  const [bw, bh] = resolved.box;
  const [cx, cy, cw, ch] = crop ?? [0, 0, bw, bh];
  return html`<div class=${`sprite-window${ghost ? ' ghost' : ''}${scale > 1 ? ' magnified' : ''}`} style=${`width:${cw * scale}px;height:${ch * scale}px`}>
    <canvas ref=${ref} class="sprite-frame" width=${bw} height=${bh} style=${`width:${bw * scale}px;height:${bh * scale}px;left:${-cx * scale}px;top:${-cy * scale}px`}></canvas>
  </div>`;
}

/** The whole sheet with each frame's rectangle; the showing frame is marked and a click shows another. */
function SheetMap({ img, resolved, index, scale, onPick }) {
  const w = img.naturalWidth, h = img.naturalHeight;
  return html`<div class=${`sprite-map${scale > 1 ? ' magnified' : ''}`} style=${`width:${w * scale}px;height:${h * scale}px`}>
    <img src=${img.src} alt="" draggable="false" />
    <svg viewBox=${`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      ${resolved.frames.map((f, i) => html`<rect x=${f.region[0]} y=${f.region[1]} width=${f.region[2]} height=${f.region[3]} class=${i === index ? 'on' : ''} vector-effect="non-scaling-stroke" onClick=${() => onPick(i)}><title>Frame ${i + 1}</title></rect>`)}
    </svg>
  </div>`;
}

/** The scale that fits `size` into the element: magnified, in whole steps, so every pixel is drawn the same size. */
function useFit(ref, size, reserve = 64) {
  const [box, setBox] = useState([0, 0]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setBox([r.width, r.height]); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!size[0] || !size[1] || !box[0]) return 1;
  const fit = Math.min((box[0] - 24) / size[0], (box[1] - reserve - 16) / size[1], 8);
  return fit >= 1 ? Math.floor(fit) : Math.max(fit, 0.05);
}

// ---------- Controls shared by the player and the comparison ----------
function Bar({ t, frames, index, onStep, show, setShow, onion, setOnion, whole, setWhole, fps }) {
  const toggle = (on, label, d, onClick) => html`<button class=${`tool icon${on ? ' on' : ''}`} aria-pressed=${on} aria-label=${label} title=${label} onClick=${onClick}><${Glyph} d=${d} /></button>`;
  return html`<div class="sprite-bar viewer-tools-bottom" onPointerDown=${(e) => e.stopPropagation()}>
    <button class="tool icon" aria-label="Previous frame" title="Previous frame (←)" onClick=${() => onStep(-1)}><${Glyph} d=${P.prev} /></button>
    <button class="tool icon" aria-label=${t.playing ? 'Pause' : 'Play'} title=${`${t.playing ? 'Pause' : 'Play'} (Space)`} onClick=${() => t.setPlaying(!t.playing)}><${Glyph} d=${t.playing ? P.pause : P.play} /></button>
    <button class="tool icon" aria-label="Next frame" title="Next frame (→)" onClick=${() => onStep(1)}><${Glyph} d=${P.next} /></button>
    <input class="sprite-scrub" type="range" min="0" max=${Math.max(frames - 1, 0)} step="1" value=${index} aria-label="Frame"
      onInput=${(e) => onStep(0, Number(e.target.value))} />
    <span class="tool-readout">${index + 1} / ${frames}${fps ? ` · ${+fps.toFixed(2)} fps` : ''}</span>
    <select class="tool" aria-label="Speed" value=${t.speed} onChange=${(e) => t.setSpeed(Number(e.target.value))}>${SPEEDS.map((s) => html`<option value=${s}>${s}×</option>`)}</select>
    ${toggle(t.loop, 'Loop', P.loop, () => t.setLoop(!t.loop))}
    ${setOnion && toggle(onion, 'Onion skin: show the previous frame faintly', P.onion, () => setOnion(!onion))}
    ${setWhole && toggle(whole, 'Show the whole frame, not only what is drawn in it', P.frame, () => setWhole(!whole))}
    ${setShow && toggle(show === 'sheet', 'Show the whole sheet', P.sheet, () => setShow(show === 'sheet' ? 'animation' : 'sheet'))}
  </div>`;
}

// Keys on a focused player: Space plays or pauses, arrows step a frame, Home and End go to the ends.
const onKeys = (t, step, last) => (e) => {
  if (e.key === ' ') t.setPlaying(!t.playing);
  else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
  else if (e.key === 'Home') step(0, 0);
  else if (e.key === 'End') step(0, last);
  else return;
  e.preventDefault(); e.stopPropagation();
};

/** A control from an agent or a review view, applied to a transport: `animation { frame, time, playing, speed }`. */
function applyAnimation(t, resolved, a) {
  if (a.clip != null) throw refusal('unsupported', 'a sprite sheet has no named clips; give frame or time');
  if (a.playing === false) t.setPlaying(false);
  if (a.frame != null) {
    if (!Number.isInteger(a.frame) || a.frame < 0 || a.frame >= resolved.frames.length) throw refusal('invalid', `frame must be 0 to ${resolved.frames.length - 1}`);
    t.seek(resolved.frames[a.frame].start);
  } else if (a.time != null) t.seek(a.time);
  if (a.speed != null) { if (!SPEEDS.includes(a.speed)) throw refusal('invalid', `speed must be one of ${SPEEDS.join(', ')}`); t.setSpeed(a.speed); }
  if (a.playing === true) t.setPlaying(true);
}

const stepper = (t, resolved, index) => (delta, to) => {
  const n = resolved.frames.length;
  const target = to ?? (t.loop ? (index + delta + n) % n : Math.min(Math.max(index + delta, 0), n - 1));
  t.setPlaying(false);
  t.seek(resolved.frames[target].start);
};

// ---------- The player ----------
export function SpriteViewer({ src, sheet, label, viewerId, shows, onStatus, initialState }) {
  const box = useRef();
  const image = useImage(src);
  const resolved = useResolved(sheet, image.img);
  const start = initialState?.animation;
  const t = useTransport({ total: resolved?.total ?? 0, loop: sheet.loop, initial: start && { time: start.time ?? 0, playing: start.playing ?? false } });
  // A view that starts on a frame can place it only once the image says where the frames are.
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || !resolved || resolved.error) return;
    placed.current = true;
    if (start?.frame != null && resolved.frames[start.frame]) t.seek(resolved.frames[start.frame].start);
  }, [resolved]);
  const [show, setShow] = useState('animation');
  const [onion, setOnion] = useState(false);
  const [whole, setWhole] = useState(false);
  const [zoom, setZoom] = useState(null);
  const content = useContent(image.img, resolved);
  const crop = whole ? null : content;
  const status = image.error || resolved?.error ? 'error' : resolved ? 'ready' : 'loading';
  const error = image.error ?? resolved?.error ?? null;
  useEffect(() => { onStatus?.(status); }, [status]);
  const index = resolved && !resolved.error ? frameAt(resolved, t.time, t.loop) : 0;
  const fitSize = show === 'sheet' && image.img ? [image.img.naturalWidth, image.img.naturalHeight] : crop ? [crop[2], crop[3]] : resolved?.box ?? [0, 0];
  const fit = useFit(box, fitSize);
  const scale = zoom ?? fit;
  useViewer(viewerId, () => ({
    kind: 'image', status, error, shows,
    natural: image.img ? { width: image.img.naturalWidth, height: image.img.naturalHeight } : null,
    sheet: resolved && !resolved.error ? { frames: resolved.frames.length, frameSize: resolved.box, fps: sheet.fps, duration: +resolved.total.toFixed(4), note: resolved.note } : null,
    animation: { frame: index, time: +t.time.toFixed(4), playing: t.playing, speed: t.speed, loop: t.loop },
    sprite: { show, onion, crop: crop && { x: crop[0], y: crop[1], width: crop[2], height: crop[3] } },
    zoom: { scale: +scale.toFixed(4), fit: zoom === null },
    controls: ['animation', 'sprite', 'zoom'],
  }), (c) => {
    let did = false;
    if (c.animation) { if (!resolved || resolved.error) throw refusal('unavailable', error ?? 'the sheet is still loading'); applyAnimation(t, resolved, c.animation); did = true; }
    if (c.sprite) {
      if (c.sprite.show != null) { if (!['animation', 'sheet'].includes(c.sprite.show)) throw refusal('invalid', 'sprite.show is animation or sheet'); setShow(c.sprite.show); }
      if (c.sprite.onion != null) setOnion(!!c.sprite.onion);
      if (c.sprite.whole != null) setWhole(!!c.sprite.whole);
      did = true;
    }
    if (c.zoom) { setZoom(c.zoom.fit || c.zoom.scale == null ? null : Math.min(32, Math.max(0.05, Number(c.zoom.scale)))); did = true; }
    return did;
  });
  const step = resolved && !resolved.error ? stepper(t, resolved, index) : () => {};
  return html`<div class="viewer viewer-2d viewer-sprite" ref=${box} tabindex="0" data-viewer-input aria-label=${label ?? 'Animation'}
    onKeyDown=${resolved && !resolved.error ? onKeys(t, step, resolved.frames.length - 1) : undefined}
    onWheel=${(e) => { e.preventDefault(); setZoom(Math.min(32, Math.max(0.05, scale * Math.exp(-e.deltaY * 0.0015)))); }}
    onDblClick=${(e) => { if (!e.target.closest('.sprite-bar')) setZoom(zoom === null ? 1 : null); }}>
    <${Msg} status=${status} error=${error} onRetry=${image.error ? image.retry : null} />
    ${status === 'ready' && html`<div class="sprite-stage">
      ${show === 'sheet'
        ? html`<${SheetMap} img=${image.img} resolved=${resolved} index=${index} scale=${scale} onPick=${(i) => step(0, i)} />`
        : html`<${FrameCanvas} img=${image.img} resolved=${resolved} index=${index} onion=${onion} scale=${scale} crop=${crop} />`}
    </div>
    <div class="viewer-tools">
      <button class="tool" onClick=${() => setZoom(null)} title="Fit">Fit</button>
      <button class="tool" onClick=${() => setZoom(1)} title="Actual size">1:1</button>
      <span class="tool-readout">${Math.round(scale * 100)}%</span>
    </div>
    ${resolved.note && html`<div class="viewer-note">${resolved.note}</div>`}
    <${Bar} t=${t} frames=${resolved.frames.length} index=${index} onStep=${step} show=${show} setShow=${setShow} onion=${onion} setOnion=${setOnion} whole=${whole} setWhole=${show === 'sheet' ? null : setWhole} fps=${sheet.fps} />`}
  </div>`;
}

// ---------- Two versions in step ----------
const MODES = [['side', 'Side by side', 'M2 5h7v10H2z M11 5h7v10h-7z'], ['overlay', 'Overlay: the second over the first', 'M4 4h9v9H4z M7 7h9v9H7z'], ['toggle', 'Toggle', 'M4 7h12 M13 4l3 3-3 3 M16 13H4 M7 10l-3 3 3 3']];

/**
 * Two sides, at least one with a sheet, on one transport. A side without a sheet is its still
 * image. Each side loops on its own length; the scrubber moves through the longer one.
 */
export function SpriteCompare({ a, b, labels, mark, control, apiRef }) {
  const box = useRef();
  const ia = useImage(a.status === 'ok' ? a.url : ''), ib = useImage(b.status === 'ok' ? b.url : '');
  const ra = useResolved(a.sheet, ia.img), rb = useResolved(b.sheet, ib.img);
  const total = Math.max(ra?.error ? 0 : ra?.total ?? 0, rb?.error ? 0 : rb?.total ?? 0);
  const longer = (rb && !rb.error && rb.total >= (ra?.total ?? 0)) ? rb : ra && !ra.error ? ra : rb;
  const t = useTransport({ total, loop: true });
  const [mode, setMode] = useState('side');
  const m = control?.mode ?? mode;
  const cropError = (s, img) => s.crop && img.img && !cropFits(s.crop, img.img.naturalWidth, img.img.naturalHeight)
    ? `Crop lies outside the ${img.img.naturalWidth}×${img.img.naturalHeight} image` : null;
  const sideState = (s, img, r) => s.status !== 'ok' || img.error || r?.error || cropError(s, img)
    ? 'error' : img.img && (!s.sheet || r) ? 'ready' : 'loading';
  const st = [sideState(a, ia, ra), sideState(b, ib, rb)];
  useEffect(() => { mark('a')(st[0]); mark('b')(st[1]); }, [st[0], st[1]]);
  const [ca, cb] = [useContent(ia.img, ra), useContent(ib.img, rb)];
  const boxOf = (s, img, r) => r && !r.error ? r.box
    : img.img && !cropError(s, img) ? s.crop?.slice(2) ?? [img.img.naturalWidth, img.img.naturalHeight] : [0, 0];
  const [ba, bb] = [boxOf(a, ia, ra), boxOf(b, ib, rb)];
  const sameSize = ba[0] === bb[0] && ba[1] === bb[1] && ba[0] > 0;
  // Frames of one size are cut to one box, so the two line up; otherwise each to its own drawing.
  const [cropA, cropB] = sameSize && ra && rb ? [union(ca, cb), union(ca, cb)] : [ra ? ca : null, rb ? cb : null];
  const sa = cropA ? [cropA[2], cropA[3]] : ba, sb = cropB ? [cropB[2], cropB[3]] : bb;
  const fit = useFit(box, m === 'side' ? [sa[0] + sb[0], Math.max(sa[1], sb[1])] : [Math.max(sa[0], sb[0]), Math.max(sa[1], sb[1])]);
  const [showB, setShowB] = useState(true);
  const index = longer && !longer.error ? frameAt(longer, t.time, true) : 0;
  const step = longer && !longer.error ? stepper(t, longer, index) : () => {};
  const getState = () => ({ kind: 'image', status: st.includes('loading') ? 'loading' : st.includes('error') ? 'error' : 'ready', animation: { time: +t.time.toFixed(4), playing: t.playing, speed: t.speed, frames: [ra && !ra.error ? frameAt(ra, t.time, true) : null, rb && !rb.error ? frameAt(rb, t.time, true) : null] }, mode: m, controls: ['animation', 'compare'] });
  const commands = (c) => {
    let did = false;
    if (c.animation && longer && !longer.error) { applyAnimation(t, longer, c.animation); did = true; }
    if (c.compare?.mode) { if (!MODES.some(([k]) => k === c.compare.mode)) throw refusal('invalid', `compare.mode is one of ${MODES.map(([k]) => k).join(', ')}`); setMode(c.compare.mode); did = true; }
    return did;
  };
  if (apiRef) apiRef.current = { getState, control: commands };
  const side = (s, img, r, k) => {
    if (s.status !== 'ok') return html`<${SideError} side=${s} />`;
    const error = img.error ?? r?.error ?? cropError(s, img);
    if (error) return html`<div class="viewer"><div class="viewer-msg err" role="alert">${error}</div></div>`;
    if (!img.img || (s.sheet && !r)) return html`<div class="viewer"><${Msg} status="loading" /></div>`;
    if (r) return html`<${FrameCanvas} img=${img.img} resolved=${r} index=${frameAt(r, t.time, true)} scale=${fit} ghost=${k === 'ghost'} crop=${s === a ? cropA : cropB} />`;
    const stillClass = `sprite-still${k === 'ghost' ? ' ghost' : ''}${fit > 1 ? ' magnified' : ''}`;
    if (s.crop) return html`<${CroppedImage} className=${stillClass} src=${img.img.src} crop=${s.crop}
      size=${[img.img.naturalWidth, img.img.naturalHeight]} style=${`width:${s.crop[2] * fit}px;height:${s.crop[3] * fit}px`} />`;
    return html`<img class=${stillClass} src=${img.img.src} alt="" style=${`width:${img.img.naturalWidth * fit}px`} />`;
  };
  const ready = !st.includes('loading');
  return html`<div class="cmp cmp-sprite">
    <div class="viewer viewer-2d viewer-sprite" ref=${box} tabindex="0" data-viewer-input aria-label="Animation comparison"
      onKeyDown=${longer && !longer.error ? onKeys(t, step, longer.frames.length - 1) : undefined}>
      <div class="sprite-caps">${sideLabel(a, labels[0])}${sideLabel(b, labels[1])}</div>
      ${m === 'side' && html`<div class="sprite-stage sprite-pair"><div>${side(a, ia, ra, 'a')}</div><div>${side(b, ib, rb, 'b')}</div></div>`}
      ${m === 'overlay' && html`<div class="sprite-stage sprite-overlay"><div>${side(a, ia, ra, 'a')}</div><div class="over">${side(b, ib, rb, 'ghost')}</div></div>`}
      ${m === 'toggle' && html`<div class="sprite-stage" role="button" tabindex="-1" aria-pressed=${showB} title=${`Showing ${showB ? labels[1] : labels[0]}; click for the other`} onClick=${() => setShowB(!showB)}>${showB ? side(b, ib, rb, 'b') : side(a, ia, ra, 'a')}</div>`}
      <div class="cmp-modes"><span role="radiogroup" aria-label="Comparison mode">${MODES.map(([k, l, d]) => html`<button role="radio" aria-checked=${m === k} aria-label=${l} data-tip=${l} class=${m === k ? 'on' : ''} disabled=${k === 'overlay' && !sameSize} onClick=${() => setMode(k)}><${Glyph} d=${d} /></button>`)}</span></div>
      ${ready && longer && !longer.error && html`<${Bar} t=${t} frames=${longer.frames.length} index=${index} onStep=${step} />`}
    </div>
  </div>`;
}

// ---------- Thumbnail: the first frame ----------
export function SpriteThumb({ asset }) {
  const ref = useRef();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const img = new Image();
    img.onload = () => {
      if (!live || !ref.current) return;
      const r = resolveSheet(asset.sheet, img.naturalWidth, img.naturalHeight);
      if (r.error) { setFailed(true); return; }
      // The first frame that draws anything (an effect may start empty), cut to what it draws: a
      // small sprite in a large cell still fills the tile.
      const frame = document.createElement('canvas');
      let part = null;
      for (let index = 0; index < r.frames.length && part === null; index++) {
        draw(frame, img, r, index, false);
        part = drawnPart(frame, { whole: true });
      }
      if (part === null) draw(frame, img, r, 0, false);
      drawPart(ref.current, frame, part ?? [0, 0, frame.width, frame.height]);
    };
    img.onerror = () => live && setFailed(true);
    img.src = asset.url;
    return () => { live = false; };
  }, [asset.url, JSON.stringify(asset.sheet)]);
  return failed ? html`<img src=${asset.url} alt="" loading="lazy" decoding="async" />` : html`<canvas ref=${ref} class="thumb-canvas" aria-hidden="true"></canvas>`;
}
