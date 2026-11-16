#!/usr/bin/env node
// Install or upgrade the jam toolkit in a game project: the toolkit folder plus the project files it needs.
// Usage: node install.mjs [--project <dir>] [--dir <toolkit folder>] [--check] [--no-deps] [--no-lfs] [--force]
// Prints one JSON summary on stdout; exits 2 when a required npm install failed. Never authenticates, spends or commits.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '../assets');
const BUNDLE = join(ASSETS, 'toolkit');
const MARKER = '.jam-toolkit.json';
const CONFIG = 'jam.config.json';
const SKIP_DIRS = new Set(['node_modules', 'test', 'test-output', '__pycache__', '.venv', '.pytest_cache']);
const SKIP_FILES = new Set(['.DS_Store', MARKER]);
const WIN = process.platform === 'win32';

const TOOLKIT_IGNORE = ['node_modules/', '.venv/', '__pycache__/'];
const LFS_EXTENSIONS = ['glb', 'bin', 'fbx', 'obj', 'blend', 'png', 'jpg', 'jpeg', 'webp', 'exr', 'psd', 'wav', 'mp4', 'webm', 'zip'];
const CATALOG_PLUGINS = ['manifest', 'jam'];

// How to install each prerequisite on the user's OS; the summary carries the ones that are missing.
const OS = WIN ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
const HOW = {
  node: { windows: 'winget install OpenJS.NodeJS.LTS', macos: 'brew install node', linux: 'install Node.js 22.20+ from https://nodejs.org or your distribution (e.g. nvm install --lts)' },
  'git-lfs': { windows: 'winget install GitHub.GitLFS; git lfs install', macos: 'brew install git-lfs && git lfs install', linux: 'sudo apt install git-lfs && git lfs install (or your distribution\'s package)' },
  python: { windows: 'winget install Python.Python.3.12', macos: 'brew install python@3.12', linux: 'sudo apt install python3 python3-venv (or your distribution\'s package)' },
  blender: { windows: 'winget install BlenderFoundation.Blender', macos: 'brew install --cask blender', linux: 'sudo snap install blender --classic (or https://www.blender.org/download/)' },
};
const fix = (tool, why) => ({ tool, why, os: OS, command: HOW[tool][OS] });

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const posix = (path) => path.split(sep).join('/');
const run = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', timeout: 600000, windowsHide: true, ...options });
const ok = (result) => !result.error && result.status === 0;
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); };
const bundled = (path) => readJson(join(BUNDLE, path));

function bundleFiles() {
  const files = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full); }
      else if (entry.isFile() && !SKIP_FILES.has(entry.name) && !entry.name.endsWith('.pyc')) files[posix(relative(BUNDLE, full))] = sha(readFileSync(full));
    }
  };
  walk(BUNDLE);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}
const digestOf = (files) => sha(Object.entries(files).map(([path, hash]) => `${path}\0${hash}\n`).join(''));

function projectRoot(explicit) {
  if (explicit) return resolve(explicit);
  const top = run('git', ['rev-parse', '--show-toplevel']);
  return ok(top) ? resolve(top.stdout.trim()) : process.cwd();
}

// The project's configuration as it is on disk: version 2, version 1, or absent.
function readConfig(root) {
  const file = join(root, CONFIG);
  return existsSync(file) ? readJson(file) : null;
}

// Where the toolkit goes: --dir, else where this project already has it, else the shipped default.
function toolkitDir(root, explicit, config) {
  const chosen = explicit ?? (config?.version === 2 ? config.toolkit : undefined) ?? bundled('defaults/config.json').toolkit;
  const normal = posix(chosen).replace(/\/+$/, '');
  const full = resolve(root, normal);
  const inside = relative(root, full);
  if (isAbsolute(normal) || !inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error(`--dir ${chosen}: expected a folder inside the project, written relative to it (for example tools/jam)`);
  return posix(inside);
}

// Content roots: the project's own once configured, else the defaults a new configuration starts with.
function contentRoots(config) {
  const roots = config?.version === 2 ? config.roots : config?.version === 1 ? bundled('defaults/migration-v1.json').roots : bundled('defaults/config.json').roots;
  const tracked = [...new Set([roots.delivered, ...(roots.scan ?? [])])].filter((root, _, all) => !all.some((other) => other !== root && root.startsWith(`${other}/`)));
  return { scratch: roots.scratch, delivered: roots.delivered, tracked, source: config?.version === 2 ? CONFIG : 'toolkit defaults (rerun after "jam setup" if the project chooses other folders)' };
}

function inspect(dir, files) {
  const markerFile = join(dir, MARKER);
  if (!existsSync(dir)) return { state: 'absent', modified: [] };
  if (!existsSync(markerFile)) {
    const entries = readdirSync(dir).filter((name) => name !== '.DS_Store');
    return { state: entries.length ? 'foreign' : 'absent', modified: [] };
  }
  const marker = readJson(markerFile);
  const modified = Object.entries(marker.files ?? {}).filter(([path, hash]) => existsSync(join(dir, path)) && sha(readFileSync(join(dir, path))) !== hash).map(([path]) => path);
  return { state: marker.digest === digestOf(files) ? 'current' : 'outdated', marker, modified };
}
// Paths this bundle would newly take over that already hold someone else's content.
function collisions(dir, files, marker) {
  return Object.entries(files).filter(([path, hash]) => !(path in (marker?.files ?? {})) && existsSync(join(dir, path)) && sha(readFileSync(join(dir, path))) !== hash).map(([path]) => path);
}

function replaceBlock(file, start, end, lines) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const block = `${start}\n${lines.join('\n')}\n${end}\n`;
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escape(start)}[\\s\\S]*?${escape(end)}\\n?`);
  const next = pattern.test(text) ? text.replace(pattern, block) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${block}`;
  if (next !== text) writeFileSync(file, next);
  return next !== text;
}

