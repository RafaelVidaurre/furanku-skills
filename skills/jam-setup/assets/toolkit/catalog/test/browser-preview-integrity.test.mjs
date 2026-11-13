// Preview integrity in real Chromium: every declared preview input must be present, and a frozen
// preview runs only the exact project module revision it was submitted with.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, copyFileSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeProject, open, write, read, png, glb, git, W, human, cleanup } from './helpers.mjs';
import { startServer } from '../src/server/server.mjs';
import { launchBrowser } from '../src/browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let dir, app, server, browser, base;
const col = (id) => ({ kind: 'collection', id });
const api = async (name, input) => { const r = await fetch(`${base}api/run/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-catalog-request': '1' }, body: JSON.stringify({ input }) }); const j = await r.json(); if (!r.ok) { const e = new Error(j.error.message); e.code = j.error.code; throw e; } return j; };
async function viewState(hash) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(`${base}${hash}`);
  await p.evaluate(() => window.catalogViewer.settled(15000));
  const st = await p.evaluate(() => window.catalogViewer.state());
  const text = await p.textContent('.stage-view');
  await p.close();
  assert.deepEqual(errors, []);
  return { st, text };
}
async function captureRefused(target) {
  const o = await api('viewer.open', { target, session: 'pi' }).catch((e) => e);
  const c = await api('viewer.capture', { session: 'pi' }).catch((e) => e);
  await api('viewer.close', { session: 'pi' });
  assert.equal(c.code, 'unavailable', `capture refused (open: ${o.code ?? 'ok'})`);
}

before(async () => {
  dir = await makeProject({
    assets: { 'art/a.glb': await glb(), 'art/b.glb': await glb({ size: 2 }), 'art/stand.glb': await glb({ size: 3 }), 'art/body.glb': await glb({ size: 4 }) },
    units: [
      { id: 'armor/a', type: 'armor', name: 'A', attrs: {}, links: [{ role: 'model', asset: 'art/a.glb' }] },
      { id: 'armor/b', type: 'armor', name: 'B', attrs: {}, links: [{ role: 'model', asset: 'art/b.glb' }] },
    ],
    collections: [
      { id: 'set/ab', name: 'Set AB', kind: 'outfitbase', members: [{ unit: 'armor/a' }, { unit: 'armor/b' }] },
      { id: 'row/ab', name: 'Row AB', kind: 'lineup', members: [{ unit: 'armor/a' }, { unit: 'armor/b' }] },
    ],
    extra: { collectionKinds: {
      outfitbase: { label: 'Outfit', preview: { label: 'Assembled', module: 'assembled-mesh', base: 'art/body.glb' } },
      lineup: { label: 'Lineup', preview: { label: 'Lineup', module: 'lineup', base: 'art/stand.glb', config: { spacing: 2 } } },
    } },
    commit: false,
  });
  mkdirSync(join(dir, 'previews'), { recursive: true });
  copyFileSync(join(here, '../examples/previews/lineup.mjs'), join(dir, 'previews/lineup.mjs'));
  write(dir, 'catalog.config.json', { version: 1, adapter: 'manifest', previewModules: { lineup: './previews/lineup.mjs' } });
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'initial');
  app = await open(dir);
  server = await startServer({ app, port: 0 });
  base = server.url;
  browser = await launchBrowser();
});
after(async () => { await browser?.close(); await server?.close(); cleanup(dir); });

describe('preview dependency integrity', () => {
  it('a frozen built-in preview whose base evidence is missing is an explicit error and cannot be captured', async () => {
    write(dir, 'art/body.glb', await glb({ size: 4.5 })); // dirty: the base is stored as catalog evidence
    const s = await W(app, human)('review.submit', { items: [{ target: col('set/ab'), parts: ['preview'] }] });
    const rv = await app.run('review.get', { submission: s.submission.id });
    const item = rv.items[0];
    const baseLeaf = item.parts[0].leaves.find((l) => l.key === 'base');
    assert.equal(baseLeaf.storage, 'catalog');
    const target = { kind: 'submission', id: rv.id, item: item.id, view: item.views[0].id };
    let v = await viewState(`#/reviews/s/${rv.id}/${item.id}`);
    assert.equal(v.st.viewer.status, 'ready'); assert.equal(v.st.viewer.files.ghosts.length, 1);
    unlinkSync(join(dir, `.catalog/evidence/${baseLeaf.sha256.slice(0, 2)}/${baseLeaf.sha256}.glb`));
    v = await viewState(`#/reviews/s/${rv.id}/${item.id}`);
    assert.equal(v.st.viewer.status, 'error'); assert.match(v.text, /Preview inputs unavailable: base/);
    await captureRefused(target);
  });

  it('a current preview whose declared base file is missing is an explicit error; submission is refused', async () => {
    let v = await viewState('#/collections/c/set%2Fab');
    assert.equal(v.st.viewer.status, 'ready');
    unlinkSync(join(dir, 'art/body.glb'));
    v = await viewState('#/collections/c/set%2Fab');
    assert.equal(v.st.viewer.status, 'error'); assert.match(v.text, /base/);
    await captureRefused({ kind: 'collection', id: 'set/ab' });
    const r = await W(app, human)('review.submit', { items: [{ target: col('set/ab'), parts: ['preview'] }] }).catch((e) => e);
    assert.equal(r.code, 'invalid');
    git(dir, 'checkout', '--', 'art/body.glb');
  });

  it('a frozen preview runs only its submitted module revision; a changed module is reported and refused, and marks the verdict changed', async () => {
    const s = await W(app, human)('review.submit', { items: [{ target: col('row/ab'), parts: ['preview'] }] });
    const rv = await app.run('review.get', { submission: s.submission.id });
    const item = rv.items[0];
    await W(app, human)('review.decide', { submission: rv.id, item: item.id, whole: 'approved' });
    const pinned = item.preview.moduleUrl;
    assert.match(pinned, /\?v=[0-9a-f]{16}$/);
    let v = await viewState(`#/reviews/s/${rv.id}/${item.id}`);
    assert.equal(v.st.viewer.status, 'ready'); assert.equal(v.st.viewer.source.spacing, 2);
    let proj = (await app.run('collection.get', { id: 'row/ab' })).review.parts.find((p) => p.id === 'preview');
    assert.equal(proj.verdict, 'approved'); assert.equal(proj.changed, false);
    // Edit the module source (v2).
    const src = readFileSync(join(dir, 'previews/lineup.mjs'), 'utf8');
    writeFileSync(join(dir, 'previews/lineup.mjs'), src.replace('source=${{ ...ctx.source, spacing }}', 'source=${{ ...ctx.source, spacing, revision: 2 }}'));
    const r = await fetch(`${base}${pinned.slice(1)}`);
    assert.equal(r.status, 409, 'the server refuses to serve another revision for a pinned request');
    const after = await app.run('review.get', { submission: rv.id });
    assert.equal(after.items[0].preview.moduleChanged, true); assert.equal(after.items[0].preview.moduleUrl, null);
    v = await viewState(`#/reviews/s/${rv.id}/${item.id}`);
    assert.equal(v.st.viewer.status, 'error'); assert.match(v.text, /changed since this submission/);
    await captureRefused({ kind: 'submission', id: rv.id, item: item.id, view: item.views[0].id });
    // The current collection runs the new revision; the verdict stays, marked changed.
    v = await viewState('#/collections/c/row%2Fab');
    assert.equal(v.st.viewer.status, 'ready'); assert.equal(v.st.viewer.source.revision, 2);
    proj = (await app.run('collection.get', { id: 'row/ab' })).review.parts.find((p) => p.id === 'preview');
    assert.equal(proj.verdict, 'approved'); assert.equal(proj.changed, true, 'module change shows as changed evidence');
    // Restoring the submitted revision makes the frozen preview renderable again.
    writeFileSync(join(dir, 'previews/lineup.mjs'), src);
    v = await viewState(`#/reviews/s/${rv.id}/${item.id}`);
    assert.equal(v.st.viewer.status, 'ready'); assert.equal(v.st.viewer.source.revision, undefined);
  });

  it('a removed project module file is unavailable for current and frozen previews', async () => {
    const s = await W(app, human)('review.submit', { items: [{ target: col('row/ab'), parts: ['preview'] }] });
    const rv = await app.run('review.get', { submission: s.submission.id });
    unlinkSync(join(dir, 'previews/lineup.mjs'));
    let v = await viewState(`#/reviews/s/${rv.id}/${rv.items[0].id}`);
    assert.equal(v.st.viewer.status, 'error'); assert.match(v.text, /not available in this checkout/);
    v = await viewState('#/collections/c/row%2Fab');
    assert.equal(v.st.viewer.status, 'error'); assert.match(v.text, /declared but its file is missing/);
    await captureRefused({ kind: 'collection', id: 'row/ab' });
    // Comparison rows still resolve each declared input independently.
    const c = await app.run('evidence.compare', { a: { submission: rv.id, item: rv.items[0].id, part: 'preview' }, b: 'current' });
    assert.deepEqual(c.rows.map((x) => x.key).sort(), ['armor/a/model', 'armor/b/model', 'base']);
    assert.ok(c.rows.every((x) => x.a.status === 'ok'));
    git(dir, 'checkout', '--', 'previews/lineup.mjs');
  });
});
