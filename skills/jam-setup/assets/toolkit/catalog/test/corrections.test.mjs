// Regression tests for the reviewed defects (S1-S6, P1, P3, P5, P6) through public seams.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync, existsSync, symlinkSync, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { request } from 'node:http';
import { standardProject, makeProject, open, W, human, human2, agent, git, write, read, png, glb, rejects, cleanup, tmp } from './helpers.mjs';
import { startServer } from '../src/server/server.mjs';

const unit = (id) => ({ kind: 'unit', id });
const get = (port, path) => new Promise((ok, fail) => { const r = request({ host: '127.0.0.1', port, path, headers: { host: `127.0.0.1:${port}` } }, (res) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => ok({ status: res.statusCode, body: Buffer.concat(c) })); }); r.on('error', fail); r.end(); });
const subFile = (dir, id) => join(dir, '.catalog/reviews', id, 'submission.json');
const snapshotDir = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).sort().map((f) => { try { return `${f}:${readFileSync(join(dir, f), 'utf8')}`; } catch { return f; } }).join('\n') : '');

test('S1 evidence reads never follow links out of .catalog and require complete references', async () => {
  const dir = await standardProject();
  write(dir, 'art/helm.png', png(4, 4, [1, 2, 3, 255])); // dirty: stored as catalog evidence
  const app = await open(dir);
  const s = await W(app)('review.submit', { items: [{ target: unit('armor/helm'), parts: ['icon'] }] });
  const rv = await app.run('review.get', { submission: s.submission.id });
  const leaf = rv.items[0].parts[0].leaves[0];
  assert.equal(leaf.storage, 'catalog');
  const outside = tmp('cc-outside-'); writeFileSync(join(outside, 'secret.png'), Buffer.concat([png(2, 2), Buffer.from('SECRET')]));
  const blob = join(dir, `.catalog/evidence/${leaf.sha256.slice(0, 2)}/${leaf.sha256}.png`);
  unlinkSync(blob); symlinkSync(join(outside, 'secret.png'), blob);
  const server = await startServer({ app, port: 0 });
  try {
    const r = await get(server.port, leaf.url);
    assert.notEqual(r.status, 200); assert.ok(!r.body.includes('SECRET'));
    assert.notEqual((await app.run('review.get', { submission: rv.id })).items[0].parts[0].leaves[0].status, 'ok');
    // A reference without its digest, or a store path not named by the digest, makes the record invalid.
    const rec = JSON.parse(readFileSync(subFile(dir, rv.id), 'utf8'));
    delete rec.items[0].parts[0].evidence.sha256;
    writeFileSync(subFile(dir, rv.id), JSON.stringify(rec));
    assert.ok((await app.run('problems', {})).problems.some((p) => p.source.includes(rv.id) && /evidence/.test(p.error)));
    await rejects(app.run('review.get', { submission: rv.id }), 'not_found');
    assert.notEqual((await get(server.port, leaf.url)).status, 200);
  } finally { await server.close(); }
  cleanup(dir, outside);
});

test('S1 record writes and reads never follow links inside .catalog', async () => {
  const dir = await standardProject();
  const outside = tmp('cc-outside-');
  mkdirSync(join(dir, '.catalog'), { recursive: true });
  symlinkSync(outside, join(dir, '.catalog/notes'));
  const app = await open(dir);
  await rejects(W(app)('note.create', { target: unit('armor/helm'), body: 'x' }), 'forbidden');
  assert.deepEqual(readdirSync(outside), [], 'nothing written outside the checkout');
  writeFileSync(join(outside, 'nt_abc.json'), JSON.stringify({ id: 'nt_abc', target: unit('armor/helm'), body: 'planted', by: human, at: '2026-01-01T00:00:00.000Z', revision: 1 }));
  assert.equal((await app.run('notes.list', {})).total, 0, 'linked records are not read');
  assert.ok((await app.run('problems', {})).problems.some((p) => /symbolic link/.test(p.error)));
  // The machine-local folder is protected too (locks, journal, captures).
  rmSync(join(dir, '.catalog/notes'));
  rmSync(join(dir, '.catalog/.local'), { recursive: true, force: true });
  symlinkSync(outside, join(dir, '.catalog/.local'));
  await rejects(W(app)('note.create', { target: unit('armor/helm'), body: 'y' }, 'req-1'), 'forbidden');
  assert.deepEqual(readdirSync(outside), ['nt_abc.json']);
  // .catalog itself as a link.
  const dir2 = await standardProject(); const out2 = tmp('cc-outside-');
  symlinkSync(out2, join(dir2, '.catalog'));
  const app2 = await open(dir2);
  await rejects(W(app2)('note.create', { target: unit('armor/helm'), body: 'z' }), 'forbidden');
  assert.deepEqual(readdirSync(out2), []);
  cleanup(dir, outside, dir2, out2);
});

