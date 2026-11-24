import { html } from '../core.js';

export const cropFits = ([x, y, w, h], width, height) =>
  x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= width && y + h <= height;

export function CroppedImage({ src, crop, size, label, className, style }) {
  const [x, y, width, height] = crop;
  // Clip in source coordinates before fitting into the available box.
  return html`<svg role=${label ? 'img' : null} aria-label=${label} aria-hidden=${label ? null : 'true'}
    class=${className} style=${style} viewBox=${`0 0 ${width} ${height}`}>
    <svg width=${width} height=${height} overflow="hidden">
      <image href=${src} x=${-x} y=${-y} width=${size[0]} height=${size[1]} />
    </svg>
  </svg>`;
}
