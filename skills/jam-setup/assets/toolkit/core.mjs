import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, realpathSync, openSync, closeSync, unlinkSync, readdirSync } from 'node:fs';
import { resolve, relative, dirname, isAbsolute, sep } from 'node:path';

import { measureFiles } from './measurement.mjs';
import { spawnSync } from 'node:child_process';

export const STAGES = ['concept', 'turnaround', 'mesh', 'topology', 'uv', 'texture', 'delivery'];
export const VIEWS = ['front', 'left', 'back', 'right', 'three-quarter'];
export const fail = (message) => { throw new Error(message); };
export const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const digest = (value) => hash(JSON.stringify(value));
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const amount = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const check = (condition, message) => { if (!condition) fail(message); };
const now = () => new Date().toISOString();
export function portable(root, file) {
  check(nonempty(file) && !isAbsolute(file) && !file.includes('\\') && !/^[A-Za-z]:/.test(file), 'use a project-relative path with forward slashes');
  const full = resolve(root, file);
  const rel = relative(resolve(root), full);
  check(rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel), 'path must stay inside the project');
  check(rel.split(sep).join('/') === file, 'use a normalized project-relative path');
  // Existing inputs must not escape through a symlink.
  let ancestor = full;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  if (ancestor !== resolve(root)) {
    const real = relative(realpathSync(root), realpathSync(ancestor));
    check(real && real !== '..' && !real.startsWith(`..${sep}`) && !isAbsolute(real), 'symlink escapes the project');
  }
  return full;
}
function stamp(root, file) { return { path: file, sha256: hash(readFileSync(portable(root, file))) }; }
function unchanged(root, row) { try { return stamp(root, row.path).sha256 === row.sha256; } catch { return false; } }
export function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try { writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' }); renameSync(tmp, file); }
  finally { if (existsSync(tmp)) unlinkSync(tmp); }
}
export function mutate(file, operation) {
  const lock = `${file}.lock`;
  mkdirSync(dirname(file), { recursive: true });
  let fd;
  try { fd = openSync(lock, 'wx'); }
  catch { fail('record is locked; verify the writer exited before removing its lock'); }
  try { const run = json(file); const result = operation(run); writeJson(file, run); return result; }
  finally { closeSync(fd); unlinkSync(lock); }
}
export function withLock(file, operation) {
  mkdirSync(dirname(file), { recursive: true });
  let fd;
  try { fd = openSync(file, 'wx'); } catch { fail('job ledger is locked; verify its owner exited before recovery'); }
  try { return operation(); } finally { closeSync(fd); unlinkSync(file); }
}
function otherRuns(root) {
  const files = [];
  const walk = (folder) => {
    if (!existsSync(folder)) return;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = resolve(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name === 'run.json') {
        const run = json(path);
        if (run.version === 1 && Array.isArray(run.jobs)) files.push(run);
      }
    }
  };
  walk(resolve(root, 'Art'));
  return files;
}
export function checkDelivery(root, config, run, runPath) {
  check(/^Art\/Assets\/[^/]+\/[^/]+\/run\.json$/.test(runPath), 'delivery run must be under Art/Assets/<asset>/<revision>/run.json');
  check(stageStatus(root, config, run, 'delivery').status === 'accepted', 'delivery is not accepted');
  const delivery = latest(run, 'delivery');
  for (const stage of ['topology', 'uv', 'texture']) check(stage in delivery.dependencies && stageStatus(root, config, run, stage).status === 'accepted', `delivery needs accepted ${stage}`);
  check(!run.jobs.some((job) => ['intent', 'unknown', 'submitted'].includes(job.state)), 'provider jobs remain unresolved');
  const paths = new Set([runPath, run.brief.path]);
  const collect = (stage, seen = new Set()) => {
    if (seen.has(stage)) return;
    seen.add(stage);
    const record = latest(run, stage);
    for (const file of [...record.files, ...record.inputs, ...record.evidence]) paths.add(file.path);
    for (const dependency of Object.keys(record.dependencies)) collect(dependency, seen);
  };
  collect('delivery');
  for (const job of run.jobs) paths.add(job.request.path);
  const prefix = runPath.slice(0, -'run.json'.length);
  const revision = realpathSync(portable(root, prefix.slice(0, -1)));
  for (const path of paths) {
    const actual = relative(revision, realpathSync(portable(root, path)));
    check(path.startsWith(prefix) && actual && actual !== '..' && !actual.startsWith(`..${sep}`) && !isAbsolute(actual), 'delivery closure must be self-contained in its Art/Assets revision');
  }
  const ignored = spawnSync('git', ['check-ignore', '--no-index', '-z', '--stdin'], { cwd: root, input: [...paths].join('\0') + '\0', encoding: 'utf8' });
  check(!ignored.error && ignored.status === 1, ignored.status === 0 ? 'delivery includes git-ignored files' : 'cannot verify Git delivery custody');
  return { accepted: true, files: paths.size };
}
export function draftConfig() {
  return { version: 1, style: { document: null, references: [] }, profiles: {}, providers: { image: 'scenario', mesh: 'meshy' }, review: { default: 'human', stages: {} }, spend: { meshy: { unit: 'credits', limit: 0 }, scenario: { unit: 'CU', limit: 0 } } };
}
export function validateConfig(config, profile) {
  check(config.version === 1, 'unsupported project configuration version');
  check(config.style && Array.isArray(config.style.references), 'style.references must be an array');
  check(config.style.revision === undefined || nonempty(config.style.revision), 'style.revision must be a nonempty name when set');
  check(['human', 'agent'].includes(config.review?.default), 'review.default must be human or agent');
  check(config.review.stages && typeof config.review.stages === 'object', 'review.stages is required');
  for (const [stage, mode] of Object.entries(config.review.stages)) check(STAGES.includes(stage) && ['human', 'agent'].includes(mode), 'invalid stage review policy');
  for (const [profile, policy] of Object.entries(config.review.profiles ?? {})) {
    check(policy && typeof policy === 'object' && !Array.isArray(policy), `review.profiles.${profile} must be an object`);
    check(policy.default === undefined || ['human', 'agent'].includes(policy.default), `review.profiles.${profile}.default must be human or agent`);
    for (const [stage, mode] of Object.entries(policy.stages ?? {})) check(STAGES.includes(stage) && ['human', 'agent'].includes(mode), `invalid review policy in review.profiles.${profile}`);
  }
  for (const provider of ['meshy', 'scenario']) {
    const budget = config.spend?.[provider];
    check(budget && budget.unit === (provider === 'meshy' ? 'credits' : 'CU') && (budget.limit === null || amount(budget.limit)), `invalid ${provider} spending limit: use a nonnegative number or null for no cap`);
  }
  check(config.profiles && typeof config.profiles === 'object', 'profiles are required');
  if (!profile) return;
  const p = config.profiles[profile];
  check(p, `profile ${profile} is unresolved`);
  // Required: what the tool enforces or every export needs. Optional: context for people choosing budgets.
  for (const field of ['assetKind', 'units', 'up', 'forward', 'pivot']) check(nonempty(p[field]), `profile.${field} is unresolved`);
  check(['static', 'deforming'].includes(p.assetKind), 'assetKind must be static or deforming');
  for (const field of ['targetTriangles', 'maxTriangles', 'textureSize', 'maxMaterials']) check(positive(p[field]), `profile.${field} must be a positive integer`);
  check(amount(p.maxTextureMiB) && p.maxTextureMiB > 0, 'profile.maxTextureMiB must be positive');
  for (const field of ['camera', 'renderer', 'materialWorkflow']) check(p[field] === undefined || nonempty(p[field]), `profile.${field} must be a nonempty description when set`);
  check(p.platforms === undefined || (Array.isArray(p.platforms) && p.platforms.length > 0 && p.platforms.every(nonempty)), 'profile.platforms must list platforms when set');
  check(p.expectedInstances === undefined || positive(p.expectedInstances), 'profile.expectedInstances must be a positive integer when set');
  for (const field of ['cameraDistanceMeters', 'screenCoveragePercent']) check(p[field] === undefined || (amount(p[field]) && p[field] > 0), `profile.${field} must be positive when set`);
  check(p.screenCoveragePercent === undefined || p.screenCoveragePercent <= 100, 'screen coverage exceeds 100 percent');
  if (p.assetKind === 'deforming') { check(nonempty(p.skeleton) && positive(p.maxInfluences) && nonempty(p.poseRequirements), 'deforming profiles need skeleton, maxInfluences and poseRequirements'); }
  check(p.targetTriangles <= p.maxTriangles, 'targetTriangles exceeds maxTriangles');
  check((p.textureSize & (p.textureSize - 1)) === 0, 'textureSize must be a power of two');
  check(nonempty(config.style.document), 'style.document is unresolved; use jam-style first');
}
// A run records the profile and style it started with, for the audit trail. Those snapshots do not
// decide staleness: a run goes stale when its brief changes, its pipeline profile disappears or the
// art-direction revision (style.revision) changes. Budgets are re-checked against the current profile.
function context(root, config, profile) {
  validateConfig(config, profile);
  check(nonempty(config.style.document), 'style.document is unresolved; use jam-style first');
  return { profile: profile ? structuredClone(config.profiles[profile]) : null, style: { revision: config.style.revision ?? null, document: stamp(root, config.style.document), references: config.style.references.map((file) => stamp(root, file)) } };
}
// Runs recorded before style revisions existed stored a plain list of stamps; they belong to the unnamed revision.
const styleRevision = (run) => Array.isArray(run.context.style) ? null : run.context.style.revision ?? null;
const pipelineProfile = (config, run) => run.profile ? config.profiles[run.profile] : null;
function budgetProblem(p, stage, metrics) {
  if (['topology', 'delivery'].includes(stage)) {
    if (!(positive(metrics.triangles) && metrics.triangles <= p.maxTriangles)) return 'measured exported triangles missing or over budget';
    if (!(positive(metrics.materials) && metrics.materials <= p.maxMaterials)) return 'measured material count missing or over budget';
  }
  if (['texture', 'delivery'].includes(stage)) {
    if (!(amount(metrics.textureMiB) && metrics.textureMiB <= p.maxTextureMiB)) return 'measured texture memory missing or over budget';
    if (!Array.isArray(metrics.textureDimensions)) return 'measured textureDimensions is required (empty for a documented untextured material)';
    if (!metrics.textureDimensions.every((size) => Array.isArray(size) && size.length === 2 && size.every((n) => positive(n) && n <= p.textureSize))) return 'texture dimensions exceed the profile';
  }
  return null;
}
export function newRun(root, config, { id, profile, brief, humanStages = [], exploration = false }) {
  check(nonempty(id), 'asset id is required');
  check(profile === undefined || nonempty(profile), 'profile must be a nonempty name when supplied');
  check(!exploration || profile === undefined, 'exploration does not use a production profile');
  check(humanStages.every((stage) => STAGES.includes(stage)), 'unknown human review stage');
  return { version: 1, id, profile, created: now(), exploration, context: exploration ? (validateConfig(config), { exploration: true }) : context(root, config, profile), brief: stamp(root, brief), humanStages, stages: {}, jobs: [] };
}
const latest = (run, stage) => run.stages[stage]?.at(-1);
function currentContext(root, config, run) {
  if (!unchanged(root, run.brief)) return false;
  if (run.exploration) return true;
  validateConfig(config, run.profile ?? undefined);
  return nonempty(config.style.document) && styleRevision(run) === (config.style.revision ?? null);
}
// Most specific wins: the run's own human stages, then the run's pipeline (profile), then the project.
export function reviewerFor(config, profile, stage) {
  const pipeline = profile ? config.review.profiles?.[profile] : undefined;
  return pipeline?.stages?.[stage] ?? pipeline?.default ?? config.review.stages[stage] ?? config.review.default;
}
function requiredReviewer(config, run, stage) { return run.humanStages.includes(stage) ? 'human' : reviewerFor(config, run.profile, stage); }
export function stageStatus(root, config, run, stage, seen = new Set()) {
  const record = latest(run, stage);
  if (!record) return { stage, status: 'missing' };
  if (seen.has(stage)) return { stage, status: 'invalid', reason: 'dependency cycle' };
  seen = new Set([...seen, stage]);
  let validContext = false;
  try { validContext = currentContext(root, config, run); } catch { /* unresolved config is stale */ }
  if (!validContext || ![...record.files, ...record.inputs, ...record.evidence].every((row) => unchanged(root, row))) return { stage, status: 'stale', reason: 'artifact, brief, style revision or pipeline profile changed' };
  const budget = pipelineProfile(config, run) && budgetProblem(pipelineProfile(config, run), stage, record.metrics ?? {});
  if (budget) return { stage, status: 'over-budget', reason: budget };
  for (const [dependency, id] of Object.entries(record.dependencies)) {
    if (latest(run, dependency)?.id !== id) return { stage, status: 'stale', reason: `${dependency} was replaced` };
    if (stageStatus(root, config, run, dependency, seen).status !== 'accepted') return { stage, status: 'blocked', reason: `${dependency} is not accepted` };
  }
  const review = record.reviews.at(-1);
  if (!review) return { stage, status: 'review', reviewer: requiredReviewer(config, run, stage) };
  if (review.decision !== 'accept') return { stage, status: review.decision, reason: review.reason };
  if (requiredReviewer(config, run, stage) === 'human' && review.actor !== 'human') return { stage, status: 'review', reviewer: 'human' };
  return { stage, status: 'accepted', record: record.id };
}
export function status(root, config, run) { return STAGES.map((stage) => stageStatus(root, config, run, stage)); }
export function register(root, config, run, spec) {
  check(run.version === 1, 'unsupported run version');
  check(currentContext(root, config, run), 'run context changed; start a new run and explicitly re-admit reusable artifacts');
  check(STAGES.includes(spec.stage), 'unknown stage');
  check(!run.exploration || spec.stage === 'concept', 'exploration only admits concept images, never production geometry or delivery');
  check(run.profile || ['concept', 'turnaround'].includes(spec.stage), 'geometry and surface stages need a resolved asset profile; start a profiled run after the turnaround');
  for (const field of ['files', 'inputs', 'evidence', 'dependsOn']) check(Array.isArray(spec[field]), `${field} must be an array`);
  check(spec.files.length > 0 && spec.evidence.length > 0, 'stage needs output files and review evidence');
  check(spec.files.every(nonempty) && spec.inputs.every(nonempty) && spec.evidence.every(nonempty), 'artifact paths must be strings');
  check(nonempty(spec.note), 'explain the operation or why existing artifacts suffice');
  const dependencies = {};
  for (const stage of spec.dependsOn) {
    check(STAGES.includes(stage) && stage !== spec.stage, 'invalid stage dependency');
    check(stageStatus(root, config, run, stage).status === 'accepted', `${stage} must be accepted before use`);
    // A new record may not depend transitively on its own earlier version.
    const reaches = (s, seen = new Set()) => s === spec.stage || (!seen.has(s) && Object.keys(latest(run, s)?.dependencies ?? {}).some((d) => reaches(d, new Set([...seen, s]))));
    check(!reaches(stage), 'dependency cycle');
    dependencies[stage] = latest(run, stage).id;
  }
  let metrics = spec.metrics ?? {};
  let runtimeModel;
  const measuredHashes = new Map();
  if (['topology', 'texture', 'delivery'].includes(spec.stage)) {
    const models = spec.files.filter((path) => /\.glb$/i.test(path));
    const model = spec.runtimeModel ?? (models.length === 1 ? models[0] : null);
    check(model && spec.files.includes(model), 'name runtimeModel in files when no unique GLB is available');
    runtimeModel = model;
    let measured;
    if (/\.glb$/i.test(model)) {
      measured = measureFiles([portable(root, model)])[0];
      measuredHashes.set(model, measured.sha256);
    }
    else {
      check(nonempty(spec.measurementReport) && spec.evidence.includes(spec.measurementReport), 'non-core-GLB measurement requires a DCC report in evidence');
      const report = json(portable(root, spec.measurementReport));
      check(report.model?.path === model && report.model.sha256 === stamp(root, model).sha256 && nonempty(report.tool) && nonempty(report.command), 'DCC report must bind the exact model hash and measuring tool/command');
      measured = report.metrics;
      measuredHashes.set(model, report.model.sha256);
    }
    for (const field of ['triangles', 'materials', 'textureDimensions', 'textureMiB']) {
      if (field in metrics) check(digest(metrics[field]) === digest(measured[field]), `supplied ${field} disagrees with measurement`);
    }
    metrics = { ...metrics, ...measured };
  }
  const p = pipelineProfile(config, run);
  const budget = p && budgetProblem(p, spec.stage, metrics);
  if (budget) fail(budget);
  if (spec.stage === 'turnaround') {
    check(spec.views && VIEWS.every((view) => spec.files.includes(spec.views[view])) && new Set(Object.values(spec.views)).size === 5, 'turnaround requires five distinct named view files');
    check(nonempty(spec.cropReport) && spec.evidence.includes(spec.cropReport), 'turnaround needs its crop report in evidence');
    const report = json(portable(root, spec.cropReport));
    const actual = measureFiles(VIEWS.map((view) => portable(root, spec.views[view])));
    for (const [i, view] of VIEWS.entries()) {
      measuredHashes.set(spec.views[view], actual[i].sha256);
      check(report.views?.[view]?.sha256 === actual[i].sha256 && digest(report.views[view].size) === digest(actual[i].size), 'crop report does not match actual view hash/dimensions');
      check(digest(actual[i].size) === digest(actual[0].size), 'turnaround canvases must be equal');
    }
  }
  if (spec.stage === 'mesh' && spec.provenance?.provider !== 'imported') check(spec.dependsOn.includes('turnaround'), 'new geometry requires the accepted five-view turnaround');
  if (spec.stage === 'delivery' && p.assetKind === 'deforming') check(spec.deformationEvidence && spec.evidence.includes(spec.deformationEvidence), 'deforming delivery needs pose/rig evidence');
  if (spec.provenance) {
    check(['meshy', 'scenario', 'local', 'imported'].includes(spec.provenance.provider), 'unknown provenance provider');
    check(nonempty(spec.provenance.transport) && nonempty(spec.provenance.model), 'provenance needs model/tool and transport');
  } else fail('provenance is required');
  if (spec.stage !== 'concept' && spec.dependsOn.length === 0) check(spec.provenance.provider === 'imported', 'independent entry requires imported provenance with origin evidence');
  if (['meshy', 'scenario'].includes(spec.provenance.provider)) {
    const job = run.jobs.find((job) => job.id === spec.provenance.job);
    check(job?.state === 'succeeded' && job.provider === spec.provenance.provider, 'paid provenance needs a succeeded local intent for that provider');
    check(unchanged(root, job.request), 'paid request settings changed after submission');
    spec.inputs = [...spec.inputs, job.request.path];
  }
  if (spec.provenance.provider === 'imported') check(nonempty(spec.provenance.source) && nonempty(spec.provenance.sourceEvidence) && [...spec.inputs, ...spec.evidence].includes(spec.provenance.sourceEvidence), 'imported provenance needs a source and an origin evidence file');
  const files = spec.files.map((file) => stamp(root, file));
  for (const file of files) if (measuredHashes.has(file.path)) check(file.sha256 === measuredHashes.get(file.path), 'file changed during measurement; retry with immutable inputs');
  const inputs = [...new Set([...spec.inputs, ...(spec.turnaround ? [spec.turnaround] : [])])].map((file) => stamp(root, file));
  if (runtimeModel === undefined && ['mesh', 'uv'].includes(spec.stage)) {
    const models = spec.files.filter((file) => /\.glb$/i.test(file));
    runtimeModel = spec.runtimeModel ?? (models.length === 1 ? models[0] : undefined);
    check(runtimeModel === undefined || spec.files.includes(runtimeModel), 'runtimeModel must be in files');
  }
  const record = { id: randomUUID(), created: now(), files, inputs, evidence: spec.evidence.map((file) => stamp(root, file)), dependencies, note: spec.note, metrics, runtimeModel, provenance: spec.provenance, views: spec.views, reviews: [] };
  (run.stages[spec.stage] ??= []).push(record);
  return record.id;
}
export function review(root, config, run, stage, decision) {
  const state = stageStatus(root, config, run, stage);
  check(['review', 'accepted', 'reject', 'revise'].includes(state.status), `cannot review ${stage}: ${state.status}`);
  const record = latest(run, stage);
  check(decision.record === record.id, 'decision must name the exact current record id');
  check(['human', 'agent'].includes(decision.actor) && ['accept', 'reject', 'revise'].includes(decision.decision), 'invalid review decision');
  for (const field of ['by', 'source', 'reason']) check(nonempty(decision[field]), `review.${field} is required`);
  if (decision.decision === 'accept') check(requiredReviewer(config, run, stage) !== 'human' || decision.actor === 'human', 'human review is required');
  record.reviews.push({ ...decision, at: now() });
}
export function jobIntent(root, config, run, spec) {
  check(Object.keys(spec).every((key) => ['stage', 'provider', 'transport', 'scope', 'operation', 'request', 'estimate', 'unit', 'priceKind', 'priceSource', 'priceDate', 'authorization'].includes(key)), 'unexpected job intent field');
  check(currentContext(root, config, run), 'run context changed');
  check(STAGES.includes(spec.stage), 'paid intent must name its capability stage');
  check(!run.exploration || spec.stage === 'concept', 'exploration cannot pay for geometry or delivery');
  check(run.profile || ['concept', 'turnaround'].includes(spec.stage), 'geometry and surface jobs need a resolved asset profile; start a profiled run after the turnaround');
  if (spec.stage === 'mesh') check(stageStatus(root, config, run, 'turnaround').status === 'accepted', 'paid geometry requires an accepted turnaround before submission');
  const budget = config.spend?.[spec.provider];
  check(budget && spec.unit === budget.unit && amount(spec.estimate), 'job needs known estimate in provider-native units');
  check(budget.limit !== 0, `${spec.provider} paid generation is disabled (limit 0)`);
  check(nonempty(spec.authorization) && nonempty(spec.operation) && nonempty(spec.request), 'job needs authorization source, operation and a request file');
  check(['quote', 'estimate'].includes(spec.priceKind) && nonempty(spec.priceSource) && nonempty(spec.priceDate), 'job needs quote/estimate, source and date');
  check(nonempty(spec.transport) && nonempty(spec.scope), 'job needs transport and confirmed account/project scope');
  const request = stamp(root, spec.request);
  const spent = run.jobs.filter((job) => job.provider === spec.provider).reduce((sum, job) => sum + (job.actual ?? job.estimate), 0);
  check(budget.limit === null || spent + spec.estimate <= budget.limit, 'run spending limit exceeded');
  check(![run, ...otherRuns(root)].some((other) => other.jobs.some((job) => job.request.sha256 === request.sha256 && ['intent', 'submitted', 'unknown'].includes(job.state))), 'matching submission unresolved across runs; reconcile it before a new attempt');
  const job = { ...spec, id: randomUUID(), request, state: 'intent', created: now() };
  run.jobs.push(job);
  return job.id;
}
export function jobUpdate(run, id, update) {
  check(Object.keys(update).every((key) => ['state', 'evidence', 'jobId', 'actual'].includes(key)), 'unexpected job update field');
  const job = run.jobs.find((row) => row.id === id);
  check(job, 'unknown job');
  const transitions = { intent: ['submitted', 'unknown', 'not-submitted'], unknown: ['submitted', 'not-submitted'], submitted: ['succeeded', 'failed', 'cancelled'], succeeded: [], failed: [], cancelled: [], 'not-submitted': [] };
  check(transitions[job.state]?.includes(update.state), 'invalid job transition');
  check(nonempty(update.evidence), 'job update needs reconciliation or provider evidence');
  check(!('actual' in update) || ['succeeded', 'failed', 'cancelled'].includes(update.state), 'actual charge only belongs to a terminal provider result');
  if (update.state === 'submitted') check(nonempty(update.jobId), 'submitted job needs provider jobId');
  if (['succeeded', 'failed', 'cancelled'].includes(update.state)) check(amount(update.actual), 'terminal job needs known actual charge; keep submitted until reconciled');
  job.history ??= [];
  job.history.push({ ...update, at: now() });
  Object.assign(job, update);
  if (update.state === 'not-submitted') job.actual = 0;
}