function readLocal(root) {
  const file = join(root, 'jam.local.json');
  return existsSync(file) ? readJson(file) : {};
}
// A path-valued command in jam.local.json is project-relative; a bare name is looked up on PATH.
const localCommand = (root, command) => (/[\\/]/.test(command) ? resolve(root, command) : command);
function writeLocal(root, patch) {
  writeJson(join(root, 'jam.local.json'), { ...readLocal(root), ...patch });
}

// Run npm inside the package (no path arguments, so nothing project-specific passes through the Windows shell).
function npmInstall(dir) {
  const args = ['ci', '--ignore-scripts', '--no-audit', '--no-fund'];
  // npm is a .cmd on Windows: run it through cmd.exe with fixed arguments (no shell option, no project path).
  const result = WIN ? run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], { cwd: dir }) : run('npm', args, { cwd: dir });
  if (ok(result)) {
    // The launcher installs packages itself when this stamp does not match the lockfile.
    writeFileSync(join(dir, 'node_modules', '.jam-installed'), readFileSync(join(dir, 'package-lock.json'), 'utf8'));
    return 'installed';
  }
  const lines = `${result.error?.message ?? ''}\n${result.stderr ?? ''}`.split('\n').map((l) => l.replace(/^npm (error|ERR!) ?/, '').trim())
    .filter((l) => l && !/complete log of this run|To see a list of supported npm commands|^npm help|A complete log/i.test(l));
  return `failed: ${lines.slice(0, 4).join(' | ') || `exit ${result.status}`}`;
}

function python(root, toolkit) {
  const local = readLocal(root);
  const candidates = local.python ? [localCommand(root, local.python)] : WIN ? ['py', 'python'] : ['python3', 'python'];
  const check = 'import sys; assert sys.version_info >= (3, 10)';
  for (const command of candidates) {
    const args = command === 'py' ? ['-3'] : [];
    if (!ok(run(command, [...args, '-c', check], { cwd: root }))) continue;
    if (ok(run(command, [...args, '-c', 'import PIL, numpy'], { cwd: root }))) return { python: local.python ?? command, imaging: 'available' };
    if (local.python) return { python: local.python, imaging: `missing: install ${toolkit}/requirements.txt into ${local.python}` };
    const venv = join(root, toolkit, '.venv');
    const created = run(command, [...args, '-m', 'venv', venv]);
    const exe = join(venv, WIN ? 'Scripts/python.exe' : 'bin/python');
    if (!ok(created) || !existsSync(exe)) return { python: command, imaging: `missing: venv creation failed (${(created.stderr ?? '').trim().split('\n').pop()})` };
    const pip = run(exe, ['-m', 'pip', 'install', '--quiet', '-r', join(root, toolkit, 'requirements.txt')]);
    if (!ok(pip)) return { python: command, imaging: `missing: pip install failed (${(pip.stderr ?? '').trim().split('\n').pop()})` };
    writeLocal(root, { python: posix(relative(root, exe)) });
    return { python: posix(relative(root, exe)), imaging: 'installed in private venv' };
  }
  return { python: null, imaging: 'missing: Python 3.10+ not found (needed for turnaround cropping and the side-view check)' };
}

