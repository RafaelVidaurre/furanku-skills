import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync, unlinkSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { standardProject, makeProject, open, W, human, human2, agent, git, write, read, png, glb, rejects, cleanup, tmp } from './helpers.mjs';

const unit = (id) => ({ kind: 'unit', id });
const outfit = { kind: 'collection', id: 'outfit/iron' };
const files = (dir, rel) => (existsSync(join(dir, rel)) ? readdirSync(join(dir, rel), { recursive: true }).filter((f) => f.endsWith('.json')) : []);
const parts = (r) => Object.fromEntries(r.review.parts.map((p) => [p.id, p.verdict]));

test('T09 several views per item; approve-with-exceptions is one event; a later part-only verdict touches only that part', async () => {
  const dir = await standardProject();
  const app = await open(dir); const run = W(app);
  const sub = await run('review.submit', { title: 'Outfit pass', items: [
    { target: unit('armor/helm'), views: [{ part: 'model', caption: 'Helm · front' }, { part: 'model', caption: 'Helm · side', camera: { position: [2, 1, 0], target: [0, 0, 0] } }, { part: 'icon', caption: 'Helm · icon' }] },
    { target: outfit },
  ] });
  const rv = await app.run('review.get', { submission: sub.submission.id });
  assert.equal(rv.items[0].views.length, 3);
  assert.deepEqual(rv.items[0].views.map((v) => v.part), ['model', 'model', 'icon']);
  assert.ok(rv.items[0].views.every((v) => /^vw_/.test(v.id)));
  const item = rv.items[1];
  assert.deepEqual(item.parts.map((p) => p.id), ['member:armor/helm', 'member:armor/boots', 'preview']);
  await run('review.decide', { submission: rv.id, item: item.id, whole: 'approved', exceptions: { 'member:armor/boots': 'changes' }, comment: 'All good except boots' });
  const events = files(dir, `.catalog/reviews/${rv.id}/verdicts`);
  assert.equal(events.length, 1, 'compound approval is one atomic event');
  const ev = read(dir, `.catalog/reviews/${rv.id}/verdicts/${events[0]}`);
  assert.deepEqual(ev.scope, { kind: 'whole', parts: ['member:armor/helm', 'member:armor/boots', 'preview'] });
  assert.deepEqual(ev.exceptions, { 'member:armor/boots': 'changes' });
  assert.deepEqual(parts(await app.run('collection.get', { id: 'outfit/iron' })), { 'member:armor/helm': 'approved', 'member:armor/boots': 'changes', preview: 'approved' });
  await run('review.decide', { submission: rv.id, item: item.id, verdicts: { 'member:armor/boots': 'approved' } });
  assert.deepEqual(parts(await app.run('collection.get', { id: 'outfit/iron' })), { 'member:armor/helm': 'approved', 'member:armor/boots': 'approved', preview: 'approved' });
  // Collection-context verdicts do not cascade to the member units themselves.
  assert.equal((await app.run('unit.get', { id: 'armor/boots' })).review.summary.state, 'undecided');
  // Feedback-only observation on a part leaves verdicts unchanged.
  await run('note.create', { target: { kind: 'submission', id: rv.id, item: item.id, part: 'preview' }, body: 'Lighting looks flat' });
  assert.equal((await app.run('review.get', { submission: rv.id })).items[1].summary.state, 'approved');
  assert.equal((await app.run('review.get', { submission: rv.id })).observations.length, 1);
  await rejects(run('review.decide', { submission: rv.id, item: item.id, verdicts: { 'member:armor/coat': 'approved' } }), 'invalid');
  await rejects(run('review.decide', { submission: rv.id, item: item.id, whole: 'maybe' }), 'invalid');
  cleanup(dir);
});

