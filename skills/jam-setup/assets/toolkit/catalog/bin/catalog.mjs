#!/usr/bin/env node
// Content catalog CLI. Data actions run in-process against the checkout (no browser).
// Viewer actions use a running server (--url) or a temporary one for `capture`.
import { readFileSync, copyFileSync, mkdirSync, mkdtempSync, openSync, closeSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openCatalog } from '../src/core/app.mjs';
import { actorFromGit, resolveRoot } from '../src/core/context.mjs';
import { CatalogError } from '../src/core/util.mjs';

const HELP = `Content catalog (Node.js 22.20+)
  catalog serve [--root dir] [--port 4600] [--adapter manifest|jam|./adapter.mjs] [--detach]
        --detach: run in the background, independent of this shell; prints the URL, process ID and log
  catalog actions [--root dir]                       list actions with input schemas
  catalog run <action> [--input '<json>' | --input -] [--root dir]
        writes: --actor-kind human|agent [--actor-name name] [--request-id id]
        viewer actions (viewer.*): --url http://127.0.0.1:<port>/ of a running server
  catalog capture --target unit:<id>|collection:<id>|asset:<id>|submission:<id>/<item>
        [--part id] [--view id] [--camera '{"position":[x,y,z],"target":[x,y,z]}'] [--mode textured|clay|wireframe]
        [--animation <clip>] [--out file.png] [--size 1280x860] [--root dir | --url url]
  catalog example <empty-dir> [--no-video]            create the Hollowmere sample project

Examples:
  catalog run catalog.search --input '{"q":"helm","filters":{"type":["gear"]}}'
  catalog run notes.list --input '{"state":"open"}'
  catalog run note.create --actor-kind agent --actor-name my-agent --input '{"target":{"kind":"unit","id":"gear/x"},"body":"..."}'
  catalog run review.decide --actor-kind human --input '{"submission":"sub_..","item":"it_..","whole":"approved","exceptions":{"model":"changes"}}'
Actor attribution is a declaration; agents must declare --actor-kind agent.`;

const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
const opts = { root: { type: 'string' }, port: { type: 'string' }, adapter: { type: 'string' }, input: { type: 'string' }, 'actor-kind': { type: 'string' }, 'actor-name': { type: 'string' }, 'request-id': { type: 'string' }, url: { type: 'string' }, target: { type: 'string' }, part: { type: 'string' }, view: { type: 'string' }, camera: { type: 'string' }, mode: { type: 'string' }, animation: { type: 'string' }, out: { type: 'string' }, size: { type: 'string' }, 'no-video': { type: 'boolean' }, detach: { type: 'boolean' }, help: { type: 'boolean' } };