function blender(root) {
  const local = readLocal(root);
  if (local.blender) return { blender: local.blender, source: 'jam.local.json', runs: ok(run(localCommand(root, local.blender), ['--version'], { cwd: root, timeout: 30000 })) };
  if (ok(run('blender', ['--version'], { cwd: root, timeout: 30000 }))) return { blender: 'blender', source: 'PATH' };
  const found = [];
  if (process.platform === 'darwin') found.push('/Applications/Blender.app/Contents/MacOS/Blender');
  if (WIN) {
    const base = 'C:\\Program Files\\Blender Foundation';
    if (existsSync(base)) for (const name of readdirSync(base).sort().reverse()) found.push(join(base, name, 'blender.exe'));
  }
  const hit = found.find((path) => existsSync(path));
  if (!hit) return { blender: null, source: 'not found (optional until a Blender step is chosen)' };
  writeLocal(root, { blender: hit });
  return { blender: hit, source: 'detected and recorded in jam.local.json' };
}

// Binaries under the tracked content roots go to LFS, plus whatever the engine adapter says its own binaries are.
function lfs(root, roots, engineGlobs) {
  if (!ok(run('git', ['rev-parse', '--git-dir'], { cwd: root }))) return 'skipped: not a Git repository';
  if (!ok(run('git', ['lfs', 'version'], { cwd: root }))) return 'skipped: git-lfs is not installed; install it, then rerun to track content binaries in LFS';
  const lines = [
    ...roots.tracked.flatMap((folder) => LFS_EXTENSIONS.map((ext) => `${folder}/**/*.${ext} filter=lfs diff=lfs merge=lfs -text`)),
    ...engineGlobs.map((glob) => `${glob} filter=lfs diff=lfs merge=lfs -text`),
  ];
  const changed = replaceBlock(join(root, '.gitattributes'), '# >>> jam toolkit: content binaries in Git LFS', '# <<< jam toolkit', lines);
  const hooked = ok(run('git', ['config', 'filter.lfs.clean'], { cwd: root }));
  return `${changed ? 'added' : 'present'}: binaries under ${roots.tracked.join(', ')} tracked in LFS${hooked ? '' : '; run `git lfs install` once on this machine'}`;
}

// catalog.config.json version 2 lists plugins. A version 1 file named one adapter: the built-in ones become the
// shipped plugins; a project's own adapter module keeps working as a plugin and is listed beside them.
function catalog(root, roots) {
  const file = join(root, 'catalog.config.json');
  const v1 = bundled('defaults/migration-v1.json').catalog;
  const result = {};
  let config = existsSync(file) ? readJson(file) : null;
  const fallbackManifest = `${roots.tracked[0] ?? dirname(roots.delivered)}/catalog.json`;
  if (!config) {
    config = { version: 2, plugins: [...CATALOG_PLUGINS], options: { manifest: { file: fallbackManifest } } };
    result.catalogConfig = 'created';
  } else if (config.version === 2) {
    const missing = CATALOG_PLUGINS.filter((plugin) => !(config.plugins ?? []).includes(plugin) && plugin === 'jam');
    result.catalogConfig = missing.length ? 'added the jam plugin' : 'present';
    if (missing.length) config = { ...config, plugins: [...(config.plugins ?? []), ...missing] };
  } else {
    const { adapter, options = {}, review = {}, previewModules = {} } = config;
    const builtin = adapter === 'manifest' || adapter === 'jam' || adapter === v1.adapter || adapter === undefined;
    const manifest = typeof options.manifest === 'string' ? options.manifest : adapter === 'manifest' ? 'catalog.manifest.json' : v1.manifest;
    // Version 2 options are one object per plugin. The manifest plugin's path is `file`; a project's own adapter
    // is listed by its module path and finds its whole version 1 options object under that same key.
    const kept = builtin ? { manifest: { file: manifest } } : Object.keys(options).length ? { [adapter]: options } : {};
    // A version 2 file holds nothing else of version 1: preview modules and a resolver module are registered by a
    // plugin, and a resolver that came from a module cannot be named without it.
    const shipped = ['latest', 'strictest'].includes(review.resolver ?? 'latest');
    const keptReview = Object.fromEntries(Object.entries(review).filter(([key]) => key === 'referenceRoles' || key === 'verdicts' || (key === 'resolver' && shipped)));
    const dropped = [...(Object.keys(previewModules).length ? ['previewModules'] : []), ...(shipped ? [] : [`review.resolver ${review.resolver}`])];
    config = { version: 2, plugins: builtin ? [...CATALOG_PLUGINS] : [adapter, 'jam'], options: kept, ...(Object.keys(keptReview).length ? { review: keptReview } : {}) };
    result.catalogConfig = builtin
      ? `migrated to version 2: plugins ${CATALOG_PLUGINS.join(', ')} (keeps manifest ${manifest}); review settings kept`
      : `migrated to version 2: the project's adapter ${adapter} is kept as a plugin beside jam; if it already shows jam runs itself, remove "jam" from plugins`;
    if (dropped.length) result.catalogNotCarried = dropped;
  }
  if (result.catalogConfig !== 'present') writeJson(file, config);
  const manifest = config.options?.manifest?.file;
  if (!manifest || !config.plugins.includes('manifest')) return result;
  if (!existsSync(join(root, manifest))) {
    writeJson(join(root, manifest), { ...readJson(join(ASSETS, 'project/catalog.json')), assetRoots: roots.tracked });
    result.catalogManifest = `created ${manifest} (hand-registered external content)`;
  } else result.catalogManifest = 'present';
  return result;
}