test('T10 two reviewers on different branches: merge in either order yields the same latest-wins projection; ties are deterministic; alternate resolver needs no event changes', async () => {
  const dir = await standardProject();
  const base = await open(dir);
  const sub = await W(base)('review.submit', { items: [{ target: unit('armor/helm') }] });
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'submission');
  const rv = await base.run('review.get', { submission: sub.submission.id });
  const item = rv.items[0].id;
  git(dir, 'checkout', '-q', '-b', 'reviewer-a');
  await W(await open(dir), human)('review.decide', { submission: rv.id, item, verdicts: { model: 'approved' } });
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'a');
  git(dir, 'checkout', '-q', 'main'); git(dir, 'checkout', '-q', '-b', 'reviewer-b');
  await new Promise((r) => setTimeout(r, 15));
  await W(await open(dir), human2)('review.decide', { submission: rv.id, item, verdicts: { model: 'changes' } });
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'b');
  const projectionAfter = async (first, second) => {
    git(dir, 'checkout', '-q', '-B', `m-${first}`, first);
    git(dir, 'merge', '-q', '--no-edit', second);
    const app = await open(dir);
    const u = await app.run('unit.get', { id: 'armor/helm' });
    return { model: u.review.parts.find((p) => p.id === 'model'), history: u.history.length };
  };
  const ab = await projectionAfter('reviewer-a', 'reviewer-b');
  const ba = await projectionAfter('reviewer-b', 'reviewer-a');
  assert.equal(ab.model.verdict, 'changes'); assert.equal(ba.model.verdict, 'changes');
  assert.equal(ab.model.event.by.name, human2.name); assert.equal(ab.history, 2); assert.equal(ba.history, 2);
  // Tie on recorded time: identity decides, reproducibly.
  const evDir = join(dir, '.catalog/reviews', rv.id, 'verdicts');
  const evs = readdirSync(evDir).map((f) => read(dir, `.catalog/reviews/${rv.id}/verdicts/${f}`));
  for (const e of evs) writeFileSync(join(evDir, `${e.id}.json`), JSON.stringify({ ...e, at: '2026-01-01T00:00:00.000Z' }));
  const winner = evs.map((e) => e.id).sort().at(-1);
  for (let i = 0; i < 2; i++) assert.equal((await (await open(dir)).run('unit.get', { id: 'armor/helm' })).review.parts.find((p) => p.id === 'model').event.id, winner);
  // Alternate resolver from project configuration: most severe of each reviewer's latest.
  const before = readdirSync(evDir).map((f) => readFileSync(join(evDir, f), 'utf8'));
  for (const e of evs) writeFileSync(join(evDir, `${e.id}.json`), JSON.stringify({ ...e, at: e.verdicts.model === 'approved' ? '2026-02-01T00:00:00.000Z' : '2026-01-01T00:00:00.000Z' }));
  assert.equal((await (await open(dir)).run('unit.get', { id: 'armor/helm' })).review.parts.find((p) => p.id === 'model').verdict, 'approved', 'latest wins by default');
  write(dir, 'catalog.config.json', { version: 1, adapter: 'manifest', review: { resolver: 'strictest' } });
  assert.equal((await (await open(dir)).run('unit.get', { id: 'armor/helm' })).review.parts.find((p) => p.id === 'model').verdict, 'changes', 'strictest resolver');
  assert.equal(before.length, readdirSync(evDir).length);
  cleanup(dir);
});

test('T11 content changes keep verdicts, show them as changed, create no events; new members inherit nothing', async () => {
  const dir = await standardProject();
  const app = await open(dir); const run = W(app);
  await run('collection.create', { id: 'col/kit', name: 'Kit', members: ['armor/helm'] });
  await run('review.decideCurrent', { target: unit('armor/helm'), whole: 'approved' });
  await run('review.decideCurrent', { target: { kind: 'collection', id: 'col/kit' }, whole: 'approved' });
  const subsBefore = files(dir, '.catalog/reviews').length;
  write(dir, 'art/helm.png', png(4, 4, [10, 10, 250, 255]));
  write(dir, 'content/armor_helm.json', { ...read(dir, 'content/armor_helm.json'), attrs: { slot: 'Head', armor: 99 } });
  const u = await app.run('unit.get', { id: 'armor/helm' });
  assert.equal(u.unit.attrs.armor, 99);
  const icon = u.review.parts.find((p) => p.id === 'icon');
  assert.equal(icon.verdict, 'approved'); assert.equal(icon.changed, true);
  assert.equal(u.review.parts.find((p) => p.id === 'model').changed, false);
  assert.equal(u.review.parts.find((p) => p.id === 'attributes').changed, true);
  assert.equal(files(dir, '.catalog/reviews').length, subsBefore, 'no automatic review or invalidation');
  await run('collection.update', { id: 'col/kit', add: ['armor/coat'] });
  const kit = await app.run('collection.get', { id: 'col/kit' });
  assert.equal(kit.review.parts.find((p) => p.id === 'member:armor/coat').verdict, null, 'new member undecided');
  assert.equal(kit.review.parts.find((p) => p.id === 'member:armor/helm').verdict, 'approved');
  // Part identity: a newly linked visual role is a new, undecided part.
  write(dir, 'art/clip.mp4', Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(16)]));
  write(dir, 'content/armor_helm.json', { ...read(dir, 'content/armor_helm.json'), links: [...read(dir, 'content/armor_helm.json').links, { role: 'clip', asset: 'art/clip.mp4' }] });
  assert.equal((await app.run('unit.get', { id: 'armor/helm' })).review.parts.find((p) => p.id === 'clip').verdict, null);
  cleanup(dir);
});

