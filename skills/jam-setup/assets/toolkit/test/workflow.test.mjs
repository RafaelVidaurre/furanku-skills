import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { draftConfig } from '../core.mjs';
import { modelBytes, PROFILE, PNG } from './fixtures.mjs';
const cli = resolve(import.meta.dirname, '../jam.mjs');
async function setup(t) {
  const root=mkdtempSync(join(tmpdir(),'jam workflow '));t.after(()=>rmSync(root,{recursive:true,force:true}));
  assert.equal(spawnSync('git',['init','-q',root]).status,0);
  const base='Art/Assets/table/v1/';mkdirSync(join(root,base),{recursive:true});
  const write=(path,value)=>writeFileSync(join(root,path),typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value));
  const config=draftConfig();config.style.document='style.md';config.profiles.prop=PROFILE;config.review.default='agent';config.review.stages={concept:'human',turnaround:'human'};config.spend.meshy.limit=10;
  write('jam.config.json',config);write('style.md','style');
  for(const name of ['brief.md','origin.md','evidence.md'])write(base+name,name);
  write(base+'model.glb',await modelBytes());
  const command=(verb,args=[],input)=>spawnSync(process.execPath,[cli,verb,'--root',root,...args],{encoding:'utf8',input:input?JSON.stringify(input):undefined});
  const run=base+'run.json';
  const call=(verb,spec,extra=[])=>command(verb,['--run',run,...(spec?['--record','-']:[]),...extra],spec);
  const must=(result)=>{assert.equal(result.status,0,result.stderr);return result.stdout;};
  must(command('init',['--run',run,'--id','table','--profile','prop','--brief',base+'brief.md']));
  const record=(stage,deps=[])=>({stage,files:[base+'model.glb'],inputs:[base+'origin.md'],evidence:[base+'evidence.md'],dependsOn:deps,note:'qualify existing artifact',provenance:{provider:'imported',model:'fixture',transport:'file',source:'fixture origin',sourceEvidence:base+'origin.md'}});
  const accept=(stage,spec)=>{const id=JSON.parse(must(call('register',spec))).record;must(call('review',{record:id,actor:'agent',by:'test reviewer',source:'fixture response',decision:'accept',reason:'accepted fixture'},['--stage',stage]));};
  return {root,base,write,config,command,run,call,must,record,accept};
}
test('CLI delivery requires qualified dependency closure and non-ignored durable custody',async(t)=>{
  const f=await setup(t);
  f.accept('delivery',f.record('delivery'));
  assert.match(f.call('check-delivery').stderr,/accepted topology/);
  for(const stage of ['topology','uv','texture'])f.accept(stage,f.record(stage));
  f.accept('delivery',f.record('delivery',['topology','uv','texture']));
  f.must(f.call('check-delivery'));
  f.write('.gitignore','Art/Assets/**/evidence.md\n');
  assert.match(f.call('check-delivery').stderr,/git-ignored/);
  f.write('.gitignore','');mkdirSync(join(f.root,'Art/.scratch'),{recursive:true});f.write('Art/.scratch/source.txt','scratch');
  const spec=f.record('delivery',['topology','uv','texture']);spec.inputs.push('Art/.scratch/source.txt');f.accept('delivery',spec);
  assert.match(f.call('check-delivery').stderr,/self-contained/);
  symlinkSync(join(f.root,'Art/.scratch'),join(f.root,f.base,'redirect'),process.platform === 'win32' ? 'junction' : 'dir');
  spec.inputs=[f.base+'origin.md',f.base+'redirect/source.txt'];f.accept('delivery',spec);
  assert.match(f.call('check-delivery').stderr,/self-contained/);
});
test('CLI requires evidenced import provenance before a standalone topology-to-delivery workflow',async(t)=>{
  const f=await setup(t);
  const topology=f.record('topology');
  topology.inputs=[f.base+'model.glb'];
  topology.provenance={provider:'local',model:'Blender',transport:'blender-mcp'};
  topology.note='Reduced an externally supplied mesh';
  assert.match(f.call('register',topology).stderr,/independent entry requires imported provenance/);
  assert.match(f.call('check-delivery').stderr,/not accepted/);
  // Supplying the missing origin permits independent entry without inventing prior stages.
  topology.provenance=f.record('topology').provenance;
  topology.inputs.push(f.base+'origin.md');f.accept('topology',topology);
  for(const [stage,deps] of [['uv',['topology']],['texture',['topology','uv']],['delivery',['topology','uv','texture']]]) {
    const spec=f.record(stage,deps);spec.provenance={provider:'local',model:'Blender',transport:'blender-mcp'};f.accept(stage,spec);
  }
  f.must(f.call('check-delivery'));
});
test('CLI blocks unresolved duplicates across runs and requires provider/import provenance',async(t)=>{
  const f=await setup(t);f.write(f.base+'request.json',{prompt:'same request'});
  const intent={stage:'concept',provider:'meshy',transport:'cli',scope:'same-account',operation:'image',request:f.base+'request.json',estimate:10,unit:'credits',priceKind:'estimate',priceSource:'fixture',priceDate:'2026-11-10',authorization:'human allocated 10 credits to this run only'};
  const paid=f.record('concept');paid.provenance={provider:'meshy',model:'fixture',transport:'cli'};
  assert.match(f.call('register',paid).stderr,/succeeded local intent/);
  const imported=f.record('mesh');delete imported.provenance.source;
  assert.match(f.call('register',imported).stderr,/origin evidence/);
  const job=JSON.parse(f.must(f.call('job-intent',intent))).intent;
  f.must(f.call('job-update',{state:'unknown',evidence:'lost response'},['--job',job]));
  const another='Art/.scratch/another/run.json';f.must(f.command('init',['--run',another,'--id','another','--brief',f.base+'brief.md','--exploration']));
  const retry=f.command('job-intent',['--run',another,'--record','-'],intent);assert.match(retry.stderr,/across runs/);
  f.must(f.call('job-update',{state:'submitted',jobId:'provider-job',evidence:'history matched'},['--job',job]));
  f.must(f.call('job-update',{state:'succeeded',actual:10,evidence:'provider result'},['--job',job]));
  paid.provenance.job=job;f.must(f.call('register',paid));
});
test('CLI remeasures geometry and verifies each turnaround file against its crop report',async(t)=>{
  const f=await setup(t);const topology=f.record('topology');topology.metrics={triangles:7};
  assert.match(f.call('register',topology).stderr,/disagrees with measurement/);
  const views={};const report={views:{}};
  for(const view of ['front','left','back','right','three-quarter']){
    views[view]=f.base+view+'.png';f.write(views[view],PNG);
    report.views[view]={size:[1,1],sha256:createHash('sha256').update(PNG).digest('hex')};
  }
  const cropReport=f.base+'crops.json';f.write(cropReport,report);
  const spec={...f.record('turnaround'),files:Object.values(views),views,cropReport,evidence:[cropReport,f.base+'evidence.md']};
  f.must(f.call('register',spec));
  report.views.left.sha256='changed';f.write(cropReport,report);
  assert.match(f.call('register',spec).stderr,/crop report does not match/);
});
test('external image exploration retains origin and needs resolved context and fresh review for production admission',async(t)=>{
  const f=await setup(t);
  f.config.style.document=null;f.config.profiles={};f.write('jam.config.json',f.config);
  const image=f.base+'native-preview.png',origin=f.base+'image-origin.md';
  f.write(image,PNG);f.write(origin,'Synthetic native-tool handoff; not live generation. Source, prompt, reference roles, task authorization and host usage basis would be retained here.');
  const exploration='Art/.scratch/style-round-a/run.json';
  f.must(f.command('init',['--run',exploration,'--id','style-round-a','--brief',f.base+'brief.md','--exploration']));
  const spec={stage:'concept',files:[image],inputs:[origin],evidence:[image],dependsOn:[],note:'Exploratory option A, not a production approval',provenance:{provider:'imported',model:'synthetic native-image tool fixture',transport:'native tool handoff',source:'fixture tool output outside provider ledger',sourceEvidence:origin}};
  const missing={...spec,provenance:{...spec.provenance,sourceEvidence:undefined}};
  assert.match(f.command('register',['--run',exploration,'--record','-'],missing).stderr,/origin evidence/);
  const candidate=JSON.parse(f.must(f.command('register',['--run',exploration,'--record','-'],spec))).record;
  const decision={record:candidate,actor:'human',by:'fixture human',source:'fixture choice A',decision:'accept',reason:'exploration preference only'};
  f.must(f.command('review',['--run',exploration,'--stage','concept','--record','-'],decision));
  const production='Art/Assets/style-example/v1/run.json';
  assert.equal(f.command('init',['--run',production,'--id','example','--profile','prop','--brief',f.base+'brief.md']).status,1);
  f.config.style.document='style.md';f.config.profiles.prop=PROFILE;f.write('jam.config.json',f.config);
  f.must(f.command('init',['--run',production,'--id','example','--profile','prop','--brief',f.base+'brief.md']));
  const admitted=JSON.parse(f.must(f.command('register',['--run',production,'--record','-'],spec))).record;
  assert.notEqual(admitted,candidate);
  const states=()=>JSON.parse(f.must(f.command('status',['--run',production]))).stages;
  assert.equal(states().find((s)=>s.stage==='concept').status,'review');
  assert.match(f.command('review',['--run',production,'--stage','concept','--record','-'],decision).stderr,/exact current/);
  f.must(f.command('review',['--run',production,'--stage','concept','--record','-'],{...decision,record:admitted,source:'fixture explicit production admission'}));
  assert.equal(states().find((s)=>s.stage==='concept').status,'accepted');
  f.write(origin,'changed origin evidence');
  assert.equal(states().find((s)=>s.stage==='concept').status,'stale');
});

