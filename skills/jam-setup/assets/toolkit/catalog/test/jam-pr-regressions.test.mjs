import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmp, git, write, read, png, glb, open, W, standardProject, cleanup, human, agent } from './helpers.mjs';
import { startServer } from '../src/server/server.mjs';

const JAM = resolve(import.meta.dirname, '../../jam.mjs');
const jam = (root, args, input) => JSON.parse(execFileSync(process.execPath, [JAM, ...args, '--root', root], { input: input && JSON.stringify(input), encoding: 'utf8' }));
const profile = { platforms: ['Windows'], renderer: 'deferred', camera: 'third person', cameraDistanceMeters: 3, screenCoveragePercent: 10, expectedInstances: 20, maxTextureMiB: 8, assetKind: 'static', units: 'meters', up: '+Z', forward: '-Y', pivot: 'bottom', materialWorkflow: 'pbr', targetTriangles: 1000, maxTriangles: 2000, textureSize: 1024, maxMaterials: 1 };

test('request bindings survive a missing local journal, a new worktree and a fresh clone', async (t) => {
  const dir = await standardProject(); t.after(() => cleanup(dir));
  const app = await open(dir); const run = W(app);
  const helm = { kind: 'unit', id: 'armor/helm' }; const boots = { kind: 'unit', id: 'armor/boots' };
  const operations = [
    ['note.create', { target: helm, body: 'Helm visor clips' }, { target: boots, body: 'Boot sole clips' }],
    ['review.decideCurrent', { target: helm, whole: 'approved' }, { target: boots, whole: 'rejected' }],
    ['review.submit', { items: [{ target: helm }] }, { items: [{ target: boots }] }],
    ['collection.create', { name: 'Helmet set', members: ['armor/helm'] }, { name: 'Boot set', members: ['armor/boots'] }],
  ];
  const results = [];
  for (const [action, input] of operations) results.push(await run(action, input, action));
  assert.equal(git(dir, 'check-ignore', '.catalog/.local/requests/probe.json').trim(), '.catalog/.local/requests/probe.json', 'local replay journals stay out of commits and clones');
  const sub = results[2].submission;
  const decide = { submission: sub.id, item: sub.items[0].id, whole: 'changes' };
  await run('review.decide', decide, 'decision');
  operations.push(['review.decide', decide, { ...decide, whole: 'rejected' }]);
  const edit = { id: results[0].note.id, body: 'Still clips', expectedRevision: 1 };
  await run('note.edit', edit, 'edit');
  operations.push(['note.edit', edit, { ...edit, body: 'Different' }]);
  const ids = [...operations.slice(0, 4).map(([action]) => action), 'decision', 'edit'];
  const dropJournal = () => rmSync(join(dir, '.catalog/.local/requests'), { recursive: true, force: true });
  for (const [i, [action, input, different]] of operations.entries()) {
    dropJournal();
    assert.equal((await run(action, input, ids[i])).replayed, true);
    dropJournal();
    await assert.rejects(run(action, different, ids[i]), { code: 'conflict' });
    await assert.rejects(app.run(action, input, { actor: agent, requestId: ids[i] }), { code: 'conflict' });
  }
  dropJournal();
  await assert.rejects(run('note.create', { target: boots, body: 'Cross-action collision' }, 'decision'), { code: 'conflict' });
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'Review records');
  const wt = tmp('cc-request-wt-'); t.after(() => cleanup(wt));
  git(dir, 'worktree', 'add', '-qb', 'other', wt);
  const clone = tmp('cc-request-clone-'); t.after(() => cleanup(clone)); git(dir, 'clone', '-q', dir, clone);
  for (const other of [wt, clone]) {
    const otherRun = W(await open(other));
    for (const [i, [action, input, different]] of operations.entries()) {
      await assert.rejects(otherRun(action, input, ids[i]), { code: 'conflict' });
      await assert.rejects(otherRun(action, different, ids[i]), { code: 'conflict' });
    }
    assert.equal((await otherRun('notes.list', { target: boots })).notes.length, 0);
  }
});

