// Thumbnails of pictures drawn on a transparent background: a sprite in a large empty cell would be
// a speck in a tile, so a thumbnail shows the part that is drawn. Measured on a small copy, so a
// list of large images costs little; a picture without a transparent border is shown whole. What
// ends up smaller than its tile is enlarged without smoothing.
import { html, useRef, useState, useLayoutEffect } from '../core.js';

const MEASURE = 128;
const DRAW = 256;

/**
 * The drawn part of `source` (an image or a canvas), as [x, y, width, height] in its pixels with a
 * small margin; null when its pixels cannot be read or nothing is drawn, and also when the border
 * around the drawing is too thin to trim, unless `whole` asks for the whole picture then.
 */
export function drawnPart(source, { whole = false } = {}) {
  const W = source.naturalWidth || source.width, H = source.naturalHeight || source.height;
  if (!W || !H) return null;
  const k = Math.min(1, MEASURE / Math.max(W, H));
  const sw = Math.max(1, Math.round(W * k)), sh = Math.max(1, Math.round(H * k));
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(source, 0, 0, sw, sh);
  let data;
  try { data = g.getImageData(0, 0, sw, sh).data; } catch { return null; }
  let x0 = sw, y0 = sh, x1 = -1, y1 = -1;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    if (data[(y * sw + x) * 4 + 3] <= 8) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  // A margin of one measured pixel; nothing to gain when the border is thin.
  x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(sw - 1, x1 + 1); y1 = Math.min(sh - 1, y1 + 1);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 0.8 * sw * sh) return whole ? [0, 0, W, H] : null;
  const left = Math.floor(x0 / k), top = Math.floor(y0 / k);
  return [left, top, Math.min(W, Math.ceil((x1 + 1) / k)) - left, Math.min(H, Math.ceil((y1 + 1) / k)) - top];
}

/**
 * Copy `part` of `source` onto `canvas` at about DRAW pixels on its long side: a large part is
 * reduced smoothly; a small one is enlarged in whole steps without smoothing, so a tile shows its
 * pixels instead of a blur.
 */
export function drawPart(canvas, source, [x, y, w, h]) {
  const fit = DRAW / Math.max(w, h);
  const k = fit >= 1 ? Math.floor(fit) : fit;
  canvas.width = Math.max(1, Math.round(w * k)); canvas.height = Math.max(1, Math.round(h * k));
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = k < 1;
  g.drawImage(source, x, y, w, h, 0, 0, canvas.width, canvas.height);
}

/** An image thumbnail that shows the drawn part of a picture with a transparent border, else the whole image. */
export function TrimmedImage({ src }) {
  const [part, setPart] = useState(null);
  // The loaded picture outlives its <img>, which leaves the page once the canvas shows the part.
  const loaded = useRef(null);
  const canvas = useRef(null);
  useLayoutEffect(() => { if (part && canvas.current && loaded.current) drawPart(canvas.current, loaded.current, part); }, [part]);
  if (part) return html`<canvas ref=${canvas} class="thumb-canvas" aria-hidden="true"></canvas>`;
  // A picture the tile enlarges shows its pixels rather than a blur.
  const magnified = (img) => img.classList.toggle('magnified', img.naturalWidth < img.clientWidth && img.naturalHeight < img.clientHeight);
  return html`<img src=${src} alt="" loading="lazy" decoding="async" onLoad=${(e) => { loaded.current = e.target; magnified(e.target); setPart(drawnPart(e.target)); }} />`;
}
