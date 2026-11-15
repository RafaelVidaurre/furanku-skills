import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { standardProject, open, W, human, human2, agent, git, rejects, cleanup } from './helpers.mjs';

const noteFiles = (dir) => (existsSync(join(dir, '.catalog/notes')) ? readdirSync(join(dir, '.catalog/notes')) : []);

test('T07 note lifecycle: create, edit, list, deal with, reopen, clear; reading never changes records', async () => {
  const dir = await standardProject();
  const app = await open(dir); const run = W(app, agent);
  const { note } = await run('note.create', { target: { kind: 'unit', id: 'armor/helm', part: 'model' }, body: 'Visor too thin' }, 'r1');
  assert.equal(note.by.kind, 'agent');
  const file = join(dir, '.catalog/notes', `${note.id}.json`);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).body, 'Visor too thin');
  const before = readFileSync(file, 'utf8');
  for (let i = 0; i < 3; i++) { await app.run('notes.list', {}); await app.run('unit.get', { id: 'armor/helm' }); }
  assert.equal(readFileSync(file, 'utf8'), before, 'reading does not change the note');
  const edited = (await run('note.edit', { id: note.id, body: 'Visor too thin at 20 m', expectedRevision: 1 })).note;
  assert.equal(edited.revision, 2);
  const inbox = await app.run('notes.list', { state: 'open' });
  assert.deepEqual(inbox.notes.map((n) => n.id), [note.id]);
  assert.equal(inbox.notes[0].partLabel, 'Model');
  const resolved = (await run('note.resolve', { id: note.id, explanation: 'Widened', expectedRevision: 2 })).note;
  assert.equal(resolved.resolved.explanation, 'Widened');
  assert.equal((await app.run('notes.list', { state: 'open' })).total, 0);
  assert.equal((await app.run('notes.list', { state: 'resolved' })).total, 1);
  await run('note.reopen', { id: note.id, expectedRevision: 3 });
  assert.equal((await app.run('notes.list', {})).total, 1);
  await run('note.delete', { id: note.id, expectedRevision: 4 });
  assert.equal(noteFiles(dir).length, 0);
  // No review, issue or reply records were created by any of this.
  assert.ok(!existsSync(join(dir, '.catalog/reviews')));
  cleanup(dir);
});

test('T08 concurrent edits with the same expected revision: one wins, the other conflicts with its text retained', async () => {
  const dir = await standardProject();
  const a = await open(dir); const b = await open(dir);
  const { note } = await W(a)('note.create', { target: { kind: 'unit', id: 'armor/helm' }, body: 'Original' });
  const results = await Promise.allSettled([
    W(a, human)('note.edit', { id: note.id, body: 'Edit from A', expectedRevision: 1 }),
    W(b, human2)('note.edit', { id: note.id, body: 'Edit from B', expectedRevision: 1 }),
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  const bad = results.filter((r) => r.status === 'rejected');
  assert.equal(ok.length, 1); assert.equal(bad.length, 1);
  assert.equal(bad[0].reason.code, 'conflict');
  assert.equal(bad[0].reason.details.current.body, ok[0].value.note.body, 'conflict reports the winning text so the loser can merge');
  cleanup(dir);
});

test('T08 independent note additions on two branches merge without ID or file collisions', async () => {
  const dir = await standardProject();
  git(dir, 'checkout', '-q', '-b', 'left');
  const left = await open(dir);
  await W(left)('note.create', { target: { kind: 'unit', id: 'armor/helm' }, body: 'Left note' });
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'left note');
  git(dir, 'checkout', '-q', 'main'); git(dir, 'checkout', '-q', '-b', 'right');
  const right = await open(dir);
  await W(right)('note.create', { target: { kind: 'unit', id: 'armor/helm' }, body: 'Right note' });
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'right note');
  git(dir, 'merge', '-q', '--no-edit', 'left');
  const merged = await open(dir);
  const notes = (await merged.run('notes.list', {})).notes.map((n) => n.body).sort();
  assert.deepEqual(notes, ['Left note', 'Right note']);
  assert.equal((await merged.run('problems', {})).problems.length, 0);
  cleanup(dir);
});