test('S2 tags and categories are type-checked; empty rename destinations are rejected', async () => {
  const dir = await standardProject();
  const app = await open(dir); const run = W(app);
  await run('organize.set', { target: unit('armor/helm'), tags: ['keep'] });
  await rejects(run('tag.rename', { from: 'keep', to: '' }), 'invalid');
  await rejects(run('tag.rename', { from: 'keep', to: '   ' }), 'invalid');
  await rejects(run('organize.set', { target: unit('armor/helm'), tags: [null] }), 'invalid');
  await rejects(run('organize.set', { target: unit('armor/helm'), tags: [123] }), 'invalid');
  await rejects(run('organize.set', { target: unit('armor/helm'), category: 42 }), 'invalid');
  await rejects(run('category.rename', { from: 'Gear', to: '' }), 'invalid');
  assert.deepEqual((await app.run('unit.get', { id: 'armor/helm' })).tags.sort(), ['keep', 'tier:1']);
  assert.equal((await app.run('catalog.search', { section: 'units', q: 'helm' })).items[0].id, 'armor/helm');
  cleanup(dir);
});

test('S3 arbitrary JSON in records becomes scoped problems; the application keeps working', async () => {
  const dir = await standardProject();
  const app = await open(dir); const run = W(app);
  const keep = (await run('note.create', { target: unit('armor/helm'), body: 'valid' })).note;
  const s = await run('review.submit', { items: [{ target: unit('armor/helm'), parts: ['icon'] }] });
  const bad = {
    'notes/null.json': 'null', 'notes/nt_arr.json': '[1,2]', 'notes/nt_str.json': '"text"',
    'notes/nt_t.json': JSON.stringify({ id: 'nt_t', target: null, body: 'x', by: human, at: '2026-01-01T00:00:00.000Z', revision: 1 }),
    'notes/nt_by.json': JSON.stringify({ id: 'nt_by', target: unit('armor/helm'), body: 'x', by: 'someone', at: '2026-01-01T00:00:00.000Z', revision: 1 }),
    'collections/x-0000000000.json': JSON.stringify({ id: 'x', name: 'X', tags: [null], members: [{ unit: 5 }], revision: 1 }),
    'labels/unit/y.json': JSON.stringify({ target: { kind: 'unit', id: 'armor/helm' }, tags: 'tier', revision: 1 }),
    'reviews/sub_bad/submission.json': JSON.stringify({ id: 'sub_bad', title: 'x', by: human, at: '2026-01-01T00:00:00.000Z', context: {}, items: [null] }),
    [`reviews/${s.submission.id}/verdicts/vd_bad.json`]: JSON.stringify({ id: 'vd_bad', submission: s.submission.id, item: 'it_x', by: human, at: '2026-01-01T00:00:00.000Z', scope: { kind: 'parts', parts: [{}] }, verdicts: {} }),
    'categories.json': JSON.stringify({ categories: [null], revision: 1 }),
  };
  for (const [rel, text] of Object.entries(bad)) write(dir, `.catalog/${rel}`, text);
  const ctx = await app.run('context', {});
  assert.ok(ctx.problems >= Object.keys(bad).length);
  assert.deepEqual((await app.run('notes.list', {})).notes.map((n) => n.id), [keep.id]);
  for (const section of ['units', 'collections', 'assets']) assert.ok((await app.run('catalog.search', { section })).total > 0 || section === 'assets');
  assert.equal((await app.run('reviews.list', { state: 'all' })).total, 1);
  await app.run('organization.list', {});
  await app.run('unit.get', { id: 'armor/helm' });
  cleanup(dir);
});

