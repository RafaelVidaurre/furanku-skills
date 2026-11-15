import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmp, git, write, png, open, W, standardProject, cleanup, human } from './helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const JAM = resolve(here, '../../jam.mjs');
const PROFILE = { platforms: ['Windows'], renderer: 'deferred', camera: 'third person', cameraDistanceMeters: 3, screenCoveragePercent: 10, expectedInstances: 20, maxTextureMiB: 8, assetKind: 'static', units: 'meters', up: '+Z', forward: '-Y', pivot: 'bottom', materialWorkflow: 'pbr', targetTriangles: 1000, maxTriangles: 2000, textureSize: 1024, maxMaterials: 1 };
const jam = (root, args, input) => execFileSync(process.execPath, [JAM, ...args, '--root', root], { input, encoding: 'utf8' });

async function jamProject() {
  const dir = tmp('cc-jam-');
  git(dir, 'init', '-q');
  write(dir, 'Art/style.md', '# Style\n');
  write(dir, 'jam.config.json', { version: 1, style: { document: 'Art/style.md', references: [] }, profiles: { prop: PROFILE }, providers: { image: 'scenario', mesh: 'meshy' }, review: { default: 'human', stages: {} }, spend: { meshy: { unit: 'credits', limit: 0 }, scenario: { unit: 'CU', limit: 0 } } });
  write(dir, 'catalog.config.json', { version: 1, adapter: 'jam' });
  for (const v of ['v1', 'v2']) {
    write(dir, `Art/.scratch/table/${v}/brief.md`, `Table ${v}\n`);
    jam(dir, ['init', '--run', `Art/.scratch/table/${v}/run.json`, '--id', 'table', '--profile', 'prop', '--brief', `Art/.scratch/table/${v}/brief.md`]);
  }
  write(dir, 'Art/.scratch/table/v1/concept-a.png', png(8, 8, [120, 80, 40, 255]));
  write(dir, 'Art/.scratch/table/v1/concept-b.png', png(8, 8, [40, 80, 120, 255]));
  write(dir, 'Art/.scratch/table/v1/notes.md', 'Two directions\n');
  const rec = (files) => JSON.stringify({ stage: 'concept', files, inputs: [], evidence: ['Art/.scratch/table/v1/notes.md'], dependsOn: [], note: 'Concept directions', provenance: { provider: 'local', model: 'hand drawn', transport: 'file' } });
  jam(dir, ['register', '--run', 'Art/.scratch/table/v1/run.json', '--record', '-'], rec(['Art/.scratch/table/v1/concept-a.png', 'Art/.scratch/table/v1/concept-b.png']));
  // The second run re-admits the same concept file: one shared visual asset.
  jam(dir, ['register', '--run', 'Art/.scratch/table/v2/run.json', '--record', '-'], rec(['Art/.scratch/table/v1/concept-a.png']));
  return dir;
}

