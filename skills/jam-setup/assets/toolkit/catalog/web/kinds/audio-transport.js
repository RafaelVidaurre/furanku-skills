// Browser decoding and a single transport clock shared by ordinary audio and A/B review.
// decodeAudioData reports the decoded playback rate; facts of the source file come from probes.
export async function decodeAudio(url, expectedSha, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Audio unavailable (HTTP ${response.status})`);
  const bytes = await response.arrayBuffer();
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
  if (expectedSha && expectedSha !== sha256) throw new Error('Audio bytes changed; reload the catalog before playing');
  const decoder = new OfflineAudioContext(1, 1, 48000);
  const buffer = await decoder.decodeAudioData(bytes);
  return { buffer, sha256 };
}

const envelopes = new WeakMap();
export function drawWaveform(canvas, buffer, time = 0, duration = buffer.duration) {
  const width = canvas.width, height = canvas.height, ctx = canvas.getContext('2d');
  ctx.fillStyle = '#15181c'; ctx.fillRect(0, 0, width, height);
  let channels = envelopes.get(buffer);
  if (!channels || channels.width !== width) {
    channels = { width, peaks: [] };
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const samples = buffer.getChannelData(c), peaks = [];
      for (let x = 0; x < width; x++) {
        let min = 0, max = 0;
        const end = Math.min(samples.length, Math.max(1, Math.floor((x + 1) * samples.length / width)));
        for (let i = Math.floor(x * samples.length / width); i < end; i++) { min = Math.min(min, samples[i]); max = Math.max(max, samples[i]); }
        peaks.push([min, max]);
      }
      channels.peaks.push(peaks);
    }
    envelopes.set(buffer, channels);
  }
  const lane = height / buffer.numberOfChannels;
  ctx.strokeStyle = '#83baba'; ctx.lineWidth = 1;
  channels.peaks.forEach((peaks, c) => {
    const center = (c + 0.5) * lane;
    ctx.beginPath();
    for (let x = 0; x < width; x++) { const [min, max] = peaks[x]; const px = x * buffer.duration / duration; ctx.moveTo(px, center - max * lane * 0.44); ctx.lineTo(px, center - min * lane * 0.44 + 1); }
    ctx.stroke();
  });
  ctx.fillStyle = '#f2c276'; ctx.fillRect(Math.min(width - 2, time / duration * width), 0, 2, height);
}

export class AudioTransport {
  constructor(tracks, onChange) {
    this.tracks = tracks; this.onChange = onChange; this.side = 0; this.offset = 0; this.playing = false; this.loop = false;
    this.duration = Math.max(...tracks.map(t => t.buffer.duration));
  }
  time() {
    const t = this.offset + (this.playing ? this.context.currentTime - this.started : 0);
    return this.loop ? t % this.duration : Math.min(t, this.duration);
  }
  stopSource() { if (this.node) { this.node.stop(); this.node.disconnect(); this.node = null; } }
  startSource() {
    this.stopSource();
    const buffer = this.tracks[this.side].buffer, offset = this.time();
    if (offset >= buffer.duration) return; // A shorter side is silent; the shared timeline keeps running.
    const node = this.context.createBufferSource(); node.buffer = buffer;
    node.connect(this.context.destination); node.start(0, offset); this.node = node;
  }
  async play() {
    if (this.playing) return;
    this.context ??= new AudioContext({ sampleRate: 48000 });
    await this.context.resume();
    if (this.disposed) return;
    if (this.offset >= this.duration) this.offset = 0;
    this.started = this.context.currentTime; this.playing = true; this.startSource();
    const tick = () => {
      if (!this.playing) return;
      const elapsed = this.offset + this.context.currentTime - this.started;
      if (elapsed >= this.duration) {
        if (this.loop) { this.offset = elapsed % this.duration; this.started = this.context.currentTime; this.startSource(); }
        else { this.pause(); this.offset = this.duration; }
      }
      this.onChange();
      if (this.playing) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick); this.onChange();
  }
  pause() { this.offset = this.time(); this.playing = false; cancelAnimationFrame(this.frame); this.stopSource(); this.onChange(); }
  seek(time) { this.offset = Math.max(0, Math.min(this.duration, time)); if (this.playing) { this.started = this.context.currentTime; this.startSource(); } this.onChange(); }
  switch(side) { const time = this.time(); this.side = side; this.seek(time); }
  dispose() { this.disposed = true; this.playing = false; cancelAnimationFrame(this.frame); this.stopSource(); this.context?.close(); }
}
