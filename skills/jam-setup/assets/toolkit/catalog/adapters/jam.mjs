// Jam toolkit adapter: one stable catalog entry per asset, sourced from Art/**/run.json.
// Jam stage status (gates, staleness, acceptance) is displayed as read-only project facts using
// the toolkit's own stageStatus contract. Nothing here writes jam records or decisions.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const STAGES = ['concept', 'turnaround', 'mesh', 'topology', 'uv', 'texture', 'delivery'];
const VIEWS = ['front', 'left', 'back', 'right', 'three-quarter'];
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const VIDEO = /\.(mp4|webm|m4v)$/i;
const MODEL = /\.glb$/i;
const STAGE_LABEL = { concept: 'Concept', turnaround: 'Turnaround', mesh: 'Mesh', topology: 'Topology', uv: 'UV', texture: 'Texture', delivery: 'Delivery' };

const schema = {
  types: {
    'jam-asset': {
      label: 'Game asset',
      thumb: 'three-quarter',
      fields: [
        { key: 'asset', label: 'Asset' },
        { key: 'custody', derived: true, label: 'Custody', help: 'Accepted revisions live under Art/Assets; scratch work under Art/.scratch is ignored by Git.' },
        { key: 'profile', derived: true, label: 'Profile' },
        { key: 'created', derived: true, label: 'Created' },
        ...STAGES.map((s) => ({ key: `stage.${s}`, derived: true, label: STAGE_LABEL[s], group: 'Jam stages', help: 'Jam pipeline status from tools/jam (a project fact, not a catalog verdict).' })),
        { key: 'humanStages', derived: true, label: 'Human checkpoints' },
        { key: 'triangles', label: 'Triangles' },
        { key: 'materials', label: 'Materials' },
        { key: 'textureMiB', label: 'Texture', unit: 'MiB' },
        { key: 'provider', derived: true, label: 'Provider' },
        { key: 'jobs', derived: true, label: 'Paid jobs' },
      ],
      roles: [
        { key: 'three-quarter', label: 'Three-quarter', kinds: ['image'] },
        { key: 'front', label: 'Front', kinds: ['image'] },
        { key: 'left', label: 'Left', kinds: ['image'] },
        { key: 'back', label: 'Back', kinds: ['image'] },
        { key: 'right', label: 'Right', kinds: ['image'] },
        { key: 'concept', label: 'Concept', kinds: ['image'], many: true },
        ...['delivery', 'texture', 'uv', 'topology', 'mesh'].map((s) => ({ key: s, label: STAGE_LABEL[s], kinds: ['model'] })),
        { key: 'evidence', label: 'Evidence', kinds: ['image', 'video'], many: true },
      ],
    },
  },
  collectionKinds: {},
};