test('S4 multi-record operations validate every resulting record before writing any', async () => {
  const dir = await standardProject();
  const app = await open(dir); const run = W(app);
  await run('organize.set', { target: unit('armor/boots'), category: 'A' });
  await run('organize.set', { target: unit('armor/helm'), category: 'A/child' });
  await run('collection.create', { name: 'Kit', category: 'A' });
  const before = snapshotDir(join(dir, '.catalog/labels')) + snapshotDir(join(dir, '.catalog/collections'));
  await rejects(run('category.rename', { from: 'A', to: 'a/b/c/d/e/f/g/h' }), 'invalid');
  assert.equal(snapshotDir(join(dir, '.catalog/labels')) + snapshotDir(join(dir, '.catalog/collections')), before, 'no partial rename');
  const sub = await run('review.submit', { items: [{ target: unit('armor/coat') }] });
  await rejects(run('organize.bulk', { targets: [unit('armor/coat'), { kind: 'submission', id: sub.submission.id }], addTags: ['x'] }), 'invalid');
  await rejects(run('organize.bulk', { targets: [unit('armor/coat'), unit('armor/missing')], addTags: ['x'] }), 'not_found');
  assert.deepEqual((await app.run('unit.get', { id: 'armor/coat' })).tags, [], 'first target untouched');
  // A valid rename still updates every record in one operation.
  await run('category.rename', { from: 'A', to: 'B' });
  assert.equal((await app.run('unit.get', { id: 'armor/helm' })).organization.category, 'B/child');
  assert.equal((await app.run('unit.get', { id: 'armor/boots' })).organization.category, 'B');
  cleanup(dir);
});

test('S5 concurrent retries with one request id record once; ids are bound to the checkout context', async () => {
  const dir = await standardProject();
  const app = await open(dir); const run = W(app);
  await run('collection.create', { id: 'col/kit', name: 'Kit', members: ['armor/helm'] });
  const input = { id: 'col/kit', add: ['armor/coat'], expectedRevision: 1 };
  const results = await Promise.all([run('collection.update', input, 'same'), run('collection.update', input, 'same'), run('collection.update', input, 'same')]);
  assert.deepEqual(results.map((r) => r.collection.revision), [2, 2, 2]);
  assert.equal(results.filter((r) => r.replayed).length, 2);
  // A second application instance (another process or a restart) replays as well.
  assert.equal((await W(await open(dir))('collection.update', input, 'same')).replayed, true);
  assert.equal((await app.run('collection.get', { id: 'col/kit' })).collection.revision, 2);
  await rejects(run('collection.update', { ...input, name: 'Other' }, 'same'), 'conflict');
  // The same id on another branch did not happen there: it is refused, not replayed.
  git(dir, 'checkout', '-q', '-b', 'other');
  await rejects(run('collection.update', input, 'same'), 'conflict');
  cleanup(dir);
});

test('S6/P5 catalog Review: validated before any effect; reuses only waiting items', async () => {
  const dir = await standardProject();
  const app = await open(dir); const run = W(app);
  const evidenceCount = () => (existsSync(join(dir, '.catalog/evidence')) ? readdirSync(join(dir, '.catalog/evidence'), { recursive: true }).length : 0);
  await rejects(run('review.decideCurrent', { target: unit('armor/helm'), whole: 'bogus' }), 'invalid');
  await rejects(run('review.decideCurrent', { target: unit('armor/helm'), verdicts: { nope: 'approved' } }), 'invalid');
  assert.equal((await app.run('reviews.list', { state: 'all' })).total, 0);
  assert.equal(evidenceCount(), 0, 'no frozen blobs from a rejected action');
  const first = await run('review.decideCurrent', { target: unit('armor/helm'), whole: 'approved' });
  assert.equal(first.createdSubmission, true);
  // The item is fully decided: a repeated review submits current content again.
  const second = await run('review.decideCurrent', { target: unit('armor/helm'), whole: 'changes' });
  assert.equal(second.createdSubmission, true); assert.notEqual(second.submission.id, first.submission.id);
  // A waiting item with identical evidence is reused.
  const waiting = await run('review.submit', { items: [{ target: unit('armor/boots') }] });
  const third = await run('review.decideCurrent', { target: unit('armor/boots'), verdicts: { icon: 'approved' } });
  assert.equal(third.createdSubmission, false); assert.equal(third.submission.id, waiting.submission.id);
  cleanup(dir);
});

