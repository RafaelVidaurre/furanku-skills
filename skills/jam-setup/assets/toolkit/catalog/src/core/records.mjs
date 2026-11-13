// Repository Records: validated, atomic, worktree-local reads and writes under <root>/.catalog.
// Callers work with records; file layout, confinement, locking and request identity stay here.
import { existsSync, mkdirSync, readFileSync, readdirSync, lstatSync, openSync, writeSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { hostname } from 'node:os';
import { sha256, digest, fail, check, toPosix, CatalogError } from './util.mjs';

export const RECORDS_DIR = '.catalog';
export const EVIDENCE_PATH = /^\.catalog\/evidence\/([0-9a-f]{2})\/([0-9a-f]{64})(\.[a-z0-9]{1,8})?$/;

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';
const fileKey = (s) => `${slug(s)}-${sha256(String(s)).slice(0, 10)}`;

// Record kinds and their layout. Immutable kinds can only be created.
const KINDS = {
  note: { dir: 'notes', file: (r) => `notes/${r.id}.json`, match: /^notes\/[^/]+\.json$/, mutable: true, key: (r) => r.id },
  label: { dir: 'labels', file: (r) => `labels/${r.target.kind}/${fileKey(r.target.id)}.json`, match: /^labels\/(unit|asset|collection)\/[^/]+\.json$/, mutable: true, key: (r) => `${r.target.kind}:${r.target.id}` },
  collection: { dir: 'collections', file: (r) => `collections/${fileKey(r.id)}.json`, match: /^collections\/[^/]+\.json$/, mutable: true, key: (r) => r.id },
  categories: { dir: '', file: () => 'categories.json', match: /^categories\.json$/, mutable: true, key: () => 'categories' },
  submission: { dir: 'reviews', file: (r) => `reviews/${r.id}/submission.json`, match: /^reviews\/[^/]+\/submission\.json$/, mutable: false, key: (r) => r.id },
  verdict: { dir: 'reviews', file: (r) => `reviews/${r.submission}/verdicts/${r.id}.json`, match: /^reviews\/[^/]+\/verdicts\/[^/]+\.json$/, mutable: false, key: (r) => r.id },
};

export function createRecords(root, { validators = {} } = {}) {
  const base = join(root, RECORDS_DIR);
  const local = join(base, '.local');
  const cache = new Map(); // kind -> { sig, items, problems }
  const queues = new Map(); // in-process lock queues

  // Every path under .catalog is reached without following symbolic links, for reads and writes.
  function confine(file) {
    const rel = relative(root, file);
    check(rel && !rel.startsWith(`..${sep}`) && rel !== '..' && rel.split(sep)[0] === RECORDS_DIR, 'forbidden', 'record path outside .catalog');
    let cur = root;
    for (const seg of rel.split(sep)) {
      cur = join(cur, seg);
      let st;
      try { st = lstatSync(cur); } catch (e) { if (e.code === 'ENOENT') return file; throw e; }
      check(!st.isSymbolicLink(), 'forbidden', `symbolic links are not followed inside .catalog (${toPosix(relative(root, cur))})`);
    }
    return file;
  }
  const readConfined = (file) => readFileSync(confine(file));
  function ensureDir(dir) {
    confine(dir);
    mkdirSync(dir, { recursive: true });
    confine(dir);
  }
  function ensureBase() {
    ensureDir(local);
    const gi = join(base, '.gitignore');
    if (!existsSync(confine(gi))) writeFile(gi, '# Machine-local catalog state: locks, request journal, captures.\n.local/\n');
  }

  function walk(dir, out, problems) {
    let st;
    try { st = lstatSync(dir); } catch { return out; }
    if (st.isSymbolicLink()) { problems.push({ file: toPosix(relative(root, dir)), kind: 'records', error: 'symbolic link ignored', recovery: 'replace the link with a real directory or file' }); return out; }
    if (!st.isDirectory()) return out;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.local' || e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isSymbolicLink()) { problems.push({ file: toPosix(relative(root, p)), kind: 'records', error: 'symbolic link ignored', recovery: 'replace the link with a real file' }); continue; }
      if (e.isDirectory()) walk(p, out, problems);
      else if (e.isFile() && e.name.endsWith('.json')) out.push(p);
    }
    return out;
  }

  function signature(files) {
    return sha256(files.map((f) => { const s = lstatSync(f); return `${f}:${s.mtimeMs}:${s.size}`; }).join('\n'));
  }

  function validate(kind, rec) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return 'record must be a JSON object';
    try { return validators[kind]?.(rec) ?? null; } catch (e) { return `record structure is invalid (${e.message})`; }
  }

  function parse(kind, file) {
    const rel = toPosix(relative(base, file));
    const shown = `${RECORDS_DIR}/${rel}`;
    let text;
    try { text = readConfined(file).toString('utf8'); } catch (e) { return { problem: { file: shown, kind, error: e.message, recovery: 'replace this path with a regular file' } }; }
    if (/^(<{7}|={7}|>{7})( |$)/m.test(text)) return { problem: { file: shown, kind, error: 'unresolved Git merge conflict', recovery: 'resolve the conflict markers in this file and commit the result' } };
    let rec;
    try { rec = JSON.parse(text); } catch (e) { return { problem: { file: shown, kind, error: `invalid JSON: ${e.message}`, recovery: 'repair or remove this file; other records are unaffected' } }; }
    const err = validate(kind, rec);
    if (err) return { problem: { file: shown, kind, error: err, recovery: 'repair this record; it is excluded until valid' } };
    if (KINDS[kind].file(rec) !== rel) return { problem: { file: shown, kind, error: `record identity does not match its path (expected ${KINDS[kind].file(rec)})`, recovery: 'move or repair the file' } };
    return { rec };
  }

  function list(kind) {
    const k = KINDS[kind];
    const walkProblems = [];
    let files = [];
    try {
      confine(base);
      files = (k.dir === '' ? [join(base, 'categories.json')].filter((f) => { try { const s = lstatSync(f); if (s.isSymbolicLink()) { walkProblems.push({ file: `${RECORDS_DIR}/categories.json`, kind, error: 'symbolic link ignored' }); return false; } return s.isFile(); } catch { return false; } }) : walk(join(base, k.dir), [], walkProblems))
        .filter((f) => k.match.test(toPosix(relative(base, f))));
    } catch (e) { walkProblems.push({ file: RECORDS_DIR, kind, error: e.message, recovery: 'replace .catalog with a real directory inside the checkout' }); }
    const sig = signature(files) + walkProblems.length;
    const hit = cache.get(kind);
    if (hit?.sig === sig) return hit;
    const items = []; const problems = [...walkProblems]; const seen = new Set();
    for (const f of files) {
      const { rec, problem } = parse(kind, f);
      if (problem) { problems.push(problem); continue; }
      const key = k.key(rec);
      if (seen.has(key)) { problems.push({ file: toPosix(relative(root, f)), kind, error: `duplicate identity ${key}`, recovery: 'remove the duplicate record' }); continue; }
      seen.add(key); items.push(rec);
    }
    const value = { sig, items, problems };
    cache.set(kind, value);
    return value;
  }

  const pathOf = (kind, rec) => join(base, KINDS[kind].file(rec));
  function readOne(kind, rec) {
    const file = pathOf(kind, rec);
    confine(file);
    if (!existsSync(file)) return null;
    const { rec: r, problem } = parse(kind, file);
    if (problem) fail('malformed', `${problem.file}: ${problem.error}`, problem);
    return r;
  }

  function atomicWrite(file, data) {
    ensureDir(dirname(file));
    confine(file);
    const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    const fd = openSync(tmp, 'wx');
    try { writeSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
    return tmp;
  }
  function commit(tmp, file) {
    confine(file);
    try { renameSync(tmp, file); } catch (e) { try { unlinkSync(tmp); } catch {} throw e; }
    try { const d = openSync(dirname(file), 'r'); fsyncSync(d); closeSync(d); } catch {}
  }
  const writeFile = (file, data) => commit(atomicWrite(file, data), file);
  const serialize = (rec) => `${JSON.stringify(rec, null, 2)}\n`;

  // ---- Locks: in-process queue plus an exclusive lock file for other processes.
  // A lock left by a crashed writer is never removed automatically.
  const lockFile = (name) => join(local, 'locks', `${fileKey(name)}.lock`);
  async function withLock(name, fn) {
    const prev = queues.get(name) ?? Promise.resolve();
    let release;
    const mine = new Promise((r) => { release = r; });
    const chained = prev.then(() => mine);
    queues.set(name, chained);
    await prev;
    let fd = null;
    try {
      ensureBase();
      const file = lockFile(name);
      ensureDir(dirname(file));
      for (let i = 0; i < 40 && fd === null; i++) {
        try { fd = openSync(confine(file), 'wx'); } catch (e) { if (e.code !== 'EEXIST') throw e; await new Promise((r) => setTimeout(r, 50)); }
      }
      if (fd === null) {
        let owner = null; try { owner = JSON.parse(readConfined(file).toString()); } catch {}
        fail('locked', `records are locked by another writer (${name})`, { lock: name, owner, recovery: 'retry shortly; if the owning process has exited, run `catalog run unlock` for this lock' });
      }
      writeSync(fd, JSON.stringify({ name, pid: process.pid, host: hostname(), at: new Date().toISOString() }));
      return await fn();
    } finally {
      if (fd !== null) { closeSync(fd); try { unlinkSync(lockFile(name)); } catch {} }
      release();
      if (queues.get(name) === chained) queues.delete(name);
    }
  }
  function locks() {
    const dir = join(local, 'locks');
    try { confine(dir); } catch { return []; }
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith('.lock')).map((f) => {
      let owner = {}; try { owner = JSON.parse(readConfined(join(dir, f)).toString()); } catch {}
      let alive = null;
      if (owner.host === hostname() && owner.pid) { try { process.kill(owner.pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; } }
      return { file: f, ...owner, alive };
    });
  }
  function unlock(name) {
    const l = locks().find((x) => x.name === name || x.file === name);
    check(l, 'not_found', 'no such lock');
    check(l.alive === false, 'locked', l.alive ? `lock owner process ${l.pid} is still running` : 'cannot verify that the lock owner exited on this machine; remove the lock file manually after checking', { lock: l });
    unlinkSync(confine(join(local, 'locks', l.file)));
    return { removed: l.name };
  }

  // ---- Durable request identity: a machine-local journal bound to the checkout context.
  const journalFile = (requestId) => join(local, 'requests', `${sha256(requestId).slice(0, 32)}.json`);
  function replay(requestId, action, input, contextKey) {
    if (!requestId) return null;
    const f = journalFile(requestId);
    confine(f);
    if (!existsSync(f)) return null;
    let j;
    try { j = JSON.parse(readConfined(f).toString()); } catch { fail('conflict', 'request journal entry is unreadable; use a new request id'); }
    check(j.action === action && j.input === digest(input), 'conflict', 'request id was already used for a different action or input');
    check(j.context === contextKey, 'conflict', 'request id was already used in another branch or worktree context');
    return j.result;
  }
  function remember(requestId, action, input, contextKey, result) {
    if (!requestId) return;
    ensureBase();
    writeFile(journalFile(requestId), JSON.stringify({ requestId, action, input: digest(input), context: contextKey, result, at: new Date().toISOString() }));
  }

  // ---- Logical operations over one or more records: every resulting record is validated
  // (existence, expected revision, schema) before any file changes.
  // ops: { type: 'create' | 'update' | 'remove', kind, rec, expectedRevision }
  function apply(ops) {
    const staged = [];
    for (const op of ops) {
      const k = KINDS[op.kind];
      const file = pathOf(op.kind, op.rec);
      confine(file);
      const fresh = readOne(op.kind, op.rec);
      if (op.type === 'create') {
        check(!fresh, 'conflict', `${op.kind} ${k.key(op.rec)} already exists`);
        const err = validate(op.kind, op.rec);
        check(!err, 'invalid', err);
        staged.push({ file, data: serialize(op.rec), rec: op.rec });
      } else {
        check(k.mutable, 'forbidden', `${op.kind} records are immutable`);
        check(fresh, 'not_found', `${op.kind} ${k.key(op.rec)} no longer exists`);
        if (op.expectedRevision !== undefined && op.expectedRevision !== null) check(fresh.revision === op.expectedRevision, 'conflict', `${op.kind} changed since it was read (revision ${fresh.revision}, expected ${op.expectedRevision})`, { current: fresh });
        if (op.type === 'remove') { staged.push({ file, remove: true, rec: fresh }); continue; }
        const rec = { ...op.rec, revision: (fresh.revision ?? 0) + 1 };
        const err = validate(op.kind, rec);
        check(!err, 'invalid', `${k.key(rec)}: ${err}`);
        staged.push({ file, data: serialize(rec), rec });
      }
    }
    check(new Set(staged.map((s) => s.file)).size === staged.length, 'invalid', 'one operation touched the same record twice');
    ensureBase();
    const tmps = [];
    try { for (const s of staged) if (!s.remove) tmps.push([atomicWrite(s.file, s.data), s.file]); }
    catch (e) { for (const [t] of tmps) try { unlinkSync(t); } catch {} throw e; }
    for (const [t, f] of tmps) commit(t, f);
    for (const s of staged) if (s.remove) unlinkSync(confine(s.file));
    for (const op of ops) cache.delete(op.kind);
    return staged.map((s) => s.rec);
  }
  const create = (kind, rec) => apply([{ type: 'create', kind, rec }])[0];
  const update = (kind, current, next, expectedRevision) => apply([{ type: 'update', kind, rec: { ...next, ...(KINDS[kind].key(next) === KINDS[kind].key(current) ? {} : fail('invalid', 'record identity cannot change')) }, expectedRevision }])[0];
  const remove = (kind, rec, expectedRevision) => apply([{ type: 'remove', kind, rec, expectedRevision }])[0];
  function upsert(kind, rec, expectedRevision) {
    const fresh = readOne(kind, rec);
    if (!fresh) { check(!expectedRevision, 'conflict', `${kind} ${KINDS[kind].key(rec)} does not exist`); return create(kind, { ...rec, revision: 1 }); }
    return update(kind, fresh, rec, expectedRevision);
  }
  // Stage an upsert inside a larger operation.
  function upsertOp(kind, rec, expectedRevision) {
    const fresh = readOne(kind, rec);
    return fresh ? { type: 'update', kind, rec, expectedRevision } : { type: 'create', kind, rec: { ...rec, revision: 1 } };
  }

  // ---- Content-addressed evidence blobs (immutable, versioned with the repository).
  const blobRel = (hash, ext) => `${RECORDS_DIR}/evidence/${hash.slice(0, 2)}/${hash}${ext ? `.${ext}` : ''}`;
  function putBlob(buf, ext) {
    const hash = sha256(buf);
    const safeExt = /^[a-z0-9]{1,8}$/.test(ext ?? '') ? ext : '';
    const rel = blobRel(hash, safeExt);
    const file = join(root, rel);
    confine(file);
    if (!existsSync(file)) { ensureBase(); writeFile(file, buf); }
    return { sha256: hash, path: rel };
  }
  // Read a stored evidence blob by its structurally validated path; never follows links.
  function readBlob(rel) {
    const m = EVIDENCE_PATH.exec(rel ?? '');
    check(m && m[1] === m[2].slice(0, 2), 'invalid', 'invalid evidence path');
    const file = join(root, rel);
    confine(file);
    if (!existsSync(file)) return null;
    check(lstatSync(file).isFile(), 'forbidden', 'evidence path is not a regular file');
    return readConfined(file);
  }
  function blobState(rel) {
    const file = join(root, rel);
    try { confine(file); const s = lstatSync(file); return `${s.size}:${s.mtimeMs}`; } catch (e) { return e.code === 'forbidden' ? 'forbidden' : 'absent'; }
  }
  // Machine-local files (captures).
  function writeLocal(rel, buf) {
    check(/^[a-z]+\/[A-Za-z0-9._-]+$/.test(rel), 'invalid', 'invalid local path');
    const file = join(local, rel);
    writeFile(file, buf);
    return `${RECORDS_DIR}/.local/${rel}`;
  }

  return { list, readOne, apply, create, update, upsert, upsertOp, remove, withLock, locks, unlock, replay, remember, putBlob, readBlob, blobState, blobRel, writeLocal, base, problems: () => Object.keys(KINDS).flatMap((k) => list(k).problems) };
}

export { CatalogError };