// The toolkit's own command, once its packages are installed.
function jam(root, dir, args) {
  const result = run(process.execPath, [join(dir, 'jam.mjs'), ...args, '--json', '--root', root], { cwd: root, env: { ...process.env, JAM_NO_INSTALL: '1' } });
  try { return { ok: ok(result), value: JSON.parse(ok(result) ? result.stdout : result.stderr) }; }
  catch { return { ok: false, value: { error: { message: (result.stderr || result.stdout || String(result.error?.message)).trim() } } }; }
}

function main() {
  const { values: o } = parseArgs({ options: { project: { type: 'string' }, dir: { type: 'string' }, check: { type: 'boolean' }, 'no-deps': { type: 'boolean' }, 'no-lfs': { type: 'boolean' }, force: { type: 'boolean' }, help: { type: 'boolean' } } });
  if (o.help) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 4).join('\n')); return; }
  const root = projectRoot(o.project);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`project directory not found: ${root}`);
  const [major, minor] = process.versions.node.split('.').map(Number);
  const nodeOk = major > 22 || (major === 22 && minor >= 20);
  const before = readConfig(root);
  const toolkit = toolkitDir(root, o.dir, before);
  const dir = join(root, toolkit);
  const files = bundleFiles();
  const state = inspect(dir, files);
  const summary = { os: OS, project: root, toolkit: `${toolkit}/`, node: { version: process.versions.node, required: '22.20.0', ok: nodeOk } };

  if (o.check) {
    console.log(JSON.stringify({ ...summary, installed: state.state, locallyModified: state.modified, configuration: before === null ? 'missing' : `version ${before.version}` }, null, 2));
    return;
  }
  if (!nodeOk) throw new Error(`Node.js 22.20+ is required (found ${process.versions.node}); install it (${HOW.node[OS]}) and rerun`);
  if (state.state === 'foreign') throw new Error(`${toolkit}/ exists and was not installed by jam-setup; move it aside, or install elsewhere with --dir <folder>`);
  if (state.modified.length && !o.force) throw new Error(`locally edited toolkit files would be overwritten: ${state.modified.join(', ')}. Move the edits elsewhere (project recipes, adapters and providers live under jam/), or rerun with --force to discard them`);
  const taken = collisions(dir, files, state.marker);
  if (taken.length && !o.force) throw new Error(`files the toolkit now ships already exist with other content: ${taken.join(', ')}. Move them aside, or rerun with --force to replace them`);

  for (const path of Object.keys(state.marker?.files ?? {})) if (!(path in files)) rmSync(join(dir, path), { force: true });
  // Version 1 kept a second package under catalog/; its installed packages are not part of this layout.
  rmSync(join(dir, 'catalog', 'node_modules'), { recursive: true, force: true });
  for (const path of Object.keys(files)) { mkdirSync(dirname(join(dir, path)), { recursive: true }); copyFileSync(join(BUNDLE, path), join(dir, path)); }
  replaceBlock(join(dir, '.gitignore'), '# >>> jam toolkit: machine-local dependencies', '# <<< jam toolkit', TOOLKIT_IGNORE);
  writeJson(join(dir, MARKER), { source: 'furanku-skills jam-setup', digest: digestOf(files), files });
  summary.installed = state.state === 'absent' ? 'installed' : state.state === 'current' ? 'reinstalled (unchanged)' : 'upgraded';

  if (o['no-deps']) summary.dependencies = 'skipped (--no-deps)';
  else summary.dependencies = { jam: npmInstall(dir), ...python(root, toolkit) };
  const failed = typeof summary.dependencies === 'object' && summary.dependencies.jam !== 'installed';
  // The toolkit's own commands work once its packages match the lockfile, whoever installed them.
  const stamp = join(dir, 'node_modules', '.jam-installed');
  const usable = !failed && existsSync(stamp) && readFileSync(stamp, 'utf8') === readFileSync(join(dir, 'package-lock.json'), 'utf8');

  // Configuration: a version 1 file is upgraded by the toolkit itself; the toolkit's location is kept current.
  let config = before;
  if (config?.version === 1) {
    if (!usable) summary.configuration = `version 1: run "node ${toolkit}/jam.mjs config migrate" once the toolkit's packages are installed`;
    else {
      const migrated = jam(root, dir, ['config', 'migrate']);
      summary.configuration = migrated.ok ? { migrated: true, recipes: migrated.value.recipes, notes: migrated.value.notes } : { migrated: false, error: migrated.value.error?.message };
      config = readConfig(root);
    }
  } else summary.configuration = config === null ? 'missing' : 'version 2';
  if (config?.version === 2 && config.toolkit !== toolkit) {
    config = { ...config, toolkit };
    writeJson(join(root, CONFIG), config);
    summary.configuration = typeof summary.configuration === 'object' ? { ...summary.configuration, toolkit } : `version 2 (toolkit set to ${toolkit})`;
  }

  const roots = contentRoots(config);
  summary.roots = { scratch: roots.scratch, tracked: roots.tracked, from: roots.source };
  summary.gitignore = replaceBlock(join(root, '.gitignore'), '# >>> jam toolkit', '# <<< jam toolkit', [`/${roots.scratch}/`, '/jam.local.json', '.catalog/.local/']) ? 'updated' : 'present';
  Object.assign(summary, catalog(root, roots));
  const engineBinaries = usable && config?.version === 2 ? jam(root, dir, ['engine', 'facts', 'binaries.lfs']) : null;
  summary.lfs = o['no-lfs'] ? 'skipped (--no-lfs)' : lfs(root, roots, engineBinaries?.ok && Array.isArray(engineBinaries.value) ? engineBinaries.value : []);
  summary.dcc = blender(root);

  if (usable) {
    const doctor = jam(root, dir, ['doctor']);
    summary.doctor = doctor.ok ? doctor.value : { error: doctor.value.error?.message };
  } else summary.doctor = `not run: the toolkit's packages are not installed${o['no-deps'] ? ' (--no-deps)' : ''}; run "node ${toolkit}/jam.mjs doctor" afterwards`;

  const next = [];
  if (failed) next.push('Fix the failed npm install: rerun this installer after addressing the reported error');
  if (config === null) next.push(`Create ${CONFIG}: "node ${toolkit}/jam.mjs setup" prints the choices to decide with the user, then "node ${toolkit}/jam.mjs setup --from <choices.json>"; rerun this installer afterwards if the content folders differ from the defaults`);
  if (config?.version === 1) next.push(`Upgrade ${CONFIG}: "node ${toolkit}/jam.mjs config migrate" (add --dry-run to preview)`);
  if (summary.catalogNotCarried) next.push(`catalog.config.json version 2 registers preview modules and verdict resolvers from a plugin: move ${summary.catalogNotCarried.join(' and ')} into one (${toolkit}/src/catalog/README.md, "Scopes, resolvers and previews"); Git has the version 1 file`);
  if (String(summary.catalogConfig).includes('remove "jam"')) next.push('Check the catalog shows each jam run once (catalog.config.json lists the project\'s adapter and the jam plugin)');
  next.push(`Commit ${toolkit}/, ${existsSync(join(root, 'jam')) ? 'jam/, ' : ''}catalog.config.json, .gitignore and .gitattributes changes when the user wants them versioned`);
  const fixes = [];
  if (String(summary.lfs).includes('git-lfs is not installed')) fixes.push(fix('git-lfs', 'versions content binaries; rerun the installer afterwards'));
  else if (String(summary.lfs).includes('git lfs install')) fixes.push({ tool: 'git-lfs', why: 'enable LFS once on this machine', os: OS, command: 'git lfs install' });
  if (typeof summary.dependencies === 'object' && String(summary.dependencies.imaging).startsWith('missing') && !summary.dependencies.python) fixes.push(fix('python', 'turnaround cropping and the side-view check; rerun the installer afterwards'));
  if (!summary.dcc.blender) fixes.push(fix('blender', 'only for local Blender steps (mesh finishing, rigging, format conversion); rerun the installer afterwards'));
  summary.fixes = fixes;
  summary.complete = !failed;
  summary.next = next;
  console.log(JSON.stringify(summary, null, 2));
  if (failed) process.exitCode = 2;
}

try { main(); } catch (error) { console.error(`jam-setup install: ${error.message}`); process.exitCode = 1; }
