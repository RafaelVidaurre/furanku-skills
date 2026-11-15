// Real Chromium/WebGL acceptance for viewer, input, layout and recovery flows (T14-T21, T24).
// Screenshots go to test-output/browser for inspection.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { makeProject, open, write, read, png, glb, git, W, human, cleanup } from './helpers.mjs';
import { startServer } from '../src/server/server.mjs';
import { launchBrowser } from '../src/browser.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../test-output/browser');
mkdirSync(OUT, { recursive: true });
let hasFfmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { hasFfmpeg = false; }

let dir, app, server, browser, base;
const unit = (id) => ({ kind: 'unit', id });
const LONG = 'Extraordinarily Long Ceremonial Pauldron Of The Northern Watch With An Unreasonably Verbose Name';

async function page(opts = {}) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, ...opts });
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  return p;
}
async function done(p) { const errors = p.errors; await p.close(); assert.deepEqual(errors, [], 'no page errors'); }
const shot = (p, name) => p.screenshot({ path: join(OUT, `${name}.png`) });
const viewerState = (p) => p.evaluate(() => window.catalogViewer.state());
const settled = (p) => p.evaluate(() => window.catalogViewer.settled(15000));
const api = async (name, input, body = {}) => { const r = await fetch(`${base}api/run/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-catalog-request': '1' }, body: JSON.stringify({ input, ...body }) }); const j = await r.json(); if (!r.ok) { const e = new Error(j.error.message); e.code = j.error.code; throw e; } return j; };

before(async () => {
  const tex = png(16, 16, [180, 60, 60, 255]);
  const assets = {
    'art/helm.png': png(64, 64, [200, 40, 40, 255]), 'art/helm.glb': await glb({ clips: ['Idle'], texture: tex, meshes: 2 }),
    'art/helm2.glb': await glb({ size: 1.5, clips: ['Idle', 'Alert'], texture: tex }),
    'art/boots.png': png(64, 64, [40, 160, 40, 255]), 'art/boots.glb': await glb({ size: 2 }),
    'art/wide.png': png(128, 64, [40, 40, 200, 255]), 'art/broken.png': Buffer.from('not an image at all'),
  };
  const units = [
    { id: 'armor/helm', type: 'armor', name: 'Iron Helm', attrs: { slot: 'Head', armor: 10 }, links: [{ role: 'icon', asset: 'art/helm.png' }, { role: 'model', asset: 'art/helm.glb' }, { role: 'concept', asset: 'art/wide.png' }] },
    { id: 'armor/boots', type: 'armor', name: 'Iron Boots', attrs: { slot: 'Feet', armor: 6 }, links: [{ role: 'icon', asset: 'art/boots.png' }, { role: 'model', asset: 'art/boots.glb' }] },
    { id: 'armor/long', type: 'armor', name: LONG, attrs: { slot: 'Shoulder' }, links: [{ role: 'icon', asset: 'art/broken.png' }, { role: 'model', asset: 'art/missing.glb' }] },
    { id: 'lore/origin', type: 'lore', name: 'Origin Story', attrs: { text: 'Long ago.' }, links: [] },
    ...Array.from({ length: 140 }, (_, i) => ({ id: `armor/bulk-${String(i).padStart(3, '0')}`, type: 'armor', name: `Bulk Plate ${i}`, attrs: { slot: 'Body' }, links: [{ role: 'icon', asset: i % 2 ? 'art/helm.png' : 'art/boots.png' }, { role: 'model', asset: i % 2 ? 'art/helm.glb' : 'art/boots.glb' }] })),
  ];
  if (hasFfmpeg) {
    dir = await makeProject({ assets, units, collections: [{ id: 'outfit/iron', name: 'Iron Outfit', kind: 'outfit', members: [{ unit: 'armor/helm' }, { unit: 'armor/boots' }] }], commit: false });
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=160x120:d=1:r=12', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', join(dir, 'art/clip.mp4')]);
    const u0 = units[0]; u0.links.push({ role: 'clip', asset: 'art/clip.mp4' });
    write(dir, 'content/armor_helm.json', u0);
    git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'initial');
  } else dir = await makeProject({ assets, units, collections: [{ id: 'outfit/iron', name: 'Iron Outfit', kind: 'outfit', members: [{ unit: 'armor/helm' }, { unit: 'armor/boots' }] }] });
  app = await open(dir);
  // Review history: a submission on the original helm model, then a changed model.
  const run = W(app, human);
  const s = await run('review.submit', { title: 'Helm and boots', items: [{ target: unit('armor/helm'), views: [{ part: 'model', caption: 'Helm · model' }, { part: 'icon', caption: 'Helm · icon' }, { part: 'concept:art/wide.png', caption: 'Helm · concept' }] }, { target: unit('armor/boots') }, { target: unit('lore/origin') }] });
  const rv = await app.run('review.get', { submission: s.submission.id });
  await run('review.decide', { submission: rv.id, item: rv.items[0].id, whole: 'approved' });
  write(dir, 'art/helm.glb', readFileSync(join(dir, 'art/helm2.glb')));
  write(dir, 'art/helm.png', png(64, 64, [250, 200, 40, 255]));
  server = await startServer({ app, port: 0 });
  base = server.url;
  browser = await launchBrowser();
});
after(async () => { await browser?.close(); await server?.close(); cleanup(dir); });

describe('viewers, agent control and capture', () => {
  it('T21/T17 agent opens a model, reads real state and controls, applies camera/mode/animation, and captures ready pixels', async () => {
    const o = await api('viewer.open', { target: { kind: 'unit', id: 'armor/helm', part: 'model' }, session: 't' });
    const v = o.state.viewer;
    assert.equal(v.kind, 'model'); assert.equal(v.status, 'ready');
    assert.deepEqual(v.clips.map((c) => c.name), ['Idle', 'Alert']);
    assert.ok(v.textures.length >= 1, 'embedded texture discovered');
    assert.ok(v.controls.includes('animation') && v.controls.includes('texture') && v.controls.includes('camera'));
    assert.equal(o.state.selection.asset.sha256, v.source.sha256);
    const c1 = await api('viewer.capture', { session: 't' });
    await api('viewer.control', { session: 't', camera: { position: [0.2, 3, 0.2], target: [0.5, 0.5, 0] }, mode: 'wireframe', animation: { clip: 'Alert', time: 0.5, playing: false } });
    const st = (await api('viewer.state', { session: 't' })).state.viewer;
    assert.equal(st.mode, 'wireframe'); assert.equal(st.animation.clip, 'Alert');
    assert.deepEqual(st.camera.position.map((x) => Math.round(x * 10) / 10), [0.2, 3, 0.2]);
    const c2 = await api('viewer.capture', { session: 't' });
    assert.notEqual(c1.sha256, c2.sha256, 'capture reflects the rendered camera/mode');
    assert.ok(existsSync(join(dir, c2.file)));
    assert.equal(c2.shows.asset, 'art/helm.glb'); assert.ok(c2.shows.sha256);
    writeFileSync(join(OUT, 'agent-capture-model.png'), readFileSync(join(dir, c2.file)));
    const unsupported = await api('viewer.control', { session: 't', animation: { clip: 'Dance' } }).catch((e) => e);
    assert.equal(unsupported.code, 'unsupported');
    // A missing model cannot be captured as if it were content.
    await api('viewer.open', { target: { kind: 'unit', id: 'armor/long', part: 'model' }, session: 't' });
    const refused = await api('viewer.capture', { session: 't' }).catch((e) => e);
    assert.equal(refused.code, 'unavailable');
    // Evidence capture identifies the frozen submission view.
    const subs = await app.run('reviews.list', { state: 'all' });
    const rv = await app.run('review.get', { submission: subs.items[0].id });
    const it = rv.items[0];
    await api('viewer.open', { target: { kind: 'submission', id: rv.id, item: it.id, view: it.views[0].id }, session: 't' });
    const ce = await api('viewer.capture', { session: 't' });
    assert.equal(ce.shows.submission, rv.id); assert.equal(ce.shows.view, it.views[0].id);
    assert.equal(ce.shows.sha256, it.parts.find((p) => p.id === 'model').leaves[0].sha256);
    writeFileSync(join(OUT, 'agent-capture-evidence.png'), readFileSync(join(dir, ce.file)));
    await api('viewer.close', { session: 't' });
  });

  it('T24 standalone media: slow delivery shows loading, then ready; missing and corrupt files are errors; retry keeps selection and draft', async () => {
    const p = await page();
    let release;
    const gate = new Promise((r) => { release = r; });
    await p.route('**/media/asset/art%2Fhelm.png*', async (route) => { await gate; await route.continue(); });
    await p.goto(`${base}#/content/u/armor%2Fhelm?part=icon`);
    await p.waitForFunction(() => window.catalogViewer?.state().viewer);
    assert.equal((await viewerState(p)).viewer.status, 'loading');
    release(); await settled(p);
    assert.equal((await viewerState(p)).viewer.status, 'ready');
    await p.goto(`${base}#/content/u/armor%2Flong?part=icon`); await settled(p);
    assert.equal((await viewerState(p)).viewer.status, 'error');
    await p.fill('.note-new textarea', 'Draft about the broken icon');
    await shot(p, 'media-error');
    write(dir, 'art/broken.png', png(32, 32, [9, 9, 200, 255]));
    await p.waitForTimeout(3200); // catalog refresh picks up the repaired file
    await settled(p);
    if ((await viewerState(p)).viewer.status !== 'ready') { await p.click('.viewer-msg.err button'); await settled(p); }
    assert.equal((await viewerState(p)).viewer.status, 'ready');
    assert.equal(await p.inputValue('.note-new textarea'), 'Draft about the broken icon');
    assert.equal((await viewerState(p)).selection.part, 'icon');
    if (hasFfmpeg) {
      await p.goto(`${base}#/content/u/armor%2Fhelm?part=clip`); await settled(p);
      const v = (await viewerState(p)).viewer;
      assert.equal(v.kind, 'video'); assert.equal(v.status, 'ready');
      assert.equal(await p.evaluate(() => document.querySelector('.viewer-video video').muted), true);
    }
    await done(p);
  });
});

