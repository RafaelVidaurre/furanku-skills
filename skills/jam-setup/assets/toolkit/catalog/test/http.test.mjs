import test from 'node:test';
import assert from 'node:assert/strict';
import { symlinkSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { request } from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { standardProject, open, write, tmp, cleanup, png } from './helpers.mjs';
import { startServer } from '../src/server/server.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '../bin/catalog.mjs');
function raw(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((ok, fail) => {
    const r = request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) })); });
    r.on('error', fail); if (body) r.write(body); r.end();
  });
}
const post = (port, action, payload, headers = {}) => raw(port, { method: 'POST', path: `/api/run/${action}`, headers: { 'content-type': 'application/json', 'x-catalog-request': '1', ...headers }, body: JSON.stringify(payload) });
const json = (r) => JSON.parse(r.body.toString());

test('T15/T21 HTTP actions: discovery, browser identity, same validation, and a retried request recorded once', async () => {
  const dir = await standardProject();
  const s = await startServer({ app: await open(dir), port: 0 });
  try {
    const actions = json(await raw(s.port, { path: '/api/actions' })).actions.map((a) => a.name);
    for (const a of ['catalog.search', 'note.create', 'review.submit', 'review.decide', 'evidence.compare', 'viewer.open', 'viewer.capture', 'viewer.control']) assert.ok(actions.includes(a), a);
    // A non-browser client must declare its actor.
    assert.equal((await post(s.port, 'note.create', { input: { target: { kind: 'unit', id: 'armor/helm' }, body: 'x' } })).status, 400);
    const body = { input: { target: { kind: 'unit', id: 'armor/helm' }, body: 'Lost response' }, actor: { name: 'bot', kind: 'agent' }, requestId: 'retry-1' };
    const a = json(await post(s.port, 'note.create', body));
    const b = json(await post(s.port, 'note.create', body));
    assert.equal(a.note.id, b.note.id); assert.equal(b.replayed, true);
    const web = json(await post(s.port, 'note.create', { input: { target: { kind: 'unit', id: 'armor/boots' }, body: 'From browser' } }, { 'x-catalog-client': 'web' }));
    assert.equal(web.note.by.kind, 'human');
    const bad = await post(s.port, 'organize.set', { input: { target: { kind: 'unit', id: 'armor/helm' }, tags: ['Bad Tag'] }, actor: { name: 'bot', kind: 'agent' } });
    assert.equal(bad.status, 400); assert.equal(json(bad).error.code, 'invalid');
    assert.equal(json(await post(s.port, 'notes.list', { input: {} })).total, 2);
  } finally { await s.close(); cleanup(dir); }
});

test('T21 CLI runs the same actions without a browser and the same validation', async () => {
  const dir = await standardProject();
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args, '--root', dir], { encoding: 'utf8' });
  const list = JSON.parse(run('actions').stdout).actions.map((a) => a.name);
  assert.ok(list.includes('note.resolve') && list.includes('viewer.capture'));
  const search = JSON.parse(run('run', 'catalog.search', '--input', '{"q":"helm"}').stdout);
  assert.equal(search.items[0].id, 'armor/helm');
  const noActor = run('run', 'note.create', '--input', '{"target":{"kind":"unit","id":"armor/helm"},"body":"x"}');
  assert.equal(noActor.status, 1); assert.match(noActor.stderr, /declare the actor/);
  const ok = JSON.parse(run('run', 'note.create', '--actor-kind', 'agent', '--actor-name', 'cli-bot', '--request-id', 'cli-1', '--input', '{"target":{"kind":"unit","id":"armor/helm"},"body":"From CLI"}').stdout);
  assert.equal(ok.note.by.name, 'cli-bot');
  const again = JSON.parse(run('run', 'note.create', '--actor-kind', 'agent', '--actor-name', 'cli-bot', '--request-id', 'cli-1', '--input', '{"target":{"kind":"unit","id":"armor/helm"},"body":"From CLI"}').stdout);
  assert.equal(again.note.id, ok.note.id);
  const invalid = run('run', 'organize.set', '--actor-kind', 'agent', '--actor-name', 'cli-bot', '--input', '{"target":{"kind":"unit","id":"armor/helm"},"tags":["NOPE NOPE"]}');
  assert.equal(JSON.parse(invalid.stderr).error.code, 'invalid');
  cleanup(dir);
});

