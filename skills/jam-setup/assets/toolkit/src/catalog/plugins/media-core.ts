// The built-in media kinds: image, video, model and audio, recognised by their first bytes.
// A file's extension is never trusted; it only says which kind a file was meant to be.
import * as fsp from "node:fs/promises"
import { definePlugin, type MediaKind } from "../plugin.ts"

const ascii = (head: Uint8Array, from: number, to: number): string => Buffer.from(head.subarray(from, to)).toString("latin1")

const image: MediaKind = {
  id: "image",
  label: "Image",
  extensions: ["png", "jpg", "jpeg", "webp", "gif"],
  sniff: (head) => {
    if (head.length >= 8 && head[0] === 0x89 && ascii(head, 1, 4) === "PNG") return "image/png"
    if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg"
    // WebP and WAV share the RIFF container; the format tag tells them apart.
    if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return "image/webp"
    if (head.length >= 6 && (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a")) return "image/gif"
    return null
  }
}

/**
 * The codec of an Ogg file, from its first packet: an Ogg page's 27-byte header and segment table
 * come first, then the packet (Theora video `\x80theora`, Vorbis `\x01vorbis`, Opus `OpusHead`).
 */
const oggCodec = (head: Uint8Array): "theora" | "other" | null => {
  if (head.length < 28 || ascii(head, 0, 4) !== "OggS") return null
  const packet = 27 + (head[26] ?? 0)
  return head.length >= packet + 7 && head[packet] === 0x80 && ascii(head, packet + 1, packet + 7) === "theora" ? "theora" : "other"
}

const video: MediaKind = {
  id: "video",
  label: "Video",
  extensions: ["mp4", "m4v", "webm", "ogv"],
  sniff: (head) => {
    if (head.length >= 12 && ascii(head, 4, 8) === "ftyp") return "video/mp4"
    // Browsers differ on Ogg Theora (Chromium no longer plays it); it is video all the same.
    if (oggCodec(head) === "theora") return "video/ogg"
    if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "video/webm"
    return null
  }
}

// An MPEG audio frame header: sync bits set, and none of the reserved version, layer, bitrate or
// sample-rate values.
const mpegFrame = (head: Uint8Array): boolean => {
  const [b0 = 0, b1 = 0, b2 = 0] = head
  return head.length >= 4 && b0 === 0xff && (b1 & 0xe0) === 0xe0 && (b1 & 0x18) !== 0x08 && (b1 & 0x06) !== 0 &&
    (b2 & 0xf0) !== 0xf0 && (b2 & 0x0c) !== 0x0c
}

const audio: MediaKind = {
  id: "audio",
  label: "Audio",
  extensions: ["wav", "ogg", "flac", "mp3"],
  sniff: (head) => {
    if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WAVE") return "audio/wav"
    if (head.length >= 4 && ascii(head, 0, 4) === "OggS" && oggCodec(head) !== "theora") return "audio/ogg"
    if (head.length >= 4 && ascii(head, 0, 4) === "fLaC") return "audio/flac"
    if ((head.length >= 3 && ascii(head, 0, 3) === "ID3") || mpegFrame(head)) return "audio/mpeg"
    return null
  }
}

const GLB_JSON_CHUNK = 0x4e4f534a
const MAX_JSON_CHUNK = 64 << 20

/** URIs of external buffers or images a GLB refers to; a viewer could not show it from one file. */
const glbExternal = async (path: string): Promise<string | null> => {
  let handle: fsp.FileHandle | undefined
  try {
    handle = await fsp.open(path, "r")
    const head = Buffer.alloc(20)
    await handle.read(head, 0, 20, 0)
    const length = head.readUInt32LE(12)
    if (head.readUInt32LE(16) !== GLB_JSON_CHUNK || length > MAX_JSON_CHUNK) return "unreadable JSON chunk"
    const json = Buffer.alloc(length)
    await handle.read(json, 0, length, 20)
    const doc = JSON.parse(json.toString("utf8")) as { buffers?: Array<{ uri?: unknown }>; images?: Array<{ uri?: unknown }> }
    const uris = [...(doc.buffers ?? []), ...(doc.images ?? [])]
      .map((entry) => entry.uri)
      .filter((uri): uri is string => typeof uri === "string" && !uri.startsWith("data:"))
    return uris.length > 0 ? uris.slice(0, 3).join(", ") : null
  } catch {
    return "unreadable JSON chunk"
  } finally {
    await handle?.close()
  }
}

const model: MediaKind = {
  id: "model",
  label: "3D model",
  extensions: ["glb"],
  sniff: (head) => (head.length >= 12 && ascii(head, 0, 4) === "glTF" ? "model/gltf-binary" : null),
  validate: async (file) => {
    const external = await glbExternal(file.absolutePath)
    return external === null ? null : `GLB references external resources (${external}); only self-contained GLB models are supported`
  }
}

export const mediaCore = definePlugin({ name: "media-core", mediaKinds: [image, video, model, audio] })
