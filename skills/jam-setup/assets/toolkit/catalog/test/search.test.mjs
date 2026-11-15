import test from 'node:test';
import assert from 'node:assert/strict';
import { standardProject, makeProject, open, W, write, read, png, glb, cleanup } from './helpers.mjs';

test('T05 ranking: exact id/name first, prefixes and aliases, transposed words and typos, member-only facts', async () => {
  const dir = await standardProject();
  const app = await open(dir);
  const s = (q, extra = {}) => app.run('catalog.search', { section: 'units', q, ...extra });
  assert.equal((await s('armor/helm')).items[0].id, 'armor/helm');
  assert.equal((await s('Iron Boots')).items[0].id, 'armor/boots');
  const iron = (await s('iron')).items.map((u) => u.id);
  assert.deepEqual(iron.slice(0, 2).sort(), ['armor/boots', 'armor/helm'], 'name prefixes rank above attribute text');
  assert.equal(iron.at(-1), 'lore/origin');
  assert.equal((await s('casque')).items[0].id, 'armor/helm', 'alias');
  assert.equal((await s('helm iron')).items[0].id, 'armor/helm', 'transposed word order');
  assert.equal((await s('iorn helm')).items[0].id, 'armor/helm', 'transposed letters');
  assert.equal((await s('hlem')).items[0]?.id, 'armor/helm', 'typo tolerance');
  assert.equal((await s('mines')).items[0].id, 'lore/origin', 'attribute text is searchable');
  assert.equal((await s('zzzz')).total, 0);
  // Member-only fact: the collection matches because a member does, and says which.
  const cols = await app.run('catalog.search', { section: 'collections', q: 'boots' });
  assert.equal(cols.items[0].id, 'outfit/iron');
  assert.equal(cols.items[0].match.member.id, 'armor/boots');
  cleanup(dir);
});

test('T05 facets: counts apply the other filters; filters combine; pages are bounded and reset by the caller', async () => {
  const units = Array.from({ length: 130 }, (_, i) => ({ id: `lore/entry-${String(i).padStart(3, '0')}`, type: 'lore', name: `Entry ${i}`, attrs: { text: i % 2 ? 'odd' : 'even' }, links: [], tags: [i % 3 ? 'common' : 'rare'], category: i < 65 ? 'Book/One' : 'Book/Two' }));
  const dir = await makeProject({ units });
  const app = await open(dir);
  const r = await app.run('catalog.search', { section: 'units', filters: { tag: ['rare'] }, pageSize: 50 });
  assert.equal(r.total, 44); assert.equal(r.items.length, 44); assert.equal(r.all, 130);
  // Tag facet counts ignore the tag filter itself, category counts apply it.
  assert.deepEqual(Object.fromEntries(r.facets.tag.values.map((v) => [v.value, v.count])), { common: 86, rare: 44 });
  assert.equal(r.facets.cat.values.find((v) => v.value === 'Book').count, 44);
  const both = await app.run('catalog.search', { section: 'units', filters: { tag: ['rare'], cat: ['Book/Two'] } });
  assert.equal(both.total, both.items.length);
  assert.ok(both.items.every((u) => u.category === 'Book/Two' && u.tags.includes('rare')));
  const p1 = await app.run('catalog.search', { section: 'units', pageSize: 60, page: 1 });
  const p3 = await app.run('catalog.search', { section: 'units', pageSize: 60, page: 3 });
  assert.equal(p1.pages, 3); assert.equal(p1.items.length, 60); assert.equal(p3.items.length, 10);
  assert.equal(p1.ids.length, 130, 'full ordered id list for previous/next navigation');
  const huge = await app.run('catalog.search', { section: 'units', pageSize: 10000 });
  assert.equal(huge.items.length, 130 > 200 ? 200 : 130); assert.equal(huge.pageSize, 200);
  const beyond = await app.run('catalog.search', { section: 'units', page: 99 });
  assert.equal(beyond.page, beyond.pages, 'out-of-range pages clamp');
  cleanup(dir);
});

test('T06 metadata-only entries, expected-but-missing art and undecodable files are distinct states', async () => {
  const dir = await standardProject({});
  write(dir, 'art/broken.png', Buffer.from('this is not a png'));
  write(dir, 'art/notes.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  write(dir, 'content/armor_broken.json', { id: 'armor/broken', type: 'armor', name: 'Broken Gloves', attrs: { slot: 'Hands' }, links: [{ role: 'icon', asset: 'art/broken.png' }, { role: 'concept', asset: 'art/notes.svg' }, { role: 'model', asset: 'art/gone.glb' }] });
  const app = await open(dir);
  const lore = await app.run('unit.get', { id: 'lore/origin' });
  assert.equal(lore.links.length, 0); assert.equal(lore.missing.length, 0);
  assert.equal(lore.unit.attrs.text, 'Long ago the iron mines opened.');
  const coat = await app.run('unit.get', { id: 'armor/coat' });
  assert.deepEqual(coat.missing.map((r) => r.key), ['model'], 'only the expected role is reported missing');
  const broken = await app.run('unit.get', { id: 'armor/broken' });
  const state = Object.fromEntries(broken.links.map((l) => [l.role, l.asset.state]));
  assert.deepEqual(state, { icon: 'invalid', model: 'missing', concept: 'unsupported' });
  assert.equal(broken.unit.attrs.slot, 'Hands', 'attributes stay usable');
  const missingFacet = await app.run('catalog.search', { section: 'units', filters: { visual: ['missing:model'] } });
  assert.deepEqual(missingFacet.items.map((u) => u.id), ['armor/coat']);
  const errors = await app.run('catalog.search', { section: 'units', filters: { visual: ['error'] } });
  assert.deepEqual(errors.items.map((u) => u.id), ['armor/broken']);
  const assets = await app.run('catalog.search', { section: 'assets', filters: { state: ['invalid', 'missing', 'unsupported'] } });
  assert.deepEqual(assets.items.map((a) => a.id).sort(), ['art/broken.png', 'art/gone.glb', 'art/notes.svg']);
  cleanup(dir);
});

test('Shared assets are single entities with usage, versions and verdicts across content units', async () => {
  const dir = await standardProject();
  const app = await open(dir); const run = W(app);
  const sheet = await app.run('asset.get', { id: 'art/sheet.png' });
  assert.deepEqual(sheet.usage.map((u) => u.unit).sort(), ['armor/boots', 'armor/helm']);
  assert.ok(sheet.usage.every((u) => u.part === 'concept:art/sheet.png'));
  const helm = await app.run('unit.get', { id: 'armor/helm' });
  assert.deepEqual(helm.links.find((l) => l.role === 'concept').alsoUsedBy.map((x) => x.unit), ['armor/boots']);
  await run('review.decideCurrent', { target: { kind: 'unit', id: 'armor/helm' }, whole: 'approved' });
  // No propagation to the other unit sharing the asset.
  assert.equal((await app.run('unit.get', { id: 'armor/boots' })).review.parts.find((p) => p.id === 'concept:art/sheet.png').verdict, null);
  write(dir, 'art/sheet.png', png(8, 4, [255, 255, 255, 255]));
  const after = await app.run('asset.get', { id: 'art/sheet.png' });
  assert.equal(after.versions.length, 2); assert.equal(after.versions[0].current, true);
  assert.equal(after.verdicts.length, 1); assert.equal(after.verdicts[0].verdict, 'approved');
  const facet = await app.run('catalog.search', { section: 'assets', filters: { use: ['shared'] } });
  assert.deepEqual(facet.items.map((a) => a.id), ['art/sheet.png']);
  cleanup(dir);
});