test('T23 jam adapter: real run records become content; gates/staleness are read-only facts; catalog actions never touch jam records', async () => {
  const dir = await jamProject();
  const runBytes = () => ['v1', 'v2'].map((v) => readFileSync(join(dir, `Art/.scratch/table/${v}/run.json`), 'utf8'));
  const before = runBytes();
  const app = await open(dir);
  const units = await app.run('catalog.search', { section: 'units' });
  assert.deepEqual(units.items.map((u) => u.id), ['table']);
  const v1 = await app.run('unit.get', { id: 'table' });
  assert.equal(v1.unit.attrs['stage.concept'], 'awaiting human review');
  assert.equal(v1.unit.attrs.profile, 'prop');
  assert.equal(v1.unit.attrs.custody, 'Scratch (Git-ignored)');
  assert.deepEqual(v1.links.map((l) => l.role), ['concept']);
  assert.equal(v1.unit.sources[0], 'Art/.scratch/table/v2/run.json');
  const shared = await app.run('asset.get', { id: 'Art/.scratch/table/v1/concept-a.png' });
  assert.deepEqual(shared.usage.map((u) => u.unit).sort(), ['table']);
  assert.equal((await app.run('context', {})).counts.collections, 0);
  // Generic actions: notes, submissions, verdicts — jam records stay byte-identical.
  const run = W(app, human);
  await run('note.create', { target: { kind: 'unit', id: 'table' }, body: 'Prefer direction A' });
  await run('review.decideCurrent', { target: { kind: 'unit', id: 'table' }, whole: 'approved' });
  await run('organize.set', { target: { kind: 'unit', id: 'table' }, tags: ['shortlist'] });
  assert.deepEqual(runBytes(), before, 'jam run records unchanged');
  assert.equal((await app.run('unit.get', { id: 'table' })).unit.attrs['stage.concept'], 'awaiting human review', 'a catalog verdict is not a jam decision');
  // Jam staleness is displayed after the artifact changes.
  write(dir, 'Art/.scratch/table/v1/concept-a.png', png(8, 8, [1, 1, 1, 255]));
  assert.match((await app.run('unit.get', { id: 'table' })).unit.attrs['stage.concept'], /^stale/);
  assert.match(execFileSync(process.execPath, [JAM, 'status', '--run', 'Art/.scratch/table/v1/run.json', '--root', dir], { encoding: 'utf8' }), /stale/);
  cleanup(dir);
});

test('T23 an empty jam project stays honestly empty', async () => {
  const dir = tmp('cc-jam-empty-');
  git(dir, 'init', '-q');
  write(dir, 'catalog.config.json', { version: 1, adapter: 'jam' });
  const app = await open(dir);
  const ctx = await app.run('context', {});
  assert.deepEqual([ctx.counts.units, ctx.counts.collections, ctx.counts.assets], [0, 0, 0]);
  assert.equal((await app.run('problems', {})).problems.length, 0);
  cleanup(dir);
});

test('T23 the generic core loads no game- or toolkit-specific modules with the manifest adapter', async () => {
  const dir = await standardProject();
  const script = `
    import { registerHooks } from 'node:module';
    const seen = [];
    registerHooks({ resolve(s, c, next) { const r = next(s, c); seen.push(r.url); return r; } });
    const { openCatalog } = await import(${JSON.stringify(resolve(here, '../src/core/app.mjs'))});
    const app = await openCatalog({ root: ${JSON.stringify(dir)} });
    await app.run('catalog.search', { section: 'units' });
    await app.run('unit.get', { id: 'armor/helm' });
    console.log(JSON.stringify(seen));`;
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const urls = JSON.parse(out.stdout.trim().split('\n').at(-1));
  assert.ok(urls.some((u) => u.includes('/src/adapters/manifest.mjs')));
  assert.ok(!urls.some((u) => /\/tools\/jam\/|adapters\/jam\.mjs|three|preact|playwright|unreal/i.test(u)), urls.filter((u) => !u.startsWith('node:')).join('\n'));
  cleanup(dir);
});

test('Manifest adapter: project collections, aliases, explanations and per-file problems', async () => {
  const dir = await standardProject();
  write(dir, 'content/bad.json', '{"id": 1}');
  write(dir, 'content/dup.json', { id: 'armor/helm', type: 'armor', name: 'Dup' });
  write(dir, 'content/unknown.json', { id: 'x/y', type: 'vehicle', name: 'Car' });
  const app = await open(dir);
  const problems = (await app.run('problems', {})).problems.map((p) => `${p.source}: ${p.error}`);
  assert.ok(problems.some((p) => /duplicate content id armor\/helm/.test(p)));
  assert.ok(problems.some((p) => /unknown type vehicle/.test(p)));
  assert.ok(problems.some((p) => /content\/bad\.json/.test(p)));
  assert.equal((await app.run('unit.get', { id: 'armor/helm' })).unit.name, 'Iron Helm');
  const col = await app.run('collection.get', { id: 'outfit/iron' });
  assert.equal(col.collection.owner, 'adapter'); assert.equal(col.preview.module, 'assembled-mesh');
  assert.equal(col.preview.members.length, 2);
  cleanup(dir);
});
