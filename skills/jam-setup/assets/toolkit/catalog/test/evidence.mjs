#!/usr/bin/env node
// Capture the production UI on a sample project at desktop and narrow widths for visual review.
//   node test/evidence.mjs <project-root> [out-dir]
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCatalog } from '../src/core/app.mjs';
import { startServer } from '../src/server/server.mjs';
import { launchBrowser } from '../src/browser.mjs';

const [root, outArg] = process.argv.slice(2);
const out = resolve(outArg ?? join(dirname(fileURLToPath(import.meta.url)), '../test-output/evidence'));
mkdirSync(out, { recursive: true });
const app = await openCatalog({ root });
const server = await startServer({ app, port: 0 });
const browser = await launchBrowser();
const errors = [];
const subs = (await app.run('reviews.list', { state: 'all' })).items;
const sub = (title) => subs.find((s) => s.title === title);
const set = await app.run('review.get', { submission: sub('Ironclad Set').id });
const helm = await app.run('review.get', { submission: sub('Ironclad Helm first pass').id });
const crest = await app.run('review.get', { submission: sub('Helm crest').id });
const views = [
  ['01-content-grid', '#/content'],
  ['02-unit-multi-visual', '#/content/u/gear%2Fironclad-helm?part=model'],
  ['03-asset-shared', '#/assets/a/art%2Fconcepts%2Fironclad_sheet.png'],
  ['04-collection-preview', '#/collections/c/set%2Fironclad'],
  ['05-member-context', '#/collections/c/set%2Fironclad/gear%2Fironclad-greaves'],
  ['06-review-queue', '#/reviews'],
  ['07-submission-item', `#/reviews/s/${set.id}/${set.items[0].id}`],
  ['08-compare-3d', `#/content/u/gear%2Fironclad-helm?cmp=${helm.id}~${helm.items[0].id}~model`],
  ['09-compare-image', `#/content/u/gear%2Fironclad-helm?cmp=${helm.id}~${helm.items[0].id}~icon`],
  ['10-compare-attributes', `#/content/u/gear%2Fironclad-helm?cmp=${helm.id}~${helm.items[0].id}~attributes`],
  ['11-notes', '#/notes'],
  ['12-organize', '#/organize'],
  ['13-textured-animated-model', '#/content/u/creature%2Fmire-lurker?part=model'],
  ['14-evidence-views', `#/reviews/s/${crest.id}/${crest.items[0].id}?view=${crest.items[0].views[1].id}`],
  ['15-missing-filter', '#/content?f.visual=missing%253Aicon%2Cmissing%253Amodel'],
];
for (const [w, h, suffix] of [[1440, 900, ''], [390, 844, '-narrow']]) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  p.on('pageerror', (e) => errors.push(`${suffix}: ${e}`));
  for (const [name, hash] of views) {
    await p.goto(`${server.url}${hash}`);
    await p.evaluate(() => window.catalogViewer?.settled(15000));
    await p.waitForTimeout(700);
    await p.screenshot({ path: join(out, `${name}${suffix}.png`) });
  }
  await p.close();
}
await browser.close(); await server.close();
console.log(JSON.stringify({ out, views: views.length * 2, pageErrors: errors }, null, 2));
