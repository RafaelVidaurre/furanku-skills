// Signal rules over decoded samples: where a sound starts and ends, where its separate events are,
// how loud it is heard, and the cuts, fades and gains that follow. Pure functions; reading and
// writing files is the Ffmpeg service's and the chain's business.

/** Decoded audio: one Float32Array per channel, all the same length. */
export interface Pcm {
  readonly rate: number
  readonly channels: ReadonlyArray<Float32Array>
}

export const frames = (pcm: Pcm): number => pcm.channels[0]?.length ?? 0
export const seconds = (pcm: Pcm): number => frames(pcm) / pcm.rate

const db = (x: number): number => 20 * Math.log10(Math.max(x, 1e-9))

export const mono = (pcm: Pcm): Float32Array => {
  const first = pcm.channels[0] ?? new Float32Array(0)
  if (pcm.channels.length === 1) return first
  const out = new Float32Array(first.length)
  for (const channel of pcm.channels) for (let i = 0; i < out.length; i++) out[i] = out[i]! + channel[i]! / pcm.channels.length
  return out
}

export const slice = (pcm: Pcm, start: number, end: number): Pcm => ({ rate: pcm.rate, channels: pcm.channels.map((channel) => channel.slice(start, end)) })

export const applyGain = (pcm: Pcm, gainDb: number): Pcm => {
  const factor = 10 ** (gainDb / 20)
  return { rate: pcm.rate, channels: pcm.channels.map((channel) => channel.map((sample) => sample * factor)) }
}

export interface Envelope {
  /** RMS level in dB, one value per hop. */
  readonly values: Float64Array
  /** Samples between values. */
  readonly hop: number
}

/** Short-window RMS envelope in dB. */
export const envelope = (samples: Float32Array, rate: number, windowMs = 10, hopMs = 2): Envelope => {
  const win = Math.max(1, Math.round(rate * windowMs / 1000))
  const hop = Math.max(1, Math.round(rate * hopMs / 1000))
  const values = new Float64Array(Math.ceil(samples.length / hop))
  for (let index = 0, start = 0; start < samples.length; index++, start += hop) {
    const end = Math.min(samples.length, start + win)
    let sum = 0
    for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!
    values[index] = db(Math.sqrt(sum / Math.max(end - start, 1)))
  }
  return { values, hop }
}

const percentile = (values: Float64Array, p: number): number => Float64Array.from(values).sort()[Math.floor((values.length - 1) * p)] ?? -180

const maxOf = (values: ArrayLike<number>): number => {
  let most = -Infinity
  for (let i = 0; i < values.length; i++) if (values[i]! > most) most = values[i]!
  return most
}

const zeroCrossing = (samples: Float32Array, wanted: number, radius = 240): number => {
  const at = Math.max(0, Math.min(samples.length - 1, wanted))
  for (let d = 0; d <= radius; d++) {
    for (const i of [at - d, at + d]) {
      if (i > 0 && i < samples.length && Math.sign(samples[i - 1]!) !== Math.sign(samples[i]!)) return i
    }
  }
  return at
}

// The envelope finds an onset to within its window; the transient itself is the first sample that
// reaches a tenth of the attack's peak within the following 30 ms.
const refineOnset = (samples: Float32Array, around: number, rate: number): number => {
  const end = Math.min(samples.length, around + Math.round(rate * 0.03))
  let peak = 0
  for (let i = around; i < end; i++) peak = Math.max(peak, Math.abs(samples[i]!))
  for (let i = around; i < end; i++) if (Math.abs(samples[i]!) >= peak * 0.1) return i
  return around
}

export interface DetectOptions {
  /** How long the level must stay down for two events to be separate. */
  readonly minGapMs?: number
  /** How far above the noise floor an event must rise. */
  readonly riseDb?: number
  /** How far below its own peak an event must fall to have ended. */
  readonly fallDb?: number
  readonly preRollMs?: number
  /** A gap that stays this far above the floor has not gone quiet. */
  readonly stillRingingDb?: number
  /** An event this much quieter than the one it follows without a quiet gap is that one's tail. */
  readonly tailDb?: number
  /** Events this far below the loudest are noise, not hits. */
  readonly faintDb?: number
}

export interface SoundEvent {
  /** First and one-past-last sample of the cut. */
  readonly start: number
  readonly end: number
  /** The sample of the transient. */
  readonly onset: number
  readonly peakDb: number
}

export interface Detection {
  readonly floorDb: number
  readonly peakDb: number
  readonly events: ReadonlyArray<SoundEvent>
}

/**
 * Events are regions that rise well above the noise floor and are kept apart by a real gap: the
 * level must fall near the floor, relative to the event's own peak, for at least `minGapMs`. Close
 * transients of one action stay one event, and a quieter event that begins before the previous one
 * has gone quiet is its ringing tail. Cuts go at the quietest point of each gap, on a zero crossing.
 */
