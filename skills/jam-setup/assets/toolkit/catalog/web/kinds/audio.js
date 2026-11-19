// The audio kind: one transport with a waveform, optional word-by-word transcript highlighting,
// waveform thumbnails, and an A/B comparison that switches sides on one shared clock.
import { html, useEffect, useRef, useState } from '../core.js';
import { refusal, useViewer } from '../controller.js';
import { registerMediaKind } from '../media-kinds.js';
import { decodeAudio, drawWaveform, AudioTransport } from './audio-transport.js';

// Multiple tracks here are A/B sides: one clock and one sounding source, never parallel players.
export function AudioViewer({ src, shows, tracks: givenTracks, labels, viewerId, onStatus, apiRef, transcript }) {
  const tracks = givenTracks ?? [{ url: src, shows }];
  const key = JSON.stringify(tracks.map(t => [t.url, t.shows?.sha256]));
  const canvas = useRef(), transport = useRef();
  const [loaded, setLoaded] = useState(null), [failure, setFailure] = useState(null), [, refresh] = useState(0);
  const ready = loaded?.key === key, error = failure?.key === key ? failure.message : null;
  const status = error ? 'error' : ready ? 'ready' : 'loading';
  useEffect(() => {
    const ctrl = new AbortController(); let disposed = false;
    Promise.all(tracks.map(t => decodeAudio(t.url, t.shows?.sha256, ctrl.signal))).then(decoded => {
      if (disposed) return;
      transport.current = new AudioTransport(decoded, () => refresh(n => n + 1));
      setLoaded({ key, decoded });
    }).catch(e => { if (!disposed) setFailure({ key, message: e.message }); });
    return () => { disposed = true; ctrl.abort(); transport.current?.dispose(); transport.current = null; };
  }, [key]);
  useEffect(() => { onStatus?.(status); }, [status]);
  const player = ready && transport.current;
  useEffect(() => {
    if (!player || !canvas.current) return;
    const c = canvas.current;
    const paint = () => { c.width = Math.max(1, Math.round(c.clientWidth * devicePixelRatio)); c.height = Math.max(1, Math.round(c.clientHeight * devicePixelRatio)); drawWaveform(c, player.tracks[player.side].buffer, player.time(), player.duration); };
    paint(); const ro = new ResizeObserver(paint); ro.observe(c); return () => ro.disconnect();
  });
  const wordAt = time => {
    const index = transcript?.words?.findIndex(w => time >= w.start && time < w.end) ?? -1;
    return index < 0 ? null : { index, ...transcript.words[index] };
  };
  const getState = () => {
    const p = ready ? transport.current : null, track = p && loaded.decoded[p.side], buffer = track?.buffer;
    return { kind: 'audio', status, error, shows: { ...tracks[p?.side ?? 0].shows, ...(track ? { sha256: track.sha256 } : {}) },
      duration: p?.duration ?? null, channels: buffer?.numberOfChannels ?? null, sampleRate: buffer?.sampleRate ?? null,
      playing: p?.playing ?? false, currentTime: p?.time() ?? 0, loop: p?.loop ?? false,
      ...(labels ? { side: p?.side === 0 ? 'a' : 'b', sides: tracks.map((t, i) => ({ side: i ? 'b' : 'a', status, sha256: loaded?.decoded?.[i]?.sha256 ?? t.shows?.sha256, kind: 'audio' })) } : {}),
      ...(transcript ? { transcript: transcript.text, currentWord: wordAt(p?.time() ?? 0), alignment: transcript.words?.length ? 'aligned' : 'unavailable' } : {}),
      controls: ['audio', ...(labels ? ['compare'] : [])] };
  };
  const control = async c => {
    const p = ready && transport.current;
    if (!p) throw refusal('unavailable', error ?? 'Audio is not ready');
    const a = c.audio;
    if (!a && !c.compare) return false;
    if (a && (typeof a !== 'object' || Array.isArray(a) || (a.time != null && (!Number.isFinite(a.time) || a.time < 0)) || (a.loop != null && typeof a.loop !== 'boolean') || (a.playing != null && typeof a.playing !== 'boolean'))) throw refusal('invalid', 'audio needs a nonnegative time and boolean playing/loop');
    if (c.compare && (!labels || !['a', 'b'].includes(c.compare.side))) throw refusal('invalid', 'Audio comparison needs side a or b');
    if (a?.playing === false) p.pause();
    if (a?.loop != null) p.loop = a.loop;
    if (a?.time != null) p.seek(a.time);
    if (c.compare) p.switch(c.compare.side === 'a' ? 0 : 1);
    if (a?.playing === true) {
      try { await p.play(); } catch (e) { throw refusal('unavailable', `Audio could not start: ${e.message}`); }
    }
    refresh(n => n + 1); return true;
  };
  useViewer(viewerId, getState, control);
  if (apiRef) apiRef.current = { getState, control };
  const act = async c => { try { await control(c); } catch (e) { setFailure({ key, message: e.message }); } };
  return html`<div class="viewer viewer-audio" data-viewer-input>
    ${status === 'loading' && html`<div class="viewer-msg"><span class="spin" aria-label="Loading audio"></span></div>`}
    ${error && html`<div class="viewer-msg err" role="alert">${error}</div>`}
    ${transcript && html`<div class="audio-transcript" aria-label="Dialogue text">${transcript.text.split(/(\s+)/).map((word, i) => /^\s+$/.test(word) ? word : html`<span class=${wordAt(player ? player.time() : 0)?.index === i / 2 ? 'spoken-word current' : 'spoken-word'} aria-current=${wordAt(player ? player.time() : 0)?.index === i / 2 ? 'true' : undefined}>${word}</span>`)}</div>`}
    ${player && html`<div class="audio-body">
      ${labels && html`<div class="seg" role="radiogroup" aria-label="Audio comparison">${labels.map((label, i) => html`<button class=${`seg-b${player.side === i ? ' on' : ''}`} role="radio" aria-checked=${player.side === i} onClick=${() => act({ compare: { side: i ? 'b' : 'a' } })}>${label}</button>`)}</div>`}
      <canvas ref=${canvas} class="audio-waveform" role="img" aria-label="Audio waveform"></canvas>
      <input aria-label="Audio position" type="range" min="0" max=${player.duration} step="0.001" value=${player.time()} onInput=${e => act({ audio: { time: Number(e.target.value) } })} />
      <div class="audio-tools"><button class="btn sm" onClick=${() => act({ audio: { playing: !player.playing } })}>${player.playing ? 'Pause' : 'Play'}</button>
        <button class="btn sm" aria-pressed=${player.loop} onClick=${() => act({ audio: { loop: !player.loop } })}>Loop</button>
        <span class="mono">${player.time().toFixed(2)} / ${player.duration.toFixed(2)} s</span>
        <span class="muted">${player.tracks[player.side].buffer.numberOfChannels} ch · ${player.tracks[player.side].buffer.sampleRate} Hz decoded</span></div>
    </div>`}
  </div>`;
}

