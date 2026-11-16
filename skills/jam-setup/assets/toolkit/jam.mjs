#!/usr/bin/env node
// Launcher for the jam toolkit. It uses only Node built-ins so it can run before anything is
// installed: it checks the Node version, installs the toolkit's npm packages the first time (a
// fresh clone or worktree has none), and then hands over to the command itself.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const say = (line) => process.stderr.write(`${line}\n`);

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 20)) {
  say(`error: the jam toolkit needs Node.js 22.20 or newer; this is ${process.versions.node}`);
  say('  fix: install a current Node.js (nodejs.org, or your package manager), open a new terminal and run the command again');
  process.exit(1);
}

// Installed means: node_modules holds the versions the lockfile asks for. The stamp records the
// lockfile it was installed from, so an upgraded toolkit reinstalls once.
const lock = join(here, 'package-lock.json');
const stamp = join(here, 'node_modules', '.jam-installed');
const wanted = existsSync(lock) ? readFileSync(lock, 'utf8') : '';
const installed = existsSync(stamp) && readFileSync(stamp, 'utf8') === wanted;
if (!installed) {
  if (process.env.JAM_NO_INSTALL === '1') {
    say('error: the jam toolkit packages are not installed');
    say(`  fix: run "npm ci --ignore-scripts" in ${here}, or unset JAM_NO_INSTALL`);
    process.exit(1);
  }
  say('jam: installing toolkit packages (first run in this checkout)...');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, [existsSync(lock) ? 'ci' : 'install', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: here,
    stdio: ['ignore', 2, 2],
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    say('error: installing the toolkit packages failed');
    say(`  fix: run "npm ci --ignore-scripts" in ${here} and read its output`);
    process.exit(1);
  }
  writeFileSync(stamp, wanted);
}

await import('./src/cli/main.ts');
