#!/usr/bin/env node
// Create the Hollowmere sample project: a separate Git repository with manifest-adapter content,
// procedural art, two art passes, catalog records made through the public actions, and some
// uncommitted work. For acceptance testing and demonstration only.
//   node tools/jam/catalog/examples/hollowmere/create.mjs <empty-dir> [--no-video]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { schema, assets, units, collections } from './data.mjs';
import { renderAssets, hasFfmpeg } from './art.mjs';
import { launchBrowser } from '../../src/browser.mjs';
import { openCatalog } from '../../src/core/app.mjs';

const [dirArg, ...flags] = process.argv.slice(2);
if (!dirArg) { console.error('usage: create.mjs <empty-dir> [--no-video]'); process.exit(2); }
const dir = path.resolve(dirArg);
if (fs.existsSync(dir) && fs.readdirSync(dir).length) { console.error(`${dir} is not empty`); process.exit(2); }
fs.mkdirSync(dir, { recursive: true });
const videos = !flags.includes('--no-video') && hasFfmpeg();

const git = (...args) => execFileSync('git', ['-c', 'user.name=Hollowmere Dev', '-c', 'user.email=dev@hollowmere.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'pipe' });
const write = (rel, value) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`); };
const slug = (id) => id.split('/').pop();
const projectCollections = collections.filter((c) => c.kind === 'armor-set');

// ---- Project files (what a real project would already version) ----
write('catalog.config.json', { version: 1, adapter: 'manifest', options: { manifest: 'catalog.manifest.json' }, review: { resolver: 'latest' } });
write('catalog.manifest.json', {
  version: 1, project: schema.project, assetRoots: ['art'],
  types: schema.types, collectionKinds: schema.collectionKinds,
  assets: assets.map((a) => ({ id: a.id, path: a.id, kind: a.kind, ...(a.tags ? { tags: a.tags } : {}), ...(a.category ? { category: a.category } : {}) })),
  unitFiles: ['content'],
  collections: projectCollections.map((c) => ({ id: c.id, name: c.name, kind: c.kind, category: c.category, tags: c.tags, members: c.members })),
});
const unitFile = (u, attrs = u.attrs) => write(`content/${u.type}/${slug(u.id)}.json`, { id: u.id, type: u.type, name: u.name, attrs, links: u.links, tags: u.tags, category: u.category });
for (const u of units) unitFile(u, u.id === 'gear/ironclad-helm' ? { ...u.attrs, armor: 16 } : u.attrs);
write('.gitattributes', '*.png binary\n*.glb binary\n*.mp4 binary\n');

const browser = await launchBrowser();
const version = (i) => assets.filter((a) => a.versions[Math.min(i, a.versions.length - 1)] && (i === 0 || a.versions.length > i)).map((a) => ({ path: a.id, spec: a.versions[Math.min(i, a.versions.length - 1)] }));
await renderAssets(version(0), dir, browser, { videos });
git('init', '-q', '-b', 'main');
git('add', '-A'); git('commit', '-q', '-m', 'Initial content');

// ---- Catalog work through the public actions ----
const app = await openCatalog({ root: dir });
const mika = { name: 'Mika Sato', kind: 'human' }, ana = { name: 'Ana Ruiz', kind: 'human' }, jules = { name: 'Jules Okafor', kind: 'human' }, bot = { name: 'art-check', kind: 'agent' };
let n = 0;
const act = (actor, name, input) => app.run(name, input, { actor, requestId: `sample-${++n}` });
const unit = (id) => ({ kind: 'unit', id });

for (const c of collections.filter((x) => x.kind !== 'armor-set')) {
  await act(c.kind ? jules : mika, 'collection.create', { id: c.id, name: c.name, kind: c.kind, category: c.category, tags: c.tags, members: c.members.map((m) => ({ ...m })) });
}
await act(mika, 'category.create', { path: 'Milestones/Beta' });
await act(ana, 'organize.bulk', { targets: ['gear/ironclad-greaves', 'gear/ashen-sabatons', 'creature/stone-warden'].map(unit), addTags: ['needs-art'] });

const s1 = await act(mika, 'review.submit', { title: 'Ironclad Helm first pass', items: [{ target: unit('gear/ironclad-helm') }] });
const r1 = await app.run('review.get', { submission: s1.submission.id });
await act(mika, 'review.decide', { submission: r1.id, item: r1.items[0].id, whole: 'approved' });

const s2 = await act(mika, 'review.submit', { title: 'Ironclad Set', items: [{ target: { kind: 'collection', id: 'set/ironclad' } }] });
const r2 = await app.run('review.get', { submission: s2.submission.id });
await act(mika, 'review.decide', { submission: r2.id, item: r2.items[0].id, whole: 'approved', exceptions: { 'member:gear/ironclad-greaves': 'changes' }, comment: 'Greaves are too bulky next to the cuirass.' });

const s3 = await act(jules, 'review.submit', { title: 'Mire creatures', items: [{ target: unit('creature/mire-lurker') }, { target: unit('creature/bog-toad') }, { target: { kind: 'collection', id: 'enc/mire-ambush' } }] });
const r3 = await app.run('review.get', { submission: s3.submission.id });
await act(bot, 'review.decide', { submission: r3.id, item: r3.items[0].id, verdicts: { portrait: 'approved', model: 'approved' }, comment: 'Portrait 512×512 and model within the creature budget.' });
await act(jules, 'review.decide', { submission: r3.id, item: r3.items[0].id, verdicts: { portrait: 'changes' }, comment: 'Eyes need to read from across the swamp.' });

const s4 = await act(ana, 'review.submit', { title: 'Ember Burst', items: [{ target: unit('ability/ember-burst') }] });
const r4 = await app.run('review.get', { submission: s4.submission.id });
await act(ana, 'review.decide', { submission: r4.id, item: r4.items[0].id, whole: 'approved', exceptions: { vfx: 'changes' }, comment: 'Burst is too slow for an 8 s cooldown.' });
const vfxNote = await act(ana, 'note.create', { target: { ...unit('ability/ember-burst'), part: 'vfx' }, body: 'Needs a faster start.' });

const s5 = await act(jules, 'review.submit', { title: 'Rations', items: [{ target: unit('consumable/trail-ration') }, { target: unit('consumable/stale-ration') }] });
const r5 = await app.run('review.get', { submission: s5.submission.id });
await act(jules, 'review.decide', { submission: r5.id, item: r5.items[0].id, whole: 'approved' });

const s6 = await act(ana, 'review.submit', { title: 'Wayfarer Set', items: [{ target: { kind: 'collection', id: 'set/wayfarer' } }] });
const r6 = await app.run('review.get', { submission: s6.submission.id });
await act(ana, 'review.decide', { submission: r6.id, item: r6.items[0].id, verdicts: { 'member:gear/wayfarer-hood': 'approved' } });

await act(ana, 'note.create', { target: { kind: 'asset', id: 'art/concepts/ironclad_sheet.png' }, body: 'Sheet still shows the old rivet pattern on the gauntlets.' });
await act(jules, 'note.create', { target: { kind: 'collection', id: 'enc/lurker-den' }, body: 'Four lurkers plus the matriarch overwhelms a tier 2 player.' });
await act(mika, 'note.create', { target: unit('creature/stone-warden'), body: 'Model is scheduled after the highlands blockout.' });
await act(bot, 'note.create', { target: unit('consumable/stale-ration'), body: 'Shares its icon with Trail Ration. Players may not tell them apart in the inventory.' });

// ---- Art pass 2 (second commit) ----
await renderAssets(version(1), dir, browser, { videos });
unitFile(units.find((u) => u.id === 'gear/ironclad-helm'));
git('add', '-A', '--', 'art', 'content'); git('commit', '-q', '-m', 'Art pass 2: helm crest, slimmer greaves, faster ember burst');

const s7 = await act(ana, 'review.submit', { title: 'Helm crest', items: [{ target: unit('gear/ironclad-helm'), parts: ['model'], views: [{ part: 'model', caption: 'Ironclad Helm · crest, front' }, { part: 'model', caption: 'Ironclad Helm · crest, side', camera: { position: [0.9, 1.75, 0], target: [0, 1.62, 0] } }] }] });
const r7 = await app.run('review.get', { submission: s7.submission.id });
await act(ana, 'review.decide', { submission: r7.id, item: r7.items[0].id, verdicts: { model: 'changes' }, comment: 'Crest breaks the silhouette at gameplay distance. Try a lower fin.' });
const s8 = await act(mika, 'review.submit', { title: 'Ember Burst retime', items: [{ target: unit('ability/ember-burst'), parts: ['vfx'] }], supersedes: s4.submission.id });
const r8 = await app.run('review.get', { submission: s8.submission.id });
await act(mika, 'review.decide', { submission: r8.id, item: r8.items[0].id, verdicts: { vfx: 'approved' } });
await act(mika, 'note.resolve', { id: vfxNote.note.id, explanation: 'Retimed in art pass 2.' });
await act(mika, 'note.create', { target: { ...unit('gear/ironclad-greaves'), part: 'icon' }, body: 'No icon yet. Placeholder from the cuirass is fine for now.' });
git('add', '-A', '--', '.catalog'); git('commit', '-q', '-m', 'Catalog review records');

// ---- Uncommitted work ----
const frost = units.find((u) => u.id === 'ability/frost-lance');
unitFile(frost, { ...frost.attrs, damage: 35 });
await act(jules, 'review.submit', { title: 'Frost Lance balance', items: [{ target: unit('ability/frost-lance') }] });
await act(jules, 'note.create', { target: unit('ability/frost-lance'), body: 'Damage bump needs a matching effect pass.' });

await browser.close();
const ctx = (await app.run('context', {})).counts;
console.log(JSON.stringify({ created: dir, units: ctx.units, collections: ctx.collections, assets: ctx.assets, submissions: ctx.submissions, openNotes: ctx.openNotes, videos, serve: `node tools/jam/catalog/bin/catalog.mjs serve --root ${dir}` }, null, 2));
