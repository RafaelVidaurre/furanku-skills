#!/usr/bin/env node
// Install or upgrade the jam toolkit in a game project: tools/jam/ plus the project files it needs.
// Usage: node install.mjs [--project <dir>] [--check] [--no-deps] [--no-lfs] [--force]
// Prints one JSON summary on stdout; exits 2 when a required npm install failed. Never authenticates, spends or commits.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '../assets');
const BUNDLE = join(ASSETS, 'toolkit');
const TARGET = 'tools/jam';
const MARKER = '.jam-toolkit.json';
const SKIP_DIRS = new Set(['node_modules', 'test', 'test-output', '__pycache__', '.venv', '.pytest_cache']);
const SKIP_FILES = new Set(['.DS_Store', MARKER]);
const WIN = process.platform === 'win32';

const TOOLKIT_IGNORE = ['node_modules/', '.venv/', '__pycache__/', 'catalog/test-output/'];
const IGNORE_BLOCK = ['/Art/.scratch/', '/Art/.jam-jobs.lock', '/jam.local.json', '.catalog/.local/'];
const LFS_EXTENSIONS = ['glb', 'bin', 'fbx', 'obj', 'blend', 'png', 'jpg', 'jpeg', 'webp', 'exr', 'psd', 'mp4', 'webm', 'zip'];
const JAM_ADAPTER = './tools/jam/catalog-adapter.mjs';
const BUILTIN_ADAPTERS = new Set(['manifest', 'jam']);

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

function inspect(root, bundled) {
  const dir = join(root, TARGET);
  const markerFile = join(dir, MARKER);
  if (!existsSync(dir)) return { state: 'absent', modified: [] };
  if (!existsSync(markerFile)) {
    const entries = readdirSync(dir).filter((name) => name !== '.DS_Store');
    return { state: entries.length ? 'foreign' : 'absent', modified: [] };
  }
  const marker = JSON.parse(readFileSync(markerFile, 'utf8'));
  const modified = Object.entries(marker.files ?? {}).filter(([path, hash]) => existsSync(join(dir, path)) && sha(readFileSync(join(dir, path))) !== hash).map(([path]) => path);
  return { state: marker.digest === digestOf(bundled) ? 'current' : 'outdated', marker, modified };
}
// Paths this bundle would newly take over that already hold someone else's content.
function collisions(root, bundled, marker) {
  const dir = join(root, TARGET);
  return Object.entries(bundled).filter(([path, hash]) => !(path in (marker?.files ?? {})) && existsSync(join(dir, path)) && sha(readFileSync(join(dir, path))) !== hash).map(([path]) => path);
}

