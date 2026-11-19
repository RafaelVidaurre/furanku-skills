// The video kind: a muted looping player, a first-frame thumbnail, and two players side by side.
import { html, useEffect, useRef, useState, prefersReducedMotion } from '../core.js';
import { useViewer } from '../controller.js';
import { registerMediaKind } from '../media-kinds.js';
import { Msg } from '../viewers.js';
import { sideLabel, SideError } from '../compare.js';

// ---------- Video: ordinary controls, muted, no surprise audio; explicit readiness ----------
export function VideoViewer({ src, videoRef, viewerId, shows, onStatus }) {
  const [status, setStatus] = useState('loading');
  const [nonce, setNonce] = useState(0);
  const local = useRef(); const ref = videoRef ?? local;
  useEffect(() => setStatus('loading'), [src, nonce]);
  useEffect(() => { onStatus?.(status); }, [status]);
  useViewer(viewerId, () => ({ kind: 'video', status, error: status === 'error' ? `Video could not be played: ${shows?.path ?? src}` : null, shows, time: ref.current ? +ref.current.currentTime.toFixed(2) : null, duration: ref.current?.duration ?? null, paused: ref.current?.paused ?? null, controls: ['video'] }),
    (c) => { if (c.video && ref.current) { if (c.video.time != null) ref.current.currentTime = c.video.time; if (c.video.playing === false) ref.current.pause(); if (c.video.playing === true) ref.current.play(); return true; } return false; });
  return html`<div class="viewer viewer-video">
    <${Msg} status=${status} error="Video could not be decoded or loaded" onRetry=${() => setNonce(nonce + 1)} />
    <video key=${`${src}#${nonce}`} ref=${ref} src=${src} controls loop muted playsinline preload="auto" autoplay=${!prefersReducedMotion()} data-viewer-input
      onLoadedData=${() => setStatus('ready')} onError=${() => setStatus('error')} style=${status === 'error' ? 'visibility:hidden' : ''}></video>
  </div>`;
}

export function VideoCompare({ a, b, labels, mark }) {
  const vids = [useRef(), useRef()];
  useEffect(() => { if (a.status !== 'ok') mark('a')('error'); if (b.status !== 'ok') mark('b')('error'); }, [a.status, b.status]);
  return html`<div class="cmp">
    <div class="cmp-tools"><button class="btn sm" onClick=${() => vids.forEach((r) => { if (r.current) { r.current.currentTime = 0; r.current.play(); } })}>Restart both</button></div>
    <div class="cmp-side">
      <div>${sideLabel(a, labels[0])}${a.status === 'ok' ? html`<${VideoViewer} src=${a.url} videoRef=${vids[0]} onStatus=${mark('a')} />` : html`<${SideError} side=${a} />`}</div>
      <div>${sideLabel(b, labels[1])}${b.status === 'ok' ? html`<${VideoViewer} src=${b.url} videoRef=${vids[1]} onStatus=${mark('b')} />` : html`<${SideError} side=${b} />`}</div>
    </div></div>`;
}


registerMediaKind('video', {
  icon: 'M3 4h14v12H3z M8 7.5v5l4.5-2.5z',
  controls: ['video'],
  viewer: ({ media, ...rest }) => html`<${VideoViewer} src=${media.url} ...${rest} />`,
  thumbnail: ({ asset }) => html`<video src=${`${asset.url}#t=0.5`} muted playsinline preload="metadata" tabindex="-1" aria-hidden="true"></video>`,
  compare: VideoCompare,
  components: { VideoViewer },
});