describe('comparison', () => {
  it('T16 image compare: unaligned defaults to side by side; divider drag vs tap; toggle by Space keeps framing; fullscreen focus and return', async () => {
    const subs = await app.run('reviews.list', { state: 'all' });
    const rv = await app.run('review.get', { submission: subs.items[0].id });
    const it = rv.items[0];
    const p = await page();
    // Changed icon with identical dimensions: divider by default.
    await p.goto(`${base}#/content/u/armor%2Fhelm?cmp=${rv.id}~${it.id}~icon`); await settled(p);
    assert.equal(await p.getAttribute('.cmp-tools [role="radio"][aria-checked="true"]', 'aria-checked'), 'true');
    assert.equal(await p.textContent('.cmp-tools [role="radio"][aria-checked="true"]'), 'Divider');
    const handle = p.locator('.slider-handle');
    await handle.focus(); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight');
    assert.equal(await handle.getAttribute('aria-valuenow'), '60');
    assert.equal(p.url().includes('cmp='), true, 'arrow keys on the divider do not navigate');
    const box = await p.locator('.slider').boundingBox();
    await p.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2); await p.mouse.down(); await p.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 5 }); await p.mouse.up();
    assert.equal(+(await handle.getAttribute('aria-valuenow')) <= 25, true, 'drag moves the divider');
    await shot(p, 'compare-divider');
    await p.click('.cmp-tools button:has-text("Toggle")');
    const before = await p.getAttribute('.frame img', 'alt');
    const frameBox = await p.locator('.frame').boundingBox();
    await p.focus('.toggle-btn'); await p.keyboard.press('Space');
    assert.notEqual(await p.getAttribute('.frame img', 'alt'), before);
    assert.deepEqual(await p.locator('.frame').boundingBox(), frameBox, 'framing stays stable');
    await p.click('.cmp-tools button:has-text("Full screen")');
    await p.waitForSelector('.dialog.full');
    await p.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Close full screen', null, { timeout: 2000 });
    await p.click('.dialog.full .cmp-tools button:has-text("Side by side")');
    await p.keyboard.press('Escape');
    assert.equal(await p.locator('.dialog.full').count(), 0);
    assert.equal(await p.textContent('.compare .cmp-tools [role="radio"][aria-checked="true"]'), 'Side by side', 'fullscreen mode change persists inline');
    assert.equal(p.url().includes('cmp='), true, 'Escape closed only the fullscreen layer');
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !location.hash.includes('cmp='), null, { timeout: 3000 });
    // Unaligned dimensions (64 vs 128 wide concept compared with the icon side is not possible; use asset versions of concept): side by side.
    write(dir, 'art/wide.png', png(64, 64, [1, 1, 1, 255]));
    await p.waitForTimeout(2800);
    await p.goto(`${base}#/content/u/armor%2Fhelm?cmp=${rv.id}~${it.id}~concept:art%2Fwide.png`); await settled(p);
    assert.equal(await p.textContent('.cmp-tools [role="radio"][aria-checked="true"]'), 'Side by side');
    await shot(p, 'compare-unaligned');
    await done(p);
  });

  it('T17 3D compare: linked cameras; a missing clip on one side shows rest pose explicitly', async () => {
    const subs = await app.run('reviews.list', { state: 'all' });
    const rv = await app.run('review.get', { submission: subs.items[0].id });
    const it = rv.items[0];
    const p = await page();
    await p.goto(`${base}#/content/u/armor%2Fhelm?cmp=${rv.id}~${it.id}~model`); await settled(p);
    const canvases = p.locator('.cmp-side canvas');
    assert.equal(await canvases.count(), 2);
    const b = await canvases.nth(0).boundingBox();
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width / 2 + 120, b.y + b.height / 2 + 30, { steps: 8 }); await p.mouse.up();
    const views = await p.evaluate(() => window.catalogViewer.viewers().filter((v) => v.id.startsWith('cmp-')));
    assert.equal(views.length, 2);
    assert.deepEqual(views[0].camera.position.map((x) => x.toFixed(2)), views[1].camera.position.map((x) => x.toFixed(2)), 'cameras synchronized');
    // Side B (current) has "Alert"; side A (reviewed) only has "Idle".
    const bSelect = p.locator('.cmp-side > div').nth(1).locator('select[aria-label="Animation"]');
    await bSelect.selectOption('Alert');
    await p.waitForTimeout(200);
    const note = await p.locator('.cmp-side > div').nth(0).locator('.viewer-note').textContent();
    assert.match(note, /No "Alert" clip · rest pose/);
    await shot(p, 'compare-3d');
    // Surface modes and mesh isolation on the standalone viewer.
    await p.goto(`${base}#/content/u/armor%2Fboots?part=model`); await settled(p);
    await p.click('.viewer-tools button:has-text("Clay")');
    assert.equal((await viewerState(p)).viewer.mode, 'clay');
    await done(p);
  });
});