export default function jamAdapter({ root }) {
  const here = dirname(fileURLToPath(import.meta.url));
  const coreFile = join(here, '../../core.mjs');

  function runs() {
    const out = [];
    const walk = (rel) => {
      const full = join(root, rel);
      if (!existsSync(full)) return;
      for (const e of readdirSync(full, { withFileTypes: true })) {
        const r = `${rel}/${e.name}`;
        if (e.isDirectory()) walk(r);
        else if (e.isFile() && e.name === 'run.json') out.push(r);
      }
    };
    walk('Art');
    return out.sort();
  }

  return {
    name: 'jam',
    sources: () => ['Art', 'jam.config.json'],
    async load() {
      const problems = [];
      let config = null;
      if (existsSync(join(root, 'jam.config.json'))) {
        try { config = JSON.parse(readFileSync(join(root, 'jam.config.json'), 'utf8')); } catch (e) { problems.push({ source: 'jam.config.json', error: e.message, recovery: 'repair jam.config.json' }); }
      }
      const runPaths = runs();
      // External-only catalogs do not need Jam's measurement dependencies.
      // Only configured workflow runs can ask the toolkit for stage status.
      let jam = null;
      if (config && runPaths.length) {
        try { jam = await import(pathToFileURL(coreFile).href); }
        catch (e) { problems.push({ source: 'tools/jam', error: `jam toolkit unavailable: ${e.message}`, recovery: 'run npm ci --prefix tools/jam --ignore-scripts; stage status is shown as unknown until then' }); }
      }
      const candidates = new Map(); const assets = new Map();
      const addAsset = (path) => { if (!assets.has(path)) assets.set(path, { id: path, path }); return path; };
      for (const runPath of runPaths) {
        let run;
        try { run = JSON.parse(readFileSync(join(root, runPath), 'utf8')); } catch (e) { problems.push({ source: runPath, error: e.message, recovery: 'repair this run record with the jam tools' }); continue; }
        if (!run || run.version !== 1 || typeof run.id !== 'string' || typeof run.stages !== 'object') { problems.push({ source: runPath, error: 'not a jam run (version 1) record' }); continue; }
        try {
          const dir = runPath.slice(0, -'/run.json'.length);
          if (!run.id.trim() || !Number.isFinite(Date.parse(run.created)) || Array.isArray(run.stages)) throw new Error('invalid asset identity, creation date or stages');
          for (const stage of Object.values(run.stages)) {
            if (!Array.isArray(stage) || stage.some((r) => !r || !Array.isArray(r.files) || !Array.isArray(r.evidence) || [...r.files, ...r.evidence].some((f) => typeof f?.path !== 'string'))) throw new Error('invalid stage files or evidence');
          }
          const latest = (s) => run.stages[s]?.at(-1);
          const links = [];
          const link = (role, path, key) => { if (!links.some((l) => l.role === role && l.asset === path)) links.push({ role, asset: addAsset(path), ...(key ? { key } : {}) }); };
          const concept = latest('concept');
          for (const [i, f] of (concept?.files ?? []).filter((f) => IMAGE.test(f.path)).entries()) link('concept', f.path, String(i + 1));
          const turn = latest('turnaround');
          if (turn?.views) for (const v of VIEWS) if (turn.views[v]) link(v, turn.views[v]);
          for (const s of ['mesh', 'topology', 'uv', 'texture', 'delivery']) {
            const rec = latest(s);
            const model = rec?.runtimeModel && MODEL.test(rec.runtimeModel) && rec.files.find((f) => f.path === rec.runtimeModel);
            if (model) link(s, model.path);
          }
          for (const s of STAGES) for (const [i, f] of (latest(s)?.evidence ?? []).entries()) if (IMAGE.test(f.path) || VIDEO.test(f.path)) link('evidence', f.path, `${s}-${i + 1}`);
          const attrs = {
            asset: run.id,
            custody: dir.startsWith('Art/Assets/') ? 'Accepted revision' : dir.startsWith('Art/.scratch/') ? 'Scratch (Git-ignored)' : 'Other',
            profile: run.profile ?? (run.exploration ? 'Exploration' : null),
            created: run.created ?? null,
            humanStages: run.humanStages?.length ? run.humanStages.join(', ') : null,
          };
          for (const s of STAGES) {
            if (!latest(s)) continue;
            if (!jam || !config) { attrs[`stage.${s}`] = config ? 'unknown' : 'unknown (no jam.config.json)'; continue; }
            try {
              const st = jam.stageStatus(root, config, run, s);
              attrs[`stage.${s}`] = st.status === 'review' ? `awaiting ${st.reviewer} review` : st.reason ? `${st.status}: ${st.reason}` : st.status;
            } catch (e) { attrs[`stage.${s}`] = `unknown: ${e.message}`; }
          }
          const measured = latest('delivery') ?? latest('texture') ?? latest('topology');
          if (measured?.metrics) { attrs.triangles = measured.metrics.triangles ?? null; attrs.materials = measured.metrics.materials ?? null; attrs.textureMiB = measured.metrics.textureMiB ?? null; }
          const lastRecord = STAGES.map(latest).filter(Boolean).at(-1);
          if (lastRecord?.provenance) attrs.provider = `${lastRecord.provenance.provider}${lastRecord.provenance.model ? ` · ${lastRecord.provenance.model}` : ''}`;
          if (run.jobs?.length) attrs.jobs = `${run.jobs.length} (${run.jobs.filter((j) => ['intent', 'submitted', 'unknown'].includes(j.state)).length} unresolved)`;
          for (const k of Object.keys(attrs)) if (attrs[k] == null) delete attrs[k];
          const unit = { id: run.id, type: 'jam-asset', name: run.id, attrs, links, search: [run.profile ?? '', ...(run.humanStages ?? [])], sources: [runPath], tags: dir.startsWith('Art/Assets/') ? ['jam:accepted-revision'] : [] };
          if (!candidates.has(run.id)) candidates.set(run.id, []);
          candidates.get(run.id).push({ unit, created: Date.parse(run.created), durable: dir.startsWith('Art/Assets/') });
        } catch (e) { problems.push({ source: runPath, error: e.message, recovery: 'repair this run record with the jam tools' }); }
      }
      const units = [...candidates.values()].map((versions) => {
        // New work remains visible even when an older delivery exists. Ties prefer durable art.
        versions.sort((a, b) => b.created - a.created || Number(b.durable) - Number(a.durable) || b.unit.sources[0].localeCompare(a.unit.sources[0]));
        const unit = versions[0].unit;
        unit.sources = versions.map((v) => v.unit.sources[0]);
        return unit;
      });
      const used = new Set(units.flatMap((u) => u.links.map((l) => l.asset)));
      return {
        project: null,
        schema,
        assetRoots: ['Art'],
        assets: [...assets.values()].filter((a) => used.has(a.id)),
        units,
        collections: [],
        problems,
      };
    },
  };
}