test('CLI accepts reviewed turnarounds before profile decisions but blocks all geometry work',async(t)=>{
  const f=await setup(t);
  f.config.profiles={};f.write('jam.config.json',f.config);
  const run='Art/.scratch/design/run.json';
  f.must(f.command('init',['--run',run,'--id','table-design','--brief',f.base+'brief.md']));
  const call=(verb,spec,extra=[])=>f.command(verb,['--run',run,...(spec?['--record','-']:[]),...extra],spec);
  const states=()=>JSON.parse(f.must(call('status'))).stages;
  const accept=(stage,id,actor='human')=>call('review',{record:id,actor,by:'fixture reviewer',source:'fixture design approval',decision:'accept',reason:'approve exact design'},['--stage',stage]);
  const concept={...f.record('concept'),files:[f.base+'concept.png']};f.write(concept.files[0],PNG);
  const id=JSON.parse(f.must(call('register',concept))).record;
  assert.equal(accept('concept',id,'agent').status,1);
  f.must(accept('concept',id));
  const views={},report={views:{}};
  for(const view of ['front','left','back','right','three-quarter']){
    views[view]=f.base+view+'.png';f.write(views[view],PNG);
    report.views[view]={size:[1,1],sha256:createHash('sha256').update(PNG).digest('hex')};
  }
  const cropReport=f.base+'design-crops.json';f.write(cropReport,report);
  const turn={...f.record('turnaround',['concept']),files:Object.values(views),views,cropReport,evidence:[cropReport,f.base+'evidence.md']};
  const tid=JSON.parse(f.must(call('register',turn))).record;f.must(accept('turnaround',tid));
  assert.equal(states().find(s=>s.stage==='turnaround').status,'accepted');
  f.write(f.base+'design-request.json',{prompt:'turnaround fixture'});
  const intent={stage:'turnaround',provider:'meshy',transport:'cli',scope:'fixture',operation:'image',request:f.base+'design-request.json',estimate:1,unit:'credits',priceKind:'estimate',priceSource:'fixture',priceDate:'2026-11-11',authorization:'fixture requested turnaround plus approved cost'};
  f.must(call('job-intent',intent));
  for(const stage of ['mesh','topology','uv','texture','delivery']){
    assert.match(call('register',f.record(stage)).stderr,/resolved asset profile/);
    assert.match(call('job-intent',{...intent,stage}).stderr,/resolved asset profile/);
  }
  // Later profile decisions do not stale or silently upgrade the image run.
  f.config.profiles.prop=PROFILE;f.write('jam.config.json',f.config);
  assert.equal(states().find(s=>s.stage==='turnaround').status,'accepted');
  assert.match(call('register',f.record('mesh',['turnaround'])).stderr,/resolved asset profile/);
  // Re-register identical designs into the first profiled run and cite their real
  // earlier decisions, without a second fixture-human answer or source mutation.
  const source=JSON.parse(readFileSync(join(f.root,run),'utf8'));
  const profiled='Art/.scratch/profiled/run.json';
  f.must(f.command('init',['--run',profiled,'--id','table-profiled','--profile','prop','--brief',f.base+'brief.md']));
  const dest=(verb,spec,extra=[])=>f.command(verb,['--run',profiled,...(spec?['--record','-']:[]),...extra],spec);
  const destination=()=>JSON.parse(readFileSync(join(f.root,profiled),'utf8'));
  assert.deepEqual(destination().brief,source.brief);
  assert.deepEqual(destination().context.style,source.context.style);
  for(const [stage,spec] of [['concept',concept],['turnaround',turn]]){
    const original=source.stages[stage].at(-1),prior=original.reviews.at(-1);
    const newId=JSON.parse(f.must(dest('register',spec))).record;
    const added=destination().stages[stage].at(-1);
    for(const key of ['files','inputs','evidence'])assert.deepEqual(added[key],original[key]);
    assert.notEqual(newId,original.id);
    f.must(dest('review',{record:newId,actor:prior.actor,by:prior.by,decision:prior.decision,
      source:`${run} record ${original.id} review ${prior.at}; ${prior.source}`,
      reason:'Carry unchanged design approval into the first profiled run; fixture profile preserves its scope'},['--stage',stage]));
  }
  assert.equal(JSON.parse(f.must(dest('status'))).stages.find(s=>s.stage==='turnaround').status,'accepted');
  assert.deepEqual(JSON.parse(readFileSync(join(f.root,run),'utf8')),source);
  f.write(f.base+'mesh-request.json',{prompt:'mesh fixture'});
  f.must(dest('job-intent',{...intent,stage:'mesh',request:f.base+'mesh-request.json'}));
  report.views.left.sha256='wrong';f.write(cropReport,report);
  assert.match(call('register',turn).stderr,/crop report does not match/);
  f.write('style.md','revised style');
  assert.equal(states().find(s=>s.stage==='concept').status,'accepted');
  f.config.style.revision='v002';f.write('jam.config.json',f.config);
  assert.equal(states().find(s=>s.stage==='concept').status,'stale');
  assert.equal(states().find(s=>s.stage==='turnaround').status,'stale');
});
