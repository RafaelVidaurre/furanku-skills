// Local checkout context: which worktree and branch the catalog describes.
import { execFileSync } from 'node:child_process';
import { realpathSync, existsSync } from 'node:fs';
import { resolve, basename, isAbsolute } from 'node:path';
import { sha256 } from './util.mjs';

export function git(root, args, opts = {}) {
  return execFileSync('git', args, { cwd: root, encoding: opts.encoding ?? 'utf8', input: opts.input, maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } });
}
export function tryGit(root, args, opts) { try { return git(root, args, opts); } catch { return null; } }

export function resolveRoot(input) {
  const start = realpathSync(resolve(input ?? process.cwd()));
  const top = tryGit(start, ['rev-parse', '--show-toplevel'])?.trim();
  return top ? realpathSync(top) : start;
}

// Cheap enough to call before every write; cached briefly for reads.
export function readContext(root) {
  const isGit = !!tryGit(root, ['rev-parse', '--is-inside-work-tree'])?.trim();
  if (!isGit) return { root, name: basename(root), git: false, branch: null, head: null, detached: false, dirty: 0, worktree: sha256(root).slice(0, 12), key: `nogit:${sha256(root).slice(0, 12)}` };
  let gitDir = tryGit(root, ['rev-parse', '--git-dir'])?.trim() ?? '.git';
  if (!isAbsolute(gitDir)) gitDir = resolve(root, gitDir);
  const branch = tryGit(root, ['symbolic-ref', '--short', '-q', 'HEAD'])?.trim() || null;
  const head = tryGit(root, ['rev-parse', '--verify', '-q', 'HEAD'])?.trim() || null;
  const status = tryGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']) ?? '';
  const dirty = status.split('\0').filter(Boolean).filter((l) => !l.slice(3).startsWith('.catalog/')).length;
  const worktree = sha256(existsSync(gitDir) ? realpathSync(gitDir) : gitDir).slice(0, 12);
  const ref = branch ?? `detached@${head?.slice(0, 12)}`;
  return { root, name: basename(root), git: true, branch, head, detached: !branch, dirty, worktree, key: `${worktree}:${ref}` };
}

let cache = { at: 0, root: null, value: null };
export function context(root, maxAgeMs = 750) {
  if (cache.root === root && Date.now() - cache.at < maxAgeMs) return cache.value;
  const value = readContext(root);
  cache = { at: Date.now(), root, value };
  return value;
}
export function freshContext(root) { cache = { at: 0, root: null, value: null }; return context(root); }

export function gitCommonDir(root) {
  let dir = tryGit(root, ['rev-parse', '--git-common-dir'])?.trim();
  if (!dir) return null;
  if (!isAbsolute(dir)) dir = resolve(root, dir);
  return dir;
}

export function actorFromGit(root) {
  const name = tryGit(root, ['config', 'user.name'])?.trim();
  return name || null;
}