test('P6 only the selected parts are frozen: unrelated missing media does not block a review', async () => {
  const dir = await standardProject();
  unlinkSync(join(dir, 'art/helm.glb'));
  const app = await open(dir); const run = W(app);
  await rejects(run('review.submit', { items: [{ target: unit('armor/helm') }] }), 'invalid');
  const s = await run('review.submit', { items: [{ target: unit('armor/helm'), parts: ['attributes', 'icon'] }] });
  const rv = await app.run('review.get', { submission: s.submission.id });
  assert.deepEqual(rv.items[0].parts.map((p) => p.id), ['icon', 'attributes']);
  assert.equal(rv.items[0].parts.find((p) => p.id === 'icon').leaves[0].status, 'ok');
  const rec = JSON.parse(readFileSync(subFile(dir, rv.id), 'utf8'));
  assert.ok(!JSON.stringify(rec).includes('helm.glb"') || JSON.stringify(rec.items[0].parts).indexOf('helm.glb') === -1, 'model not frozen');
  cleanup(dir);
});

test('P1 a running catalog follows the checkout: configuration, adapter options and resolver change with the branch', async () => {
  const dir = await standardProject();
  const app = await open(dir);
  const server = await startServer({ app, port: 0 });
  const post = async (action, input) => (await fetch(`${server.url}api/run/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-catalog-request': '1' }, body: JSON.stringify({ input }) })).json();
  try {
    await W(app, human)('review.decideCurrent', { target: unit('armor/helm'), verdicts: { icon: 'approved' } });
    await new Promise((r) => setTimeout(r, 15));
    await W(app, human2)('review.decideCurrent', { target: unit('armor/helm'), verdicts: { icon: 'changes' } });
    git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'reviews');
    // An alternate branch: a different manifest file, units and resolver.
    git(dir, 'checkout', '-q', '-b', 'alternate');
    const m = read(dir, 'catalog.manifest.json');
    write(dir, 'alternate.json', { ...m, project: 'Alternate', unitFiles: ['alt'] });
    write(dir, 'alt/one.json', { id: 'armor/helm', type: 'armor', name: 'Alt Helm', attrs: { slot: 'Head' }, links: [{ role: 'icon', asset: 'art/helm.png' }] });
    write(dir, 'catalog.config.json', { version: 1, adapter: 'manifest', options: { manifest: 'alternate.json' }, review: { resolver: 'strictest' } });
    git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'alternate');
    const ctx = await post('context', {});
    assert.equal(ctx.context.branch, 'alternate'); assert.equal(ctx.project, 'Alternate'); assert.equal(ctx.resolver, 'strictest');
    assert.deepEqual((await post('catalog.search', { section: 'units' })).items.map((u) => u.name), ['Alt Helm']);
    git(dir, 'checkout', '-q', 'main');
    const back = await post('context', {});
    assert.equal(back.project, 'Testgame'); assert.equal(back.resolver, 'latest');
    assert.equal((await post('unit.get', { id: 'armor/helm' })).review.parts.find((p) => p.id === 'icon').verdict, 'changes');
    // Resolver change on a branch applies to the same records without rewriting them.
    git(dir, 'checkout', '-q', '-b', 'strict');
    write(dir, 'catalog.config.json', { version: 1, adapter: 'manifest', review: { resolver: 'strictest' } });
    assert.equal((await post('unit.get', { id: 'armor/helm' })).review.parts.find((p) => p.id === 'icon').verdict, 'changes');
    // A changed project adapter module is re-imported.
    write(dir, 'adapter.mjs', "export default () => ({ sources: () => ['adapter.mjs'], load: async () => ({ project: 'Module A', schema: { types: { t: { label: 'T', fields: [], roles: [] } } }, units: [] }) });\n");
    write(dir, 'catalog.config.json', { version: 1, adapter: './adapter.mjs' });
    assert.equal((await post('context', {})).project, 'Module A');
    write(dir, 'adapter.mjs', "export default () => ({ sources: () => ['adapter.mjs'], load: async () => ({ project: 'Module B', schema: { types: { t: { label: 'T', fields: [], roles: [] } } }, units: [] }) });\n");
    assert.equal((await post('context', {})).project, 'Module B');
  } finally { await server.close(); cleanup(dir); }
});

test('P3 a project preview declaration is frozen with its module, config, base and member inputs', async () => {
  const dir = await makeProject({
    assets: { 'art/a.glb': await glb(), 'art/b.glb': await glb({ size: 2 }), 'art/stand.glb': await glb({ size: 3 }), 'art/a.png': png(4, 4) },
    units: [
      { id: 'armor/a', type: 'armor', name: 'A', attrs: {}, links: [{ role: 'icon', asset: 'art/a.png' }, { role: 'model', asset: 'art/a.glb' }] },
      { id: 'armor/b', type: 'armor', name: 'B', attrs: {}, links: [{ role: 'model', asset: 'art/b.glb' }] },
    ],
    collections: [{ id: 'row/ab', name: 'Row', kind: 'lineup', members: [{ unit: 'armor/a' }, { unit: 'armor/b' }] }],
    extra: { collectionKinds: { lineup: { label: 'Lineup', preview: { label: 'Lineup', module: 'lineup', roles: ['model'], base: 'art/stand.glb', config: { spacing: 1.75 } } } } },
  });
  write(dir, 'catalog.config.json', { version: 1, adapter: 'manifest', previewModules: { lineup: './previews/lineup.mjs' } });
  write(dir, 'previews/lineup.mjs', 'export default function lineup(ctx) { return ctx.html`<div></div>`; }\n');
  const app = await open(dir);
  const col = await app.run('collection.get', { id: 'row/ab' });
  assert.equal(col.preview.module, 'lineup'); assert.deepEqual(col.preview.config, { spacing: 1.75 });
  assert.match(col.preview.moduleUrl, /^\/project\/preview\/lineup\?v=/);
  assert.equal(col.preview.base.id, 'art/stand.glb'); assert.equal(col.preview.members.length, 2);
  const s = await W(app)('review.submit', { items: [{ target: { kind: 'collection', id: 'row/ab' }, parts: ['preview'] }] });
  const rv = await app.run('review.get', { submission: s.submission.id });
  const it = rv.items[0];
  assert.deepEqual(it.preview.config, { spacing: 1.75 }); assert.equal(it.preview.module, 'lineup');
  assert.deepEqual(it.parts[0].leaves.map((l) => l.key).sort(), ['armor/a/model', 'armor/b/model', 'base']);
  // The base changes later: the frozen side keeps the reviewed base bytes.
  write(dir, 'art/stand.glb', await glb({ size: 5 }));
  const c = await app.run('evidence.compare', { a: { submission: rv.id, item: it.id, part: 'preview' }, b: 'current' });
  const base = c.rows.find((r) => r.key === 'base');
  assert.notEqual(base.a.sha256, base.b.sha256); assert.match(base.a.url, /leaf=base/);
  assert.equal((await app.run('collection.get', { id: 'row/ab' })).review.parts.find((p) => p.id === 'preview').verdict, null);
  const server = await startServer({ app, port: 0 });
  try { const mod = await get(server.port, '/project/preview/lineup'); assert.equal(mod.status, 200); assert.match(mod.body.toString(), /lineup/); assert.equal((await get(server.port, '/project/preview/nope')).status, 404); }
  finally { await server.close(); }
  cleanup(dir);
});

test('GLB models with external resources are rejected explicitly', async () => {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'mesh.bin', byteLength: 12 }], images: [{ uri: 'albedo.png' }] }));
  const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(20); head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + padded.length, 8); head.writeUInt32LE(padded.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  const dir = await makeProject({ assets: { 'art/ext.glb': Buffer.concat([head, padded]) }, units: [{ id: 'armor/x', type: 'armor', name: 'X', attrs: {}, links: [{ role: 'model', asset: 'art/ext.glb' }] }] });
  const app = await open(dir);
  const a = (await app.run('unit.get', { id: 'armor/x' })).links[0].asset;
  assert.equal(a.state, 'unsupported'); assert.match(a.error, /external resources \(mesh\.bin, albedo\.png\)/);
  cleanup(dir);
});