test('T12 comparison sides resolve independently: relinked, removed, changed and missing evidence never fall back to current', async () => {
  const dir = await standardProject();
  const app = await open(dir); const run = W(app);
  const s1 = await run('review.submit', { items: [{ target: unit('armor/helm') }, { target: unit('armor/boots') }, { target: unit('armor/coat') }] });
  const r1 = await app.run('review.get', { submission: s1.submission.id });
  const [helm, boots, coat] = r1.items;
  // Identical complete evidence against current content.
  let c = await app.run('evidence.compare', { a: { submission: r1.id, item: helm.id, part: 'model' }, b: 'current' });
  assert.equal(c.identical, true);
  // Changed model bytes.
  write(dir, 'art/helm.glb', await glb({ size: 3, clips: ['Idle', 'Alert'] }));
  c = await app.run('evidence.compare', { a: { submission: r1.id, item: helm.id, part: 'model' }, b: 'current' });
  assert.equal(c.identical, false);
  assert.notEqual(c.rows[0].a.sha256, c.rows[0].b.sha256);
  assert.match(c.rows[0].a.url, /^\/media\/evidence\//); assert.match(c.rows[0].b.url, /^\/media\/asset\//);
  // The frozen side still yields the original bytes.
  const original = await app.evidenceMedia(r1.id, helm.id, 'model', '');
  assert.equal(original.sha256, helm.parts.find((p) => p.id === 'model').evidence.sha256);
  // Relinked role: the current side resolves the new asset, never the frozen path.
  write(dir, 'art/boots2.png', png(5, 5, [1, 1, 1, 255]));
  write(dir, 'content/armor_boots.json', { ...read(dir, 'content/armor_boots.json'), links: [{ role: 'icon', asset: 'art/boots2.png' }, { role: 'model', asset: 'art/boots.glb' }] });
  c = await app.run('evidence.compare', { a: { submission: r1.id, item: boots.id, part: 'icon' }, b: 'current' });
  assert.equal(c.rows[0].a.path, 'art/boots.png'); assert.equal(c.rows[0].b.path, 'art/boots2.png'); assert.equal(c.identical, false);
  // Removed entry: current side is missing; frozen side stays available.
  unlinkSync(join(dir, 'content/armor_coat.json'));
  c = await app.run('evidence.compare', { a: { submission: r1.id, item: coat.id, part: 'icon' }, b: 'current' });
  assert.equal(c.rows[0].a.status, 'ok'); assert.equal(c.rows[0].b.status, 'missing'); assert.equal(c.identical, false);
  // Missing frozen bytes are never treated as equal to anything.
  const s2 = await run('review.submit', { items: [{ target: unit('armor/helm') }] });
  const r2 = await app.run('review.get', { submission: s2.submission.id });
  const ev = r2.items[0].parts.find((p) => p.id === 'model').leaves[0];
  assert.equal(ev.storage, 'catalog', 'dirty model is copied into catalog evidence');
  unlinkSync(join(dir, `.catalog/evidence/${ev.sha256.slice(0, 2)}/${ev.sha256}.glb`));
  c = await app.run('evidence.compare', { a: { submission: r2.id, item: r2.items[0].id, part: 'model' }, b: 'current' });
  assert.equal(c.rows[0].a.status, 'missing'); assert.equal(c.identical, false);
  const r2b = await app.run('review.get', { submission: r2.id });
  assert.equal(r2b.items[0].parts.find((p) => p.id === 'model').leaves[0].status, 'missing');
  // Corrupted frozen bytes are explicit.
  const s3 = await run('review.submit', { items: [{ target: unit('armor/helm') }] });
  const r3 = await app.run('review.get', { submission: s3.submission.id });
  const l3 = r3.items[0].parts.find((p) => p.id === 'model').leaves[0];
  writeFileSync(join(dir, `.catalog/evidence/${l3.sha256.slice(0, 2)}/${l3.sha256}.glb`), 'tampered');
  c = await app.run('evidence.compare', { a: { submission: r3.id, item: r3.items[0].id, part: 'model' }, b: 'current' });
  assert.equal(c.rows[0].a.status, 'corrupt');
  // Two frozen sides with the same bytes are identical; the attributes diff is reported.
  const s4 = await run('review.submit', { items: [{ target: unit('armor/helm') }] });
  const r4 = await app.run('review.get', { submission: s4.submission.id });
  c = await app.run('evidence.compare', { a: { submission: r1.id, item: helm.id, part: 'icon' }, b: { submission: r4.id, item: r4.items[0].id, part: 'icon' } });
  assert.equal(c.identical, true);
  c = await app.run('evidence.compare', { a: { submission: r1.id, item: helm.id, part: 'attributes' }, b: 'current' });
  assert.equal(c.rows[0].a.kind, 'attributes'); assert.equal(c.identical, true);
  cleanup(dir);
});

test('T13 uncommitted work is captured as repository evidence and reopens exactly in a fresh clone; missing LFS data is a precise failure', async () => {
  const dir = await makeProject({ assets: { 'art/a.png': png(4, 4, [5, 5, 5, 255]), 'art/m.glb': await glb() }, units: [{ id: 'armor/a', type: 'armor', name: 'A', attrs: { armor: 1 }, links: [{ role: 'icon', asset: 'art/a.png' }, { role: 'model', asset: 'art/m.glb' }] }], commit: false });
  execFileSync('git', ['lfs', 'install', '--local'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['lfs', 'track', '*.glb'], { cwd: dir, stdio: 'ignore' });
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'initial');
  // Dirty definition and an untracked new asset.
  write(dir, 'art/new.png', png(7, 7, [9, 200, 9, 255]));
  write(dir, 'content/armor_a.json', { ...read(dir, 'content/armor_a.json'), attrs: { armor: 2 }, links: [{ role: 'icon', asset: 'art/new.png' }, { role: 'model', asset: 'art/m.glb' }] });
  const app = await open(dir);
  const s = await W(app)('review.submit', { items: [{ target: unit('armor/a') }] });
  const rv = await app.run('review.get', { submission: s.submission.id });
  const leaf = (pid) => rv.items[0].parts.find((p) => p.id === pid).leaves[0];
  assert.equal(leaf('icon').storage, 'catalog'); assert.equal(leaf('model').storage, 'git');
  assert.equal(leaf('attributes').attrs.armor, 2);
  assert.equal(rv.context.dirty > 0, true);
  const iconSha = leaf('icon').sha256;
  // Later source edits do not change the frozen evidence.
  write(dir, 'art/new.png', png(7, 7, [255, 0, 0, 255]));
  write(dir, 'content/armor_a.json', { ...read(dir, 'content/armor_a.json'), attrs: { armor: 3 } });
  assert.equal((await app.evidenceMedia(rv.id, rv.items[0].id, 'icon', '')).sha256, iconSha);
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'work + catalog records');
  // Fresh clone with LFS objects available locally.
  const clone = join(tmp('cc-clone-'), 'c');
  execFileSync('git', ['clone', '-q', dir, clone]);
  const ca = await open(clone);
  const crv = await ca.run('review.get', { submission: rv.id });
  const cl = (pid) => crv.items[0].parts.find((p) => p.id === pid).leaves[0];
  assert.equal(cl('icon').status, 'ok'); assert.equal(cl('icon').sha256, iconSha);
  assert.equal((await ca.evidenceMedia(rv.id, rv.items[0].id, 'icon', '')).sha256, iconSha);
  assert.equal(cl('attributes').attrs.armor, 2);
  assert.equal(cl('model').status, 'ok');
  // Clone without LFS data: the model evidence fails precisely; history stays readable.
  const bare = join(tmp('cc-nolfs-'), 'c');
  execFileSync('git', ['clone', '-q', dir, bare], { env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' } });
  execFileSync('rm', ['-rf', join(bare, '.git/lfs')]);
  const na = await open(bare);
  const nrv = await na.run('review.get', { submission: rv.id });
  const model = nrv.items[0].parts.find((p) => p.id === 'model').leaves[0];
  assert.equal(model.status, 'missing'); assert.match(model.error, /LFS object/);
  assert.equal(nrv.items[0].parts.find((p) => p.id === 'icon').leaves[0].status, 'ok');
  cleanup(dir, clone, bare);
});

test('Catalog Review reuses a waiting item with identical evidence, otherwise submits current content', async () => {
  const dir = await standardProject();
  const app = await open(dir); const run = W(app);
  const s = await run('review.submit', { items: [{ target: unit('armor/helm') }] });
  const r = await run('review.decideCurrent', { target: unit('armor/helm'), verdicts: { icon: 'approved' } });
  assert.equal(r.createdSubmission, false); assert.equal(r.submission.id, s.submission.id);
  write(dir, 'art/helm.png', png(4, 4, [0, 0, 0, 255]));
  const r2 = await run('review.decideCurrent', { target: unit('armor/helm'), verdicts: { icon: 'changes' } }, 'quick-1');
  assert.equal(r2.createdSubmission, true);
  const r3 = await run('review.decideCurrent', { target: unit('armor/helm'), verdicts: { icon: 'changes' } }, 'quick-1');
  assert.equal(r3.event.id, r2.event.id, 'retry with the same request id records once');
  assert.equal((await app.run('reviews.list', { state: 'all' })).total, 2);
  // Multi-role part identity: a different concept file is a different part.
  const u = await app.run('unit.get', { id: 'armor/helm' });
  assert.ok(u.review.parts.some((p) => p.id === 'concept:art/sheet.png'));
  cleanup(dir);
});

test('Queue counts distinguish waiting, approved, changes and rejected', async () => {
  const dir = await standardProject();
  const app = await open(dir); const run = W(app);
  const s = await run('review.submit', { items: [{ target: unit('armor/helm') }, { target: unit('armor/boots') }, { target: unit('armor/coat') }, { target: unit('lore/origin') }] });
  const rv = await app.run('review.get', { submission: s.submission.id });
  await run('review.decide', { submission: rv.id, item: rv.items[0].id, whole: 'approved' });
  await run('review.decide', { submission: rv.id, item: rv.items[1].id, whole: 'rejected' });
  await run('review.decide', { submission: rv.id, item: rv.items[2].id, whole: 'changes' });
  const v = await app.run('review.get', { submission: rv.id });
  assert.deepEqual(v.counts, { items: 4, waiting: 1, approved: 1, changes: 1, rejected: 1 });
  assert.deepEqual(v.items.map((i) => i.state), ['approved', 'rejected', 'changes', 'undecided']);
  assert.equal((await app.run('reviews.list', { state: 'rejected' })).total, 1);
  assert.equal((await app.run('reviews.list', { state: 'waiting' })).total, 1);
  // The metadata-only unit has an attributes part only.
  assert.deepEqual(v.items[3].parts.map((p) => p.id), ['attributes']);
  cleanup(dir);
});

test('Part notes stay with their decided part through recording, reload, history and retries; notes on undecided or unknown parts are refused', async () => {
  const dir = await standardProject();
  const app = await open(dir); const run = W(app);
  const s = await run('review.submit', { items: [{ target: unit('armor/helm') }] });
  const rv = await app.run('review.get', { submission: s.submission.id });
  const item = rv.items[0].id;
  const verdictFiles = () => files(dir, `.catalog/reviews/${rv.id}/verdicts`);
  // Unknown part, undecided part and non-text notes are refused before any record is written.
  await rejects(run('review.decide', { submission: rv.id, item, verdicts: { icon: 'changes' }, partNotes: { 'concept:nope': 'x' } }), 'invalid');
  await rejects(run('review.decide', { submission: rv.id, item, verdicts: { icon: 'changes' }, partNotes: { model: 'Not decided here' } }), 'invalid');
  await rejects(run('review.decide', { submission: rv.id, item, verdicts: { icon: 'changes' }, partNotes: { icon: 5 } }), 'invalid');
  await rejects(run('review.decideCurrent', { target: unit('armor/boots'), verdicts: { icon: 'changes' }, partNotes: { model: 'x' } }), 'invalid');
  assert.equal(verdictFiles().length, 0);
  assert.equal((await app.run('reviews.list', { state: 'all' })).total, 1, 'an invalid quick review creates no submission');

  // Whole approval with a change and a rejection, two distinct part notes, a blank one and an overall comment.
  await run('review.decide', { submission: rv.id, item, whole: 'approved', exceptions: { icon: 'changes', model: 'rejected' }, comment: 'Overall close', partNotes: { icon: '  Outline too thin  ', model: 'Wrong silhouette', attributes: '   ' } }, 'pn-1');
  const ev = read(dir, `.catalog/reviews/${rv.id}/verdicts/${verdictFiles()[0]}`);
  assert.deepEqual(ev.partNotes, { icon: 'Outline too thin', model: 'Wrong silhouette' });
  assert.equal(ev.comment, 'Overall close');
  // Retrying the request records once; reusing its id with other notes is a conflict.
  await run('review.decide', { submission: rv.id, item, whole: 'approved', exceptions: { icon: 'changes', model: 'rejected' }, comment: 'Overall close', partNotes: { icon: '  Outline too thin  ', model: 'Wrong silhouette', attributes: '   ' } }, 'pn-1');
  await rejects(run('review.decide', { submission: rv.id, item, whole: 'approved', exceptions: { icon: 'changes', model: 'rejected' }, partNotes: { icon: 'Other' } }, 'pn-1'), 'conflict');
  assert.equal(verdictFiles().length, 1);
  // A later part-only approval with its own note; an event without notes stays readable.
  await run('review.decide', { submission: rv.id, item, verdicts: { icon: 'approved' }, partNotes: { icon: 'Fixed outline' } });
  await run('review.decide', { submission: rv.id, item, verdicts: { attributes: 'approved' } });

  const fresh = await open(dir);
  const u = await fresh.run('unit.get', { id: 'armor/helm' });
  const part = (id) => u.review.parts.find((p) => p.id === id);
  assert.equal(part('icon').event.partNotes.icon, 'Fixed outline', 'the deciding event carries the current part note');
  assert.equal(part('model').event.partNotes.model, 'Wrong silhouette');
  assert.equal(part('attributes').event.partNotes.attributes, undefined);
  assert.deepEqual(u.history.map((e) => e.partNotes), [{}, { icon: 'Fixed outline' }, { icon: 'Outline too thin', model: 'Wrong silhouette' }]);
  assert.deepEqual(u.history[2].verdicts, { icon: 'changes', model: 'rejected', 'concept:art/sheet.png': 'approved', attributes: 'approved' });
  assert.equal(u.history[2].comment, 'Overall close', 'the overall comment stays separate from part notes');
  const asset = await fresh.run('asset.get', { id: 'art/helm.glb' });
  assert.deepEqual(asset.verdicts.map((v) => [v.verdict, v.note]), [['rejected', 'Wrong silhouette']]);
  assert.equal((await fresh.run('problems', {})).problems.length, 0);

  // A record whose note addresses a part it does not decide is excluded as a problem.
  const bad = read(dir, `.catalog/reviews/${rv.id}/verdicts/${verdictFiles().find((f) => read(dir, `.catalog/reviews/${rv.id}/verdicts/${f}`).verdicts?.attributes)}`);
  write(dir, `.catalog/reviews/${rv.id}/verdicts/${bad.id}.json`, { ...bad, partNotes: { model: 'Stray' } });
  assert.match((await (await open(dir)).run('problems', {})).problems.map((p) => p.error).join('\n'), /part notes are invalid/);
  cleanup(dir);
});

test('Before/after views: a view compares its evidence with a frozen project file or earlier evidence of the same kind', async () => {
  const dir = await standardProject();
  const app = await open(dir); const run = W(app, agent);
  const sha = (b) => execFileSync('shasum', ['-a', '256'], { input: b }).toString().split(' ')[0];
  const old = png(4, 4, [10, 10, 10, 255]);
  write(dir, 'art/scratch/helm-icon-v1.png', old); // a render of the earlier version, not a catalog asset
  const s1 = await run('review.submit', { items: [{ target: unit('armor/helm'), views: [
    { part: 'icon', caption: 'Icon, same framing', before: { path: 'art/scratch/helm-icon-v1.png', label: 'v1' }, afterLabel: 'v2' },
    { part: 'model', caption: 'Model' },
  ] }] });
  let rv = await app.run('review.get', { submission: s1.submission.id });
  const [cmp, plain] = rv.items[0].views;
  assert.equal(cmp.afterLabel, 'v2');
  assert.deepEqual({ ...cmp.before, url: !!cmp.before.url }, { label: 'v1', from: null, kind: 'image', path: 'art/scratch/helm-icon-v1.png', sha256: sha(old), storage: 'catalog', status: 'ok', url: true });
  assert.equal(plain.before, undefined);
  // The before side is frozen: changing or deleting the file later does not change what reviewers see.
  write(dir, 'art/scratch/helm-icon-v1.png', png(4, 4, [99, 99, 99, 255]));
  assert.equal((await app.beforeMedia(rv.id, rv.items[0].id, cmp.id)).sha256, sha(old));

  // Earlier frozen evidence as the before side: the helm model of the first submission, labelled by default.
  write(dir, 'art/helm.glb', await glb({ size: 3 }));
  const s2 = await run('review.submit', { items: [{ target: unit('armor/helm'), parts: ['model'], views: [{ part: 'model', caption: 'Bigger helm', before: { submission: rv.id, item: rv.items[0].id, part: 'model' } }] }] });
  const v2 = (await app.run('review.get', { submission: s2.submission.id })).items[0].views[0];
  assert.deepEqual(v2.before.from, { submission: rv.id, item: rv.items[0].id, part: 'model' });
  assert.equal(v2.before.label, 'Before'); assert.equal(v2.afterLabel, 'After');
  assert.equal(v2.before.sha256, rv.items[0].parts.find((p) => p.id === 'model').evidence.sha256);

  // A collection member view compares its named leaf.
  const s3 = await run('review.submit', { items: [{ target: { kind: 'collection', id: 'outfit/iron' }, parts: ['member:armor/helm'], views: [{ part: 'member:armor/helm', leaf: 'armor/helm/icon', caption: 'Helm icon in the outfit', before: { path: 'art/boots.png' } }] }] });
  assert.equal((await app.run('review.get', { submission: s3.submission.id })).items[0].views[0].before.status, 'ok');

  // Every refusal leaves no record.
  const count = (await app.run('reviews.list', { state: 'all' })).total;
  const helm = (view) => run('review.submit', { items: [{ target: unit('armor/helm'), views: [view] }] });
  await rejects(helm({ part: 'model', before: { path: 'art/helm.png' } }), 'invalid'); // image before a model
  await rejects(helm({ part: 'icon', before: { path: 'content/armor_helm.json' } }), 'forbidden'); // outside the asset roots
  await rejects(helm({ part: 'icon', before: { path: 'art/missing.png' } }), 'invalid');
  await rejects(helm({ part: 'attributes', before: { path: 'art/helm.png' } }), 'invalid');
  await rejects(helm({ part: 'icon', before: { path: 'art/helm.png', submission: rv.id, item: rv.items[0].id, part: 'icon' } }), 'invalid');
  await rejects(helm({ part: 'icon', afterLabel: 'After' }), 'invalid');
  await rejects(helm({ part: 'icon', before: { submission: rv.id, item: rv.items[0].id, part: 'attributes' } }), 'invalid');
  await rejects(run('review.submit', { items: [{ target: { kind: 'collection', id: 'outfit/iron' }, views: [{ part: 'member:armor/helm', before: { path: 'art/boots.png' } }] }] }), 'invalid'); // no leaf named
  assert.equal((await app.run('reviews.list', { state: 'all' })).total, count);

  // The record survives a fresh open (schema validation) unchanged.
  const again = await open(dir);
  assert.equal((await again.run('review.get', { submission: rv.id })).items[0].views[0].before.sha256, sha(old));
  assert.equal((await again.run('context', {})).problems, 0, 'the before record passes validation');
  cleanup(dir);
});