async function http(url, action, body) {
  const r = await fetch(new URL(`/api/run/${action}`, url), { method: 'POST', headers: { 'content-type': 'application/json', 'x-catalog-request': '1' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new CatalogError(j.error?.code ?? 'unavailable', j.error?.message ?? `HTTP ${r.status}`, j.error?.details);
  return j;
}
// Re-run this command without --detach in its own session with no handles on this shell,
// so closing the terminal or agent session that started it does not stop the server.
async function serveDetached() {
  const log = join(mkdtempSync(join(tmpdir(), 'catalog-serve-')), 'serve.log');
  const fd = openSync(log, 'a');
  const args = [...process.execArgv, ...process.argv.slice(1).filter((a) => a !== '--detach')];
  const child = spawn(process.execPath, args, { detached: true, stdio: ['ignore', fd, fd], windowsHide: true });
  closeSync(fd);
  child.unref();
  let exited = false;
  child.on('exit', () => { exited = true; });
  for (const deadline = Date.now() + 120_000; ;) {
    const text = readFileSync(log, 'utf8');
    const ready = /^Catalog for .* at http:\/\/\S+$/m.exec(text);
    if (ready) {
      console.log(ready[0]);
      console.log(`Running detached as process ${child.pid}; log ${log}`);
      console.log(`Stop it with: node -e "process.kill(${child.pid})"`);
      return;
    }
    if (exited || Date.now() > deadline) {
      if (!exited) child.kill();
      throw new CatalogError('unavailable', `catalog server did not start${exited ? '' : ' within 120 s'}; log ${log}`, { log: text.trim() });
    }
    await sleep(100);
  }
}
function parseTarget(s) {
  const m = /^(unit|collection|asset|submission):(.+)$/.exec(s ?? '');
  if (!m) throw new CatalogError('invalid', '--target must be unit:<id>, collection:<id>, asset:<id> or submission:<id>/<item>');
  if (m[1] === 'submission') { const [id, item] = m[2].split('/'); return { kind: 'submission', id, item }; }
  return { kind: m[1], id: m[2] };
}

try {
  const { positionals, values: o } = parseArgs({ allowPositionals: true, options: opts });
  const [verb, arg] = positionals;
  if (o.help || !verb || verb === 'help') { console.log(HELP); process.exit(0); }
  if (verb === 'example') {
    const r = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '../examples/hollowmere/create.mjs'), arg ?? '', ...(o['no-video'] ? ['--no-video'] : [])], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
  if (verb === 'serve' && o.detach) await serveDetached();
  else if (verb === 'serve') {
    const { startServer } = await import('../src/server/server.mjs');
    const app = await openCatalog({ root: o.root, adapter: o.adapter });
    const s = await startServer({ app, port: o.port ? Number(o.port) : 4600 });
    const c = app.context();
    console.log(`Catalog for ${c.name} (${c.branch ?? 'detached'}) at ${s.url}`);
    const stop = async () => { await s.close(); process.exit(0); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  } else if (verb === 'actions') {
    const app = await openCatalog({ root: o.root, adapter: o.adapter });
    const { VIEWER_ACTIONS } = await import('../src/server/renderer.mjs');
    out({ actions: [...app.discover(), ...VIEWER_ACTIONS] });
  } else if (verb === 'run') {
    if (!arg) throw new CatalogError('invalid', 'run needs an action name; see `catalog actions`');
    const input = o.input === '-' ? JSON.parse(readFileSync(0, 'utf8')) : o.input ? JSON.parse(o.input) : {};
    const kind = o['actor-kind'] ?? process.env.CATALOG_ACTOR_KIND;
    const actorName = o['actor-name'] ?? process.env.CATALOG_ACTOR_NAME ?? (kind === 'human' ? actorFromGit(resolveRoot(o.root)) : undefined);
    const actor = kind ? { kind, name: actorName } : undefined;
    if (arg.startsWith('viewer.') || o.url) {
      if (!o.url) throw new CatalogError('invalid', 'viewer actions need --url of a running `catalog serve`');
      out(await http(o.url, arg, { input, actor, requestId: o['request-id'] }));
    } else {
      const app = await openCatalog({ root: o.root, adapter: o.adapter });
      out(await app.run(arg, input, { actor, requestId: o['request-id'] }));
    }
  } else if (verb === 'capture') {
    if (o.url && o.out) throw new CatalogError('invalid', '--out requires a local capture; with --url use the server capture path returned in the result');
    const target = parseTarget(o.target);
    if (o.part) target.part = o.part;
    if (o.view) target.view = o.view;
    let url = o.url; let temp = null;
    if (!url) {
      const { startServer } = await import('../src/server/server.mjs');
      const app = await openCatalog({ root: o.root, adapter: o.adapter });
      temp = await startServer({ app, port: 0 });
      url = temp.url;
    }
    try {
      const size = o.size ? (([w, h]) => ({ width: +w, height: +h }))(o.size.split('x')) : undefined;
      await http(url, 'viewer.open', { input: { target, size, session: 'cli' } });
      const control = {};
      if (o.camera) control.camera = JSON.parse(o.camera);
      if (o.mode) control.mode = o.mode;
      if (o.animation) control.animation = { clip: o.animation, time: 0, playing: false };
      if (Object.keys(control).length) await http(url, 'viewer.control', { input: { session: 'cli', ...control } });
      const cap = await http(url, 'viewer.capture', { input: { session: 'cli' } });
      const root = temp ? resolveRoot(o.root) : null;
      if (o.out && root) { mkdirSync(dirname(resolve(o.out)), { recursive: true }); copyFileSync(join(root, cap.file), resolve(o.out)); cap.file = resolve(o.out); }
      out(cap);
    } finally { if (temp) await temp.close(); }
  } else throw new CatalogError('invalid', `unknown command ${verb}; see --help`);
} catch (e) {
  const err = e instanceof CatalogError ? { code: e.code, message: e.message, details: e.details ?? undefined } : { code: 'internal', message: e.message };
  process.stderr.write(`${JSON.stringify({ error: err }, null, 2)}\n`);
  process.exitCode = 1;
}
