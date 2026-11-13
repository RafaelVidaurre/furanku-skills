// Real Chromium acceptance for Markdown submission notes: the review page renders the formatting an
// agent writes and drops anything that could run code or load content. Screenshot in test-output/browser.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { standardProject, open, W, agent, cleanup } from './helpers.mjs';
import { startServer } from '../src/server/server.mjs';
import { launchBrowser } from '../src/browser.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../test-output/browser');
mkdirSync(OUT, { recursive: true });
let dir, app, server, browser;

// Written the way the jam-catalog skill asks: what to decide, what changed and why, known limits.
const NOTE = `Answer to the v001 review ("fix the **skin patches** on the hair"). The scalp showed through above the ears, and the hair edge ran in steps along the quad grid.

### Decide
1. Topology: hair edge now follows the painted hairline
2. Textures rebaked on the new UVs; compare the *Hairline* view with v001

### Known limits
- Faint line at the forehead when the hair is removed
- Not yet rendered in the engine; same helmet slot as [boots](#/content/u/armor%2Fboots), see the [brief](https://example.com/brief)`;
// HTML blocks, inline HTML with handlers and styles, a javascript: link and markup in a code span.
const HOSTILE = `Inert: <script>window.__pwned = 1</script><img src=x onerror="window.__pwned = 2"> <a href="#" onclick="window.__pwned = 3" style="color:red">click</a> [js](javascript:window.__pwned=4) \`<b>code</b>\`

<script>window.__pwned = 5</script>

<iframe src="https://example.com"></iframe>`;

before(async () => {
  dir = await standardProject();
  app = await open(dir);
  server = await startServer({ app, port: 0 });
  browser = await launchBrowser();
});
after(async () => { await browser?.close(); await server?.close(); cleanup(dir); });

describe('Markdown submission note', () => {
  async function show(note) {
    const s = await W(app, agent)('review.submit', { title: 'Helm hair fix', note, items: [{ target: { kind: 'unit', id: 'armor/helm' } }] });
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    p.errors = [];
    p.on('pageerror', (e) => p.errors.push(String(e)));
    await p.goto(`${server.url}#/reviews/s/${s.submission.id}`);
    const md = p.locator('.md[aria-label="Submission note"]');
    await md.waitFor();
    return { p, md };
  }
  async function done(p) { const errors = p.errors; await p.close(); assert.deepEqual(errors, [], 'no page errors'); }

  it('renders headings, lists, emphasis and links; catalog links stay in the app, others open a new tab', async () => {
    const { p, md } = await show(NOTE);
    assert.deepEqual(await md.locator('h3').allTextContents(), ['Decide', 'Known limits']);
    assert.equal(await md.locator('ol > li').count(), 2);
    assert.equal(await md.locator('ul > li').count(), 2);
    assert.equal(await md.locator('strong').textContent(), 'skin patches');
    assert.equal(await md.locator('em').textContent(), 'Hairline');
    const links = await md.locator('a').evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')]));
    assert.deepEqual(links, [['boots', '#/content/u/armor%2Fboots', null, null], ['brief', 'https://example.com/brief', '_blank', 'noopener noreferrer']]);
    await p.screenshot({ path: join(OUT, 'markdown-submission-note.png') });
    await md.locator('a', { hasText: 'boots' }).click();
    await p.waitForFunction(() => location.hash === '#/content/u/armor%2Fboots');
    await done(p);
  });

  it('keeps hostile text inert: no scripts, images, handlers, styles or javascript: links; code spans show markup as text', async () => {
    const { p, md } = await show(HOSTILE);
    assert.equal(await md.locator('script, img, iframe, [onerror], [onclick], [style]').count(), 0);
    assert.equal(await md.locator('a[href^="javascript"]').count(), 0);
    assert.equal(await md.locator('code').textContent(), '<b>code</b>');
    await md.locator('a', { hasText: 'js' }).click();
    await md.locator('a', { hasText: 'click' }).click();
    assert.equal(await p.evaluate(() => window.__pwned), undefined, 'no injected code ran');
    await done(p);
  });
});