test('T22 security: loopback host/origin checks, write headers, body limits, traversal and symlink escapes, unsafe media', async () => {
  const dir = await standardProject();
  const outside = tmp('cc-secret-'); writeFileSync(join(outside, 'secret.png'), png(2, 2));
  symlinkSync(join(outside, 'secret.png'), join(dir, 'art/escape.png'));
  write(dir, 'art/fake.png', Buffer.from('<html><script>alert(1)</script></html>'));
  write(dir, 'content/armor_x.json', { id: 'armor/x', type: 'armor', name: 'X', attrs: {}, links: [{ role: 'icon', asset: 'art/escape.png' }, { role: 'concept', asset: 'art/fake.png' }] });
  write(dir, 'content/armor_y.json', { id: 'armor/y', type: 'armor', name: 'Y', attrs: {}, links: [{ role: 'icon', asset: '../outside.png' }, { role: 'concept', asset: 'catalog.config.json' }] });
  write(dir, 'content/armor_z.json', { id: 'armor/z', type: 'armor', name: 'Z', attrs: {}, links: [{ role: 'icon', asset: '.git/HEAD' }] });
  const app = await open(dir);
  const s = await startServer({ app, port: 0 });
  try {
    assert.equal((await raw(s.port, { path: '/api/actions', headers: { host: 'evil.example:80' } })).status, 403, 'DNS rebinding host');
    assert.equal((await post(s.port, 'notes.list', { input: {} }, { origin: 'http://evil.example' })).status, 403, 'cross-origin write');
    assert.equal((await raw(s.port, { method: 'POST', path: '/api/run/note.create', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403, 'missing request header');
    assert.equal((await raw(s.port, { method: 'POST', path: '/api/run/notes.list', headers: { 'content-type': 'text/plain', 'x-catalog-request': '1' }, body: '{}' })).status, 415);
    assert.equal((await raw(s.port, { method: 'POST', path: '/api/run/notes.list', headers: { 'content-type': 'application/json', 'x-catalog-request': '1' }, body: 'x'.repeat(1_100_000) })).status, 400);
    for (const p of ['/../package.json', '/vendor/three/../../package.json', '/vendor/three/../../../../../../etc/passwd', '/media/asset/..%2F..%2Fpackage.json', '/media/asset/.git%2Fconfig', '/.catalog/.gitignore', '/media/evidence/x/y/z']) {
      assert.ok([400, 403, 404].includes((await raw(s.port, { path: p })).status), p);
    }
    const x = await app.run('unit.get', { id: 'armor/x' });
    assert.equal(x.links.find((l) => l.role === 'icon'), undefined, 'symlink escaping the project is not catalogued');
    assert.equal(x.links.find((l) => l.role === 'concept').asset.state, 'invalid', 'bytes are not an image');
    assert.equal((await raw(s.port, { path: `/media/asset/${encodeURIComponent('art/escape.png')}` })).status, 404);
    assert.match((await app.run('problems', {})).problems.map((p) => p.error).join('\n'), /symlink escapes/);
    assert.match((await app.run('problems', {})).problems.map((p) => p.error).join('\n'), /repository metadata/);
    assert.equal((await raw(s.port, { path: `/media/asset/${encodeURIComponent('art/fake.png')}` })).status, 503);
    const problems = (await app.run('problems', {})).problems.map((p) => p.error).join('\n');
    assert.match(problems, /outside the declared asset roots|inside the project/);
    const okMedia = await raw(s.port, { path: `/media/asset/${encodeURIComponent('art/helm.png')}` });
    assert.equal(okMedia.status, 200); assert.equal(okMedia.headers['content-type'], 'image/png'); assert.equal(okMedia.headers['x-content-type-options'], 'nosniff');
    assert.match(okMedia.headers['content-security-policy'], /sandbox/);
    const range = await raw(s.port, { path: `/media/asset/${encodeURIComponent('art/helm.glb')}`, headers: { range: 'bytes=0-3' } });
    assert.equal(range.status, 206); assert.equal(range.body.toString(), 'glTF');
    const page = await raw(s.port, { path: '/' });
    assert.match(page.headers['content-security-policy'], /script-src 'self' 'sha256-/);
    // Note text is stored as data, never markup.
    const n = json(await post(s.port, 'note.create', { input: { target: { kind: 'unit', id: 'armor/helm' }, body: '<img src=x onerror=alert(1)>' }, actor: { name: 'a', kind: 'agent' } }));
    assert.equal(n.note.body, '<img src=x onerror=alert(1)>');
  } finally { await s.close(); cleanup(dir, outside); }
});

test('Server binds to loopback only', async () => {
  const dir = await standardProject();
  const s = await startServer({ app: await open(dir), port: 0 });
  try { assert.equal(s.server.address().address, '127.0.0.1'); } finally { await s.close(); cleanup(dir); }
});

test('serve --detach returns once the server is ready and leaves it running on its own', async () => {
  const dir = await standardProject();
  let pid;
  try {
    // spawnSync returning at all shows the server holds none of the caller's output pipes.
    const r = spawnSync(process.execPath, [CLI, 'serve', '--detach', '--port', '0', '--root', dir], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(r.status, 0, r.stderr);
    const url = /at (http:\/\/127\.0\.0\.1:\d+\/)/.exec(r.stdout)[1];
    pid = Number(/process (\d+)/.exec(r.stdout)[1]);
    assert.match(r.stdout, new RegExp(`process\\.kill\\(${pid}\\)`));
    assert.equal((await fetch(url)).status, 200);
    // A second server on the same port fails and reports the server's own error.
    const again = spawnSync(process.execPath, [CLI, 'serve', '--detach', '--port', new URL(url).port, '--root', dir], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(again.status, 1);
    const err = JSON.parse(again.stderr).error;
    assert.equal(err.code, 'unavailable'); assert.match(err.details.log, /EADDRINUSE/);
  } finally {
    if (pid) { process.kill(pid); for (let i = 0; i < 50; i++) { try { process.kill(pid, 0); } catch { break; } await new Promise((ok) => setTimeout(ok, 100)); } }
    cleanup(dir);
  }
});
