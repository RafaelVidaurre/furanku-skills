// Shared by the example adapter's commands: where things are, the path rule, and the one line a command prints.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const project = process.env.JAM_PROJECT_ROOT ?? process.cwd();
const adapterDir = process.env.JAM_ADAPTER_DIR || join(dirname(fileURLToPath(import.meta.url)), '..');
export const facts = JSON.parse(readFileSync(join(adapterDir, 'adapter.json'), 'utf8')).facts;
export const contentRoot = facts.contentRoot;

/** Exit with one JSON object on standard output and the same words for a person on standard error. */
export function fail(message, fix) {
  process.stderr.write(`${message}${fix ? `\nfix: ${fix}` : ''}\n`);
  process.stdout.write(`${JSON.stringify({ error: { message, ...(fix ? { fix } : {}) } })}\n`);
  process.exit(1);
}

export const emit = (receipt) => process.stdout.write(`${JSON.stringify(receipt)}\n`);

/** A stored path is project-relative with forward slashes and no `.` or `..` part. */
export function portable(path) {
  if (typeof path !== 'string' || !/^(?![A-Za-z]:)(?!\/)(?!.*\\)(?!.*(?:^|\/)\.{0,2}(?:\/|$)).+$/.test(path)) {
    fail(`not a project-relative path with forward slashes: ${path}`, 'name the file as it reads from the project root');
  }
  return path;
}

export const absolute = (path) => join(project, ...portable(path).split('/'));
export const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** `assets/static/barrel.glb` <-> `game/assets/static/barrel.glb`, by the facts' assetId scheme. */
export function fileOf(id) {
  const [head] = facts.assetId.scheme.split('{path}');
  if (typeof id !== 'string' || !id.startsWith(head)) fail(`not an asset id of the form ${facts.assetId.scheme}: ${id}`);
  return portable(facts.assetId.from.replace('{path}', id.slice(head.length)));
}
export const idOf = (file) => facts.assetId.scheme.replace('{path}', file.slice(facts.assetId.from.indexOf('{path}')));
