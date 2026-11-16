// WAV bytes to samples and back. Reading accepts what a decoder streams (PCM or float, with length
// fields it could not fill in); writing produces plain integer PCM, which every engine imports.
import { raise } from "../../kernel/errors.ts"
import { frames, type Pcm } from "./signal.ts"

const tag = (bytes: Uint8Array, at: number): string => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!)

export interface WavInfo {
  readonly channels: number
  readonly sampleRate: number
  readonly bitDepth: number
  readonly float: boolean
  /** Byte range of the samples. */
  readonly dataStart: number
  readonly dataEnd: number
}

/** The header of a WAV file, or the reason it is not one. */
export const wavInfo = (bytes: Uint8Array, what: string): WavInfo => {
  if (bytes.length < 12 || tag(bytes, 0) !== "RIFF" || tag(bytes, 8) !== "WAVE") return raise("malformed", `${what} is not a WAV file`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let format: { channels: number; sampleRate: number; bitDepth: number; float: boolean } | undefined
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = tag(bytes, at)
    const declared = view.getUint32(at + 4, true)
    const body = at + 8
    if (id === "fmt ") {
      const code = view.getUint16(body, true)
      // 0xFFFE is the extensible form: the real code is the first two bytes of the sub-format.
      const actual = code === 0xfffe && declared >= 26 ? view.getUint16(body + 24, true) : code
      if (actual !== 1 && actual !== 3) return raise("unsupported", `${what} is WAV with compression code ${actual}; expected PCM or float`)
      format = { channels: view.getUint16(body + 2, true), sampleRate: view.getUint32(body + 4, true), bitDepth: view.getUint16(body + 14, true), float: actual === 3 }
    } else if (id === "data") {
      if (format === undefined) return raise("malformed", `${what} has samples before its format`)
      // A streamed file declares a length it never knew; the samples run to the end.
      const end = declared === 0xffffffff || declared === 0 || body + declared > bytes.length ? bytes.length : body + declared
      const frame = format.channels * (format.bitDepth / 8)
      return { ...format, dataStart: body, dataEnd: body + Math.floor((end - body) / frame) * frame }
    }
    at = body + declared + (declared % 2)
  }
  return raise("malformed", `${what} has no samples`)
}

/** Decode WAV bytes (16, 24 or 32-bit PCM, or 32-bit float) into one array per channel. */
export const readWav = (bytes: Uint8Array, what: string): Pcm => {
  const info = wavInfo(bytes, what)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = info.bitDepth / 8
  if (!(info.float ? width === 4 : width === 2 || width === 3 || width === 4) || info.channels < 1) return raise("unsupported", `${what} is ${info.bitDepth}-bit ${info.float ? "float" : "PCM"} WAV, which is not read here`)
  const count = (info.dataEnd - info.dataStart) / (width * info.channels)
  const channels = Array.from({ length: info.channels }, () => new Float32Array(count))
  for (let frame = 0, at = info.dataStart; frame < count; frame++) {
    for (let channel = 0; channel < info.channels; channel++, at += width) {
      channels[channel]![frame] = info.float
        ? view.getFloat32(at, true)
        : width === 2
        ? view.getInt16(at, true) / 0x8000
        : width === 3
        ? ((view.getInt8(at + 2) << 16) | (view.getUint8(at + 1) << 8) | view.getUint8(at)) / 0x800000
        : view.getInt32(at, true) / 0x80000000
    }
  }
  return { rate: info.sampleRate, channels }
}

/** Encode samples as integer PCM WAV. Samples outside -1..1 are clipped. */
export const writeWav = (pcm: Pcm, bitDepth: 16 | 24): Uint8Array => {
  const count = frames(pcm)
  const width = bitDepth / 8
  const channels = pcm.channels.length
  const size = count * channels * width
  const out = Buffer.alloc(44 + size)
  out.write("RIFF", 0, "latin1")
  out.writeUInt32LE(36 + size, 4)
  out.write("WAVEfmt ", 8, "latin1")
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20)
  out.writeUInt16LE(channels, 22)
  out.writeUInt32LE(pcm.rate, 24)
  out.writeUInt32LE(pcm.rate * channels * width, 28)
  out.writeUInt16LE(channels * width, 32)
  out.writeUInt16LE(bitDepth, 34)
  out.write("data", 36, "latin1")
  out.writeUInt32LE(size, 40)
  const scale = bitDepth === 16 ? 0x7fff : 0x7fffff
  for (let frame = 0, at = 44; frame < count; frame++) {
    for (let channel = 0; channel < channels; channel++, at += width) {
      const value = Math.round(Math.max(-1, Math.min(1, pcm.channels[channel]![frame]!)) * scale)
      if (bitDepth === 16) out.writeInt16LE(value, at)
      else out.writeIntLE(value, at, 3)
    }
  }
  return out
}