function replaceBlock(file, start, end, lines) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const block = `${start}\n${lines.join('\n')}\n${end}\n`;
  const pattern = new RegExp(`${start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`);
  const next = pattern.test(text) ? text.replace(pattern, block) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${block}`;
  if (next !== text) writeFileSync(file, next);
  return next !== text;
}

function readLocal(root) {
  const file = join(root, 'jam.local.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}
// A path-valued command in jam.local.json is project-relative; a bare name is looked up on PATH.
const localCommand = (root, command) => (/[\\/]/.test(command) ? resolve(root, command) : command);
function writeLocal(root, patch) {
  writeFileSync(join(root, 'jam.local.json'), `${JSON.stringify({ ...readLocal(root), ...patch }, null, 2)}\n`);
}

// Run npm inside the package (no path arguments, so nothing project-specific passes through the Windows shell).
function npmInstall(dir) {
  const args = ['ci', '--ignore-scripts', '--no-audit', '--no-fund'];
  // npm is a .cmd on Windows: run it through cmd.exe with fixed arguments (no shell option, no project path).
  const result = WIN ? run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], { cwd: dir }) : run('npm', args, { cwd: dir });
  if (ok(result)) return 'installed';
  const lines = `${result.error?.message ?? ''}\n${result.stderr ?? ''}`.split('\n').map((l) => l.replace(/^npm (error|ERR!) ?/, '').trim())
    .filter((l) => l && !/complete log of this run|To see a list of supported npm commands|^npm help|A complete log/i.test(l));
  return `failed: ${lines.slice(0, 4).join(' | ') || `exit ${result.status}`}`;
}

function python(root) {
  const local = readLocal(root);
  const candidates = local.python ? [localCommand(root, local.python)] : WIN ? ['py', 'python'] : ['python3', 'python'];
  const check = 'import sys; assert sys.version_info >= (3, 10)';
  for (const command of candidates) {
    const args = command === 'py' ? ['-3'] : [];
    if (!ok(run(command, [...args, '-c', check], { cwd: root }))) continue;
    if (ok(run(command, [...args, '-c', 'import PIL, numpy'], { cwd: root }))) return { python: local.python ?? command, imaging: 'available' };
    if (local.python) return { python: local.python, imaging: `missing: install ${TARGET}/requirements.txt into ${local.python}` };
    const venv = join(root, TARGET, '.venv');
    const created = run(command, [...args, '-m', 'venv', venv]);
    const exe = join(venv, WIN ? 'Scripts/python.exe' : 'bin/python');
    if (!ok(created) || !existsSync(exe)) return { python: command, imaging: `missing: venv creation failed (${(created.stderr ?? '').trim().split('\n').pop()})` };
    const pip = run(exe, ['-m', 'pip', 'install', '--quiet', '-r', join(root, TARGET, 'requirements.txt')]);
    if (!ok(pip)) return { python: command, imaging: `missing: pip install failed (${(pip.stderr ?? '').trim().split('\n').pop()})` };
    writeLocal(root, { python: posix(relative(root, exe)) });
    return { python: posix(relative(root, exe)), imaging: 'installed in private venv' };
  }
  return { python: null, imaging: 'missing: Python 3.10+ not found (needed for turnaround cropping and character texture tools)' };
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

function lfs(root) {
  if (!ok(run('git', ['rev-parse', '--git-dir'], { cwd: root }))) return 'skipped: not a Git repository';
  if (!ok(run('git', ['lfs', 'version'], { cwd: root }))) return 'skipped: git-lfs is not installed; install it, then rerun to track Art binaries in LFS';
  const lines = LFS_EXTENSIONS.map((ext) => `Art/**/*.${ext} filter=lfs diff=lfs merge=lfs -text`);
  const changed = replaceBlock(join(root, '.gitattributes'), '# >>> jam toolkit: Art binaries in Git LFS', '# <<< jam toolkit', lines);
  const hooked = ok(run('git', ['config', 'filter.lfs.clean'], { cwd: root }));
  return `${changed ? 'added' : 'present'}: Art binaries tracked in LFS${hooked ? '' : '; run `git lfs install` once on this machine'}`;
}

// The jam adapter shows jam runs plus a manifest of external content. A project already on the built-in
// manifest or jam adapter moves to it with its manifest and every other setting kept; a custom adapter is left
// alone and reported, since only its owner can compose the two.
function catalog(root) {
  const file = join(root, 'catalog.config.json');
  const result = {};
  let config = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  if (!config) { config = { version: 1, adapter: JAM_ADAPTER }; result.catalogConfig = 'created'; }
  else if (config.adapter === JAM_ADAPTER) result.catalogConfig = 'present';
  else if (BUILTIN_ADAPTERS.has(config.adapter)) {
    const manifestPath = config.adapter === 'manifest' ? (config.options?.manifest ?? 'catalog.manifest.json') : undefined;
    result.catalogConfig = `switched from the built-in ${config.adapter} adapter to ${JAM_ADAPTER}${manifestPath ? ` (keeps manifest ${manifestPath})` : ''}; other settings kept`;
    config = { ...config, adapter: JAM_ADAPTER, options: { ...(config.options ?? {}), ...(manifestPath ? { manifest: manifestPath } : {}) } };
  } else {
    return { catalogConfig: `incomplete: custom adapter ${config.adapter} kept; jam runs stay invisible in the catalog until that adapter also loads ${JAM_ADAPTER}'s jam part (tools/jam/docs/external-content.md#catalog-adapter)` };
  }
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  const manifest = config.options?.manifest ?? 'Art/catalog.json';
  if (!existsSync(join(root, manifest))) {
    mkdirSync(dirname(join(root, manifest)), { recursive: true });
    copyFileSync(join(ASSETS, 'project/catalog.json'), join(root, manifest));
    result.catalogManifest = `created ${manifest} (external-asset type; unit files in Art/Catalog/)`;
  } else result.catalogManifest = 'present';
  return result;
}

