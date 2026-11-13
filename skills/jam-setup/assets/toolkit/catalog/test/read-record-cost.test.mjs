import test from 'node:test';
import assert from 'node:assert/strict';
import { standardProject, open, W, cleanup } from './helpers.mjs';

test('a search shares one record snapshot across its rows and sees later external label changes', async () => {
  const units = Array.from({ length: 30 }, (_, i) => ({ id: `prop/${i}`, type: 'armor', name: `Prop ${i}`, links: [] }));
  const root = await standardProject({ units, collections: [] });
  try {
    const app = await open(root);
    await W(app)('organize.bulk', { targets: units.map((u) => ({ kind: 'unit', id: u.id })), addTags: ['placeholder'] });
    const list = app.records.list;
    let scans = 0;
    app.records.list = (...args) => { scans++; return list(...args); };
    const found = await app.run('catalog.search', { filters: { tag: ['placeholder'] } });
    assert.equal(found.total, units.length);
    assert.ok(scans <= 20, `one search rescanned repository records ${scans} times for ${units.length} rows`);
    const otherWriter = await open(root);
    await W(otherWriter)('organize.bulk', { targets: [{ kind: 'unit', id: units[0].id }], removeTags: ['placeholder'] });
    assert.equal((await app.run('catalog.search', { filters: { tag: ['placeholder'] } })).total, units.length - 1);
  } finally { cleanup(root); }
});