export const detectEvents = (samples: Float32Array, rate: number, options: DetectOptions = {}): Detection => {
  const { minGapMs = 120, riseDb = 18, fallDb = 24, preRollMs = 4, stillRingingDb = 12, tailDb = 10, faintDb = 30 } = options
  const { values, hop } = envelope(samples, rate)
  const floor = percentile(values, 0.1)
  const peak = maxOf(values)
  if (values.length === 0 || peak - floor < riseDb) return { floorDb: floor, peakDb: peak, events: [] }
  const on = Math.max(floor + riseDb, peak - 40)
  interface Region { start: number; end: number; max: number }
  const raw: Array<Region> = []
  let current: Region | null = null
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!
    if (current === null) {
      if (value >= on) current = { start: i, end: i, max: value }
      continue
    }
    if (value > current.max) current.max = value
    // Quiet relative to this event's own peak, so a soft hit after a loud one still separates.
    if (value >= Math.max(floor + 6, current.max - fallDb)) current.end = i
    else if ((i - current.end) * hop / rate * 1000 >= minGapMs) {
      raw.push(current)
      current = null
    }
  }
  if (current !== null) raw.push(current)
  const minGap = Math.round(minGapMs / 1000 * rate / hop)
  const merged: Array<Region> = []
  for (const region of raw) {
    const last = merged.at(-1)
    if (last !== undefined && region.start - last.end < minGap) {
      last.end = region.end
      last.max = Math.max(last.max, region.max)
    } else merged.push({ ...region })
  }
  for (let k = merged.length - 1; k > 0; k--) {
    const previous = merged[k - 1]!
    const region = merged[k]!
    let quietest = Infinity
    for (let i = previous.end; i < region.start; i++) quietest = Math.min(quietest, values[i]!)
    if (quietest > floor + stillRingingDb && previous.max - region.max >= tailDb) {
      previous.end = region.end
      merged.splice(k, 1)
    }
  }
  const loudest = Math.max(...merged.map((region) => region.max))
  for (let k = merged.length - 1; k >= 0; k--) if (loudest - merged[k]!.max > faintDb) merged.splice(k, 1)
  const preRoll = Math.round(preRollMs / 1000 * rate)
  const cuts = [0]
  for (let k = 1; k < merged.length; k++) {
    let best = merged[k - 1]!.end
    for (let i = merged[k - 1]!.end; i < merged[k]!.start; i++) if (values[i]! < values[best]!) best = i
    cuts.push(zeroCrossing(samples, Math.min(best * hop, merged[k]!.start * hop - preRoll)))
  }
  cuts.push(samples.length)
  const events = merged.map((region, k): SoundEvent => {
    const onset = refineOnset(samples, region.start * hop, rate)
    const start = Math.max(cuts[k]!, zeroCrossing(samples, onset - preRoll))
    // The tail runs until it settles near the floor, or until the next cut.
    let tail = region.end
    while (tail + 1 < values.length && tail * hop < cuts[k + 1]! && values[tail + 1]! > floor + 3) tail++
    const end = Math.min(cuts[k + 1]!, zeroCrossing(samples, Math.min(samples.length - 1, (tail + 1) * hop + Math.round(rate * 0.01))))
    return { start, end, onset, peakDb: region.max }
  })
  return { floorDb: floor, peakDb: peak, events }
}

export interface Bounds {
  readonly start: number
  readonly end: number
}

/**
 * The sound's real extent: from just before its first transient to where its last tail settles
 * into the floor, so a ringing tail stays with its event. Null when nothing stands out (an even
 * bed), which is then kept whole.
 */
export const soundBounds = (samples: Float32Array, rate: number): Bounds | null => {
  const { events } = detectEvents(samples, rate, { minGapMs: 1e9, preRollMs: 2 })
  return events.length === 0 ? null : { start: events[0]!.start, end: events.at(-1)!.end }
}

/**
 * Where speech starts and ends: the first and last moments above an absolute threshold, with a
 * short pad of room on both sides so a soft consonant is never clipped. Null when nothing is above it.
 */
export const speechBounds = (samples: Float32Array, rate: number, thresholdDb = -45, padMs = 60): Bounds | null => {
  const { values, hop } = envelope(samples, rate)
  let first = -1
  let last = -1
  for (let i = 0; i < values.length; i++) {
    if (values[i]! > thresholdDb) {
      if (first === -1) first = i
      last = i
    }
  }
  if (first === -1) return null
  const pad = Math.round(rate * padMs / 1000)
  return { start: Math.max(0, first * hop - pad), end: Math.min(samples.length, (last + 1) * hop + Math.round(rate * 0.01) + pad) }
}

/** Short linear fades so a cut never clicks. Changes the samples in place. */
export const fade = (pcm: Pcm, inMs: number, outMs: number): Pcm => {
  const length = frames(pcm)
  const fin = Math.min(Math.round(pcm.rate * inMs / 1000), Math.floor(length / 4))
  const fout = Math.min(Math.round(pcm.rate * outMs / 1000), Math.floor(length / 2))
  for (const channel of pcm.channels) {
    for (let i = 0; i < fin; i++) channel[i] = channel[i]! * (i / fin)
    for (let i = 0; i < fout; i++) channel[length - 1 - i] = channel[length - 1 - i]! * (i / fout)
  }
  return pcm
}