test('T22 malformed and conflicted records are reported and skipped; valid notes survive', async () => {
  const dir = await standardProject();
  const app = await open(dir); const run = W(app);
  const keep = (await run('note.create', { target: { kind: 'unit', id: 'armor/helm' }, body: 'Valid' })).note;
  const broken = (await run('note.create', { target: { kind: 'unit', id: 'armor/boots' }, body: 'Will conflict' })).note;
  writeFileSync(join(dir, '.catalog/notes', `${broken.id}.json`), '<<<<<<< HEAD\n{"body":"a"}\n=======\n{"body":"b"}\n>>>>>>> other\n');
  writeFileSync(join(dir, '.catalog/notes', 'nt_garbage.json'), '{not json');
  const list = await app.run('notes.list', {});
  assert.deepEqual(list.notes.map((n) => n.id), [keep.id]);
  const problems = (await app.run('problems', {})).problems;
  assert.ok(problems.some((p) => /merge conflict/.test(p.error) && p.source.includes(broken.id)));
  assert.ok(problems.some((p) => /invalid JSON/.test(p.error)));
  await rejects(run('note.edit', { id: broken.id, body: 'x' }), 'not_found');
  cleanup(dir);
});

test('Request identity: a retried note creation records once; reuse with different input is refused', async () => {
  const dir = await standardProject();
  const app = await open(dir); const run = W(app);
  const first = await run('note.create', { target: { kind: 'unit', id: 'armor/helm' }, body: 'Once' }, 'same-req');
  const again = await run('note.create', { target: { kind: 'unit', id: 'armor/helm' }, body: 'Once' }, 'same-req');
  assert.equal(again.note.id, first.note.id); assert.equal(again.replayed, true);
  assert.equal((await app.run('notes.list', {})).total, 1);
  await rejects(run('note.create', { target: { kind: 'unit', id: 'armor/helm' }, body: 'Different' }, 'same-req'), 'conflict');
  // Survives a restart (fresh application instance) through the durable journal.
  const restarted = await open(dir);
  assert.equal((await W(restarted)('note.create', { target: { kind: 'unit', id: 'armor/helm' }, body: 'Once' }, 'same-req')).note.id, first.note.id);
  // With the local journal gone, the requestId stored on the note still prevents a duplicate.
  for (const f of readdirSync(join(dir, '.catalog/.local/requests'))) unlinkSync(join(dir, '.catalog/.local/requests', f));
  assert.equal((await W(await open(dir))('note.create', { target: { kind: 'unit', id: 'armor/helm' }, body: 'Once' }, 'same-req')).note.id, first.note.id);
  assert.equal((await app.run('notes.list', {})).total, 1);
  cleanup(dir);
});

test('Locks: a stale lock is not stolen; writes fail with recovery advice until it is explicitly removed', async () => {
  const dir = await standardProject();
  const app = await open(dir); const run = W(app);
  const { note } = await run('note.create', { target: { kind: 'unit', id: 'armor/helm' }, body: 'x' });
  const locks = join(dir, '.catalog/.local/locks'); mkdirSync(locks, { recursive: true });
  const name = `note:${note.id}`;
  const { createHash } = await import('node:crypto');
  const key = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${createHash('sha256').update(name).digest('hex').slice(0, 10)}`;
  const { hostname } = await import('node:os');
  writeFileSync(join(locks, `${key}.lock`), JSON.stringify({ name, pid: 999999, host: hostname(), at: new Date().toISOString() }));
  const err = await rejects(run('note.edit', { id: note.id, body: 'y' }), 'locked');
  assert.match(err.details.recovery, /unlock/);
  const listed = (await app.run('locks.list', {})).locks;
  assert.equal(listed[0].alive, false);
  await run('unlock', { lock: name });
  await run('note.edit', { id: note.id, body: 'y' });
  cleanup(dir);
});

test('Actor attribution is required and recorded as declared', async () => {
  const dir = await standardProject();
  const app = await open(dir);
  await rejects(app.run('note.create', { target: { kind: 'unit', id: 'armor/helm' }, body: 'x' }, {}), 'invalid');
  await rejects(app.run('note.create', { target: { kind: 'unit', id: 'armor/helm' }, body: 'x' }, { actor: { name: 'bot', kind: 'robot' } }), 'invalid');
  const { note } = await app.run('note.create', { target: { kind: 'unit', id: 'armor/helm' }, body: 'x' }, { actor: agent });
  assert.deepEqual(note.by, agent);
  cleanup(dir);
});
