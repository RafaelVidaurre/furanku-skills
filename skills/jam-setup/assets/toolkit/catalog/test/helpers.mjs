// Test helpers: real temporary Git repositories with a manifest-adapter project.
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { deflateSync, crc32 } from 'node:zlib';
import { Document, NodeIO } from '@gltf-transform/core';
import { openCatalog } from '../src/core/app.mjs';

export const human = { name: 'Rae Tester', kind: 'human' };
export const human2 = { name: 'Sam Second', kind: 'human' };
export const agent = { name: 'checker', kind: 'agent' };

export function tmp(prefix = 'cc-') { return realpathSync(mkdtempSync(join(tmpdir(), prefix))); }
export function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}
export function write(dir, rel, value) {
  const f = join(dir, rel); mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, Buffer.isBuffer(value) || value instanceof Uint8Array ? value : typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
}
export const read = (dir, rel) => JSON.parse(readFileSync(join(dir, rel), 'utf8'));

// Minimal valid RGBA PNG.
export function png(w = 4, h = 4, rgba = [200, 40, 40, 255]) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; for (let x = 0; x < w; x++) raw.set(rgba, y * (w * 4 + 1) + 1 + x * 4); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Small GLB: a quad, optionally textured, optionally with named animation clips.
export async function glb({ size = 1, texture = null, clips = [], meshes = 1 } = {}) {
  const d = new Document(); const buf = d.createBuffer();
  const s = size;
  const pos = d.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, s, 0, 0, 0, s, 0, s, s, 0])).setBuffer(buf);
  const uv = d.createAccessor().setType('VEC2').setArray(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1])).setBuffer(buf);
  const idx = d.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 1, 2, 2, 1, 3])).setBuffer(buf);
  const mat = d.createMaterial('surface').setBaseColorFactor([0.8, 0.8, 0.8, 1]).setDoubleSided(true);
  if (texture) mat.setBaseColorTexture(d.createTexture('albedo').setImage(texture).setMimeType('image/png'));
  const scene = d.createScene(); d.getRoot().setDefaultScene(scene);
  const root = d.createNode('root'); scene.addChild(root);
  for (let i = 0; i < meshes; i++) {
    const prim = d.createPrimitive().setAttribute('POSITION', pos).setAttribute('TEXCOORD_0', uv).setIndices(idx).setMaterial(mat);
    root.addChild(d.createNode(`part${i}`).setMesh(d.createMesh(`mesh${i}`).addPrimitive(prim)).setTranslation([i * 1.2, 0, 0]));
  }
  for (const name of clips) {
    const input = d.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 1])).setBuffer(buf);
    const output = d.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 0, name.length * 0.1, 0])).setBuffer(buf);
    const sampler = d.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    d.createAnimation(name).addSampler(sampler).addChannel(d.createAnimationChannel().setTargetNode(root).setTargetPath('translation').setSampler(sampler));
  }
  return Buffer.from(await new NodeIO().writeBinary(d));
}

export const TYPES = {
  armor: {
    label: 'Armor', thumb: 'icon',
    fields: [{ key: 'slot', label: 'Slot' }, { key: 'armor', label: 'Armor', kind: 'number', help: 'Damage absorbed per hit.' }, { key: 'parts', label: 'Parts', kind: 'refs' }],
    roles: [{ key: 'icon', label: 'Icon', kinds: ['image'], expected: true }, { key: 'model', label: 'Model', kinds: ['model'], expected: true }, { key: 'concept', label: 'Concept', kinds: ['image'], many: true }, { key: 'clip', label: 'Clip', kinds: ['video'] }],
  },
  lore: { label: 'Lore', fields: [{ key: 'text', label: 'Text' }], roles: [] },
};

// A manifest project with units as one file each, committed on main.
export async function makeProject({ units, assets = {}, collections = [], extra = {}, commit = true } = {}) {
  const dir = tmp();
  git(dir, 'init', '-q');
  write(dir, 'catalog.config.json', { version: 1, adapter: 'manifest', review: { resolver: 'latest' } });
  write(dir, 'catalog.manifest.json', { version: 1, project: 'Testgame', assetRoots: ['art'], types: TYPES, collectionKinds: { outfit: { label: 'Outfit', preview: { label: 'Assembled', module: 'assembled-mesh' } } }, unitFiles: ['content'], collections, ...extra });
  for (const [rel, bytes] of Object.entries(assets)) write(dir, rel, bytes);
  for (const u of units) write(dir, `content/${u.id.replace(/\//g, '_')}.json`, u);
  if (commit) { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'initial'); }
  return dir;
}
export async function standardProject(opts = {}) {
  return makeProject({
    assets: {
      'art/helm.png': png(4, 4, [200, 0, 0, 255]), 'art/helm.glb': await glb({ clips: ['Idle'] }), 'art/boots.png': png(4, 4, [0, 200, 0, 255]),
      'art/boots.glb': await glb({ size: 2 }), 'art/sheet.png': png(8, 4, [0, 0, 200, 255]), 'art/coat.png': png(4, 4, [9, 9, 9, 255]),
    },
    units: [
      { id: 'armor/helm', type: 'armor', name: 'Iron Helm', attrs: { slot: 'Head', armor: 10 }, links: [{ role: 'icon', asset: 'art/helm.png' }, { role: 'model', asset: 'art/helm.glb' }, { role: 'concept', asset: 'art/sheet.png' }], tags: ['tier:1'], category: 'Gear/Heavy', aliases: ['casque'] },
      { id: 'armor/boots', type: 'armor', name: 'Iron Boots', attrs: { slot: 'Feet', armor: 6 }, links: [{ role: 'icon', asset: 'art/boots.png' }, { role: 'model', asset: 'art/boots.glb' }, { role: 'concept', asset: 'art/sheet.png' }] },
      { id: 'armor/coat', type: 'armor', name: 'Wool Coat', attrs: { slot: 'Body', armor: 3 }, links: [{ role: 'icon', asset: 'art/coat.png' }] },
      { id: 'lore/origin', type: 'lore', name: 'Origin Story', attrs: { text: 'Long ago the iron mines opened.' }, links: [] },
    ],
    collections: [{ id: 'outfit/iron', name: 'Iron Outfit', kind: 'outfit', members: [{ unit: 'armor/helm' }, { unit: 'armor/boots' }] }],
    ...opts,
  });
}
export const open = (root, extra) => openCatalog({ root, ...extra });
export const W = (app, actor = human) => (name, input, requestId) => app.run(name, input, { actor, requestId });
export async function rejects(promise, code) {
  try { await promise; } catch (e) { if (code && e.code !== code) throw new Error(`expected ${code}, got ${e.code}: ${e.message}`); return e; }
  throw new Error(`expected rejection${code ? ` (${code})` : ''}`);
}
export function cleanup(...dirs) { for (const d of dirs) try { rmSync(d, { recursive: true, force: true }); } catch {} }
export { existsSync, join, readFileSync };
