import { createHash, randomBytes } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep, dirname } from 'node:path';

export class CatalogError extends Error {
  // code: invalid | not_found | conflict | context_changed | locked | unsupported | malformed | forbidden | unavailable
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}
export const fail = (code, message, details) => { throw new CatalogError(code, message, details); };
export const check = (cond, code, message, details) => { if (!cond) fail(code, message, details); };

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

// Stable JSON: sorted object keys, so digests do not depend on property order.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
export const digest = (value) => sha256(canonical(value));

const B32 = 'abcdefghjkmnpqrstuvwxyz23456789';
export function randomToken(n = 10) {
  const bytes = randomBytes(n);
  return [...bytes].map((b) => B32[b % B32.length]).join('');
}
// Collision-resistant, roughly time-ordered identity; safe across branches.
export function newId(prefix) { return `${prefix}_${Date.now().toString(36)}${randomToken(10)}`; }
// Short copyable reference derived from the random part.
export function shortRef(id) { return id.split('_')[1].slice(-6).toUpperCase(); }

export const nonempty = (v) => typeof v === 'string' && v.trim().length > 0;
export const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Validate a repository-relative portable path and resolve it inside root without following
// symlinks outside the allowed roots.
export function portablePath(root, rel) {
  check(nonempty(rel) && !isAbsolute(rel) && !rel.includes('\\') && !/^[A-Za-z]:/.test(rel) && !rel.includes('\0'), 'forbidden', 'use a project-relative path with forward slashes');
  const full = resolve(root, rel);
  const r = relative(resolve(root), full);
  check(r && r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r), 'forbidden', 'path must stay inside the project');
  check(r.split(sep).join('/') === rel, 'forbidden', 'use a normalized project-relative path');
  return full;
}

export function insideReal(base, file) {
  let ancestor = file;
  while (!existsSync(ancestor)) { const up = dirname(ancestor); if (up === ancestor) break; ancestor = up; }
  const realBase = realpathSync(base);
  const real = realpathSync(ancestor);
  const r = relative(realBase, real);
  return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r));
}

// Resolve `rel` within root and require it to stay (after symlinks) inside one of the declared roots.
export function confinedPath(root, rel, allowedRoots = ['']) {
  const full = portablePath(root, rel);
  check(insideReal(root, full), 'forbidden', 'symlink escapes the project');
  const ok = allowedRoots.some((a) => {
    const base = a ? resolve(root, a) : resolve(root);
    const r = relative(base, full);
    return (r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r))) && existsSync(base) && insideReal(base, full);
  });
  check(ok, 'forbidden', `path is outside the declared asset roots: ${rel}`);
  return full;
}

// Magic-byte media detection. Extensions are not trusted.
export function sniff(buf) {
  const s = (a, b) => buf.subarray(a, b).toString('latin1');
  if (buf.length >= 8 && buf[0] === 0x89 && s(1, 4) === 'PNG') return { kind: 'image', mime: 'image/png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: 'image', mime: 'image/jpeg' };
  if (buf.length >= 12 && s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP') return { kind: 'image', mime: 'image/webp' };
  if (buf.length >= 6 && (s(0, 6) === 'GIF87a' || s(0, 6) === 'GIF89a')) return { kind: 'image', mime: 'image/gif' };
  if (buf.length >= 12 && s(4, 8) === 'ftyp') return { kind: 'video', mime: 'video/mp4' };
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { kind: 'video', mime: 'video/webm' };
  if (buf.length >= 12 && s(0, 4) === 'glTF') return { kind: 'model', mime: 'model/gltf-binary' };
  return null;
}

export function extOf(path) { const m = /\.([a-z0-9]+)$/i.exec(path); return m ? m[1].toLowerCase() : ''; }
export const KIND_BY_EXT = { png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', mp4: 'video', m4v: 'video', webm: 'video', glb: 'model' };

export const toPosix = (p) => p.split(sep).join('/');
