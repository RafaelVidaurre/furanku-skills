// Shared by the Godot adapter's commands: where the project and the Godot project are, the facts,
// argument handling, the path rule, and the one JSON object a command prints.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export class AdapterError extends Error {
  constructor(message, fix) {
    super(message);
    this.fix = fix;
  }
}

/** Runs a command: one JSON object on standard output, exit 0; a failure as `{ error }` with exit 1. */
export async function main(build) {
  try {
    process.stdout.write(`${JSON.stringify(await build(process.argv.slice(2)))}\n`);
  } catch (error) {
    const known = error instanceof AdapterError;
    const message = known ? error.message : String(error?.stack ?? error);
    process.stderr.write(`${message}${known && error.fix ? `\nfix: ${error.fix}` : ''}\n`);
    process.stdout.write(`${JSON.stringify({ error: { message, ...(known && error.fix ? { fix: error.fix } : {}) } })}\n`);
    process.exitCode = 1;
  }
}

/** `--name value`, repeatable `--name value`, and `--flag`; anything else is positional. */
export function parseArgs(argv, { values = [], lists = [], flags = [] }) {
  const out = { positional: [] };
  for (const name of lists) out[name] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const name = arg.startsWith('--') ? arg.slice(2) : null;
    if (name !== null && flags.includes(name)) out[name] = true;
    else if (name !== null && (values.includes(name) || lists.includes(name))) {
      if (i + 1 >= argv.length) throw new AdapterError(`${arg} needs a value`);
      if (lists.includes(name)) out[name].push(argv[++i]);
      else out[name] = argv[++i];
    } else if (name !== null) throw new AdapterError(`unknown option ${arg}`, `the options are ${[...values, ...lists, ...flags].map((n) => `--${n}`).join(', ')}`);
    else out.positional.push(arg);
  }
  return out;
}

// The toolkit's rule for a stored path: project-relative, forward slashes, no drive, no `.` or `..` part.
const PORTABLE = /^(?![A-Za-z]:)(?!\/)(?!.*\\)(?!.*(?:^|\/)\.{0,2}(?:\/|$)).+$/;

export function portable(path, what = 'path') {
  if (typeof path !== 'string' || !PORTABLE.test(path)) {
    throw new AdapterError(`${what} must be project-relative with forward slashes and no . or .. parts: ${path}`, 'name the file as it reads from the project root');
  }
  return path;
}

export const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** `over` wins; objects merge key by key, anything else replaces. */
export function merge(base, over) {
  if (!isRecord(base) || !isRecord(over)) return over;
  const out = { ...base };
  for (const [key, value] of Object.entries(over)) out[key] = key in base ? merge(base[key], value) : value;
  return out;
}

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new AdapterError(`cannot read ${what}: ${error.message}`, 'correct the file');
  }
}

/** Folders a search for project.godot never enters. */
const NOT_GODOT = new Set(['node_modules', '__pycache__']);

function findProjects(root, depth = 3, prefix = '') {
  if (depth < 0) return [];
  let entries;
  try {
    entries = readdirSync(join(root, prefix), { withFileTypes: true });
  } catch {
    return [];
  }
  const found = entries.some((entry) => entry.isFile() && entry.name === 'project.godot') ? [prefix === '' ? '.' : prefix] : [];
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.') && !NOT_GODOT.has(entry.name)) found.push(...findProjects(root, depth - 1, prefix === '' ? entry.name : `${prefix}/${entry.name}`));
  }
  return found;
}

/**
 * The adapter's configuration: adapter.json facts with the project's `engine.facts` merged over them,
 * and the Godot project folder (the one holding project.godot) that the `assetId` fact maps to `res://`.
 */
export function loadConfig({ project = process.env.JAM_PROJECT_ROOT || process.cwd(), adapterDir = process.env.JAM_ADAPTER_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', '..') } = {}) {
  const adapter = readJson(join(adapterDir, 'adapter.json'), 'the adapter definition (adapter.json)');
  const configFile = join(project, 'jam.config.json');
  const config = existsSync(configFile) ? readJson(configFile, 'jam.config.json') : {};
  const facts = merge(adapter.facts, isRecord(config?.engine?.facts) ? config.engine.facts : {});
  const scheme = facts.assetId?.scheme ?? 'res://{path}';
  const from = facts.assetId?.from ?? '{path}';
  if (!from.endsWith('{path}') || from.indexOf('{path}') !== from.length - 6 || !scheme.includes('{path}')) {
    throw new AdapterError(`engine.facts.assetId must map {path} to a folder: from ${JSON.stringify(from)}, scheme ${JSON.stringify(scheme)}`, 'set engine.facts.assetId in jam.config.json to { "scheme": "res://{path}", "from": "<folder holding project.godot>/{path}" }');
  }
  const prefix = from.slice(0, -6);
  if (prefix !== '' && !prefix.endsWith('/')) throw new AdapterError(`engine.facts.assetId.from must be {path} or <folder>/{path}: ${from}`);
  const godot = prefix === '' ? '.' : portable(prefix.slice(0, -1), 'the Godot project folder in engine.facts.assetId.from');
  if (!existsSync(join(project, ...godot.split('/'), 'project.godot'))) {
    const candidates = findProjects(project);
    throw new AdapterError(
      `no project.godot in ${godot === '.' ? 'the project root' : godot}`,
      candidates.length > 0
        ? `set engine.facts.assetId.from in jam.config.json to "${candidates[0] === '.' ? '' : `${candidates[0]}/`}{path}" (project.godot found in: ${candidates.join(', ')})`
        : 'run from the project that holds the Godot project, or set engine.facts.assetId.from in jam.config.json to "<folder holding project.godot>/{path}"'
    );
  }
  return {
    project,
    id: adapter.id,
    facts,
    godot,
    scheme,
    scratch: typeof config?.roots?.scratch === 'string' ? config.roots.scratch : 'Art/.scratch'
  };
}

export const absolute = (cfg, path) => join(cfg.project, ...portable(path).split('/'));

/** A project path from a path inside the Godot project, and back. */
export const projectPath = (godot, inside) => (godot === '.' ? inside : `${godot}/${inside}`);

/** The version a preview is made for, exactly as the toolkit computes it from an inventory entry. */
export const versionOf = (entry) => entry.hash ?? `${entry.size}:${entry.mtimeMs}`;

/** `**` any depth, `*` within one folder; matched against the whole project path, as the catalog does. */
export const glob = (pattern) =>
  new RegExp(`^${pattern.split('**').map((part) => part.split('*').map((text) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*')}$`);

export function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 1)}\n`);
  renameSync(temporary, path);
}

/** A previous output of this adapter, or null when it is missing, unreadable or another adapter's. */
export function readOwn(path, adapterId) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return isRecord(value) && value.format === 1 && value.adapter === adapterId && isRecord(value.files) ? value : null;
  } catch {
    return null;
  }
}
