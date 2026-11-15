import { Document, NodeIO } from '@gltf-transform/core';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { draftConfig, newRun, register, review, stageStatus, jobIntent, jobUpdate, portable } from '../core.mjs';

async function fixture(t, human = false) {
  const root = mkdtempSync(join(tmpdir(), 'jam test '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ['brief.md', 'style.md', 'origin.md', 'view.png', 'request.json']) writeFileSync(join(root, name), name);
  const document = new Document(); const buffer = document.createBuffer();
  const position = document.createAccessor().setType('VEC3').setArray(new Float32Array([0,0,0,1,0,0,0,1,0])).setBuffer(buffer);
  const indices = document.createAccessor().setType('SCALAR').setArray(new Uint16Array(Array.from({length:3000},(_,i)=>i%3))).setBuffer(buffer);
  const primitive = document.createPrimitive().setAttribute('POSITION',position).setIndices(indices).setMaterial(document.createMaterial());
  const mesh = document.createMesh().addPrimitive(primitive); document.createScene().addChild(document.createNode().setMesh(mesh));
  const binary = await new NodeIO().writeBinary(document);
  for (const name of ['source.glb','output.glb']) writeFileSync(join(root,name),binary);
  const config = draftConfig();
  config.style.document = 'style.md'; config.review.default = human ? 'human' : 'agent';
  config.profiles.prop = { platforms: ['Windows'], renderer: 'deferred', camera: 'third person', cameraDistanceMeters: 3, screenCoveragePercent: 10, expectedInstances: 20, maxTextureMiB: 8, assetKind: 'static', units: 'meters', up: '+Z', forward: '-Y', pivot: 'bottom', materialWorkflow: 'pbr', targetTriangles: 1000, maxTriangles: 2000, textureSize: 1024, maxMaterials: 1 };
  config.spend.meshy.limit = 10;
  const run = newRun(root, config, { id: 'table', profile: 'prop', brief: 'brief.md' });
  const spec = (stage, dependencies = []) => ({ stage, files: ['output.glb'], inputs: ['source.glb'], evidence: ['view.png','origin.md'], dependsOn: dependencies, note: 'qualified existing work', metrics: { triangles: 1000, materials: 1 }, provenance: { provider: 'imported', source: 'fixture origin', sourceEvidence: 'origin.md', model: 'fixture', transport: 'file' } });
  const accept = (stage, record, actor = 'agent') => review(root, config, run, stage, { record, actor, decision: 'accept', by: 'reviewer', source: 'test response', reason: 'fixture accepted' });
  return { root, config, run, spec, accept };
}
test('human policy and exact-candidate decisions cannot be satisfied by an agent or old ID', async (t) => {
  const f = await fixture(t, true);
  const first = register(f.root, f.config, f.run, f.spec('concept'));
  assert.throws(() => f.accept('concept', first), /human review/);
  assert.equal(stageStatus(f.root, f.config, f.run, 'concept').status, 'review');
  f.accept('concept', first, 'human');
  const second = register(f.root, f.config, f.run, f.spec('concept'));
  assert.throws(() => f.accept('concept', first, 'human'), /exact current/);
  f.accept('concept', second, 'human');
  assert.equal(stageStatus(f.root, f.config, f.run, 'concept').status, 'accepted');
});
test('input bytes, replacement dependencies and rejection invalidate only their consumers', async (t) => {
  const f = await fixture(t);
  const mesh = register(f.root, f.config, f.run, f.spec('mesh')); f.accept('mesh', mesh);
  const topology = register(f.root, f.config, f.run, f.spec('topology', ['mesh'])); f.accept('topology', topology);
  const concept = register(f.root, f.config, f.run, f.spec('concept')); f.accept('concept', concept);
  register(f.root, f.config, f.run, f.spec('concept'));
  assert.equal(stageStatus(f.root, f.config, f.run, 'topology').status, 'accepted');
  review(f.root, f.config, f.run, 'mesh', { record: mesh, actor: 'agent', by: 'reviewer', source: 'follow-up', decision: 'revise', reason: 'opening fused' });
  assert.equal(stageStatus(f.root, f.config, f.run, 'topology').status, 'blocked');
  const nextMesh = register(f.root, f.config, f.run, f.spec('mesh')); f.accept('mesh', nextMesh);
  assert.equal(stageStatus(f.root, f.config, f.run, 'topology').status, 'stale');
  writeFileSync(join(f.root, 'source.glb'), 'changed source');
  assert.equal(stageStatus(f.root, f.config, f.run, 'mesh').status, 'stale');
});
test('only an art-direction revision change requires re-admission; guide edits, new references and unresolved style behave as documented', async (t) => {
  const f = await fixture(t);
  const id = register(f.root, f.config, f.run, f.spec('concept')); f.accept('concept', id);
  writeFileSync(join(f.root, 'style.md'), 'guide text extended with a new hero shot');
  f.config.style.references = ['view.png'];
  assert.equal(stageStatus(f.root, f.config, f.run, 'concept').status, 'accepted');
  f.config.style.revision = 'v002';
  assert.equal(stageStatus(f.root, f.config, f.run, 'concept').status, 'stale');
  assert.equal(f.run.stages.concept[0].reviews.length, 1);
  const legacy = structuredClone(f.run); legacy.context.style = [{ path: 'style.md', sha256: 'old' }];
  f.config.style.revision = undefined;
  assert.equal(stageStatus(f.root, f.config, legacy, 'concept').status, 'accepted');
  f.config.style.document = null;
  assert.throws(() => newRun(f.root, f.config, { id: 'production', profile: 'prop', brief: 'brief.md' }), /unresolved/);
  const run = newRun(f.root, f.config, { id: 'exploration', brief: 'brief.md', exploration: true });
  register(f.root, f.config, run, f.spec('concept'));
  assert.throws(() => register(f.root, f.config, run, f.spec('mesh')), /exploration only/);
});
test('actual supplied measurements enforce profile budgets and new geometry requires turnaround', async (t) => {
  const f = await fixture(t);
  const spec = f.spec('topology'); spec.metrics.triangles = 2001;
  assert.throws(() => register(f.root, f.config, f.run, spec), /disagrees/);
  spec.metrics.triangles = 1000; register(f.root, f.config, f.run, spec);
  const mesh = f.spec('mesh'); mesh.provenance.provider = 'meshy';
  assert.throws(() => register(f.root, f.config, f.run, mesh), /five-view/);
  const texture = f.spec('texture'); texture.metrics = { textureDimensions: [[1024, 1024]], textureMiB: 8.1 };
  assert.throws(() => register(f.root, f.config, f.run, texture), /disagrees/);
});
test('uncertain submissions reserve budget and prevent duplicates until evidence reconciles them', async (t) => {
  const f = await fixture(t);
  const intent = { stage: 'concept', provider: 'meshy', transport: 'cli', scope: 'test', operation: 'mesh', request: 'request.json', estimate: 7, unit: 'credits', priceKind: 'estimate', priceSource: 'fixture price', priceDate: '2026-11-10', authorization: 'bounded fixture budget' };
  assert.throws(() => jobIntent(f.root, f.config, f.run, { ...intent, stage: 'mesh' }), /accepted turnaround/);
  assert.throws(() => jobIntent(f.root, f.config, f.run, { ...intent, actual: 0 }), /unexpected job intent/);
  const id = jobIntent(f.root, f.config, f.run, intent);
  assert.throws(() => jobUpdate(f.run, id, { state: 'unknown', evidence: 'lost', estimate: 0 }), /unexpected/);
  assert.throws(() => jobUpdate(f.run, id, { state: 'unknown', evidence: 'lost', actual: 0 }), /terminal provider result/);
  jobUpdate(f.run, id, { state: 'unknown', evidence: 'response lost' });
  assert.throws(() => jobIntent(f.root, f.config, f.run, intent), /limit exceeded|unresolved/);
  f.config.spend.meshy.limit = 20;
  assert.throws(() => jobIntent(f.root, f.config, f.run, intent), /unresolved/);
  jobUpdate(f.run, id, { state: 'submitted', jobId: 'provider-task', evidence: 'history matched exact input' });
  assert.throws(() => jobUpdate(f.run, id, { state: 'succeeded', evidence: 'done' }), /actual charge/);
  jobUpdate(f.run, id, { state: 'succeeded', actual: 9, evidence: 'task charge' });
  f.config.spend.meshy.limit = 10;
  assert.throws(() => jobIntent(f.root, f.config, f.run, intent), /limit exceeded/);
});
test('repository-relative artifact paths cannot escape through traversal or parent symlinks', async (t) => {
  const f = await fixture(t);
  assert.throws(() => portable(f.root, '../escape'), /inside/);
  assert.throws(() => portable(f.root, 'nested/../output.glb'), /normalized/);
  assert.throws(() => portable(f.root, 'C:\\escape'), /relative/);
  const outside = mkdtempSync(join(tmpdir(), 'jam outside ')); t.after(() => rmSync(outside, { recursive: true, force: true }));
  symlinkSync(outside, join(f.root, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => portable(f.root, 'redirect/new.json'), /symlink escapes/);
});
test('no cap removes only the selected provider limit, preserving estimates, authorization and duplicate protection', async (t) => {
  const f = await fixture(t); f.config.spend.meshy.limit = null;
  const intent = { stage: 'concept', provider: 'meshy', transport: 'cli', scope: 'test', operation: 'generate', request: 'request.json', estimate: 1000000, unit: 'credits', priceKind: 'estimate', priceSource: 'fixture', priceDate: '2026-11-11', authorization: 'explicit uncapped task' };
  assert.throws(() => jobIntent(f.root, f.config, f.run, { ...intent, authorization: '' }), /authorization/);
  assert.throws(() => jobIntent(f.root, f.config, f.run, { ...intent, estimate: undefined }), /known estimate/);
  assert.throws(() => jobIntent(f.root, f.config, f.run, { ...intent, provider: 'scenario', unit: 'CU' }), /scenario paid generation is disabled/);
  const id = jobIntent(f.root, f.config, f.run, intent);
  jobUpdate(f.run, id, { state: 'unknown', evidence: 'lost response' });
  assert.throws(() => jobIntent(f.root, f.config, f.run, intent), /unresolved/);
  jobUpdate(f.run, id, { state: 'not-submitted', evidence: 'provider confirmed no job' });
  f.config.spend.meshy.limit = 0;
  assert.throws(() => jobIntent(f.root, f.config, f.run, intent), /meshy paid generation is disabled/);
  f.config.spend.meshy.limit = 1000000;
  assert.ok(jobIntent(f.root, f.config, f.run, intent));
});
test('disabled paid generation refuses zero-cost intents for either provider, including exploration', async (t) => {
  const f = await fixture(t);
  for (const provider of ['meshy', 'scenario']) {
    f.config.spend[provider].limit = 0;
    const intent = { stage: 'concept', provider, transport: 'cli', scope: 'test', operation: 'generate', request: 'request.json', estimate: 0, unit: f.config.spend[provider].unit, priceKind: 'quote', priceSource: 'zero-cost fixture', priceDate: '2026-11-11', authorization: 'fixture task' };
    for (const run of [f.run, newRun(f.root, f.config, { id: 'explore', brief: 'brief.md', exploration: true })]) {
      assert.throws(() => jobIntent(f.root, f.config, run, intent), /paid generation is disabled \(limit 0\)/);
      assert.equal(run.jobs.length, 0);
    }
  }
});
test('checkpoint changes apply to existing candidates without accepting them or dropping stricter run preferences', async (t) => {
  const f = await fixture(t, true);
  const id = register(f.root, f.config, f.run, f.spec('concept'));
  f.config.review.stages.concept = 'agent';
  assert.equal(stageStatus(f.root, f.config, f.run, 'concept').status, 'review');
  f.accept('concept', id);
  assert.equal(stageStatus(f.root, f.config, f.run, 'concept').status, 'accepted');
  f.config.review.stages.concept = 'human';
  assert.equal(stageStatus(f.root, f.config, f.run, 'concept').reviewer, 'human');
  f.config.review.stages.concept = 'agent'; f.run.humanStages = ['concept'];
  assert.equal(stageStatus(f.root, f.config, f.run, 'concept').reviewer, 'human');
  assert.throws(() => f.accept('concept', id), /human review/);
  f.accept('concept', id, 'human');
  assert.equal(stageStatus(f.root, f.config, f.run, 'concept').status, 'accepted');
  assert.equal(f.run.stages.concept[0].reviews.length, 2);
});
test('a pipeline review policy overrides the project for runs of that profile, and run human stages still win', async (t) => {
  const f = await fixture(t, true);
  const id = register(f.root, f.config, f.run, f.spec('concept'));
  f.config.review.profiles = { prop: { default: 'agent' } };
  f.accept('concept', id);
  assert.equal(stageStatus(f.root, f.config, f.run, 'concept').status, 'accepted');
  f.config.review.profiles.prop.stages = { concept: 'human' };
  assert.equal(stageStatus(f.root, f.config, f.run, 'concept').reviewer, 'human');
  f.config.review.profiles = { character: { default: 'agent' } };
  assert.equal(stageStatus(f.root, f.config, f.run, 'concept').reviewer, 'human');
  f.config.review.profiles = { prop: { default: 'agent' } }; f.run.humanStages = ['concept'];
  assert.equal(stageStatus(f.root, f.config, f.run, 'concept').reviewer, 'human');
});
test('profile edits re-check accepted work against the current budget instead of invalidating it', async (t) => {
  const f = await fixture(t);
  const id = register(f.root, f.config, f.run, f.spec('topology')); f.accept('topology', id);
  f.config.profiles.prop.camera = 'top-down'; f.config.profiles.prop.expectedInstances = 200;
  assert.equal(stageStatus(f.root, f.config, f.run, 'topology').status, 'accepted');
  f.config.profiles.prop.maxTriangles = 900; f.config.profiles.prop.targetTriangles = 500;
  assert.deepEqual(stageStatus(f.root, f.config, f.run, 'topology'), { stage: 'topology', status: 'over-budget', reason: 'measured exported triangles missing or over budget' });
  assert.throws(() => register(f.root, f.config, f.run, f.spec('topology')), /over budget/);
  f.config.profiles.prop.maxTriangles = 4000;
  assert.equal(stageStatus(f.root, f.config, f.run, 'topology').status, 'accepted');
  delete f.config.profiles.prop;
  assert.equal(stageStatus(f.root, f.config, f.run, 'topology').status, 'stale');
});
test('a profile needs only what the tool enforces; descriptive fields are optional but validated when set', async (t) => {
  const f = await fixture(t);
  f.config.profiles.minimal = { assetKind: 'static', units: 'meters', up: '+Z', forward: '-Y', pivot: 'bottom', targetTriangles: 1000, maxTriangles: 2000, textureSize: 1024, maxMaterials: 1, maxTextureMiB: 8 };
  assert.ok(newRun(f.root, f.config, { id: 'minimal', profile: 'minimal', brief: 'brief.md' }));
  f.config.profiles.minimal.screenCoveragePercent = 140;
  assert.throws(() => newRun(f.root, f.config, { id: 'minimal', profile: 'minimal', brief: 'brief.md' }), /screen coverage/);
  delete f.config.profiles.minimal.screenCoveragePercent; delete f.config.profiles.minimal.maxTriangles;
  assert.throws(() => newRun(f.root, f.config, { id: 'minimal', profile: 'minimal', brief: 'brief.md' }), /maxTriangles/);
});
