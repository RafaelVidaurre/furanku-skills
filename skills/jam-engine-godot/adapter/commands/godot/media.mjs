// What a media file's header says, read from its first bytes: an image's size, a sound's channels,
// rate and length. Nothing is decoded; a file this cannot read gives null and its tags are left out.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

function head(path, length, from = 0) {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, from);
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

function sizeOf(path) {
  const fd = openSync(path, 'r');
  try {
    return fstatSync(fd).size;
  } finally {
    closeSync(fd);
  }
}

/** [width, height] of a PNG, JPEG or WebP image, or null. */
export function imageSize(path) {
  try {
    const b = head(path, 256 * 1024);
    if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString('latin1', 12, 16) === 'IHDR') return [b.readUInt32BE(16), b.readUInt32BE(20)];
    if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
      let at = 2;
      while (at + 9 < b.length) {
        if (b[at] !== 0xff) return null;
        const marker = b[at + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          at += 2;
          continue;
        }
        const length = b.readUInt16BE(at + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [b.readUInt16BE(at + 7), b.readUInt16BE(at + 5)];
        at += 2 + length;
      }
      return null;
    }
    if (b.length >= 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
      const chunk = b.toString('latin1', 12, 16);
      if (chunk === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
      if (chunk === 'VP8L') {
        const bits = b.readUInt32LE(21);
        return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
      }
      if (chunk === 'VP8X') return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
    }
  } catch {
    return null;
  }
  return null;
}

/** { channels, sampleRate, seconds? } of a WAV or Ogg (Vorbis, Opus) file, or null. */
export function soundInfo(path) {
  try {
    const b = head(path, 64 * 1024);
    if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE') {
      let at = 12;
      let format = null;
      while (at + 8 <= b.length) {
        const id = b.toString('latin1', at, at + 4);
        const length = b.readUInt32LE(at + 4);
        if (id === 'fmt ' && at + 24 <= b.length) format = { channels: b.readUInt16LE(at + 10), sampleRate: b.readUInt32LE(at + 12), bits: b.readUInt16LE(at + 22) };
        if (id === 'data' && format !== null) {
          const perSecond = format.sampleRate * format.channels * (format.bits / 8);
          return { channels: format.channels, sampleRate: format.sampleRate, ...(perSecond > 0 ? { seconds: length / perSecond } : {}) };
        }
        at += 8 + length + (length % 2);
      }
      return format === null ? null : { channels: format.channels, sampleRate: format.sampleRate };
    }
    if (b.length >= 47 && b.toString('latin1', 0, 4) === 'OggS') {
      const segments = b[26];
      const packet = 27 + segments;
      let info = null;
      let rate = 0;
      let skip = 0;
      if (b.toString('latin1', packet + 1, packet + 7) === 'vorbis') {
        info = { channels: b[packet + 11], sampleRate: b.readUInt32LE(packet + 12) };
        rate = info.sampleRate;
      } else if (b.toString('latin1', packet, packet + 8) === 'OpusHead') {
        info = { channels: b[packet + 9], sampleRate: b.readUInt32LE(packet + 12) };
        rate = 48000;
        skip = b.readUInt16LE(packet + 10);
      }
      if (info === null) return null;
      // The last page's granule position is the stream's length in samples.
      const size = sizeOf(path);
      const tail = head(path, Math.min(size, 64 * 1024), Math.max(0, size - 64 * 1024));
      const last = tail.lastIndexOf('OggS');
      if (last !== -1 && last + 14 <= tail.length && rate > 0) {
        const granule = Number(tail.readBigInt64LE(last + 6));
        if (granule > 0) info.seconds = (granule - skip) / rate;
      }
      return info;
    }
  } catch {
    return null;
  }
  return null;
}

/** The first bytes of a binary resource (.res, .scn): its class, or why it cannot be read. */
export function binaryResourceClass(path) {
  const b = head(path, 512);
  const magic = b.toString('latin1', 0, 4);
  if (magic === 'RSCC') return { unread: 'a compressed binary resource: save it as text (.tres or .tscn) to read it without the editor' };
  if (magic !== 'RSRC' || b.length < 28) return { unread: 'not a Godot binary resource (no RSRC header)' };
  const big = b.readUInt32LE(4) !== 0;
  const length = big ? b.readUInt32BE(24) : b.readUInt32LE(24);
  if (length < 1 || 28 + length > b.length) return { unread: 'the binary resource header is malformed' };
  return { class: b.toString('utf8', 28, 28 + length).replace(/\0+$/, '') };
}
