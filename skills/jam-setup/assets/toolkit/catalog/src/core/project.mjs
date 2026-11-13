// Project loading: configuration, adapter invocation, normalization, refresh fingerprints and
// content-addressed asset facts. Adapters are trusted project code; their output is data.
import { existsSync, readFileSync, statSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { sha256, fail, check, nonempty, isObject, confinedPath, portablePath, sniff, extOf, KIND_BY_EXT, insideReal } from './util.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
export const BUILTIN_ADAPTERS = {
  manifest: resolve(here, '../adapters/manifest.mjs'),
  jam: resolve(here, '../../adapters/jam.mjs'),
};
export const ASSET_KINDS = { image: { label: 'Image' }, video: { label: 'Video' }, model: { label: '3D model' } };
export const CONFIG_FILE = 'catalog.config.json';

export function readConfig(root, overrides = {}) {
  const file = join(root, CONFIG_FILE);
  let cfg = { version: 1 };
  if (existsSync(file)) {
    try { cfg = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { fail('malformed', `${CONFIG_FILE}: ${e.message}`); }
  }
  cfg = { ...cfg, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) };
  check(cfg.version === 1, 'invalid', `${CONFIG_FILE}: unsupported version`);
  cfg.adapter ??= 'manifest';
  cfg.options ??= {};
  cfg.review ??= {};
  cfg.review.resolver ??= 'latest';
  cfg.review.verdicts ??= ['approved', 'changes', 'rejected'];
  cfg.previewModules ??= {};
  check(isObject(cfg.options) && isObject(cfg.review) && Array.isArray(cfg.review.verdicts) && isObject(cfg.previewModules) && Object.values(cfg.previewModules).every((v) => typeof v === 'string'), 'invalid', `${CONFIG_FILE}: options, review and previewModules must be objects of the documented shape`);
  return cfg;
}

export async function loadAdapter(root, cfg) {
  let href;
  if (BUILTIN_ADAPTERS[cfg.adapter]) href = pathToFileURL(BUILTIN_ADAPTERS[cfg.adapter]).href;
  else {
    // Project-supplied adapter module: trusted code inside the project, re-imported when it changes.
    check(typeof cfg.adapter === 'string', 'invalid', `${CONFIG_FILE}: adapter must be text`);
    const file = portablePath(root, cfg.adapter.replace(/^\.\//, ''));
    check(existsSync(file) && insideReal(root, file), 'unavailable', `adapter module not found: ${cfg.adapter}`);
    href = `${pathToFileURL(file).href}?v=${createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16)}`;
  }
  const mod = await import(href);
  const factory = mod.default ?? mod.createAdapter;
  check(typeof factory === 'function', 'invalid', `adapter ${cfg.adapter} has no default export`);
  return factory({ root, options: cfg.options });
}

function normalizeSchema(schema, problems) {
  const types = {};
  for (const [key, t] of Object.entries(schema?.types ?? {})) {
    if (!isObject(t)) { problems.push({ source: 'schema', error: `type ${key} is invalid` }); continue; }
    const roles = (t.roles ?? []).filter((r) => {
      const ok = nonempty(r?.key) && nonempty(r?.label) && Array.isArray(r.kinds) && r.kinds.length && r.kinds.every((k) => ASSET_KINDS[k]) && !r.key.includes(':');
      if (!ok) problems.push({ source: 'schema', error: `type ${key}: role ${r?.key ?? '?'} is invalid` });
      return ok;
    }).map((r) => ({ key: r.key, label: r.label, kinds: r.kinds, many: !!r.many, expected: !!r.expected, help: r.help ?? null }));
    const fields = (t.fields ?? []).filter((f) => nonempty(f?.key) && nonempty(f?.label)).map((f) => ({ key: f.key, label: f.label, kind: f.kind ?? 'text', unit: f.unit ?? null, help: f.help ?? null, group: f.group ?? null, derived: f.derived === true }));
    types[key] = { label: nonempty(t.label) ? t.label : key, roles, fields, thumb: t.thumb ?? roles[0]?.key ?? null, help: t.help ?? null };
  }
  const collectionKinds = {};
  for (const [key, k] of Object.entries(schema?.collectionKinds ?? {})) {
    collectionKinds[key] = { label: k.label ?? key, preview: k.preview ?? null, memberField: k.memberField ?? null, memberExtra: k.memberExtra ?? null };
  }
  return { types, collectionKinds };
}

// Normalize and confine adapter output. Bad entries become scoped problems; nothing is invented.
export function normalize(root, out) {
  const problems = [...(out.problems ?? [])].map((p) => ({ source: p.source ?? 'adapter', error: p.error ?? String(p), recovery: p.recovery ?? null }));
  const schema = normalizeSchema(out.schema, problems);
  const assetRoots = (out.assetRoots ?? ['']).filter((r) => r === '' || nonempty(r));
  const assets = new Map();
  const addAsset = (a, from) => {
    try {
      check(nonempty(a?.id) && nonempty(a?.path), 'invalid', 'asset needs id and path');
      check(!/(^|\/)(\.git|\.catalog)(\/|$)/.test(a.path), 'forbidden', 'repository metadata and catalog records are not assets');
      confinedPath(root, a.path, assetRoots);
      const kind = a.kind ?? KIND_BY_EXT[extOf(a.path)] ?? null;
      if (assets.has(a.id)) return assets.get(a.id);
      const asset = { id: a.id, path: a.path, kind, declaredKind: a.kind ?? null, label: a.label ?? null, adapterTags: a.tags ?? [], adapterCategory: a.category ?? null };
      assets.set(a.id, asset);
      return asset;
    } catch (e) { problems.push({ source: from, error: `asset ${a?.id ?? a?.path ?? '?'}: ${e.message}` }); return null; }
  };
  for (const a of out.assets ?? []) addAsset(a, 'assets');
  // A preview base declared by a collection kind is an asset in its own right.
  for (const [k, ck] of Object.entries(schema.collectionKinds)) if (typeof ck.preview?.base === 'string' && !assets.has(ck.preview.base)) addAsset({ id: ck.preview.base, path: ck.preview.base }, `collection kind ${k}`);
  const units = new Map();
  for (const u of out.units ?? []) {
    const src = u?.sources?.[0] ?? 'adapter';
    if (!nonempty(u?.id) || !nonempty(u?.type)) { problems.push({ source: src, error: 'content entry without id or type' }); continue; }
    if (units.has(u.id)) { problems.push({ source: src, error: `duplicate content id ${u.id}` }); continue; }
    const type = schema.types[u.type];
    if (!type) { problems.push({ source: src, error: `${u.id}: unknown type ${u.type}` }); continue; }
    const links = [];
    for (const l of u.links ?? []) {
      const role = type.roles.find((r) => r.key === l?.role);
      if (!role) { problems.push({ source: src, error: `${u.id}: unknown visual role ${l?.role}` }); continue; }
      let asset = assets.get(l.asset);
      if (!asset && typeof l.asset === 'string') asset = addAsset({ id: l.asset, path: l.asset }, src);
      if (!asset) continue;
      if (asset.kind && !role.kinds.includes(asset.kind)) { problems.push({ source: src, error: `${u.id}: ${role.label} does not accept ${asset.kind} (${asset.id})` }); continue; }
      if (!role.many && links.some((x) => x.role === role.key)) { problems.push({ source: src, error: `${u.id}: ${role.label} takes one asset` }); continue; }
      if (links.some((x) => x.role === role.key && x.asset === asset.id)) continue;
      if (l.key != null && (!nonempty(l.key) || l.key.length > 100 || links.some((x) => x.role === role.key && x.key === l.key))) { problems.push({ source: src, error: `${u.id}: invalid or duplicate visual key for ${role.key}` }); continue; }
      links.push({ role: role.key, asset: asset.id, ...(l.key == null ? {} : { key: l.key }) });
    }
    units.set(u.id, {
      id: u.id, type: u.type, name: nonempty(u.name) ? u.name : u.id, attrs: isObject(u.attrs) ? u.attrs : {}, links,
      aliases: (u.aliases ?? []).filter(nonempty), search: (u.search ?? []).filter(nonempty), sources: (u.sources ?? []).filter(nonempty),
      adapterTags: (u.tags ?? []).filter(nonempty), adapterCategory: u.category ?? null, explain: isObject(u.explain) ? u.explain : {},
    });
  }
  const collections = [];
  for (const c of out.collections ?? []) {
    if (!nonempty(c?.id) || !nonempty(c?.name)) { problems.push({ source: 'collections', error: 'adapter collection without id or name' }); continue; }
    collections.push({ id: c.id, name: c.name, kind: c.kind ?? null, members: (c.members ?? []).filter((m) => units.has(m.unit)), adapterTags: c.tags ?? [], adapterCategory: c.category ?? null, owner: 'adapter' });
  }
  return { project: out.project ?? null, schema, assetRoots, units: [...units.values()], assets: [...assets.values()], collections, problems };
}

// ---- Asset facts, cached by path + size + mtime (content digest is the cache identity).
const factCache = new Map();
export function assetFacts(root, asset, assetRoots) {
  let full;
  try { full = confinedPath(root, asset.path, assetRoots); } catch (e) { return { state: 'forbidden', error: e.message }; }
  if (!existsSync(full)) return { state: 'missing', error: `file not found: ${asset.path}` };
  const st = statSync(full);
  if (!st.isFile()) return { state: 'missing', error: `not a file: ${asset.path}` };
  const key = `${full}:${st.size}:${st.mtimeMs}`;
  const hit = factCache.get(full);
  if (hit?.key === key) return hit.value;
  const h = createHash('sha256');
  const fd = openSync(full, 'r');
  const head = Buffer.alloc(Math.min(64, st.size));
  try {
    readSync(fd, head, 0, head.length, 0);
    const buf = Buffer.alloc(1 << 20);
    let pos = 0, n;
    while ((n = readSync(fd, buf, 0, buf.length, pos)) > 0) { h.update(buf.subarray(0, n)); pos += n; }
  } finally { closeSync(fd); }
  const sniffed = sniff(head);
  const expected = asset.kind;
  let value;
  if (!sniffed) value = { state: KIND_BY_EXT[extOf(asset.path)] ? 'invalid' : 'unsupported', error: KIND_BY_EXT[extOf(asset.path)] ? 'file bytes are not a supported image, video or GLB model' : `unsupported format: .${extOf(asset.path)}`, sha256: h.digest('hex'), size: st.size };
  else if (expected && sniffed.kind !== expected) value = { state: 'invalid', error: `declared ${expected} but bytes are ${sniffed.mime}`, sha256: h.digest('hex'), size: st.size };
  else {
    const external = sniffed.kind === 'model' ? glbExternal(full) : null;
    value = external ? { state: 'unsupported', error: `GLB references external resources (${external}); only self-contained GLB models are supported`, sha256: h.digest('hex'), size: st.size }
      : { state: 'ok', sha256: h.digest('hex'), size: st.size, mime: sniffed.mime, kind: sniffed.kind, mtime: st.mtimeMs };
  }
  factCache.set(full, { key, value });
  return value;
}

// Self-contained GLB only: buffers and images must be embedded, never external URIs.
function glbExternal(file) {
  try {
    const fd = openSync(file, 'r'); const head = Buffer.alloc(20);
    try {
      readSync(fd, head, 0, 20, 0);
      const len = head.readUInt32LE(12);
      if (head.readUInt32LE(16) !== 0x4e4f534a || len > 64 << 20) return 'unreadable JSON chunk';
      const json = Buffer.alloc(len); readSync(fd, json, 0, len, 20);
      const doc = JSON.parse(json.toString('utf8'));
      const uris = [...(doc.buffers ?? []), ...(doc.images ?? [])].map((x) => x.uri).filter((u) => typeof u === 'string' && !u.startsWith('data:'));
      return uris.length ? uris.slice(0, 3).join(', ') : null;
    } finally { closeSync(fd); }
  } catch { return 'unreadable JSON chunk'; }
}

export function fingerprint(root, files) {
  const parts = [];
  const visit = (rel, depth = 0) => {
    const full = join(root, rel);
    if (!existsSync(full)) { parts.push(`${rel}:none`); return; }
    if (!insideReal(root, full)) return;
    const st = statSync(full);
    if (st.isDirectory()) {
      if (depth > 12) return;
      for (const e of readdirSync(full).sort()) if (!['.git', '.catalog', 'node_modules'].includes(e)) visit(rel ? `${rel}/${e}` : e, depth + 1);
    } else parts.push(`${rel}:${st.size}:${st.mtimeMs}`);
  };
  for (const f of files) visit(f);
  return sha256(parts.join('\n'));
}

export { extname };
