import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync, readdirSync, lstatSync, readlinkSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { draftConfig } from '../core.mjs';
const cli = resolve(import.meta.dirname, '../jam.mjs');
function workspace(t) { const root = mkdtempSync(join(tmpdir(), 'jam cli ')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }
function run(root, ...args) { return spawnSync(process.execPath, [cli, ...args, '--root', root], { encoding: 'utf8' }); }
test('initial setup is noninteractive when supplied decisions, never overwrites existing config or MCP', (t) => {
  const root = workspace(t); const settings = JSON.stringify(draftConfig());
  writeFileSync(join(root, 'choices.json'), settings); writeFileSync(join(root, '.mcp.json'), 'existing provider configuration');
  assert.equal(run(root, 'setup').status, 1);
  assert.equal(run(root, 'setup', '--from', 'choices.json').status, 0);
  const before = readFileSync(join(root, 'jam.config.json'), 'utf8');
  assert.equal(run(root, 'setup', '--from', 'choices.json').status, 1);
  assert.equal(readFileSync(join(root, 'jam.config.json'), 'utf8'), before);
  assert.equal(readFileSync(join(root, '.mcp.json'), 'utf8'), 'existing provider configuration');
});
test('doctor can probe a Windows npm-style cmd launcher in a path with spaces', { skip: process.platform !== 'win32' }, (t) => {
  const root = workspace(t), command = join(root, 'meshy fixture.cmd');
  writeFileSync(command, '@echo off\r\necho fixture-version\r\nexit /b 0\r\n');
  writeFileSync(join(root,'jam.local.json'),JSON.stringify({meshy:command}));
  const result=run(root,'doctor');assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).tools.meshy.installed,true);
});
test('settings round-trips independent provider caps, no cap and disabled spending without changing other choices', (t) => {
  const root = workspace(t), config = draftConfig();
  config.style.document = 'chosen-style.md'; config.review.stages.texture = 'agent';
  writeFileSync(join(root, 'jam.config.json'), JSON.stringify(config));
  const before = readFileSync(join(root, 'jam.config.json'), 'utf8');
  const readOnly = run(root, 'settings'); assert.equal(readOnly.status, 0, readOnly.stderr);
  assert.equal(readFileSync(join(root, 'jam.config.json'), 'utf8'), before);
  assert.match(JSON.parse(readOnly.stdout).spend.scenario.label, /Scenario.*Compute Units/);
  for (const [provider, value, expected] of [['meshy', '125.5', 125.5], ['scenario', 'none', null], ['scenario', '0', 0]]) {
    const result = run(root, 'settings', '--provider', provider, '--limit', value);
    assert.equal(result.status, 0, result.stderr);
    config.spend[provider].limit = expected;
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'jam.config.json'), 'utf8')), config);
  }
  for (const args of [
    ['--provider', 'meshy'], ['--provider', 'other', '--limit', 'none'],
    ['--provider', 'scenario', '--limit', '-1'], ['--provider', 'scenario', '--limit', 'Infinity'],
    ['--provider', 'scenario', '--limit', '0x10'], ['--provider', 'scenario', '--limit', '1e3'],
    ['--provider', 'scenario', '--limit', ''], ['--provider', 'scenario', '--limit', 'null'],
    ['--stage', 'texture', '--review', 'agent', '--run', 'Art/example/run.json'],
    ['--provider', 'scenario', '--limit', 'none', '--stage', 'texture', '--review', 'agent']
  ]) {
    assert.equal(run(root, 'settings', ...args).status, 1, args.join(' '));
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'jam.config.json'), 'utf8')), config);
  }
});
test('checkpoint settings toggle one stage, inherit, and replace all only when explicitly requested', (t) => {
  const root = workspace(t), config = draftConfig();
  config.review.stages = { concept: 'human', texture: 'agent' };
  config.spend.scenario.limit = null;
  writeFileSync(join(root, 'jam.config.json'), JSON.stringify(config));
  const change = (stage, mode) => {
    const result = run(root, 'settings', '--stage', stage, '--review', mode);
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  };
  assert.equal(change('turnaround', 'agent').effectiveProjectReview.turnaround, 'agent');
  assert.equal(change('turnaround', 'human').effectiveProjectReview.turnaround, 'human');
  const inherited = change('turnaround', 'inherit');
  assert.equal(inherited.effectiveProjectReview.turnaround, 'human');
  assert.equal(Object.hasOwn(inherited.review.stages, 'turnaround'), false);
  assert.equal(inherited.effectiveProjectReview.texture, 'agent');
  const all = change('all', 'agent');
  assert.deepEqual(all.review, { default: 'agent', stages: {} });
  assert.ok(Object.values(all.effectiveProjectReview).every((mode) => mode === 'agent'));
  config.review = all.review;
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'jam.config.json'), 'utf8')), config);
  assert.equal(run(root, 'settings', '--stage', 'all', '--review', 'inherit').status, 1);
  assert.equal(run(root, 'settings', '--stage', 'typo', '--review', 'agent').status, 1);
  writeFileSync(join(root, 'jam.config.json.lock'), 'another owner');
  assert.equal(run(root, 'settings', '--stage', 'texture', '--review', 'human').status, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'jam.config.json'), 'utf8')), config);
});
test('pipeline checkpoint settings change one profile without touching the project or other pipelines', (t) => {
  const root = workspace(t), config = draftConfig();
  config.profiles = { prop: {}, character: {} };
  writeFileSync(join(root, 'jam.config.json'), JSON.stringify(config));
  const change = (...args) => {
    const result = run(root, 'settings', ...args, '--profile', 'prop');
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  };
  let out = change('--stage', 'all', '--review', 'agent');
  assert.deepEqual(out.review, { default: 'human', stages: {}, profiles: { prop: { default: 'agent' } } });
  assert.ok(Object.values(out.effectivePipelineReview.prop).every((mode) => mode === 'agent'));
  assert.ok(Object.values(out.effectivePipelineReview.character).every((mode) => mode === 'human'));
  assert.ok(Object.values(out.effectiveProjectReview).every((mode) => mode === 'human'));
  out = change('--stage', 'delivery', '--review', 'human');
  assert.equal(out.effectivePipelineReview.prop.delivery, 'human');
  assert.equal(out.effectivePipelineReview.prop.texture, 'agent');
  out = change('--stage', 'delivery', '--review', 'inherit');
  assert.deepEqual(out.review.profiles, { prop: { default: 'agent' } });
  assert.equal(run(root, 'settings', '--stage', 'texture', '--review', 'agent', '--profile', 'missing').status, 1);
  assert.equal(run(root, 'settings', '--profile', 'prop').status, 1);
});
test('initial setup accepts explicit no cap but rejects missing or malformed limits', (t) => {
  const root = workspace(t), config = draftConfig(); config.spend.scenario.limit = null;
  for (const bad of [undefined, 'none', -1]) {
    config.spend.meshy.limit = bad;
    writeFileSync(join(root, 'choices.json'), JSON.stringify(config));
    assert.equal(run(root, 'setup', '--from', 'choices.json').status, 1);
  }
  config.spend.meshy.limit = 42;
  writeFileSync(join(root, 'choices.json'), JSON.stringify(config));
  const result = run(root, 'setup', '--from', 'choices.json');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'jam.config.json'), 'utf8')), config);
});