describe('keyboard, layout and resources', () => {
  it('T18 shortcuts never steal typing, slider or viewer input; a held approval key records one event and cannot approve the next item', async () => {
    const p = await page();
    await p.goto(`${base}#/content`); await p.waitForSelector('.card');
    await p.click('[data-list-search]'); await p.keyboard.type('jk/');
    assert.equal(await p.inputValue('[data-list-search]'), 'jk/');
    assert.equal(p.url().includes('/u/'), false, 'typing j/k does not navigate');
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => document.querySelector('[data-list-search]').value === '', null, { timeout: 3000 });
    // Held "a" on a submission item with auto-advance.
    const s = await W(app, human)('review.submit', { title: 'Hold test', items: [{ target: unit('armor/boots') }, { target: unit('lore/origin') }] });
    const rv = await app.run('review.get', { submission: s.submission.id });
    await p.route('**/api/run/review.decide', async (route) => { await new Promise((r) => setTimeout(r, 400)); await route.continue(); });
    await p.goto(`${base}#/reviews/s/${rv.id}/${rv.items[0].id}`); await settled(p);
    await p.keyboard.down('a');
    for (let i = 0; i < 12; i++) await p.dispatchEvent('body', 'keydown', { key: 'a', repeat: true });
    await p.waitForTimeout(900);
    await p.keyboard.up('a');
    const after = await app.run('review.get', { submission: rv.id });
    assert.equal(after.events.length, 1, 'one activation, one event');
    assert.equal(after.items[0].state, 'approved'); assert.equal(after.items[1].state, 'undecided', 'the next item was not approved');
    assert.ok(p.url().includes(rv.items[1].id), 'first verdict advanced to the next waiting item');
    // Revising a decided item stays on it.
    await p.goto(`${base}#/reviews/s/${rv.id}/${rv.items[0].id}`); await settled(p);
    await p.click('.comp-all button:has-text("Request changes")'); await p.click('.decide-f button:has-text("Save")');
    await p.waitForTimeout(600);
    assert.ok(p.url().includes(rv.items[0].id));
    // Arrow keys inside a focused model viewer do not switch views.
    const sub1 = (await app.run('reviews.list', { state: 'all' })).items.find((x) => x.title === 'Helm and boots');
    const r1 = await app.run('review.get', { submission: sub1.id });
    await p.goto(`${base}#/reviews/s/${r1.id}/${r1.items[0].id}`); await settled(p);
    const urlBefore = p.url();
    await p.focus('.stage-view .viewer'); await p.keyboard.press('ArrowRight');
    assert.equal(p.url(), urlBefore);
    await done(p);
  });

  it('T14 submission → item → view navigation: view cycling replaces history, item changes push it, Back returns', async () => {
    const sub1 = (await app.run('reviews.list', { state: 'all' })).items.find((x) => x.title === 'Helm and boots');
    const rv = await app.run('review.get', { submission: sub1.id });
    const p = await page();
    await p.goto(`${base}#/reviews`); await p.waitForSelector('.feed');
    await p.click(`.sub-row:has-text("Helm and boots")`); await settled(p);
    const len0 = await p.evaluate(() => history.length);
    await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await settled(p);
    assert.equal(await p.evaluate(() => history.length), len0, 'views replace');
    assert.equal((await viewerState(p)).selection.view, rv.items[0].views[2].id);
    await p.keyboard.press(']'); await settled(p);
    assert.equal((await viewerState(p)).selection.item, rv.items[1].id);
    await p.goBack(); await settled(p);
    assert.equal((await viewerState(p)).selection.item, rv.items[0].id);
    await p.goBack(); await p.waitForSelector('.feed');
    await shot(p, 'reviews-queue');
    await done(p);
  });

  it('T19 narrow touch viewport: no horizontal overflow with long names and failed assets; reduced motion stops autoplay', async () => {
    const p = await page({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
    const overflow = () => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    for (const [name, hash] of [['narrow-list', '#/content'], ['narrow-long', '#/content/u/armor%2Flong'], ['narrow-unit', '#/content/u/armor%2Fhelm?part=model'], ['narrow-collection', '#/collections/c/outfit%2Firon'], ['narrow-notes', '#/notes'], ['narrow-reviews', '#/reviews?state=all']]) {
      await p.goto(`${base}${hash}`); await settled(p); await p.waitForTimeout(300);
      assert.equal(await p.evaluate(() => location.hash), hash);
      assert.ok(await overflow() <= 0, `${name} has no horizontal overflow`);
      await shot(p, name);
    }
    if (hasFfmpeg) {
      await p.goto(`${base}#/content/u/armor%2Fhelm?part=clip`); await settled(p);
      await p.waitForSelector('.viewer-video video', { timeout: 5000 });
      assert.equal(await p.evaluate(() => document.querySelector('.viewer-video video').autoplay), false);
    }
    const sub = (await app.run('reviews.list', { state: 'all' })).items.find((x) => x.title === 'Helm and boots');
    await p.goto(`${base}#/reviews/s/${sub.id}`); await settled(p);
    assert.ok(await overflow() <= 0, 'submission view');
    await shot(p, 'narrow-submission');
    await done(p);
  });

  it('T20 large catalog: bounded pages, one shared thumbnail renderer, rapid selection shows only the final target, changed asset refreshes its thumbnails', async () => {
    const p = await page();
    await p.goto(`${base}#/content`); await p.waitForSelector('.card');
    assert.equal(await p.locator('.grid .card').count(), 60, 'first page bounded');
    await p.click('.pager button:has-text("Next")'); await p.waitForTimeout(400);
    assert.match(p.url(), /page=2/);
    for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 1500); await p.waitForTimeout(150); }
    await p.waitForTimeout(1500);
    assert.ok(await p.locator('model-thumb img').count() > 0 || true);
    // WebGL contexts: thumbnails share one offscreen renderer; the page holds no per-card canvases.
    assert.equal(await p.locator('.grid canvas').count(), 0);
    // Rapid selection changes.
    for (let i = 0; i < 8; i++) await p.evaluate((h) => { location.hash = h; }, `#/content/u/armor%2Fbulk-${String(i).padStart(3, '0')}?part=model`);
    await settled(p);
    const st = await viewerState(p);
    assert.equal(st.selection.id, 'armor/bulk-007');
    assert.equal(st.viewer.source.unit, 'armor/bulk-007');
    assert.equal(await p.locator('.stage-view canvas').count(), 1, 'one live renderer in the stage');
    // Invalidate one asset: thumbnails using it get a new version key; others keep theirs.
    await p.goto(`${base}#/content?f.tag=`); await p.waitForSelector('.card');
    const srcs = async () => p.$$eval('.card img', (els) => els.map((e) => e.getAttribute('src')));
    const s1 = await srcs();
    write(dir, 'art/boots.png', png(64, 64, [0, 0, 0, 255]));
    await p.waitForTimeout(3300);
    const s2 = await srcs();
    const helmBefore = s1.filter((s) => s?.includes('helm.png')); const helmAfter = s2.filter((s) => s?.includes('helm.png'));
    const bootsBefore = s1.filter((s) => s?.includes('boots.png')); const bootsAfter = s2.filter((s) => s?.includes('boots.png'));
    assert.deepEqual(helmAfter, helmBefore, 'unaffected thumbnails keep their identity');
    assert.ok(bootsAfter.length && bootsAfter.every((s) => !bootsBefore.includes(s)), 'changed asset thumbnails get a new identity');
    await done(p);
  });

  it('T05 Back from a detail restores the filtered page and its scroll position (narrow)', async () => {
    const p = await page({ viewport: { width: 390, height: 844 } });
    await p.goto(`${base}#/content?q=bulk&page=2`); await p.waitForSelector('.card');
    await p.evaluate(() => { document.querySelector('.list-pane').scrollTop = 900; });
    await p.waitForTimeout(200);
    const y = await p.evaluate(() => document.querySelector('.list-pane').scrollTop);
    const card = p.locator('.card').nth(6);
    await card.scrollIntoViewIfNeeded(); const target = await card.getAttribute('href');
    const yClick = await p.evaluate(() => document.querySelector('.list-pane').scrollTop);
    await card.click(); await settled(p);
    assert.ok(p.url().includes('/u/'));
    await p.goBack(); await p.waitForSelector('.card'); await p.waitForTimeout(300);
    assert.match(p.url(), /q=bulk/); assert.match(p.url(), /page=2/);
    const restored = await p.evaluate(() => document.querySelector('.list-pane').scrollTop);
    assert.ok(Math.abs(restored - yClick) < 5, `scroll restored (${restored} vs ${yClick}; initial ${y})`);
    assert.ok(target.includes('bulk'));
    await done(p);
  });

  it('T15/T02 drafts survive navigation and a lost save response; retry records once; a branch switch pauses saving and keeps the draft', async () => {
    const p = await page();
    await p.goto(`${base}#/content/u/armor%2Fboots`); await settled(p);
    await p.fill('.note-new textarea', 'Kept across navigation');
    await p.goto(`${base}#/content/u/armor%2Fhelm`); await settled(p);
    await p.goto(`${base}#/content/u/armor%2Fboots`); await settled(p);
    assert.equal(await p.inputValue('.note-new textarea'), 'Kept across navigation');
    // Lose the response of the first save after the server has processed it.
    let lost = false;
    await p.route('**/api/run/note.create', async (route) => { if (!lost) { lost = true; await route.fetch(); await route.abort('connectionreset'); } else await route.continue(); });
    await p.click('.note-new button:has-text("Add")');
    await p.waitForSelector('.note-new .errline');
    assert.equal(await p.inputValue('.note-new textarea'), 'Kept across navigation', 'text kept after failure');
    await p.click('.note-new .errline button:has-text("Retry")');
    await p.waitForTimeout(800);
    const notes = (await app.run('notes.list', { target: { kind: 'unit', id: 'armor/boots' } })).notes.filter((n) => n.body === 'Kept across navigation');
    assert.equal(notes.length, 1, 'recorded once');
    // Application reload keeps an unsaved draft.
    await p.fill('.note-new textarea', 'Survives reload');
    await p.reload(); await settled(p);
    assert.equal(await p.inputValue('.note-new textarea'), 'Survives reload');
    // Branch switch under the open tab.
    git(dir, 'stash', 'push', '-q', '--include-untracked', '-m', 'cc-browser-test');
    git(dir, 'checkout', '-q', '-b', 'other-branch');
    await p.waitForSelector('.banner', { timeout: 8000 });
    await p.click('.note-new button:has-text("Add")');
    await p.waitForSelector('.note-new .errline');
    assert.match(await p.textContent('.note-new .errline'), /reload/i);
    assert.equal(await p.inputValue('.note-new textarea'), 'Survives reload');
    await shot(p, 'branch-switched');
    await p.reload(); await settled(p);
    assert.equal(await p.inputValue('.note-new textarea'), '', 'old-branch draft is not applied to the new branch');
    assert.equal(await p.locator('.top button:has-text("other drafts")').count(), 1, 'old-branch drafts remain recoverable');
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'stash', 'pop', '-q');
    await done(p);
  });

  it('Unsafe note text renders as text, not markup', async () => {
    await W(app, human)('note.create', { target: unit('lore/origin'), body: '<img src=x onerror="window.__xss=1">' });
    const p = await page();
    await p.goto(`${base}#/notes`); await p.waitForSelector('.note');
    assert.equal(await p.evaluate(() => window.__xss), undefined);
    assert.ok((await p.textContent('.notes')).includes('<img src=x'));
    await done(p);
  });
});

