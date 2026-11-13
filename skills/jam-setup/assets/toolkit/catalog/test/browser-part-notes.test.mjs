// Real Chromium acceptance for per-part review notes in the catalog quick review and the submission
// item review: drafts survive reload, saved notes reload with their part and verdict.
// Screenshots go to test-output/browser for inspection.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { standardProject, open, W, human, cleanup } from './helpers.mjs';
import { startServer } from '../src/server/server.mjs';
import { launchBrowser } from '../src/browser.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../test-output/browser');
mkdirSync(OUT, { recursive: true });
let dir, app, server, browser, base;
const unit = (id) => ({ kind: 'unit', id });

async function page() {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  return p;
}
async function done(p) { const errors = p.errors; await p.close(); assert.deepEqual(errors, [], 'no page errors'); }
const shot = (p, name) => p.screenshot({ path: join(OUT, `${name}.png`) });
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 50)); }
}
const texts = (p, sel) => p.$$eval(sel, (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
// Each shown part note as [verdict class, part label, note text].
const notesShown = (p, sel) => p.$$eval(`${sel} .part-note`, (els) => els.map((e) => [e.querySelector('.pv').className.replace('pv ', ''), e.querySelector('.pv').textContent.trim(), e.querySelector('.part-note-t').textContent]));

before(async () => {
  dir = await standardProject();
  app = await open(dir);
  server = await startServer({ app, port: 0 });
  base = server.url;
  browser = await launchBrowser();
});
after(async () => { await browser?.close(); await server?.close(); cleanup(dir); });

describe('part notes', () => {
  it('catalog quick review: notes per decided part survive a reload as a draft, record only for decided parts, and show after reload', async () => {
    const p = await page();
    await p.goto(`${base}#/content/u/armor%2Fhelm`);
    await p.click('section[aria-label="Review"] button.primary');
    const dlg = p.locator('[role="dialog"][aria-label="Review Iron Helm"]');
    await dlg.waitFor();
    assert.equal(await dlg.locator('button[aria-label="Note on Attributes"]').isDisabled(), true, 'no note without a verdict');
    await dlg.locator('button[aria-label="Request changes: Icon"]').click();
    await dlg.locator('button[aria-label="Reject: Model"]').click();
    await dlg.locator('button[aria-label="Approve: Concept"]').click();
    await dlg.locator('button[aria-label="Note on Icon"]').click();
    await dlg.locator('textarea[aria-label="Note on Icon"]').fill('Outline too thin at small sizes');
    await dlg.locator('button[aria-label="Note on Model"]').click();
    await dlg.locator('textarea[aria-label="Note on Model"]').fill('Visor silhouette is wrong');
    await dlg.locator('button[aria-label="Note on Concept"]').click();
    await dlg.locator('textarea[aria-label="Note on Concept"]').fill('Dropped with its verdict');
    await dlg.locator('textarea[aria-label="Comment"]').fill('Close overall');
    // The draft, notes included, survives a reload.
    await p.reload();
    await p.click('section[aria-label="Review"] button.primary');
    await dlg.waitFor();
    assert.equal(await dlg.locator('textarea[aria-label="Note on Icon"]').inputValue(), 'Outline too thin at small sizes');
    assert.equal(await dlg.locator('textarea[aria-label="Note on Model"]').inputValue(), 'Visor silhouette is wrong');
    assert.equal(await dlg.locator('textarea[aria-label="Note on Model"]').getAttribute('maxlength'), '5000', 'typing cannot exceed the API note limit');
    // A filled note collapses and reopens with its text intact.
    const iconTog = dlg.locator('button[aria-label="Note on Icon"]');
    await iconTog.click();
    assert.equal(await dlg.locator('textarea[aria-label="Note on Icon"]').count(), 0, 'filled note collapses');
    assert.equal(await iconTog.getAttribute('aria-expanded'), 'false');
    await iconTog.click();
    assert.equal(await dlg.locator('textarea[aria-label="Note on Icon"]').inputValue(), 'Outline too thin at small sizes', 'reopened note keeps its text');
    // The modal keeps its own side padding inside the Review block.
    assert.ok(await dlg.evaluate((d) => ['.comp-all', '.comp-parts', '.comp-comment'].every((s) => { const c = getComputedStyle(d.querySelector(s)); return parseFloat(s === '.comp-comment' ? c.marginLeft : c.paddingLeft) > 0; })), 'review fields remain inset from the modal edge');
    // Clearing a part's verdict hides its note and leaves it out of the decision.
    await dlg.locator('[role="radiogroup"][aria-label="Concept"] button[title="No verdict"]').click();
    assert.equal(await dlg.locator('textarea[aria-label="Note on Concept"]').count(), 0);
    await shot(p, 'part-notes-quick-composer');
    await dlg.locator('footer button:has-text("Submit")').click();
    await dlg.waitFor({ state: 'detached' });
    const ev = (await app.run('unit.get', { id: 'armor/helm' })).history[0];
    assert.deepEqual(ev.verdicts, { icon: 'changes', model: 'rejected' });
    assert.deepEqual(ev.partNotes, { icon: 'Outline too thin at small sizes', model: 'Visor silhouette is wrong' });
    assert.equal(ev.comment, 'Close overall');
    // After a reload the current part rows and the history show each note with its part and verdict.
    await p.reload();
    await p.waitForSelector('section[aria-label="Review"] .part-note-cur');
    assert.deepEqual(await texts(p, 'section[aria-label="Review"] .part-note-cur'), ['Outline too thin at small sizes', 'Visor silhouette is wrong']);
    await p.click('section[aria-label="Review"] details.history summary');
    assert.deepEqual(await notesShown(p, 'section[aria-label="Review"] .history'), [['changes', 'Icon', 'Outline too thin at small sizes'], ['rejected', 'Model', 'Visor silhouette is wrong']]);
    assert.deepEqual(await texts(p, 'section[aria-label="Review"] .history .ritem-c'), ['Close overall']);
    await p.locator('section[aria-label="Review"]').screenshot({ path: join(OUT, 'part-notes-catalog-history.png') });
    await done(p);
  });

  it('submission item review: mixed verdicts with two part notes save and reload; a decision without notes records none', async () => {
    const s = await W(app, human)('review.submit', { title: 'Boots pass', items: [{ target: unit('armor/boots') }] });
    const rv = await app.run('review.get', { submission: s.submission.id });
    const item = rv.items[0].id;
    const p = await page();
    await p.goto(`${base}#/reviews/s/${rv.id}/${item}`);
    const dec = p.locator('section[aria-label="Decision"]');
    await dec.waitFor();
    await dec.locator('.comp-all button:has-text("Approve")').click();
    await dec.locator('button[aria-label="Request changes: Model"]').click();
    await dec.locator('button[aria-label="Note on Model"]').click();
    await dec.locator('textarea[aria-label="Note on Model"]').fill('Sole is too thick');
    await dec.locator('button[aria-label="Note on Icon"]').click();
    await dec.locator('textarea[aria-label="Note on Icon"]').fill('Icon reads well');
    await p.reload();
    await dec.waitFor();
    assert.equal(await dec.locator('textarea[aria-label="Note on Model"]').inputValue(), 'Sole is too thick', 'draft note restored');
    assert.equal(await dec.locator('textarea[aria-label="Note on Icon"]').inputValue(), 'Icon reads well');
    await shot(p, 'part-notes-submission-draft');
    await dec.locator('.decide-f button:has-text("Save")').click();
    const ev = await until(async () => (await app.run('review.get', { submission: rv.id })).events[0]);
    assert.equal(ev.scope, 'whole');
    assert.deepEqual(ev.partNotes, { model: 'Sole is too thick', icon: 'Icon reads well' });
    assert.equal(ev.comment, '');
    // A second decision without notes.
    await dec.locator('.comp-all button:has-text("Reject")').click();
    await dec.locator('.decide-f button:has-text("Save")').click();
    const evs = await until(async () => { const e = (await app.run('review.get', { submission: rv.id })).events; return e.length === 2 && e; });
    assert.deepEqual(evs[0].partNotes, {}, 'no notes recorded when none were written');
    await p.reload();
    const verdicts = p.locator('section[aria-label="Verdicts"]');
    await verdicts.locator('.part-note').first().waitFor();
    assert.equal(await verdicts.locator('.ritem').nth(0).locator('.part-note').count(), 0);
    assert.deepEqual(await notesShown(p, 'section[aria-label="Verdicts"] .ritem:nth-of-type(2)'), [['approved', 'Icon', 'Icon reads well'], ['changes', 'Model', 'Sole is too thick']]);
    await verdicts.screenshot({ path: join(OUT, 'part-notes-submission-verdicts.png') });
    await done(p);
  });
});
