// Frozen review evidence. Each referenced byte stream is identified by SHA-256 and stored either
// as a content-addressed repository artifact (.catalog/evidence) or as an immutable Git blob
// reference when the file is committed and unmodified. Reads always verify the digest and never
// fall back to current working content.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { sha256, canonical, sniff } from './util.mjs';
import { gitCommonDir } from './context.mjs';
import { validRef } from './schemas.mjs';

const LFS_POINTER = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([0-9a-f]{64})\nsize (\d+)\n?$/;

function gitBuf(root, args, input) {
  return execFileSync('git', args, { cwd: root, input, maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } });
}

export function createEvidence(root, records, ctx) {
  // Committed and unmodified relative to HEAD: reference the immutable Git blob.
  function committedBlob(rel) {
    if (!ctx().git || !ctx().head) return null;
    try {
      if (!gitBuf(root, ['ls-files', '--', rel]).toString().trim()) return null;
      try { gitBuf(root, ['diff', '--quiet', 'HEAD', '--', rel]); } catch { return null; }
      const oid = gitBuf(root, ['rev-parse', `HEAD:${rel}`]).toString().trim();
      return { commit: ctx().head, path: rel, blob: oid };
    } catch { return null; }
  }

  function freezeFile(rel, full, expectedSha, ext) {
    const git = committedBlob(rel);
    if (git) {
      // Verify that the Git object really yields these bytes (directly or through local LFS).
      const check = readRef({ git }, expectedSha);
      if (check.status === 'ok') return { git };
    }
    const bytes = readFileSync(full);
    if (sha256(bytes) !== expectedSha) return null; // changed while freezing
    return { store: records.putBlob(bytes, ext).path };
  }

  function freezeJson(value) {
    const bytes = Buffer.from(canonical(value));
    const { sha256: h, path } = records.putBlob(bytes, 'json');
    return { sha256: h, ref: { store: path } };
  }

  function readRef(ref, expectedSha) {
    try {
      if (!validRef(ref, expectedSha)) return { status: 'unavailable', error: 'evidence reference is incomplete or invalid' };
      let bytes;
      if (ref.store) {
        try { bytes = records.readBlob(ref.store); } catch (e) { return { status: 'unavailable', error: e.message }; }
        if (!bytes) return { status: 'missing', error: `evidence file is missing: ${ref.store}` };
      } else if (ref.git) {
        if (!/^[0-9a-f]{40,64}$/.test(ref.git.blob)) return { status: 'unavailable', error: 'invalid Git reference' };
        try { bytes = gitBuf(root, ['cat-file', 'blob', ref.git.blob]); }
        catch { return { status: 'missing', error: `Git object ${ref.git.blob.slice(0, 12)} (${ref.git.path} at ${ref.git.commit.slice(0, 12)}) is not available in this clone` }; }
        const m = LFS_POINTER.exec(bytes.toString('latin1', 0, Math.min(bytes.length, 300)));
        if (m) {
          const common = gitCommonDir(root);
          const obj = common && join(common, 'lfs', 'objects', m[1].slice(0, 2), m[1].slice(2, 4), m[1]);
          if (!obj || !existsSync(obj)) return { status: 'missing', error: `Git LFS object ${m[1].slice(0, 12)} for ${ref.git.path} is not available locally; fetch LFS data for ${ref.git.commit.slice(0, 12)}` };
          bytes = readFileSync(obj);
        }
      } else return { status: 'unavailable', error: 'unknown evidence reference' };
      const actual = sha256(bytes);
      if (actual !== expectedSha) return { status: 'corrupt', error: `evidence bytes changed (expected ${expectedSha.slice(0, 12)}, found ${actual.slice(0, 12)})` };
      return { status: 'ok', bytes, sha256: actual, media: sniff(bytes.subarray(0, 64)) };
    } catch (e) { return { status: 'unavailable', error: e.message }; }
  }

  // A cheap fingerprint of where the bytes currently live; changes when storage changes.
  const pointers = new Map();
  function storageKey(ref) {
    try {
      if (ref.store) return `s:${ref.store}:${records.blobState(ref.store)}`;
      if (ref.git) {
        try { gitBuf(root, ['cat-file', '-e', ref.git.blob]); } catch { return `g:${ref.git.blob}:absent`; }
        if (!pointers.has(ref.git.blob)) { const head = gitBuf(root, ['cat-file', '-p', ref.git.blob]).subarray(0, 300).toString('latin1'); pointers.set(ref.git.blob, LFS_POINTER.exec(head)?.[1] ?? null); }
        const lfs = pointers.get(ref.git.blob);
        if (!lfs) return `g:${ref.git.blob}`;
        const common = gitCommonDir(root);
        const obj = common && join(common, 'lfs', 'objects', lfs.slice(0, 2), lfs.slice(2, 4), lfs);
        return `g:${ref.git.blob}:lfs:${obj && existsSync(obj) ? statSync(obj).mtimeMs : 'absent'}`;
      }
    } catch { return `x:${Math.random()}`; }
    return 'unknown';
  }

  return { freezeFile, freezeJson, readRef, storageKey };
}
