#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { draftConfig, validateConfig, reviewerFor, newRun, register, review, status, jobIntent, jobUpdate, json, writeJson, mutate, portable, STAGES, withLock, checkDelivery } from './core.mjs';

import { measureFiles } from './measurement.mjs';

const HELP = `Jam asset records and setup (Node.js 22.20+). All paths are project-relative.
  node tools/jam/jam.mjs setup [--from choices.json] [--root folder]
  node tools/jam/jam.mjs settings [--root folder]
  node tools/jam/jam.mjs settings --provider <meshy|scenario> --limit <number|none>
  node tools/jam/jam.mjs settings --stage <stage|all> --review <human|agent|inherit> [--profile <pipeline>]
  node tools/jam/jam.mjs measure --file <asset.glb> [--root folder]
  node tools/jam/jam.mjs doctor [--root folder]
  node tools/jam/jam.mjs init --run Art/.scratch/table/v1/run.json --id table --brief Art/.scratch/table/v1/brief.md [--profile prop] [--human concept,delivery] [--exploration]
  node tools/jam/jam.mjs register --run <run.json> --record <stage.json>
  node tools/jam/jam.mjs status --run <run.json>
  node tools/jam/jam.mjs review --run <run.json> --stage <stage> --record <decision.json>
  node tools/jam/jam.mjs job-intent --run <run.json> --record <intent.json>
  node tools/jam/jam.mjs job-update --run <run.json> --job <id> --record <update.json>
  node tools/jam/jam.mjs check-delivery --run <run.json>
  node tools/jam/jam.mjs catalog <serve|actions|run|capture> ...   content catalog for this checkout (tools/jam/catalog)

Setup writes jam.config.json only after preview/confirmation. It never authenticates or spends.
Omit --profile for style-bound concept/turnaround work; geometry requires a profiled run.
Settings applies explicit project choices: 0 disables paid work; none removes the per-run cap.
Review agent disables the human checkpoint, not quality checks. Stage all replaces the project review policy.
Stricter per-run human requirements remain in force. Stage inherit restores the project default.
Use jam-setup for supported provider/client connection steps; tools/jam/docs/contracts.md defines records.
Mutations lock and atomically replace one run. One writer owns a run; no automatic lock recovery.
`;
const output = (value) => console.log(JSON.stringify(value, null, 2));
const spendLabels = { meshy: 'Meshy credits', scenario: 'Scenario credits (Compute Units, CU)' };
function spendLimit(value) {
  value = value?.trim();
  if (value === 'none') return null;
  if (!/^\d+(\.\d+)?$/.test(value ?? '') || !Number.isFinite(Number(value))) throw new Error('limit must be a nonnegative decimal number, or none for no cap');
  return Number(value);
}
function settings(root, options) {
  for (const name of Object.keys(options)) if (!['root', 'provider', 'limit', 'stage', 'review', 'profile'].includes(name)) throw new Error(`settings does not accept --${name}; settings changes project or pipeline policy only`);
  const spend = options.provider !== undefined || options.limit !== undefined;
  const checkpoint = options.stage !== undefined || options.review !== undefined;
  if (spend && checkpoint) throw new Error('change spending or checkpoints in one command, not both');
  if (options.profile !== undefined && !checkpoint) throw new Error('--profile scopes a review checkpoint change: add --stage and --review');
  if (spend && (!Object.hasOwn(spendLabels, options.provider) || options.limit === undefined)) throw new Error('choose --provider meshy|scenario and --limit number|none');
  if (checkpoint && (![...STAGES, 'all'].includes(options.stage) || !['human', 'agent', 'inherit'].includes(options.review) || options.stage === 'all' && options.review === 'inherit')) throw new Error('choose --stage <stage> --review human|agent|inherit, or --stage all --review human|agent');
  const limit = spend ? spendLimit(options.limit) : undefined;
  const file = resolve(root, 'jam.config.json');
  if (!existsSync(file)) throw new Error('project settings are missing; use jam-setup first');
  const describe = (config) => ({
    spend: Object.fromEntries(Object.entries(config.spend).map(([provider, budget]) => [provider, { ...budget, label: spendLabels[provider], perRun: budget.limit === null ? 'No cap' : budget.limit === 0 ? 'Paid generation disabled' : `${budget.limit} ${spendLabels[provider]}` }])),
    review: config.review,
    effectiveProjectReview: Object.fromEntries(STAGES.map((stage) => [stage, reviewerFor(config, undefined, stage)])),
    effectivePipelineReview: Object.fromEntries(Object.keys(config.profiles).map((profile) => [profile, Object.fromEntries(STAGES.map((stage) => [stage, reviewerFor(config, profile, stage)]))])),
    runOverrides: 'Existing runs may require additional human checkpoints; their humanStages remain in force.'
  });
  if (!spend && !checkpoint) { const config = json(file); validateConfig(config); output(describe(config)); return; }
  output(mutate(file, (config) => {
    validateConfig(config);
    if (spend) config.spend[options.provider].limit = limit;
    if (checkpoint && options.profile !== undefined) {
      if (!Object.hasOwn(config.profiles, options.profile)) throw new Error(`unknown pipeline profile ${options.profile}`);
      const profiles = config.review.profiles ??= {};
      const policy = profiles[options.profile] ??= {};
      if (options.stage === 'all') { policy.default = options.review; policy.stages = {}; }
      else if (options.review === 'inherit') delete (policy.stages ?? {})[options.stage];
      else (policy.stages ??= {})[options.stage] = options.review;
      if (policy.stages && !Object.keys(policy.stages).length) delete policy.stages;
      if (!Object.keys(policy).length) delete profiles[options.profile];
      if (!Object.keys(profiles).length) delete config.review.profiles;
    } else if (checkpoint) {
      if (options.stage === 'all') config.review = { ...config.review, default: options.review, stages: {} };
      else if (options.review === 'inherit') delete config.review.stages[options.stage];
      else config.review.stages[options.stage] = options.review;
    }
    validateConfig(config);
    return describe(config);
  }));
}
async function setup(root, source) {
  const file = resolve(root, 'jam.config.json');
  if (source) {
    const config = json(portable(root, source));
    validateConfig(config);
    if (existsSync(file)) throw new Error('configuration exists; edit reviewed fields in place instead of replacing it');
    writeJson(file, config);
    output({ configured: true, productionReady: false, next: 'Run doctor; resolve style for concept/turnaround init. Resolve an asset profile before geometry work.' });
    return;
  }
  if (existsSync(file)) { output({ configured: true, next: 'Use jam-setup to review only unresolved choices; existing configuration preserved.' }); return; }
  if (!process.stdin.isTTY) throw new Error('setup needs a terminal, or --from with previously decided configuration');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (prompt, fallback) => (await rl.question(`${prompt} [${fallback}]: `)).trim() || fallback;
  const config = draftConfig();
  try {
    console.log('Create portable art settings. Leave creative decisions unresolved if the game style is not established. No secrets are requested.');
    const style = await ask('Style guide path, or later', 'later');
    if (style !== 'later') { portable(root, style); config.style.document = style; }
    const mode = await ask('Reviews: human at every stage, checkpoints (concept/turnaround/delivery), or agent', 'human');
    if (!['human', 'checkpoints', 'agent'].includes(mode)) throw new Error('choose human, checkpoints or agent');
    config.review.default = mode === 'human' ? 'human' : 'agent';
    if (mode === 'checkpoints') config.review.stages = { concept: 'human', turnaround: 'human', delivery: 'human' };
    config.providers.mesh = await ask('Mesh route: meshy or scenario', 'meshy');
    if (!['meshy', 'scenario'].includes(config.providers.mesh)) throw new Error('mesh route must be meshy or scenario');
    console.log('Each billing provider has its own per-run limit; their credits are not interchangeable. No cap removes only this toolkit limit; provider/account limits still apply.');
    for (const provider of ['meshy', 'scenario']) config.spend[provider].limit = spendLimit(await ask(`Maximum ${spendLabels[provider]} PER RUN: 0 = paid generation disabled, number = custom cap, none = No cap`, '0'));
    const profile = await ask('Create an asset profile now? Profile name, or later', 'later');
    if (profile !== 'later') {
      if (!/^[a-z][a-z0-9-]*$/.test(profile)) throw new Error('profile name must use lowercase letters, digits and hyphens');
      console.log('Budget ranges are decision aids in docs/research/asset-workflows.md. There is no universal game-ready count.');
      const p = {};
      p.platforms = (await ask('Target platforms (comma-separated)', 'Windows,macOS')).split(',').map((s) => s.trim());
      p.renderer = await ask('Target renderer (e.g. desktop deferred / Nanite)', 'unresolved');
      if (p.renderer === 'unresolved') throw new Error('resolve the renderer or leave this profile for later');
      p.camera = await ask('Camera / expected screen size and instance count', 'unresolved');
      if (p.camera === 'unresolved') throw new Error('resolve camera constraints or rerun and leave the profile for later');
      p.assetKind = await ask('Asset kind: static or deforming', 'static');
      for (const field of ['targetTriangles', 'maxTriangles', 'textureSize', 'maxMaterials', 'expectedInstances', 'cameraDistanceMeters', 'screenCoveragePercent', 'maxTextureMiB']) p[field] = Number(await ask(`${field} (explicit project choice)`, 'unresolved'));
      if (p.assetKind === 'deforming') {
        p.skeleton = await ask('Target skeleton', 'unresolved');
        p.maxInfluences = Number(await ask('Maximum skin influences', '4'));
        p.poseRequirements = await ask('Representative/extreme poses to inspect', 'unresolved');
        if (p.skeleton === 'unresolved' || p.poseRequirements === 'unresolved') throw new Error('resolve deformation requirements or leave the profile for later');
      }
      p.units = await ask('Authoring units', 'meters');
      p.up = await ask('Authoring up axis', '+Z');
      p.forward = await ask('Authoring forward axis', '-Y');
      p.pivot = await ask('Pivot convention', 'bottom-center');
      p.materialWorkflow = await ask('Material workflow', 'pbr');
      config.profiles[profile] = p;
      // A profile may be saved before the style guide is authored, but validate its numbers now.
      validateConfig({ ...config, style: { ...config.style, document: config.style.document ?? 'pending' } }, profile);
    }
    validateConfig(config);
    output(config);
    if ((await ask('Write this configuration? yes/no', 'no')) !== 'yes') { output({ written: false }); return; }
    writeJson(file, config);
    output({ written: true, next: 'Run doctor, then use jam-setup for provider connection and jam-style for unresolved creative decisions.' });
  } finally { rl.close(); }
}
// A path-valued command in jam.local.json is project-relative; a bare name is looked up on PATH.
const localCommand = (root, command) => (/[\\/]/.test(command) ? resolve(root, command) : command);
function doctor(root) {
  const file = resolve(root, 'jam.config.json');
  const [major, minor] = process.versions.node.split('.').map(Number);
  const result = { node: { version: process.versions.node, minimum: '22.20.0', supported: major > 22 || major === 22 && minor >= 20 }, configuration: 'missing', profiles: [], tools: {}, providerAccess: 'unverified: discover tools and perform a free authenticated scope/schema call in the agent session' };
  if (existsSync(file)) {
    const config = json(file); validateConfig(config); result.configuration = 'draft';
    for (const name of Object.keys(config.profiles)) {
      try { validateConfig(config, name); for (const path of [config.style.document, ...config.style.references]) if (!existsSync(portable(root, path))) throw new Error('style reference missing'); result.profiles.push({ name, ready: true }); }
      catch (error) { result.profiles.push({ name, ready: false, reason: error.message }); }
    }
    if (result.profiles.some((p) => p.ready)) result.configuration = 'profile-ready';
  }
  const local = existsSync(resolve(root, 'jam.local.json')) ? json(resolve(root, 'jam.local.json')) : {};
  for (const [name, defaultCommand, args] of [['python', process.platform === 'win32' ? 'python' : 'python3', ['--version']], ['blender', 'blender', ['--version']], ['meshy', 'meshy', ['--version']]]) {
    const command = local[name] ? localCommand(root, local[name]) : defaultCommand;
    let probe;
    if (process.platform === 'win32' && name === 'meshy') {
      if (/[%!^&|<>"\r\n]/.test(command)) throw new Error('Meshy executable path contains unsupported shell characters');
      probe = spawnSync('cmd.exe', ['/d', '/s', '/c', `""${command}" --version"`], { encoding: 'utf8', timeout: 10000, shell: false, windowsHide: true, windowsVerbatimArguments: true });
    } else probe = spawnSync(command, args, { encoding: 'utf8', timeout: 10000, shell: false, windowsHide: true });
    result.tools[name] = { installed: !probe.error && probe.status === 0, error: probe.error?.code ?? (probe.status === 0 ? null : `exit ${probe.status}`) };
  }
  const python = local.python ? localCommand(root, local.python) : (process.platform === 'win32' ? 'python' : 'python3');
  const pillow = spawnSync(python, ['-c', 'import PIL'], { timeout: 10000, shell: false, windowsHide: true });
  result.tools.pillow = { installed: !pillow.error && pillow.status === 0 };
  output(result);
}
// The content catalog is a separate package; delegate its arguments unchanged.
if (process.argv[2] === 'catalog') {
  const cli = resolve(dirname(fileURLToPath(import.meta.url)), 'catalog/bin/catalog.mjs');
  const r = spawnSync(process.execPath, [cli, ...process.argv.slice(3)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
try {
  const { positionals, values: o } = parseArgs({ allowPositionals: true, options: Object.fromEntries(['root', 'from', 'run', 'id', 'profile', 'brief', 'human', 'record', 'stage', 'job', 'file', 'provider', 'limit', 'review'].map((name) => [name, { type: 'string' }]).concat([['help', { type: 'boolean' }], ['exploration', { type: 'boolean' }]])) });
  const [verb] = positionals;
  if (o.help || !verb) console.log(HELP);
  else {
    if (positionals.length !== 1) throw new Error('unexpected argument; see --help');
    const root = resolve(o.root ?? process.cwd());
    if (verb === 'setup') await setup(root, o.from);
    else if (verb === 'settings') settings(root, o);
    else if (verb === 'doctor') doctor(root);
    else if (verb === 'measure') output(measureFiles([portable(root, o.file)])[0]);
    else {
      const config = json(resolve(root, 'jam.config.json'));
      if (!o.run?.startsWith('Art/') || !o.run.endsWith('/run.json')) throw new Error('asset runs must use Art/.../run.json');
      const file = portable(root, o.run);
      const spec = () => o.record === '-' ? JSON.parse(readFileSync(0, 'utf8')) : json(portable(root, o.record));
      if (verb === 'init') {
        const run = newRun(root, config, { id: o.id, profile: o.profile, brief: o.brief, exploration: o.exploration, humanStages: o.human ? o.human.split(',') : [] });
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`, { flag: 'wx' });
        output({ created: o.run });
      } else if (verb === 'status' || verb === 'check-delivery') {
        const run = json(file); const states = status(root, config, run); output({ exploration: !!run.exploration, stages: states });
        if (verb === 'check-delivery') output(checkDelivery(root, config, run, o.run));
      } else {
        const operation = () => mutate(file, (run) => {
          if (verb === 'register') return { record: register(root, config, run, spec()) };
          if (verb === 'review') { review(root, config, run, o.stage, spec()); return { reviewed: o.stage }; }
          if (verb === 'job-intent') return { intent: jobIntent(root, config, run, spec()) };
          if (verb === 'job-update') { jobUpdate(run, o.job, spec()); return { updated: o.job }; }
          throw new Error('unknown verb; see --help');
        });
        const result = verb === 'job-intent' ? withLock(resolve(root, 'Art/.jam-jobs.lock'), operation) : operation();
        output(result);
      }
    }
  }
} catch (error) { console.error(`jam: ${error.message}`); process.exitCode = 1; }