/**
 * Shorten a recording's room tail: the sound plays untouched until it has decayed `atDb` below its
 * loudest moment, then fades out (raised cosine) over `fadeMs` and is cut.
 */
export const tightenTail = (pcm: Pcm, atDb = 30, fadeMs = 100): Pcm => {
  const mixed = mono(pcm)
  const { values, hop } = envelope(mixed, pcm.rate)
  let peak = 0
  for (let i = 1; i < values.length; i++) if (values[i]! > values[peak]!) peak = i
  let at = peak
  while (at < values.length && values[at]! > values[peak]! - atDb) at++
  const start = Math.min(mixed.length, at * hop)
  const length = Math.round(pcm.rate * fadeMs / 1000)
  const end = Math.min(mixed.length, start + length)
  return {
    rate: pcm.rate,
    channels: pcm.channels.map((channel) => {
      const out = channel.slice(0, end)
      for (let i = start; i < end; i++) out[i] = out[i]! * 0.5 * (1 + Math.cos(Math.PI * (i - start) / length))
      return out
    })
  }
}

interface Biquad {
  readonly b: readonly [number, number, number]
  readonly a: readonly [number, number]
}

// ITU-R BS.1770 K-weighting (a high shelf, then a high-pass) as biquad coefficients for any rate.
const kWeighting = (rate: number): ReadonlyArray<Biquad> => {
  let K = Math.tan(Math.PI * 1681.974450955533 / rate)
  let Q = 0.7071752369554196
  const Vh = 10 ** (3.999843853973347 / 20)
  const Vb = Vh ** 0.4996667741545416
  const a0 = 1 + K / Q + K * K
  const shelf: Biquad = { b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] }
  K = Math.tan(Math.PI * 38.13547087602444 / rate)
  Q = 0.5003270373238773
  const d = 1 + K / Q + K * K
  return [shelf, { b: [1, -2, 1], a: [2 * (K * K - 1) / d, (1 - K / Q + K * K) / d] }]
}

const filter = (input: Float64Array, { b, a }: Biquad): Float64Array => {
  const out = new Float64Array(input.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < input.length; i++) {
    const x = input[i]!
    const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
    out[i] = y
  }
  return out
}

/**
 * How loud a sound is heard at its loudest: maximum momentary loudness (BS.1770 K-weighted, 400 ms
 * window) in LUFS. Windows overhang both ends with silence, as they would in a mix, so a short
 * knock and a long hum that read the same here sound equally loud.
 */
export const momentaryMax = (pcm: Pcm): number => {
  const filters = kWeighting(pcm.rate)
  const length = frames(pcm)
  const win = Math.round(pcm.rate * 0.4)
  const hop = Math.max(1, Math.round(pcm.rate * 0.01))
  const sum = new Float64Array(length + 1)
  for (const channel of pcm.channels) {
    let weighted: Float64Array = Float64Array.from(channel)
    for (const biquad of filters) weighted = filter(weighted, biquad)
    for (let i = 0; i < length; i++) sum[i + 1] = sum[i + 1]! + weighted[i]! * weighted[i]!
  }
  for (let i = 0; i < length; i++) sum[i + 1] = sum[i + 1]! + sum[i]!
  let most = 0
  for (let end = Math.min(hop, length);; end = Math.min(end + hop, length + win)) {
    const from = Math.max(0, end - win)
    const to = Math.min(length, end)
    most = Math.max(most, (sum[to]! - sum[from]!) / win)
    if (end >= length + win - hop) break
  }
  return -0.691 + 10 * Math.log10(Math.max(most, 1e-12))
}

/** Largest sample magnitude across channels, in dBFS. */
export const samplePeak = (pcm: Pcm): number => {
  let most = 0
  for (const channel of pcm.channels) for (let i = 0; i < channel.length; i++) most = Math.max(most, Math.abs(channel[i]!))
  return db(most)
}

export interface Measured {
  /** Loudness by the target's own measure, in LUFS. */
  readonly loud: number
  /** Peak in dB (true peak where one was measured). */
  readonly peak: number
}

/**
 * The one level every sound of a group can reach: the reference, or lower when one of them would
 * cross the ceiling there. Returns that level and each sound's gain, so variants of one sound
 * always match.
 */
export const matchGains = (levels: ReadonlyArray<Measured>, reference: number, ceilingDb: number): { readonly level: number; readonly gains: ReadonlyArray<number>; readonly limited: boolean } => {
  const level = Math.min(reference, ...levels.map((measured) => measured.loud + (ceilingDb - measured.peak)))
  return { level, gains: levels.map((measured) => level - measured.loud), limited: level < reference }
}