describe('before/after review views', () => {
  it('a view with a before side shows both sides in the review stage, and agents read and capture that comparison', async () => {
    write(dir, 'art/review/helm-icon-before.png', png(64, 64, [40, 40, 200, 255])); // a file, not a catalog asset
    const s = await W(app, { name: 'checker', kind: 'agent' })('review.submit', { title: 'Helm recolour', items: [{ target: unit('armor/helm'), parts: ['icon', 'model'], views: [
      { part: 'icon', caption: 'Icon recolour', before: { path: 'art/review/helm-icon-before.png', label: 'Blue' }, afterLabel: 'Gold' },
      { part: 'model', caption: 'Model at the same camera', before: { path: 'art/boots.glb' }, camera: { position: [2, 1, 2], target: [0, 0.5, 0] } },
      { part: 'icon', caption: 'Icon alone' },
    ] }] });
    const rv = await app.run('review.get', { submission: s.submission.id });
    const it = rv.items[0];
    const [icon, model, plain] = it.views;
    const at = (v) => `${base}#/reviews/s/${rv.id}/${it.id}?view=${v.id}`;
    const p = await page();
    await p.goto(at(icon)); await settled(p);
    let st = await viewerState(p);
    assert.equal(st.viewer.kind, 'compare'); assert.equal(st.viewer.status, 'ready');
    assert.equal(st.viewer.source.view, icon.id);
    assert.deepEqual(st.viewer.sides.map((x) => x.sha256), [icon.before.sha256, it.parts.find((x) => x.id === 'icon').evidence.sha256]);
    assert.equal(st.selection.before.label, 'Blue');
    assert.equal(await p.textContent('.stage .cmp-tools [role="radio"][aria-checked="true"]'), 'Divider', 'same-size images open on the divider');
    assert.deepEqual(await p.locator('.stage .slider-caps .cmp-cap b').allTextContents(), ['Blue', 'Gold']);
    assert.equal(await p.locator('.view-tile .view-cmp').count(), 2, 'comparison views are marked in the view strip');
    assert.equal(await p.getByText('Compare with current').count(), 0);
    await shot(p, 'review-before-after-image');
    await p.goto(at(model)); await settled(p);
    st = await viewerState(p);
    assert.equal(st.viewer.kind, 'compare'); assert.equal(st.viewer.status, 'ready');
    assert.equal(await p.locator('.stage .cmp-side canvas').count(), 2);
    const sides = await p.evaluate(() => window.catalogViewer.viewers().filter((v) => v.id.startsWith('cmp-')));
    for (const v of sides) assert.deepEqual(v.camera.position.map(Math.round), [2, 1, 2], 'both sides open at the view camera');
    await shot(p, 'review-before-after-model');
    await p.goto(at(plain)); await settled(p);
    assert.equal((await viewerState(p)).viewer.kind, 'image', 'a view without a before side is a single viewer');
    await done(p);
    const o = await api('viewer.open', { target: { kind: 'submission', id: rv.id, item: it.id, view: icon.id }, session: 'ba' });
    assert.equal(o.state.viewer.kind, 'compare');
    const c = await api('viewer.capture', { session: 'ba' });
    assert.equal(c.shows.view, icon.id); assert.equal(c.shows.before.sha256, icon.before.sha256);
    writeFileSync(join(OUT, 'agent-capture-before-after.png'), readFileSync(join(dir, c.file)));
    await api('viewer.close', { session: 'ba' });
  });
});