async function jamProject(t) {
  const dir = tmp('cc-asset-'); t.after(() => cleanup(dir)); git(dir, 'init', '-q');
  write(dir, 'catalog.config.json', { version: 1, adapter: 'jam' });
  write(dir, 'Art/style.md', '# Style'); write(dir, 'Art/brief.md', 'A table');
  write(dir, 'Art/evidence.md', 'Imported source; inspect shape.');
  write(dir, 'jam.config.json', { version: 1, style: { document: 'Art/style.md', references: [] }, profiles: { prop: profile }, providers: { image: 'scenario', mesh: 'meshy' }, review: { default: 'human', stages: {} }, spend: { meshy: { unit: 'credits', limit: 0 }, scenario: { unit: 'CU', limit: 0 } } });
  return dir;
}
const init = (dir, path, profiled = true) => jam(dir, ['init', '--run', path, '--id', 'table', '--brief', 'Art/brief.md', ...(profiled ? ['--profile', 'prop'] : [])]);
const register = (dir, path, stage, files, extra = {}) => jam(dir, ['register', '--run', path, '--record', '-'], { stage, files, inputs: [], evidence: ['Art/evidence.md'], dependsOn: [], note: 'Qualified input', provenance: { provider: 'imported', model: 'fixture', transport: 'file', source: 'test', sourceEvidence: 'Art/evidence.md' }, ...extra });

test('asset identity and image reviews survive image-to-profile-to-delivery transitions', async (t) => {
  const dir = await jamProject(t); const images = 'Art/.scratch/table/images/run.json';
  init(dir, images, false); write(dir, 'Art/.scratch/concept.png', png());
  register(dir, images, 'concept', ['Art/.scratch/concept.png']);
  const app = await open(dir); const run = W(app); const target = { kind: 'unit', id: 'table' };
  await run('note.create', { target: { ...target, part: 'concept:1' }, body: 'Keep this silhouette' });
  await run('review.decideCurrent', { target, whole: 'changes' });
  for (const path of ['Art/.scratch/table/profiled/run.json', 'Art/Assets/table/v1/run.json']) {
    init(dir, path);
    const copy = path.replace('run.json', 'concept.png'); write(dir, copy, png());
    register(dir, path, 'concept', [copy]);
    const detail = await app.run('unit.get', { id: 'table' });
    assert.equal((await app.run('catalog.search', { section: 'units' })).items.length, 1);
    assert.equal(detail.unit.sources[0], path);
    assert.equal((await app.run('notes.list', { target })).notes.length, 1);
    const part = detail.review.parts.find((p) => p.id === 'concept:1');
    assert.equal(part.verdict, 'changes'); assert.equal(part.changed, false);
    assert.equal(detail.review.parts.find((p) => p.id === 'attributes').changed, false);
  }
  // Another clone has only the durable run; the same catalog target remains valid.
  rmSync(join(dir, 'Art/.scratch'), { recursive: true });
  assert.equal((await app.run('unit.get', { id: 'table' })).review.parts.find((p) => p.id === 'concept:1').verdict, 'changes');
  // Newer work must not be hidden by an older delivery.
  const next = 'Art/.scratch/table/next/run.json'; init(dir, next);
  write(dir, 'Art/new.png', png(4, 4, [1, 2, 3, 255])); register(dir, next, 'concept', ['Art/new.png']);
  const changed = await app.run('unit.get', { id: 'table' });
  assert.equal(changed.unit.sources[0], next);
  assert.equal(changed.review.parts.find((p) => p.id === 'concept:1').changed, true);
});