function main() {
  const { values: o } = parseArgs({ options: { project: { type: 'string' }, check: { type: 'boolean' }, 'no-deps': { type: 'boolean' }, 'no-lfs': { type: 'boolean' }, force: { type: 'boolean' }, help: { type: 'boolean' } } });
  if (o.help) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 4).join('\n')); return; }
  const root = projectRoot(o.project);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`project directory not found: ${root}`);
  const [major, minor] = process.versions.node.split('.').map(Number);
  const nodeOk = major > 22 || (major === 22 && minor >= 20);
  const bundled = bundleFiles();
  const before = inspect(root, bundled);
  const summary = { os: OS, project: root, toolkit: `${TARGET}/`, node: { version: process.versions.node, required: '22.20.0', ok: nodeOk } };

  if (o.check) {
    console.log(JSON.stringify({ ...summary, installed: before.state, locallyModified: before.modified }, null, 2));
    return;
  }
  if (!nodeOk) throw new Error(`Node.js 22.20+ is required (found ${process.versions.node}); install it (${HOW.node[OS]}) and rerun`);
  if (before.state === 'foreign') throw new Error(`${TARGET}/ exists and was not installed by jam-setup; move it aside or choose another project`);
  if (before.modified.length && !o.force) throw new Error(`locally edited toolkit files would be overwritten: ${before.modified.join(', ')}. Move the edits elsewhere, or rerun with --force to discard them`);
  const taken = collisions(root, bundled, before.marker);
  if (taken.length && !o.force) throw new Error(`files the toolkit now ships already exist with other content: ${taken.join(', ')}. Move them aside, or rerun with --force to replace them`);

  const dir = join(root, TARGET);
  for (const path of Object.keys(before.marker?.files ?? {})) if (!(path in bundled)) rmSync(join(dir, path), { force: true });
  for (const path of Object.keys(bundled)) { mkdirSync(dirname(join(dir, path)), { recursive: true }); copyFileSync(join(BUNDLE, path), join(dir, path)); }
  replaceBlock(join(dir, '.gitignore'), '# >>> jam toolkit: machine-local dependencies', '# <<< jam toolkit', TOOLKIT_IGNORE);
  writeFileSync(join(dir, MARKER), `${JSON.stringify({ source: 'furanku-skills jam-setup', digest: digestOf(bundled), files: bundled }, null, 2)}\n`);
  summary.installed = before.state === 'absent' ? 'installed' : before.state === 'current' ? 'reinstalled (unchanged)' : 'upgraded';

  summary.gitignore = replaceBlock(join(root, '.gitignore'), '# >>> jam toolkit', '# <<< jam toolkit', IGNORE_BLOCK) ? 'updated' : 'present';
  Object.assign(summary, catalog(root));
  summary.lfs = o['no-lfs'] ? 'skipped (--no-lfs)' : lfs(root);

  if (o['no-deps']) summary.dependencies = 'skipped (--no-deps)';
  else summary.dependencies = { jam: npmInstall(dir), catalog: npmInstall(join(dir, 'catalog')), ...python(root) };
  const failed = typeof summary.dependencies === 'object' && ['jam', 'catalog'].filter((name) => summary.dependencies[name] !== 'installed');
  summary.dcc = blender(root);

  const doctor = run(process.execPath, [join(dir, 'jam.mjs'), 'doctor', '--root', root], { cwd: root });
  summary.doctor = ok(doctor) ? JSON.parse(doctor.stdout) : { error: (doctor.stderr || doctor.stdout).trim() };
  const next = [];
  if (!existsSync(join(root, 'jam.config.json'))) next.push('Create jam.config.json: ask the setup decisions (tools/jam/docs/setup.md), then `node tools/jam/jam.mjs setup --from <choices.json>`');
  if (failed?.length) next.unshift(`Fix the failed npm install (${failed.join(', ')}): rerun this installer after addressing the reported error`);
  if (String(summary.catalogConfig).startsWith('incomplete')) next.push('Compose the jam adapter into the project\'s custom catalog adapter (tools/jam/docs/external-content.md#catalog-adapter)');
  next.push('Commit tools/jam/, catalog.config.json, .gitignore and .gitattributes changes when the user wants them versioned');
  const fixes = [];
  if (String(summary.lfs).includes('git-lfs is not installed')) fixes.push(fix('git-lfs', 'versions Art/ binaries; rerun the installer afterwards'));
  else if (String(summary.lfs).includes('git lfs install')) fixes.push({ tool: 'git-lfs', why: 'enable LFS once on this machine', os: OS, command: 'git lfs install' });
  if (typeof summary.dependencies === 'object' && String(summary.dependencies.imaging).startsWith('missing') && !summary.dependencies.python) fixes.push(fix('python', 'turnaround cropping and character texture tools; rerun the installer afterwards'));
  if (!summary.dcc.blender) fixes.push(fix('blender', 'only for local Blender steps (prop and character pipelines, format conversion); rerun the installer afterwards'));
  summary.fixes = fixes;
  summary.complete = !failed?.length;
  summary.next = next;
  console.log(JSON.stringify(summary, null, 2));
  if (failed?.length) process.exitCode = 2;
}

try { main(); } catch (error) { console.error(`jam-setup install: ${error.message}`); process.exitCode = 1; }