// The words spoken in a take, when the project says where they are: the link's own
// `meta.transcript` ({ text, words: [{ word, start, end }] }), or a type's `audioTranscript`
// naming the attributes that hold the take's asset, its text and its word timings.
function transcriptOf(context, media) {
  const own = context?.link?.meta?.transcript;
  if (own?.text) return own;
  const spec = context?.type?.audioTranscript;
  const attrs = context?.unit?.attrs;
  return spec && attrs && attrs[spec.asset] === media.id && attrs[spec.text] ? { text: attrs[spec.text], words: attrs[spec.words] } : null;
}

// Both sides play on one transport, so the comparison is one viewer and needs both to be there.
function AudioCompare({ a, b, labels, mark, apiRef }) {
  return html`<div class="cmp-one"><${AudioViewer} tracks=${[a, b].map((s) => ({ url: s.url, shows: { path: s.path, sha256: s.sha256 } }))} labels=${labels} apiRef=${apiRef} onStatus=${(s) => { mark('a')(s); mark('b')(s); }} /></div>`;
}

// ---------- Thumbnails: <audio-thumb src sha> ----------
// The same decoder and waveform as the full viewer; the bytes are checked against `sha` when the
// digest is known (lists identify a file by its version and do not hash it).
class AudioThumb extends HTMLElement {
  static get observedAttributes() { return ['src', 'sha', 'version']; }
  connectedCallback() { this.start(); }
  attributeChangedCallback() { if (this.isConnected) this.start(); }
  disconnectedCallback() { this.ctrl?.abort(); this.observer?.disconnect(); }
  start() {
    this.disconnectedCallback();
    const src = this.getAttribute('src'), sha = this.getAttribute('sha');
    this.replaceChildren(); this.classList.remove('failed');
    if (!src) return;
    const ctrl = this.ctrl = new AbortController();
    this.observer = new IntersectionObserver(async entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      this.observer.disconnect();
      try {
        const { buffer } = await decodeAudio(src, sha, ctrl.signal);
        if (ctrl.signal.aborted) return;
        const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
        drawWaveform(canvas, buffer); this.replaceChildren(canvas);
      } catch (e) { if (!ctrl.signal.aborted) { this.classList.add('failed'); this.title = `Audio preview unavailable: ${e.message}`; } }
    }, { rootMargin: '160px' });
    this.observer.observe(this);
  }
}
customElements.define('audio-thumb', AudioThumb);

registerMediaKind('audio', {
  icon: 'M3 8v4 M6 5v10 M10 2v16 M14 5v10 M17 8v4',
  controls: ['audio', 'compare'],
  viewer: ({ media, shows, context, ...rest }) => html`<${AudioViewer} src=${media.url} shows=${{ asset: media.id, path: media.path, sha256: media.sha256, ...shows }} transcript=${transcriptOf(context, media)} ...${rest} />`,
  thumbnail: ({ asset }) => html`<audio-thumb src=${asset.url} sha=${asset.sha256} version=${asset.version}></audio-thumb>`,
  compare: AudioCompare,
  compareTogether: true,
  components: { AudioViewer },
});