test('catalog renders the measured runtime model, isolates malformed runs, and ignores gate-only changes', async (t) => {
  const dir = await jamProject(t); const path = 'Art/Assets/table/v1/run.json'; init(dir, path);
  write(dir, 'Art/source.glb', await glb({ meshes: 2 })); write(dir, 'Art/final.glb', await glb({ meshes: 1 }));
  register(dir, path, 'topology', ['Art/source.glb', 'Art/final.glb'], { runtimeModel: 'Art/final.glb' });
  const record = read(dir, path).stages.topology[0]; assert.equal(record.runtimeModel, 'Art/final.glb');
  const app = await open(dir); const run = W(app); const target = { kind: 'unit', id: 'table' };
  let detail = await app.run('unit.get', { id: 'table' });
  assert.equal(detail.links.find((l) => l.role === 'topology').asset.path, 'Art/final.glb');
  assert.equal(detail.unit.attrs.triangles, 2);
  await run('review.decideCurrent', { target, whole: 'approved' });
  jam(dir, ['review', '--run', path, '--stage', 'topology', '--record', '-'], { record: record.id, decision: 'accept', actor: 'human', by: 'Rae Tester', source: 'Test approval', reason: 'Inspected fixture' });
  detail = await app.run('unit.get', { id: 'table' });
  assert.equal(detail.unit.attrs['stage.topology'], 'accepted');
  assert.ok(detail.review.parts.every((p) => !p.changed));
  for (const stage of ['texture', 'delivery']) {
    register(dir, path, stage, ['Art/source.glb', 'Art/final.glb'], { runtimeModel: 'Art/final.glb' });
    assert.equal(read(dir, path).stages[stage][0].runtimeModel, 'Art/final.glb');
    assert.equal((await app.run('unit.get', { id: 'table' })).links.find((l) => l.role === stage).asset.path, 'Art/final.glb');
  }
  // Malformed unrelated inputs must not hide valid assets.
  write(dir, 'Art/broken/run.json', { version: 1, id: 'bad', created: new Date().toISOString(), stages: { mesh: [{}] } });
  assert.equal((await app.run('catalog.search', { section: 'units' })).items.length, 1);
  assert.ok((await app.run('problems', {})).problems.some((p) => p.source === 'Art/broken/run.json'));
  // Changing real geometry still invalidates the catalog decision.
  write(dir, 'Art/final.glb', await glb({ meshes: 3 }));
  assert.equal((await app.run('unit.get', { id: 'table' })).review.parts.find((p) => p.id === 'topology').changed, true);
  // An unsupported runtime format must never display a different, supported source model.
  const fbx = Buffer.from('Synthetic DCC output'); write(dir, 'Art/final.fbx', fbx);
  write(dir, 'Art/measurement.json', { model: { path: 'Art/final.fbx', sha256: createHash('sha256').update(fbx).digest('hex') }, tool: 'fixture DCC', command: 'measure final.fbx', metrics: { triangles: 2, materials: 1, textureMiB: 0, textureDimensions: [] } });
  register(dir, path, 'topology', ['Art/source.glb', 'Art/final.fbx'], { runtimeModel: 'Art/final.fbx', measurementReport: 'Art/measurement.json', evidence: ['Art/evidence.md', 'Art/measurement.json'] });
  assert.equal(read(dir, path).stages.topology.at(-1).runtimeModel, 'Art/final.fbx');
  assert.ok(!(await app.run('unit.get', { id: 'table' })).links.some((l) => l.role === 'topology'));
});

test('a verdict with a mismatched submission and item never affects the item', async (t) => {
  const dir = await standardProject(); t.after(() => cleanup(dir)); const app = await open(dir); const run = W(app);
  const first = (await run('review.submit', { items: [{ target: { kind: 'unit', id: 'armor/helm' } }] })).submission;
  const second = (await run('review.submit', { items: [{ target: { kind: 'unit', id: 'armor/boots' } }] })).submission;
  const { event } = await run('review.decide', { submission: first.id, item: first.items[0].id, whole: 'approved' });
  const path = `.catalog/reviews/${first.id}/verdicts/${event.id}.json`;
  const record = read(dir, path); record.item = second.items[0].id; write(dir, path, record);
  assert.ok((await app.run('unit.get', { id: 'armor/boots' })).review.parts.every((p) => p.verdict === null));
});

test('capture with a server URL refuses a misleading local output flag', () => {
  const out = spawnSync(process.execPath, [resolve(import.meta.dirname, '../bin/catalog.mjs'), 'capture', '--url', 'http://127.0.0.1:1', '--target', 'unit:table', '--out', 'unused.png'], { encoding: 'utf8' });
  assert.equal(out.status, 1); assert.match(out.stderr, /--out requires a local capture/);
});

test('a real browser capture of a Jam asset shows its runtime model and stable concept part', async (t) => {
  const dir = await jamProject(t); const path = 'Art/Assets/table/v1/run.json'; init(dir, path);
  write(dir, 'Art/source.glb', await glb({ meshes: 2 })); const final = await glb({ meshes: 1 }); write(dir, 'Art/final.glb', final);
  write(dir, 'Art/concept.png', png()); register(dir, path, 'concept', ['Art/concept.png']);
  register(dir, path, 'topology', ['Art/source.glb', 'Art/final.glb'], { runtimeModel: 'Art/final.glb' });
  const server = await startServer({ app: await open(dir), port: 0 });
  const api = async (name, input) => {
    const r = await fetch(`${server.url}api/run/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-catalog-request': '1' }, body: JSON.stringify({ input }) });
    const result = await r.json(); assert.equal(r.ok, true, JSON.stringify(result)); return result;
  };
  try {
    await api('viewer.open', { target: { kind: 'unit', id: 'table', part: 'topology' }, session: 'jam' });
    const capture = await api('viewer.capture', { session: 'jam' });
    assert.equal(capture.shows.asset, 'Art/final.glb');
    assert.equal(capture.shows.sha256, createHash('sha256').update(final).digest('hex'));
    await api('viewer.open', { target: { kind: 'unit', id: 'table', part: 'concept:1' }, session: 'jam' });
    assert.equal((await api('viewer.capture', { session: 'jam' })).shows.asset, 'Art/concept.png');
  } finally { await server.close(); }
});
