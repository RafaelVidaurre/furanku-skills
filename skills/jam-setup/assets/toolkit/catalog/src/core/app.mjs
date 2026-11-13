// Content Application: catalog projection, organization, notes, review submissions and verdicts.
// Every human (browser) and agent (CLI/HTTP) operation goes through `run(action, input, meta)`.
import { readFileSync, existsSync } from 'node:fs';
import { resolveRoot, context as readCtx, freshContext, actorFromGit } from './context.mjs';
import { createRecords } from './records.mjs';
import { validators, VERDICTS, PART_NOTE_MAX, isTag, isCategory, validCamera, validViewState } from './schemas.mjs';
import { readConfig, loadAdapter, normalize, assetFacts, fingerprint, CONFIG_FILE, ASSET_KINDS } from './project.mjs';
import { createEvidence } from './evidence.mjs';
import { createBeforeSides } from './before.mjs';
import { unitParts, reviewAttrs, collectionParts, eventVerdicts, eventOrder, RESOLVERS, resolveParts, summarize, rankDoc } from './model.mjs';
import { CatalogError, fail, check, digest, sha256, newId, shortRef, nonempty, isObject, confinedPath, portablePath, insideReal } from './util.mjs';
import { pathToFileURL } from 'node:url';

const STATE_LABEL = { approved: 'Approved', changes: 'Changes requested', rejected: 'Rejected', partial: 'Partly approved', mixed: 'Mixed', undecided: 'Undecided', none: 'No parts' };
const ancestors = (c) => (c ? c.split('/').map((_, i, a) => a.slice(0, i + 1).join('/')) : []);
const tkey = (t) => `${t.kind}:${t.id}`;
const now = () => new Date().toISOString();
const MAX_PAGE = 200;

export async function openCatalog({ root: rootInput, adapter: adapterName, options, resolver: resolverName } = {}) {
  const root = resolveRoot(rootInput);
  const overrides = { adapter: adapterName, options };
  const records = createRecords(root, { validators });
  const ctx = () => readCtx(root);
  const evidence = createEvidence(root, records, ctx);
  // Project configuration (adapter, options, resolver, verdicts, preview modules) follows the
  // checkout: it is reloaded whenever catalog.config.json or a trusted project module changes.
  let config, adapter, resolver, verdictSet, projectSig = null, projectProblem = null;
  const moduleFiles = (cfg) => [cfg.adapter?.startsWith('./') ? cfg.adapter.slice(2) : null, cfg.review?.resolverModule?.replace(/^\.\//, ''), ...Object.values(cfg.previewModules ?? {}).map((m) => String(m).replace(/^\.\//, ''))].filter(Boolean);
  async function refreshProject() {
    let cfg;
    try { cfg = readConfig(root, overrides); if (resolverName) cfg.review.resolver = resolverName; }
    catch (e) { if (config) { projectProblem = { source: CONFIG_FILE, error: e.message, recovery: 'fix the configuration; the previous project settings stay in use until then' }; return; } throw e; }
    const sig = digest({ cfg, modules: moduleFiles(cfg).map((f) => { try { return sha256(readFileSync(portablePath(root, f))); } catch { return null; } }) });
    if (sig === projectSig) return;
    const nextAdapter = await loadAdapter(root, cfg);
    let nextResolver = RESOLVERS[cfg.review.resolver];
    if (!nextResolver && cfg.review.resolverModule) { const f = portablePath(root, cfg.review.resolverModule.replace(/^\.\//, '')); nextResolver = (await import(`${pathToFileURL(f).href}?v=${sha256(readFileSync(f)).slice(0, 16)}`)).default; }
    check(typeof nextResolver === 'function', 'invalid', `unknown verdict resolver ${cfg.review.resolver}`);
    config = cfg; adapter = nextAdapter; resolver = nextResolver; verdictSet = cfg.review.verdicts.filter((v) => VERDICTS.includes(v));
    projectSig = sig; projectProblem = null; snap = null; derivedCache = null;
  }
  const moduleUrl = (name) => { if (!config.previewModules?.[name]) return null; try { return `/project/preview/${encodeURIComponent(name)}?v=${previewModule(name).sha256.slice(0, 16)}`; } catch { return null; } };
  // Project-supplied browser preview modules (trusted project code), by name.
  function previewModule(name) {
    const rel = config.previewModules?.[name];
    check(typeof rel === 'string', 'not_found', `no project preview module ${name}`);
    const file = portablePath(root, rel.replace(/^\.\//, ''));
    check(/\.m?js$/.test(file) && insideReal(root, file) && existsSync(file), 'not_found', `preview module file ${rel} not found`);
    const bytes = readFileSync(file);
    return { file, bytes, sha256: sha256(bytes) };
  }

  // ---------- Snapshot of adapter content (reloaded when its sources change) ----------
  let snap = null;
  async function load() {
    await refreshProject();
    const sources = [CONFIG_FILE, ...moduleFiles(config), ...(adapter.sources?.() ?? [])];
    const fp = fingerprint(root, sources);
    if (snap?.fp === fp) {
      // Asset bytes can change without definition changes: track referenced files too.
      const assetSig = fingerprint(root, snap.assets.map((a) => a.path));
      if (assetSig !== snap.assetSig) { snap = { ...snap, assetSig, version: `${fp.slice(0, 6)}${assetSig.slice(0, 6)}` }; derivedCache = null; }
      return snap;
    }
    let out;
    try { out = await adapter.load(); }
    catch (e) {
      if (snap) { snap = { ...snap, fp, problems: [...snap.problems.filter((p) => !/^adapter failed/.test(p.error)), { source: 'adapter', error: `adapter failed: ${e.message}`, recovery: 'showing the last successfully loaded catalog; fix the adapter input and refresh' }] }; derivedCache = null; return snap; }
      out = { problems: [{ source: 'adapter', error: `adapter failed: ${e.message}`, recovery: `check ${CONFIG_FILE} and the adapter's source files` }] };
    }
    const n = normalize(root, out);
    const assetSig = fingerprint(root, n.assets.map((a) => a.path));
    snap = { fp, assetSig, version: `${fp.slice(0, 6)}${assetSig.slice(0, 6)}`, ...n, unitsById: new Map(n.units.map((u) => [u.id, u])), assetsById: new Map(n.assets.map((a) => [a.id, a])) };
    derivedCache = null;
    return snap;
  }
  const facts = (asset) => assetFacts(root, asset, snap.assetRoots);

  // ---------- Derived view over adapter snapshot + repository records ----------
  let derivedCache = null;
  let readProjection = null;
  function derive() {
    if (readProjection) return readProjection;
    const lists = Object.fromEntries(['label', 'collection', 'categories', 'note', 'submission', 'verdict'].map((k) => [k, records.list(k)]));
    const sig = `${snap.version}|${Object.values(lists).map((l) => l.sig).join('|')}`;
    if (derivedCache?.sig === sig) return derivedCache;
    const labels = new Map(lists.label.items.map((l) => [tkey(l.target), l]));
    const collections = [
      ...snap.collections.map((c) => ({ ...c, category: labels.get(`collection:${c.id}`)?.category ?? c.adapterCategory, tags: labels.get(`collection:${c.id}`)?.tags ?? [], revision: labels.get(`collection:${c.id}`)?.revision ?? null })),
      ...lists.collection.items.filter((c) => !snap.collections.some((a) => a.id === c.id)).map((c) => ({ ...c, owner: 'catalog', adapterTags: [], adapterCategory: null })),
    ];
    const collectionsById = new Map(collections.map((c) => [c.id, c]));
    const usage = new Map();
    for (const u of snap.units) for (const l of u.links) { if (!usage.has(l.asset)) usage.set(l.asset, []); usage.get(l.asset).push({ unit: u.id, role: l.role }); }
    const memberships = new Map();
    for (const c of collections) for (const m of c.members) { if (!memberships.has(m.unit)) memberships.set(m.unit, []); memberships.get(m.unit).push(c.id); }
    const notesByTarget = new Map();
    for (const n of lists.note.items) { const k = tkey(n.target); if (!notesByTarget.has(k)) notesByTarget.set(k, []); notesByTarget.get(k).push(n); }
    const items = new Map(); const itemsByTarget = new Map();
    for (const s of lists.submission.items) for (const it of s.items) { items.set(it.id, { submission: s, item: it }); const k = tkey(it.target); if (!itemsByTarget.has(k)) itemsByTarget.set(k, []); itemsByTarget.get(k).push({ submission: s, item: it }); }
    const events = lists.verdict.items.filter((e) => items.get(e.item)?.submission.id === e.submission);
    const eventsByTarget = new Map(); const eventsByItem = new Map();
    for (const e of events) {
      const k = tkey(items.get(e.item).item.target);
      if (!eventsByTarget.has(k)) eventsByTarget.set(k, []); eventsByTarget.get(k).push(e);
      if (!eventsByItem.has(e.item)) eventsByItem.set(e.item, []); eventsByItem.get(e.item).push(e);
    }
    const categories = new Set([...(lists.categories.items[0]?.categories ?? []), ...lists.label.items.map((l) => l.category), ...collections.map((c) => c.category), ...snap.units.map((u) => u.adapterCategory), ...snap.assets.map((a) => a.adapterCategory)].filter(Boolean).flatMap(ancestors));
    derivedCache = { sig, lists, labels, collections, collectionsById, usage, memberships, notesByTarget, items, itemsByTarget, events, eventsByTarget, eventsByItem, categories, projections: new Map() };
    return derivedCache;
  }

  function org(kind, id) {
    const d = derive();
    if (kind === 'collection') {
      const c = d.collectionsById.get(id);
      return { category: c.category ?? null, tags: c.tags ?? [], projectTags: c.adapterTags ?? [], projectCategory: c.adapterCategory ?? null, revision: c.revision ?? null, owner: c.owner };
    }
    const e = kind === 'unit' ? snap.unitsById.get(id) : snap.assetsById.get(id);
    const l = d.labels.get(`${kind}:${id}`);
    return { category: l?.category ?? e?.adapterCategory ?? null, tags: l?.tags ?? [], projectTags: e?.adapterTags ?? [], projectCategory: e?.adapterCategory ?? null, revision: l?.revision ?? null };
  }
  const allTags = (kind, id) => { const o = org(kind, id); return [...new Set([...o.projectTags, ...o.tags])]; };

  // ---------- Parts and current evidence digests ----------
  const typeOf = (u) => snap.schema.types[u.type];
  function partsOf(target) {
    if (target.kind === 'unit') { const u = snap.unitsById.get(target.id); return u ? unitParts(u, typeOf(u)) : []; }
    const c = derive().collectionsById.get(target.id);
    return c ? collectionParts(c, snap.unitsById, snap.schema) : [];
  }
  function currentDigest(target, partId) {
    if (target.kind === 'unit') {
      const u = snap.unitsById.get(target.id);
      if (!u) return null;
      if (partId === 'attributes') return digest(reviewAttrs(u, typeOf(u)));
      const p = unitParts(u, typeOf(u)).find((x) => x.id === partId);
      if (!p) return null;
      const f = facts(snap.assetsById.get(p.asset));
      return f.sha256 ?? null;
    }
    const c = derive().collectionsById.get(target.id);
    if (!c) return null;
    const memberDigest = (uid) => { const u = snap.unitsById.get(uid); return u ? digest(Object.fromEntries(unitParts(u, typeOf(u)).map((p) => [p.id, currentDigest({ kind: 'unit', id: uid }, p.id)]))) : null; };
    if (partId === 'preview') { const pv = previewSpec(c); return pv ? previewDigest(pv, (id) => facts(snap.assetsById.get(id)).sha256 ?? null) : null; }
    const uid = partId.replace(/^member:/, '');
    return c.members.some((m) => m.unit === uid) ? memberDigest(uid) : null;
  }

  const eventSummary = (e) => { const d = derive(); const s = d.items.get(e.item)?.submission; return { id: e.id, submission: e.submission, ref: s ? shortRef(s.id) : null, item: e.item, by: e.by, at: e.at, scope: e.scope.kind, verdicts: eventVerdicts(e), comment: e.comment ?? '', partNotes: e.partNotes ?? {} }; };

  // Catalog projection: latest (configured) verdict per current part across every submission
  // whose item targets this entity. Changed = frozen evidence differs from current content.
  function project(target) {
    const d = derive();
    const k = tkey(target);
    if (d.projections.has(k)) return d.projections.get(k);
    const parts = partsOf(target);
    const events = d.eventsByTarget.get(k) ?? [];
    const res = resolveParts(events, parts.map((p) => p.id), resolver);
    const out = parts.map((p) => {
      const r = res[p.id];
      if (!r) return { ...p, verdict: null, event: null, changed: false };
      const frozen = d.items.get(r.event.item)?.item.parts.find((x) => x.id === p.id)?.evidence;
      const changed = !!frozen && frozen.digest !== currentDigest(target, p.id);
      return { ...p, verdict: r.verdict, event: eventSummary(r.event), changed };
    });
    const value = { parts: out, summary: summarize(out) };
    d.projections.set(k, value);
    return value;
  }

  // ---------- Summaries ----------
  function assetRef(asset) {
    const f = facts(asset);
    return { id: asset.id, path: asset.path, kind: asset.kind, state: f.state, error: f.error ?? null, sha256: f.sha256 ?? null, size: f.size ?? null, mime: f.mime ?? null, url: f.state === 'ok' ? `/media/asset/${encodeURIComponent(asset.id)}?v=${f.sha256.slice(0, 16)}` : null };
  }
  function thumbOf(u) {
    const t = typeOf(u);
    const link = u.links.find((l) => l.role === t.thumb) ?? u.links.find((l) => snap.assetsById.get(l.asset)?.kind === 'image') ?? u.links[0];
    return link ? assetRef(snap.assetsById.get(link.asset)) : null;
  }
  const openNotes = (kind, id) => (derive().notesByTarget.get(`${kind}:${id}`) ?? []).filter((n) => !n.resolved).length;
  const missingRoles = (u) => typeOf(u).roles.filter((r) => r.expected && !u.links.some((l) => l.role === r.key));
  function unitSummary(u) {
    const d = derive(); const t = typeOf(u); const o = org('unit', u.id);
    const shared = new Set(u.links.filter((l) => new Set((d.usage.get(l.asset) ?? []).map((x) => x.unit)).size > 1).map((l) => l.role));
    const p = project({ kind: 'unit', id: u.id });
    return {
      id: u.id, name: u.name, type: u.type, typeLabel: t.label, thumb: thumbOf(u),
      roles: t.roles.filter((r) => u.links.some((l) => l.role === r.key)).map((r) => ({ key: r.key, label: r.label, kind: r.kinds[0], shared: shared.has(r.key) })),
      missing: missingRoles(u).map((r) => ({ key: r.key, label: r.label, kind: r.kinds[0] })),
      attrsPreview: u.links.length ? null : t.fields.filter((f) => u.attrs[f.key] != null).slice(0, 3).map((f) => ({ label: f.label, value: fmtValue(u.attrs[f.key], f) })),
      status: { state: p.summary.state, summary: p.summary, parts: p.parts.map((x) => ({ id: x.id, label: x.label, verdict: x.verdict, changed: x.changed })) },
      notes: openNotes('unit', u.id), category: o.category, tags: allTags('unit', u.id),
    };
  }
  function fmtValue(v, f) {
    if (f?.kind === 'refs') return (Array.isArray(v) ? v : [v]).map((id) => snap.unitsById.get(id)?.name ?? id).join(', ');
    if (Array.isArray(v)) return v.join(', ');
    if (isObject(v)) return JSON.stringify(v);
    return v;
  }
  function collectionSummary(c) {
    const p = project({ kind: 'collection', id: c.id });
    const o = org('collection', c.id);
    return {
      id: c.id, name: c.name, kind: c.kind, kindLabel: c.kind ? snap.schema.collectionKinds[c.kind]?.label ?? c.kind : null, owner: c.owner,
      category: o.category, tags: allTags('collection', c.id), memberCount: c.members.length,
      thumbs: c.members.slice(0, 4).map((m) => { const u = snap.unitsById.get(m.unit); return u ? { unit: u.id, name: u.name, typeLabel: typeOf(u).label, thumb: thumbOf(u) } : null; }).filter(Boolean),
      status: { state: p.summary.state, summary: p.summary, parts: p.parts.map((x) => ({ id: x.id, label: x.label, verdict: x.verdict, changed: x.changed })) },
      notes: openNotes('collection', c.id),
    };
  }
  function assetSummary(a) {
    const d = derive(); const uses = d.usage.get(a.id) ?? [];
    const o = org('asset', a.id);
    return { ...assetRef(a), label: a.label, usedBy: new Set(uses.map((x) => x.unit)).size, roles: [...new Set(uses.map((x) => x.role))], notes: openNotes('asset', a.id), category: o.category, tags: allTags('asset', a.id) };
  }

  // ---------- Facets and search ----------
  const roleLabel = (key) => Object.values(snap.schema.types).flatMap((t) => t.roles).find((r) => r.key === key)?.label ?? key;
  function facetsFor(section) {
    const d = derive();
    const cat = { label: 'Category', values: (e, kind) => ancestors(org(kind, e.id).category), name: (v) => v.split('/').join(' / '), tree: true };
    const tag = { label: 'Tag', values: (e, kind) => allTags(kind, e.id), name: (v) => v };
    const review = (kind) => ({ label: 'Review', values: (e) => { const s = project({ kind, id: e.id }).summary; return [s.state, ...(s.changed ? ['changed'] : [])]; }, name: (v) => (v === 'changed' ? 'Changed since verdict' : STATE_LABEL[v]) });
    const notes = (kind) => ({ label: 'Notes', values: (e) => (openNotes(kind, e.id) ? ['open'] : []), name: () => 'Open notes' });
    if (section === 'units') return {
      type: { label: 'Type', values: (u) => [u.type], name: (v) => snap.schema.types[v]?.label ?? v },
      cat, tag, review: review('unit'),
      visual: { label: 'Visuals', values: (u) => [...new Set(u.links.map((l) => l.role)), ...missingRoles(u).map((r) => `missing:${r.key}`), ...(u.links.some((l) => facts(snap.assetsById.get(l.asset)).state !== 'ok') ? ['error'] : []), ...(u.links.length ? [] : ['none'])], name: (v) => (v === 'none' ? 'None' : v === 'error' ? 'Unavailable file' : v.startsWith('missing:') ? `Missing ${roleLabel(v.slice(8)).toLowerCase()}` : roleLabel(v)) },
      in: { label: 'Collection', values: (u) => d.memberships.get(u.id) ?? [], name: (v) => d.collectionsById.get(v)?.name ?? v },
      notes: notes('unit'),
    };
    if (section === 'collections') return {
      cat, tag,
      kind: { label: 'Kind', values: (c) => [c.kind ?? 'none'], name: (v) => snap.schema.collectionKinds[v]?.label ?? 'Unspecified' },
      contains: { label: 'Contains', values: (c) => [...new Set(c.members.map((m) => snap.unitsById.get(m.unit)?.type).filter(Boolean))], name: (v) => snap.schema.types[v]?.label ?? v },
      review: review('collection'), notes: notes('collection'),
    };
    return {
      kind: { label: 'Kind', values: (a) => [a.kind ?? 'unknown'], name: (v) => ASSET_KINDS[v]?.label ?? 'Unknown' },
      use: { label: 'Use', values: (a) => { const n = new Set((d.usage.get(a.id) ?? []).map((x) => x.unit)).size; return [n === 0 ? 'unused' : n === 1 ? 'single' : 'shared']; }, name: (v) => ({ unused: 'Unused', single: 'One unit', shared: 'Shared' }[v]) },
      role: { label: 'Role', values: (a) => [...new Set((d.usage.get(a.id) ?? []).map((x) => x.role))], name: roleLabel },
      state: { label: 'File', values: (a) => [facts(a).state], name: (v) => ({ ok: 'Available', missing: 'Missing', invalid: 'Invalid', unsupported: 'Unsupported', forbidden: 'Outside asset roots' }[v] ?? v) },
      cat, tag, notes: notes('asset'),
    };
  }
  function searchDoc(section, e) {
    if (section === 'units') return { name: e.name, id: e.id, aliases: e.aliases, facts: [...e.search, ...allTags('unit', e.id), org('unit', e.id).category ?? '', typeOf(e).label, ...Object.values(e.attrs).flat().filter((v) => typeof v === 'string' || typeof v === 'number').map(String)] };
    if (section === 'collections') return { name: e.name, id: e.id, aliases: [], facts: [...allTags('collection', e.id), org('collection', e.id).category ?? '', e.kind ?? ''], members: e.members.map((m) => ({ id: m.unit, name: snap.unitsById.get(m.unit)?.name ?? m.unit })) };
    return { name: e.id.split('/').pop(), id: e.id, aliases: e.label ? [e.label] : [], facts: [...allTags('asset', e.id), org('asset', e.id).category ?? '', e.kind ?? ''] };
  }
  function search({ section = 'units', q = '', filters = {}, page = 1, pageSize = 60 }) {
    check(['units', 'collections', 'assets'].includes(section), 'invalid', 'section must be units, collections or assets');
    const kind = { units: 'unit', collections: 'collection', assets: 'asset' }[section];
    const all = section === 'units' ? snap.units : section === 'collections' ? derive().collections : snap.assets;
    const facets = facetsFor(section);
    for (const k of Object.keys(filters)) check(facets[k] && Array.isArray(filters[k]), 'invalid', `unknown filter ${k}`);
    const ranked = new Map();
    for (const e of all) { const r = rankDoc(q, searchDoc(section, e)); if (r) ranked.set(e, r); }
    const valuesCache = new Map();
    const vals = (e, k) => { const key = `${k}\0${e.id}`; if (!valuesCache.has(key)) valuesCache.set(key, new Set(facets[k].values(e, kind))); return valuesCache.get(key); };
    const passes = (e, skip) => ranked.has(e) && Object.entries(filters).every(([k, sel]) => k === skip || !sel.length || sel.some((v) => vals(e, k).has(v)));
    const matched = all.filter((e) => passes(e)).sort((a, b) => (ranked.get(b).score - ranked.get(a).score) || (a.name ?? a.id).localeCompare(b.name ?? b.id));
    const facetOut = {};
    for (const [k, f] of Object.entries(facets)) {
      const counts = new Map();
      for (const e of all) if (passes(e, k)) for (const v of vals(e, k)) counts.set(v, (counts.get(v) ?? 0) + 1);
      for (const v of filters[k] ?? []) if (!counts.has(v)) counts.set(v, 0);
      facetOut[k] = { label: f.label, tree: !!f.tree, values: [...counts].map(([value, count]) => ({ value, label: f.name(value), count, selected: (filters[k] ?? []).includes(value) })).sort((a, b) => (f.tree ? a.value.localeCompare(b.value) : a.label.localeCompare(b.label))) };
    }
    const size = Math.min(MAX_PAGE, Math.max(1, pageSize | 0));
    const pages = Math.max(1, Math.ceil(matched.length / size));
    const p = Math.min(pages, Math.max(1, page | 0));
    const slice = matched.slice((p - 1) * size, p * size);
    const summarize_ = section === 'units' ? unitSummary : section === 'collections' ? collectionSummary : assetSummary;
    return { section, q, filters, total: matched.length, all: all.length, page: p, pages, pageSize: size, items: slice.map((e) => ({ ...summarize_(e), match: ranked.get(e).member ? { member: ranked.get(e).member } : null })), facets: facetOut, ids: matched.map((e) => e.id) };
  }

  // ---------- Detail reads ----------
  function noteView(n) {
    const d = derive(); const t = n.target;
    let exists = true, name = t.id, partLabel = null;
    if (t.kind === 'unit') { const u = snap.unitsById.get(t.id); exists = !!u; name = u?.name ?? t.id; if (t.part && u) partLabel = unitParts(u, typeOf(u)).find((p) => p.id === t.part)?.label ?? typeOf(u).roles.find((r) => r.key === t.part)?.label ?? t.part; }
    else if (t.kind === 'collection') { const c = d.collectionsById.get(t.id); exists = !!c; name = c?.name ?? t.id; if (t.part && c) partLabel = collectionParts(c, snap.unitsById, snap.schema).find((p) => p.id === t.part)?.label ?? t.part; }
    else if (t.kind === 'asset') { exists = snap.assetsById.has(t.id); name = t.id.split('/').pop(); }
    else if (t.kind === 'submission') { const s = d.lists.submission.items.find((x) => x.id === t.id); exists = !!s; name = s ? `${s.title} · ${shortRef(s.id)}` : t.id; const it = s?.items.find((i) => i.id === t.item); if (it) { name += ` · ${it.title}`; if (t.part) partLabel = it.parts.find((p) => p.id === t.part)?.label ?? t.part; } }
    return { ...n, targetName: name, targetExists: exists, partLabel, thumb: t.kind === 'unit' && exists ? thumbOf(snap.unitsById.get(t.id)) : t.kind === 'asset' && exists ? assetRef(snap.assetsById.get(t.id)) : null };
  }
  function historyFor(target) {
    const d = derive();
    return (d.eventsByTarget.get(tkey(target)) ?? []).slice().sort(eventOrder).reverse().map((e) => {
      const { submission, item } = d.items.get(e.item);
      const comparable = Object.keys(eventVerdicts(e)).filter((p) => { const fr = item.parts.find((x) => x.id === p)?.evidence; return fr && fr.digest !== currentDigest(target, p); });
      return { ...eventSummary(e), title: submission.title, partLabels: Object.fromEntries(item.parts.map((p) => [p.id, p.label])), changedParts: comparable };
    });
  }
  function unitGet({ id }) {
    const u = snap.unitsById.get(id);
    check(u, 'not_found', `content ${id} is not in this checkout`);
    const d = derive(); const t = typeOf(u); const o = org('unit', id);
    const links = u.links.map((l) => {
      const a = snap.assetsById.get(l.asset);
      const users = [...new Map((d.usage.get(a.id) ?? []).filter((x) => x.unit !== id).map((x) => [x.unit, { unit: x.unit, role: x.role, name: snap.unitsById.get(x.unit)?.name, roleLabel: roleLabel(x.role) }])).values()];
      return { role: l.role, roleLabel: t.roles.find((r) => r.key === l.role).label, asset: assetRef(a), alsoUsedBy: users };
    });
    return {
      unit: { id: u.id, name: u.name, type: u.type, attrs: u.attrs, aliases: u.aliases, sources: u.sources, explain: u.explain },
      type: t, organization: o, tags: allTags('unit', id), links, missing: missingRoles(u),
      review: project({ kind: 'unit', id }), history: historyFor({ kind: 'unit', id }),
      memberships: (d.memberships.get(id) ?? []).map((cid) => { const c = d.collectionsById.get(cid); const p = project({ kind: 'collection', id: cid }).parts.find((x) => x.id === `member:${id}`); return { id: cid, name: c.name, category: org('collection', cid).category, verdict: p?.verdict ?? null, position: c.members.findIndex((m) => m.unit === id), count: c.members.length }; }),
      notes: [...(d.notesByTarget.get(`unit:${id}`) ?? []), ...[...new Set(u.links.map((l) => l.asset))].flatMap((aid) => d.notesByTarget.get(`asset:${aid}`) ?? [])].map(noteView).sort((a, b) => b.at.localeCompare(a.at)),
      refs: Object.fromEntries(Object.entries(u.attrs).filter(([k]) => t.fields.find((f) => f.key === k)?.kind === 'refs').map(([k, v]) => [k, (Array.isArray(v) ? v : [v]).map((rid) => { const r = snap.unitsById.get(rid); return { id: rid, name: r?.name ?? rid, exists: !!r, thumb: r ? thumbOf(r) : null }; })])),
      waiting: openItemsFor({ kind: 'unit', id }),
    };
  }
  function collectionGet({ id }) {
    const d = derive(); const c = d.collectionsById.get(id);
    check(c, 'not_found', `collection ${id} is not in this checkout`);
    const kind = c.kind ? snap.schema.collectionKinds[c.kind] : null;
    const proj = project({ kind: 'collection', id });
    let preview = null;
    const pv = previewSpec(c);
    if (pv) {
      // Project-defined combined preview: declared module, config, base and member roles.
      preview = { label: pv.label, module: pv.module, moduleUrl: moduleUrl(pv.module), moduleError: pv.moduleSha === 'missing' ? `Preview module "${pv.module}" is declared but its file is missing` : null, represents: pv.represents, config: pv.config, roles: pv.roles, base: pv.base ? assetRef(snap.assetsById.get(pv.base)) : pv.baseDeclared ? { id: pv.baseDeclared, state: 'missing', error: `base ${pv.baseDeclared} is not an asset in this checkout` } : null, members: Object.entries(pv.members).flatMap(([unit, ps]) => ps.map((p) => ({ unit, part: p.part, role: p.role, asset: assetRef(snap.assetsById.get(p.asset)) }))) };
    }
    return {
      collection: { id: c.id, name: c.name, kind: c.kind, kindLabel: kind?.label ?? null, owner: c.owner, revision: c.owner === 'catalog' ? c.revision : null, createdBy: c.createdBy ?? null },
      organization: org('collection', id), tags: allTags('collection', id),
      members: c.members.map((m, i) => {
        const u = snap.unitsById.get(m.unit);
        const extraKey = kind?.memberExtra?.key;
        return u ? { ...unitSummary(u), position: i, extra: kind?.memberField ? fmtValue(u.attrs[kind.memberField]) : extraKey && m[extraKey] != null ? `×${m[extraKey]}` : null, inCollection: proj.parts.find((p) => p.id === `member:${u.id}`) ?? null } : { id: m.unit, name: m.unit, missingTarget: true, position: i };
      }),
      preview, review: proj, history: historyFor({ kind: 'collection', id }),
      notes: (d.notesByTarget.get(`collection:${id}`) ?? []).map(noteView).sort((a, b) => b.at.localeCompare(a.at)),
      waiting: openItemsFor({ kind: 'collection', id }),
    };
  }
  function assetGet({ id }) {
    const a = snap.assetsById.get(id);
    check(a, 'not_found', `asset ${id} is not in this checkout`);
    const d = derive(); const cur = assetRef(a);
    const usage = (d.usage.get(id) ?? []).map((x) => { const u = snap.unitsById.get(x.unit); const role = typeOf(u).roles.find((r) => r.key === x.role); return { unit: u.id, name: u.name, typeLabel: typeOf(u).label, role: x.role, roleLabel: role.label, part: unitParts(u, typeOf(u)).find((p) => p.role === x.role && p.asset === id).id, thumb: thumbOf(u) }; });
    // Versions: the current file plus every distinct frozen version referenced by review evidence.
    const versions = new Map();
    const verdicts = [];
    for (const { submission, item } of d.items.values()) for (const p of item.parts) {
      const refs = p.evidence.asset === id ? [[p.evidence, '']] : Object.entries(p.evidence.parts ?? {}).filter(([, e]) => e.asset === id).map(([pid, e]) => [e, `${p.evidence.unit}/${pid}`]);
      for (const [e, leaf] of refs) {
        if (!versions.has(e.sha256)) versions.set(e.sha256, { sha256: e.sha256, size: e.size, firstSeen: submission.at, submissions: [] });
        versions.get(e.sha256).submissions.push({ submission: submission.id, ref: shortRef(submission.id), item: item.id, part: p.id, leaf, url: `/media/evidence/${encodeURIComponent(submission.id)}/${encodeURIComponent(item.id)}/${encodeURIComponent(p.id)}${leaf ? `?leaf=${encodeURIComponent(leaf)}` : ''}` });
        if (p.evidence.asset === id) for (const ev of d.eventsByItem.get(item.id) ?? []) { const v = eventVerdicts(ev)[p.id]; if (v) verdicts.push({ event: ev.id, submission: submission.id, ref: shortRef(submission.id), item: item.id, part: p.id, partLabel: p.label, target: item.target, targetName: item.title, verdict: v, note: ev.partNotes?.[p.id] ?? '', by: ev.by, at: ev.at, sha256: e.sha256 }); }
      }
    }
    return {
      asset: { ...cur, label: a.label }, organization: org('asset', id), tags: allTags('asset', id), usage,
      versions: [...(cur.sha256 ? [{ sha256: cur.sha256, size: cur.size, current: true }] : []), ...[...versions.values()].filter((v) => v.sha256 !== cur.sha256).sort((x, y) => y.firstSeen.localeCompare(x.firstSeen))],
      verdicts: verdicts.sort((x, y) => y.at.localeCompare(x.at)),
      notes: (d.notesByTarget.get(`asset:${id}`) ?? []).map(noteView).sort((x, y) => y.at.localeCompare(x.at)),
    };
  }

  // ---------- Reviews ----------
  function itemState(item, events) {
    const res = resolveParts(events, item.parts.map((p) => p.id), resolver);
    const parts = item.parts.map((p) => ({ id: p.id, label: p.label, verdict: res[p.id]?.verdict ?? null, event: res[p.id] ? eventSummary(res[p.id].event) : null }));
    return { parts, summary: summarize(parts) };
  }
  function openItemsFor(target) {
    return (derive().itemsByTarget.get(tkey(target)) ?? []).map(({ submission, item }) => ({ submission: submission.id, ref: shortRef(submission.id), title: submission.title, item: item.id, state: itemState(item, derive().eventsByItem.get(item.id) ?? []).summary })).filter((x) => x.state.undecided > 0);
  }
  function submissionView(s, full) {
    const d = derive();
    const items = s.items.map((it) => {
      const st = itemState(it, d.eventsByItem.get(it.id) ?? []);
      return { id: it.id, target: it.target, title: it.title, targetExists: it.target.kind === 'unit' ? snap.unitsById.has(it.target.id) : d.collectionsById.has(it.target.id), state: st.summary.state, summary: st.summary, ...(full ? { parts: st.parts.map((p) => { const fp = it.parts.find((x) => x.id === p.id); return { ...p, ...pick(fp, ['role', 'member', 'asset']), evidence: publicEvidence(fp.evidence), leaves: leaves(fp.evidence, fp.label).map((l) => leafView(s.id, it.id, p.id, l)) }; }), views: it.views.map((v) => befores.project(s.id, it.id, v)), attributes: it.attributes ?? null, kind: it.kind, preview: framePreview(it) } : {}) };
    });
    const waiting = items.filter((i) => i.summary.undecided > 0).length;
    const counts = { items: items.length, waiting, approved: items.filter((i) => i.state === 'approved').length, changes: items.filter((i) => ['changes', 'mixed'].includes(i.state) && i.summary.changes).length, rejected: items.filter((i) => i.summary.rejected).length };
    return { id: s.id, ref: shortRef(s.id), title: s.title, by: s.by, at: s.at, context: s.context, supersedes: s.supersedes ?? null, note: s.note ?? null, counts, items };
  }
  // The frozen preview declaration of an item (module, config, roles) plus where to load it.
  // The frozen preview declaration of an item. A project module is offered only at the exact
  // revision that was submitted; otherwise the preview is reported unavailable, never replaced.
  function framePreview(it) {
    const p = it.parts.find((x) => x.id === 'preview');
    if (!p) return null;
    const e = p.evidence;
    const module = e.module ?? 'assembled-mesh';
    const base = { module, label: p.label, config: e.config ?? {}, roles: e.roles ?? ['model'] };
    if (!e.moduleSha) return { ...base, moduleUrl: null, moduleChanged: false, moduleError: null };
    let current = null;
    try { current = config.previewModules?.[module] ? previewModule(module).sha256 : null; } catch {}
    if (current === e.moduleSha) return { ...base, moduleSha: e.moduleSha, moduleUrl: `/project/preview/${encodeURIComponent(module)}?v=${e.moduleSha.slice(0, 16)}`, moduleChanged: false, moduleError: null };
    return { ...base, moduleSha: e.moduleSha, moduleUrl: null, moduleChanged: true, moduleError: current ? `Preview module "${module}" changed since this submission (submitted ${e.moduleSha.slice(0, 12)}, now ${current.slice(0, 12)}); the submitted revision is not available to render` : `Preview module "${module}" (submitted ${e.moduleSha.slice(0, 12)}) is not available in this checkout` };
  }
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] != null).map((k) => [k, o[k]]));
  const publicEvidence = (e) => ({ digest: e.digest, asset: e.asset ?? null, path: e.path ?? null, kind: e.kind ?? null, mime: e.mime ?? null, size: e.size ?? null, sha256: e.sha256 ?? null, storage: e.ref?.git ? 'git' : e.ref?.store ? 'catalog' : null, unit: e.unit ?? null });
  function reviewsList({ state = 'all', q = '', page = 1, pageSize = 50, target }) {
    const d = derive();
    let list = d.lists.submission.items.filter((s) => !target || s.items.some((it) => it.target.kind === target.kind && it.target.id === target.id)).map((s) => submissionView(s, false)).sort((a, b) => b.at.localeCompare(a.at));
    if (q) list = list.filter((s) => `${s.title} ${s.ref} ${s.items.map((i) => i.title).join(' ')}`.toLowerCase().includes(q.toLowerCase()));
    const counts = { all: list.length, waiting: list.filter((s) => s.counts.waiting).length, changes: list.filter((s) => s.counts.changes).length, rejected: list.filter((s) => s.counts.rejected).length, approved: list.filter((s) => s.counts.approved === s.counts.items).length };
    if (state === 'waiting') list = list.filter((s) => s.counts.waiting);
    else if (state === 'changes') list = list.filter((s) => s.counts.changes);
    else if (state === 'rejected') list = list.filter((s) => s.counts.rejected);
    else if (state === 'approved') list = list.filter((s) => s.counts.approved === s.counts.items);
    const size = Math.min(MAX_PAGE, Math.max(1, pageSize | 0));
    const pages = Math.max(1, Math.ceil(list.length / size)); const p = Math.min(pages, Math.max(1, page | 0));
    return { total: list.length, page: p, pages, counts, items: list.slice((p - 1) * size, p * size) };
  }
  function reviewGet({ submission }) {
    const d = derive();
    const s = d.lists.submission.items.find((x) => x.id === submission || shortRef(x.id) === String(submission).toUpperCase());
    check(s, 'not_found', `submission ${submission} not found`);
    const v = submissionView(s, true);
    const events = d.lists.verdict.items.filter((e) => e.submission === s.id).sort(eventOrder).reverse().map(eventSummary);
    const observations = (d.notesByTarget.get(`submission:${s.id}`) ?? []).map(noteView).sort((a, b) => b.at.localeCompare(a.at));
    const supersededBy = d.lists.submission.items.filter((x) => x.supersedes === s.id).map((x) => ({ id: x.id, ref: shortRef(x.id) }));
    return { ...v, events, observations, supersededBy };
  }

  // Resolve one side of a comparison independently. Never falls back to another side.
  function resolveEvidence(e) {
    if (!e) return { status: 'missing', error: 'no evidence for this part' };
    if (e.attrs !== undefined || e.kind === 'attributes') return { status: 'ok', kind: 'attributes', attrs: e.attrs };
    if (!e.ref) return { status: 'ok', kind: 'composite', digest: e.digest };
    const r = evidence.readRef(e.ref, e.sha256);
    return r.status === 'ok' ? { status: 'ok', kind: e.kind, mime: e.mime, sha256: e.sha256, size: e.size, path: e.path, asset: e.asset } : { status: r.status, error: r.error, kind: e.kind, path: e.path, asset: e.asset, sha256: e.sha256 };
  }
  function findItem(subId, itemId) {
    const it = derive().items.get(itemId);
    check(it && it.submission.id === subId, 'not_found', `item ${itemId} is not in submission ${subId}`);
    return it;
  }
  function frozenPart(subId, itemId, partId) {
    const { item } = findItem(subId, itemId);
    const p = item.parts.find((x) => x.id === partId);
    check(p, 'not_found', `part ${partId} is not part of item ${itemId}`);
    return { item, part: p };
  }
  // Leaf evidence for a frozen part; member parts expand to the member's own part evidence.
  function leaves(e, label) {
    if (!e) return [];
    if (e.parts) return Object.entries(e.parts).map(([pid, pe]) => ({ key: `${e.unit}/${pid}`, label: `${snap.unitsById.get(e.unit)?.name ?? e.unit} · ${pid === 'attributes' ? 'Attributes' : roleLabel(pid.split(':')[0])}`, evidence: pe, unit: e.unit, part: pid }));
    if (e.members) return [...Object.entries(e.members).flatMap(([uid, me]) => leaves({ unit: uid, parts: me }, label)), ...(e.base ? [{ key: 'base', label: 'Base', evidence: e.base }] : [])];
    return [{ key: '', label, evidence: e }];
  }
  const verified = new Map();
  function evidenceStatus(e) {
    const vk = `${e.sha256}:${evidence.storageKey(e.ref)}`;
    let st = verified.get(vk);
    if (!st) { const r = evidence.readRef(e.ref, e.sha256); st = r.status === 'ok' ? { status: 'ok' } : { status: r.status, error: r.error }; verified.set(vk, st); }
    return st;
  }
  const befores = createBeforeSides({ root, evidence, assetRoots: () => snap.assetRoots, evidenceStatus, earlierLeaf: (b) => { const { part } = frozenPart(b.submission, b.item, b.part); return leaves(part.evidence, part.label).find((x) => x.key === (b.leaf ?? ''))?.evidence; } });
  function leafView(subId, itemId, partId, l) {
    const e = l.evidence;
    if (e.kind === 'attributes') return { key: l.key, label: l.label, kind: 'attributes', status: 'ok', attrs: e.attrs };
    if (!e.ref) return { key: l.key, label: l.label, kind: e.kind ?? null, status: 'missing', error: 'no evidence recorded' };
    const st = evidenceStatus(e);
    return { key: l.key, label: l.label, kind: e.kind, path: e.path, asset: e.asset, sha256: e.sha256, unit: l.unit ?? null, part: l.part ?? null, storage: e.ref.git ? 'git' : 'catalog', ...st, url: st.status === 'ok' ? `/media/evidence/${encodeURIComponent(subId)}/${encodeURIComponent(itemId)}/${encodeURIComponent(partId)}${l.key ? `?leaf=${encodeURIComponent(l.key)}` : ''}` : null };
  }
  function currentAssetEvidence(assetId) {
    const a = snap.assetsById.get(assetId); if (!a) return null; const f = facts(a);
    return { kind: a.kind, asset: a.id, path: a.path, sha256: f.sha256 ?? null, size: f.size, mime: f.mime, digest: f.sha256 ?? null, current: true, state: f.state, error: f.error };
  }
  function currentLeafEvidence(unitId, partId) {
    const u = snap.unitsById.get(unitId);
    if (!u) return null;
    if (partId === 'attributes') return { kind: 'attributes', attrs: reviewAttrs(u, typeOf(u)), digest: digest(reviewAttrs(u, typeOf(u))) };
    const p = unitParts(u, typeOf(u)).find((x) => x.id === partId);
    if (!p) return null;
    const a = snap.assetsById.get(p.asset); const f = facts(a);
    return { kind: a.kind, asset: a.id, path: a.path, sha256: f.sha256 ?? null, size: f.size, mime: f.mime, digest: f.sha256 ?? null, current: true, state: f.state, error: f.error };
  }
  function sideView(e, mediaUrl) {
    if (!e) return { status: 'missing', error: 'not present on this side' };
    if (e.current) return e.state === 'ok' ? { status: 'ok', kind: e.kind, sha256: e.sha256, mime: e.mime, size: e.size, asset: e.asset, path: e.path, url: `/media/asset/${encodeURIComponent(e.asset)}?v=${e.sha256.slice(0, 16)}` } : { status: e.state, error: e.error, kind: e.kind, asset: e.asset, path: e.path };
    if (e.kind === 'attributes') return { status: 'ok', kind: 'attributes', attrs: e.attrs };
    const r = resolveEvidence(e);
    return r.status === 'ok' ? { ...r, url: mediaUrl } : r;
  }
  function compare({ a, b }) {
    check(isObject(a) && nonempty(a.submission) && nonempty(a.item) && nonempty(a.part), 'invalid', 'a needs submission, item and part');
    const fa = frozenPart(a.submission, a.item, a.part);
    let fbItem = null, fbPart = null;
    if (b && b !== 'current') { check(isObject(b) && nonempty(b.submission) && nonempty(b.item) && nonempty(b.part), 'invalid', 'b must be "current" or a frozen part'); ({ item: fbItem, part: fbPart } = frozenPart(b.submission, b.item, b.part)); }
    const left = leaves(fa.part.evidence, fa.part.label);
    const target = fa.item.target;
    const rows = [];
    const keys = new Map(left.map((l) => [l.key, { a: l }]));
    if (fbPart) for (const l of leaves(fbPart.evidence, fbPart.label)) keys.set(l.key, { ...(keys.get(l.key) ?? {}), b: l });
    else for (const l of left) {
      // Current side: resolve the same identity (unit + part) from the working checkout.
      if (l.key === 'base') { const pv = target.kind === 'collection' && derive().collectionsById.get(target.id) && previewSpec(derive().collectionsById.get(target.id)); keys.get(l.key).b = { key: 'base', label: 'Base', evidence: pv?.base ? currentAssetEvidence(pv.base) : null }; continue; }
      const unitId = l.unit ?? (target.kind === 'unit' ? target.id : null);
      const partId = l.unit ? l.part : a.part;
      keys.get(l.key).b = { key: l.key, label: l.label, evidence: unitId ? currentLeafEvidence(unitId, partId) : null };
    }
    const media = (side, sub, item, part, key) => `/media/evidence/${encodeURIComponent(sub)}/${encodeURIComponent(item)}/${encodeURIComponent(part)}${key ? `?leaf=${encodeURIComponent(key)}` : ''}`;
    for (const [key, { a: la, b: lb }] of keys) {
      const sa = la ? sideView(la.evidence, media('a', a.submission, a.item, a.part, key)) : { status: 'missing', error: 'not present on this side' };
      const sb = lb ? sideView(lb.evidence, fbPart ? media('b', b.submission, b.item, b.part, key) : null) : { status: 'missing', error: 'not present on this side' };
      const identical = sa.status === 'ok' && sb.status === 'ok' && (sa.kind === 'attributes' ? digest(sa.attrs) === digest(sb.attrs) : !!sa.sha256 && sa.sha256 === sb.sha256);
      rows.push({ key, label: (la ?? lb).label, a: sa, b: sb, identical });
    }
    return { title: `${fa.item.title} · ${fa.part.label}`, a: { ...a, label: fa.part.label }, b: fbPart ? { ...b, label: fbPart.label } : 'current', rows, identical: rows.length > 0 && rows.every((r) => r.identical) };
  }
  // Bytes for a frozen evidence leaf (media endpoint and capture).
  function evidenceBytes(subId, itemId, partId, leafKey) {
    const { part } = frozenPart(subId, itemId, partId);
    const leaf = leaves(part.evidence, part.label).find((l) => l.key === (leafKey ?? ''));
    check(leaf && leaf.evidence.ref, 'not_found', 'no media evidence for this part');
    const r = evidence.readRef(leaf.evidence.ref, leaf.evidence.sha256);
    if (r.status !== 'ok') fail(r.status === 'corrupt' ? 'malformed' : 'unavailable', r.error);
    return { bytes: r.bytes, mime: r.media?.mime ?? leaf.evidence.mime, sha256: r.sha256 };
  }

  // ---------- Freezing evidence for a submission ----------
  async function freezeAsset(assetId) {
    const a = snap.assetsById.get(assetId);
    const f = facts(a);
    check(f.state === 'ok', 'invalid', `cannot submit ${a.path}: ${f.error ?? f.state}`);
    const full = confinedPath(root, a.path, snap.assetRoots);
    const ref = evidence.freezeFile(a.path, full, f.sha256, a.path.split('.').pop().toLowerCase());
    check(ref, 'conflict', `${a.path} changed while it was being captured; submit again`);
    return { digest: f.sha256, asset: a.id, path: a.path, kind: a.kind, mime: f.mime, size: f.size, sha256: f.sha256, ref };
  }
  const freezeDefinition = (u) => evidence.freezeJson({ id: u.id, type: u.type, name: u.name, attrs: reviewAttrs(u, typeOf(u)), links: u.links.map((l) => ({ ...l, path: snap.assetsById.get(l.asset).path })), sources: u.sources });
  // Only the selected parts' own dependencies are frozen; unrelated media cannot block a review.
  async function freezeUnitParts(u, partIds) {
    const parts = {};
    for (const p of unitParts(u, typeOf(u))) {
      if (!partIds.includes(p.id)) continue;
      parts[p.id] = p.id === 'attributes' ? { kind: 'attributes', attrs: reviewAttrs(u, typeOf(u)), digest: digest(reviewAttrs(u, typeOf(u))) } : await freezeAsset(p.asset);
    }
    return parts;
  }
  // A collection preview's inputs as declared by the project: module, config, base and roles.
  function previewSpec(c) {
    const kind = c.kind && snap.schema.collectionKinds[c.kind];
    if (!kind?.preview) return null;
    const pv = kind.preview;
    const roles = Array.isArray(pv.roles) && pv.roles.length ? pv.roles : ['model'];
    const members = Object.fromEntries(c.members.filter((m) => snap.unitsById.has(m.unit)).map((m) => { const u = snap.unitsById.get(m.unit); return [m.unit, unitParts(u, typeOf(u)).filter((p) => p.asset && roles.includes(p.role)).map((p) => ({ part: p.id, asset: p.asset, role: p.role }))]; }));
    const module = pv.module ?? 'assembled-mesh';
    let moduleSha = null;
    if (config.previewModules?.[module]) { try { moduleSha = previewModule(module).sha256; } catch { moduleSha = 'missing'; } }
    return { module, moduleSha, label: pv.label ?? 'Preview', represents: pv.represents ?? 'complete', roles, config: isObject(pv.config) ? pv.config : {}, base: pv.base && snap.assetsById.has(pv.base) ? pv.base : null, baseDeclared: pv.base ?? null, members };
  }
  // The module's identity (project module bytes, or the built-in name) is part of the preview evidence.
  const previewDigest = (spec, shaOf) => digest({ module: spec.module, moduleSha: spec.moduleSha ?? `builtin:${spec.module}`, config: spec.config, roles: spec.roles, base: spec.base ? shaOf(spec.base) : null, members: Object.fromEntries(Object.entries(spec.members).map(([u, ps]) => [u, Object.fromEntries(ps.map((p) => [p.part, shaOf(p.asset)]))])) });

  function checkViews(requested, parts, leafKeys) {
    if (requested === undefined) return;
    check(Array.isArray(requested) && requested.length > 0 && requested.length <= 50, 'invalid', 'views must be a list of 1-50 views');
    for (const v of requested) {
      check(isObject(v) && typeof v.part === 'string' && parts.some((x) => x.id === v.part), 'invalid', `view part ${v?.part} is not in this item`);
      check(v.caption == null || (typeof v.caption === 'string' && v.caption.length <= 300), 'invalid', 'view caption must be text (at most 300 characters)');
      check(v.leaf == null || (typeof v.leaf === 'string' && (leafKeys(v.part) ?? []).includes(v.leaf)), 'invalid', `view leaf ${v.leaf} is not part of ${v.part}`);
      check(validCamera(v.camera), 'invalid', 'view camera needs position/target as three numbers each');
      check(validViewState(v.state), 'invalid', 'view state supports mode, animation {clip,time,playing}, isolate and texture');
      check(v.afterLabel == null || v.before != null, 'invalid', 'afterLabel needs a before');
    }
  }
  function buildViews(requested, parts, caption, defaults) {
    if (requested) return requested.map((v) => ({ id: newId('vw'), part: v.part, leaf: v.leaf ?? null, caption: nonempty(v.caption) ? v.caption.trim() : caption(parts.find((x) => x.id === v.part)), camera: v.camera ?? null, state: v.state ?? null }));
    return parts.flatMap((p) => (defaults ? defaults(p) : p.asset ? [{ part: p.id, caption: caption(p) }] : [])).map((v) => ({ id: newId('vw'), part: v.part, leaf: v.leaf ?? null, caption: v.caption, camera: null, state: null }));
  }

  // Validate an item request completely (target, parts, views, media availability) without effects.
  function planItem(spec) {
    check(isObject(spec) && isObject(spec.target) && ['unit', 'collection'].includes(spec.target.kind) && nonempty(spec.target.id), 'invalid', 'item target must be a unit or collection');
    check(spec.title == null || (typeof spec.title === 'string' && spec.title.length <= 300), 'invalid', 'item title must be text');
    check(spec.parts == null || (Array.isArray(spec.parts) && spec.parts.every((x) => typeof x === 'string')), 'invalid', 'parts must be a list of part ids');
    const target = { kind: spec.target.kind, id: spec.target.id };
    if (target.kind === 'unit') {
      const u = snap.unitsById.get(target.id);
      check(u, 'not_found', `content ${target.id} is not in this checkout`);
      const all = unitParts(u, typeOf(u));
      if (spec.parts) for (const p of spec.parts) check(all.some((x) => x.id === p), 'invalid', `${u.name} has no part ${p}`);
      const chosen = spec.parts ? all.filter((p) => spec.parts.includes(p.id)) : all;
      check(chosen.length, 'invalid', `no reviewable parts selected for ${u.name}`);
      checkViews(spec.views, chosen, () => ['']);
      for (const p of chosen) if (p.asset) { const f = facts(snap.assetsById.get(p.asset)); check(f.state === 'ok', 'invalid', `cannot submit ${u.name} · ${p.label}: ${f.error ?? f.state}`); }
      const shownKind = (v) => { const p = chosen.find((x) => x.id === v.part); return p.asset ? facts(snap.assetsById.get(p.asset)).kind : null; };
      const planned = spec.views?.map((v) => (v.before != null ? befores.plan(v, shownKind(v)) : null));
      return { target, spec, u, chosen, befores: planned };
    }
    const c = derive().collectionsById.get(target.id);
    check(c, 'not_found', `collection ${target.id} is not in this checkout`);
    const all = collectionParts(c, snap.unitsById, snap.schema);
    if (spec.parts) for (const p of spec.parts) check(all.some((x) => x.id === p), 'invalid', `${c.name} has no part ${p}`);
    const chosen = spec.parts ? all.filter((p) => spec.parts.includes(p.id)) : all;
    check(chosen.length, 'invalid', `no reviewable parts selected for ${c.name}`);
    const pv = chosen.some((p) => p.id === 'preview') ? previewSpec(c) : null;
    const leafKeys = (pid) => {
      if (pid === 'preview') return [...Object.entries(pv?.members ?? {}).flatMap(([u, ps]) => ps.map((p) => `${u}/${p.part}`)), ...(pv?.base ? ['base'] : [])];
      const uid = pid.replace(/^member:/, ''); const u = snap.unitsById.get(uid);
      return u ? unitParts(u, typeOf(u)).map((p) => `${uid}/${p.id}`) : [];
    };
    checkViews(spec.views, chosen, leafKeys);
    const needAssets = new Set();
    for (const p of chosen) {
      if (p.id === 'preview') {
        check(!pv.baseDeclared || pv.base, 'invalid', `preview base ${pv.baseDeclared} is not an asset in this checkout`);
        for (const ps of Object.values(pv.members)) ps.forEach((x) => needAssets.add(x.asset)); if (pv.base) needAssets.add(pv.base);
      }
      else { const u = snap.unitsById.get(p.member); check(u, 'not_found', `member ${p.member} is not in this checkout`); u.links.forEach((l) => needAssets.add(l.asset)); }
    }
    for (const id of needAssets) { const a = snap.assetsById.get(id); const f = facts(a); check(f.state === 'ok', 'invalid', `cannot submit ${c.name}: ${a.path} is ${f.error ?? f.state}`); }
    // A member view compares its one named leaf (<unit>/<part>); a preview has no single media.
    const shownKind = (v) => {
      if (v.part === 'preview' || !v.leaf) return null;
      const cut = v.leaf.lastIndexOf('/'); const u = snap.unitsById.get(v.leaf.slice(0, cut));
      const p = u && unitParts(u, typeOf(u)).find((x) => x.id === v.leaf.slice(cut + 1));
      return p?.asset ? facts(snap.assetsById.get(p.asset)).kind : null;
    };
    const planned = spec.views?.map((v) => (v.before != null ? befores.plan(v, shownKind(v)) : null));
    return { target, spec, c, chosen, pv, leafKeys, befores: planned };
  }
  async function freezeItem(plan) {
    const { target, spec, chosen } = plan;
    const itemId = newId('it');
    if (target.kind === 'unit') {
      const u = plan.u;
      const fr = await freezeUnitParts(u, chosen.map((p) => p.id));
      const parts = chosen.map((p) => ({ id: p.id, label: p.label, role: p.role ?? null, asset: p.asset ?? null, evidence: fr[p.id] }));
      return { id: itemId, target, title: nonempty(spec.title) ? spec.title.trim() : u.name, kind: 'unit', definition: freezeDefinition(u), parts, views: befores.freeze(buildViews(spec.views, parts, (p) => `${u.name} · ${p.label}`), plan.befores) };
    }
    const { c, pv } = plan;
    const parts = [];
    for (const p of chosen) {
      if (p.id === 'preview') {
        const members = {};
        for (const [uid, ps] of Object.entries(pv.members)) { members[uid] = {}; for (const x of ps) members[uid][x.part] = await freezeAsset(x.asset); }
        const base = pv.base ? await freezeAsset(pv.base) : null;
        const shaOf = (assetId) => assetId === pv.base ? base.sha256 : Object.values(members).flatMap((m) => Object.values(m)).find((l) => l.asset === assetId).sha256;
        check(pv.moduleSha !== 'missing', 'invalid', `preview module ${pv.module} is declared but its file is missing`);
        parts.push({ id: 'preview', label: p.label, evidence: { digest: previewDigest(pv, shaOf), module: pv.module, config: pv.config, roles: pv.roles, base, members, ...(pv.moduleSha ? { moduleSha: pv.moduleSha } : {}) } });
        continue;
      }
      const u = snap.unitsById.get(p.member);
      const all = unitParts(u, typeOf(u)).map((x) => x.id);
      const leaves = await freezeUnitParts(u, all);
      parts.push({ id: p.id, label: p.label, member: p.member, evidence: { digest: digest(Object.fromEntries(Object.entries(leaves).map(([k, v]) => [k, v.digest]))), unit: p.member, definition: freezeDefinition(u), parts: leaves } });
    }
    const def = evidence.freezeJson({ id: c.id, name: c.name, kind: c.kind, members: c.members });
    const views = buildViews(spec.views, parts, (p) => `${c.name} · ${p.label}`, (p) => {
      if (p.id === 'preview') return [{ part: 'preview', caption: `${c.name} · ${p.label}` }];
      const u = snap.unitsById.get(p.member); const link = u && (u.links.find((l) => l.role === typeOf(u).thumb) ?? u.links[0]);
      return link ? [{ part: p.id, leaf: `${u.id}/${unitParts(u, typeOf(u)).find((x) => x.asset === link.asset && x.role === link.role).id}`, caption: `${u.name} · ${typeOf(u).roles.find((r) => r.key === link.role).label}` }] : [];
    });
    return { id: itemId, target, title: nonempty(spec.title) ? spec.title.trim() : c.name, kind: 'collection', definition: def, parts, views: befores.freeze(views, plan.befores), preview: pv ? { module: pv.module, label: pv.label, represents: pv.represents } : null };
  }

  // ---------- Mutations ----------
  const actorOf = (meta) => { const a = meta.actor; check(isObject(a) && nonempty(a.name) && ['human', 'agent'].includes(a.kind), 'invalid', 'declare the actor: name and kind (human or agent)'); return { name: a.name.trim().slice(0, 200), kind: a.kind }; };
  const targetExists = (t) => isObject(t) && typeof t.id === 'string' && (t.kind === 'unit' ? snap.unitsById.has(t.id) : t.kind === 'asset' ? snap.assetsById.has(t.id) : t.kind === 'collection' ? derive().collectionsById.has(t.id) : t.kind === 'submission' ? derive().lists.submission.items.some((s) => s.id === t.id) : false);
  const getNote = (id) => { const n = derive().lists.note.items.find((x) => x.id === id); check(n, 'not_found', `note ${id} not found`); return n; };
  const cleanTag = (x) => { check(typeof x === 'string', 'invalid', 'tags must be text'); const t = x.trim().toLowerCase(); check(t && isTag(t), 'invalid', `invalid tag "${x}": use lowercase letters, digits and : . _ / + - (1-64 characters)`); return t; };
  const cleanTags = (tags) => { check(Array.isArray(tags), 'invalid', 'tags must be a list'); return [...new Set(tags.map(cleanTag))]; };
  const cleanCategory = (c) => { if (c == null || c === '') return null; check(typeof c === 'string', 'invalid', 'category must be text'); const p = c.split('/').map((x) => x.trim()).filter(Boolean).join('/'); check(isCategory(p), 'invalid', `invalid category "${c}" (at most 8 levels of 64 characters)`); return p; };
  const requiredCategory = (c) => { const p = cleanCategory(c); check(p, 'invalid', 'category path is required'); return p; };

  // Committed records outlive the local replay journal. Their binding must still match.
  function priorRequest(kind, requestId, binding, field = 'requestId') {
    if (!requestId) return null;
    const matches = records.list(kind).items.filter((r) => r[field] === requestId);
    for (const prior of matches) check(digest(prior[field === 'lastRequestId' ? 'lastRequestBinding' : 'requestBinding']) === digest(binding), 'conflict', 'request id was already used for a different action, input, actor or checkout context');
    return matches[0];
  }

  async function noteCreate(input, { actor, requestId, requestBinding }) {
    const t = input.target;
    check(isObject(t) && ['unit', 'collection', 'asset', 'submission'].includes(t.kind) && nonempty(t.id), 'invalid', 'note target must be a unit, collection, asset or submission');
    check((t.part == null || typeof t.part === 'string') && (t.item == null || typeof t.item === 'string'), 'invalid', 'note part/item must be text');
    check(targetExists(t), 'not_found', `${t.kind} ${t.id} is not in this checkout`);
    check(nonempty(input.body), 'invalid', 'note text is required');
    if (t.kind === 'submission' && t.item) { const s = derive().lists.submission.items.find((x) => x.id === t.id); const it = s.items.find((i) => i.id === t.item); check(it, 'not_found', 'item not in submission'); if (t.part) check(it.parts.some((p) => p.id === t.part), 'not_found', 'part not in item'); }
    else if (t.part) check(partsOf(t).some((p) => p.id === t.part) || (t.kind === 'unit' && typeOf(snap.unitsById.get(t.id)).roles.some((r) => r.key === t.part)), 'invalid', `unknown part ${t.part}`);
    return records.withLock('notes', () => {
      if (requestId) { const prior = priorRequest('note', requestId, requestBinding); if (prior) return { note: prior, replayed: true }; }
      const note = { id: newId('nt'), target: pick(t, ['kind', 'id', 'item', 'part']), body: input.body.trim(), by: actor, at: now(), revision: 1, ...(requestId ? { requestId, requestBinding } : {}) };
      return { note: records.create('note', note) };
    });
  }
  async function noteChange(input, { actor, requestId, requestBinding }, change) {
    check(nonempty(input.id), 'invalid', 'note id is required');
    return records.withLock(`note:${input.id}`, () => {
      const n = getNote(input.id);
      if (priorRequest('note', requestId, requestBinding, 'lastRequestId')) return { note: n, replayed: true };
      const next = change({ ...n });
      return { note: records.update('note', n, { ...next, lastRequestId: requestId ?? undefined, lastRequestBinding: requestBinding }, input.expectedRevision) };
    });
  }

  // The record operation that sets one target's organization (not yet applied).
  function labelOp(target, change, expectedRevision) {
    check(isObject(target) && ['unit', 'asset', 'collection'].includes(target.kind) && nonempty(target.id), 'invalid', 'organization targets are units, assets or collections');
    check(targetExists(target), 'not_found', `organization target ${target.kind}:${target.id} not found`);
    if (target.kind === 'collection') {
      const c = derive().collectionsById.get(target.id);
      if (c.owner === 'catalog') {
        const rec = records.readOne('collection', c);
        const next = change({ category: rec.category ?? null, tags: rec.tags ?? [] });
        return { type: 'update', kind: 'collection', rec: { ...rec, ...next }, expectedRevision };
      }
    }
    const current = derive().labels.get(tkey(target));
    const base = current ?? { target: pick(target, ['kind', 'id']), category: null, tags: [] };
    const next = change({ category: base.category, tags: base.tags });
    if (!current) check(!expectedRevision, 'conflict', 'organization changed since it was read');
    return current ? { type: 'update', kind: 'label', rec: { ...base, ...next }, expectedRevision } : { type: 'create', kind: 'label', rec: { ...base, ...next, revision: 1 } };
  }
  // Rewrite catalog-owned organization records as one validated operation.
  function organizationOps(mapLabel) {
    const ops = [];
    for (const l of records.list('label').items) { const n = mapLabel({ category: l.category, tags: l.tags }); if (n.category !== l.category || n.tags.join('\n') !== l.tags.join('\n')) ops.push({ type: 'update', kind: 'label', rec: { ...l, ...n } }); }
    for (const c of records.list('collection').items) { const n = mapLabel({ category: c.category ?? null, tags: c.tags }); if (n.category !== (c.category ?? null) || n.tags.join('\n') !== c.tags.join('\n')) ops.push({ type: 'update', kind: 'collection', rec: { ...c, ...n } }); }
    return ops;
  }

  async function submit(input, { actor, requestId, requestBinding, ctx: c }) {
    check(Array.isArray(input.items) && input.items.length > 0 && input.items.length <= 200, 'invalid', 'a submission needs 1-200 items');
    check(input.title == null || (typeof input.title === 'string' && input.title.length <= 300), 'invalid', 'title must be text');
    check(input.note == null || (typeof input.note === 'string' && input.note.length <= 5000), 'invalid', 'note must be text');
    return records.withLock('reviews', async () => {
      if (requestId) { const prior = priorRequest('submission', requestId, requestBinding); if (prior) return { submission: submissionView(prior, false), replayed: true }; }
      if (input.supersedes) check(derive().lists.submission.items.some((s) => s.id === input.supersedes), 'not_found', `submission ${input.supersedes} not found`);
      const plans = input.items.map(planItem);
      const items = [];
      for (const plan of plans) items.push(await freezeItem(plan));
      const title = nonempty(input.title) ? input.title.trim() : items.length === 1 ? items[0].title : `${items[0].title} and ${items.length - 1} more`;
      const s = { id: newId('sub'), title, by: actor, at: now(), context: { branch: c.branch, head: c.head, dirty: c.dirty }, supersedes: input.supersedes ?? null, note: nonempty(input.note) ? input.note.trim() : null, items, ...(requestId ? { requestId, requestBinding } : {}) };
      records.create('submission', s);
      return { submission: submissionView(s, false) };
    });
  }
  // Validate a decision against an item's part ids and build its event (not yet recorded).
  function decisionEvent(partIds, input, base) {
    check(input.comment == null || typeof input.comment === 'string', 'invalid', 'comment must be text');
    if (input.whole != null) {
      check(input.verdicts == null, 'invalid', 'give either whole (+ exceptions) or verdicts, not both');
      check(verdictSet.includes(input.whole), 'invalid', `verdict must be one of ${verdictSet.join(', ')}`);
      const ex = input.exceptions ?? {};
      check(isObject(ex), 'invalid', 'exceptions must map part ids to verdicts');
      for (const [p, v] of Object.entries(ex)) { check(partIds.includes(p), 'invalid', `part ${p} is not in this item`); check(verdictSet.includes(v), 'invalid', `invalid verdict for ${p}`); }
      return { ...base, scope: { kind: 'whole', parts: partIds }, verdict: input.whole, exceptions: Object.fromEntries(Object.entries(ex).filter(([, v]) => v !== input.whole)) };
    }
    check(input.exceptions == null, 'invalid', 'exceptions need a whole verdict');
    check(isObject(input.verdicts) && Object.keys(input.verdicts).length > 0, 'invalid', 'give whole (+ exceptions) or verdicts for specific parts');
    for (const [p, v] of Object.entries(input.verdicts)) { check(partIds.includes(p), 'invalid', `part ${p} is not in this item`); check(verdictSet.includes(v), 'invalid', `invalid verdict for ${p}`); }
    return { ...base, scope: { kind: 'parts', parts: Object.keys(input.verdicts) }, verdicts: { ...input.verdicts } };
  }
  // Optional per-part notes: each addresses one part this event gives a verdict. Blank notes are dropped.
  function withPartNotes(ev, partIds, notes) {
    if (notes == null) return ev;
    check(isObject(notes), 'invalid', 'partNotes must map part ids to text');
    const decided = eventVerdicts(ev);
    const kept = {};
    for (const [p, t] of Object.entries(notes)) {
      check(partIds.includes(p), 'invalid', `part ${p} is not in this item`);
      check(typeof t === 'string' && t.length <= PART_NOTE_MAX, 'invalid', `note for ${p} must be text of at most ${PART_NOTE_MAX} characters`);
      if (!nonempty(t)) continue;
      check(decided[p], 'invalid', `note for ${p} needs a verdict for that part`);
      kept[p] = t.trim();
    }
    return Object.keys(kept).length ? { ...ev, partNotes: kept } : ev;
  }
  function decideOn(sub, item, input, actor, requestId, requestBinding) {
    const partIds = item.parts.map((p) => p.id);
    const ev = withPartNotes(decisionEvent(partIds, input, { id: newId('vd'), submission: sub.id, item: item.id, by: actor, at: now(), comment: nonempty(input.comment) ? input.comment.trim() : undefined, ...(requestId ? { requestId, requestBinding } : {}) }), partIds, input.partNotes);
    records.create('verdict', ev);
    return ev;
  }
  async function decide(input, { actor, requestId, requestBinding }) {
    check(nonempty(input.submission) && nonempty(input.item), 'invalid', 'submission and item are required');
    return records.withLock('reviews', () => {
      if (requestId) { const prior = priorRequest('verdict', requestId, requestBinding); if (prior) return { event: eventSummary(prior), replayed: true }; }
      const { submission, item } = findItem(input.submission, input.item);
      const ev = decideOn(submission, item, input, actor, requestId, requestBinding);
      derivedCache = null;
      return { event: eventSummary(ev), item: itemState(item, [...(derive().eventsByItem.get(item.id) ?? [])]).summary };
    });
  }
  // Catalog "Review": record on a still-waiting item whose frozen evidence equals current content;
  // otherwise submit the current content as a new one-item submission and record on it.
  // Revising an earlier decision on a decided item goes through review.decide on that item.
  async function decideCurrent(input, meta) {
    const target = input.target;
    check(isObject(target) && ['unit', 'collection'].includes(target.kind) && targetExists(target), 'not_found', 'review target not found');
    const partIds = partsOf(target).map((p) => p.id);
    withPartNotes(decisionEvent(partIds, input, {}), partIds, input.partNotes); // validate fully before any effect
    if (meta.requestId) {
      const prior = priorRequest('verdict', meta.requestId, meta.requestBinding);
      if (prior) return { event: eventSummary(prior), replayed: true, submission: { id: prior.submission, ref: shortRef(prior.submission) }, createdSubmission: false };
    }
    const d = derive();
    const cur = [...partIds].sort().join('\n');
    const existing = (d.itemsByTarget.get(tkey(target)) ?? []).slice().sort((a, b) => b.submission.at.localeCompare(a.submission.at)).find(({ item }) =>
      itemState(item, d.eventsByItem.get(item.id) ?? []).summary.undecided > 0
      && item.parts.map((p) => p.id).sort().join('\n') === cur && item.parts.every((p) => p.evidence.digest === currentDigest(target, p.id)));
    let sub, item, created = false;
    if (existing) ({ submission: sub, item } = existing);
    else {
      if (meta.requestId) { const prior = priorRequest('submission', `${meta.requestId}:submission`, meta.requestBinding); if (prior) { sub = prior; item = prior.items[0]; } }
      if (!sub) {
        const r = await submit({ items: [{ target }] }, { ...meta, requestId: meta.requestId ? `${meta.requestId}:submission` : null });
        sub = derive().lists.submission.items.find((s) => s.id === r.submission.id); item = sub.items[0]; created = true;
      }
    }
    const r = await decide({ ...input, target: undefined, submission: sub.id, item: item.id }, meta);
    return { ...r, submission: { id: sub.id, ref: shortRef(sub.id) }, createdSubmission: created };
  }

  // ---------- Action registry (shared by browser, HTTP and CLI) ----------
  const R = (description, input, run) => ({ kind: 'read', description, input, run });
  const W = (description, input, run) => ({ kind: 'write', description, input, run });
  const actions = {
    context: R('Project, worktree, branch, uncommitted change count and problems', {}, async () => {
      const c = freshContext(root);
      const d = derive();
      return { project: snap.project ?? c.name, adapter: config.adapter, actor: (await defaultActor()).name, context: c, version: snap.version, records: d.sig.slice(-12), counts: { units: snap.units.length, collections: d.collections.length, assets: snap.assets.length, openNotes: d.lists.note.items.filter((n) => !n.resolved).length, submissions: d.lists.submission.items.length, waiting: d.lists.submission.items.filter((s) => submissionView(s, false).counts.waiting).length }, problems: problems().length, resolver: config.review.resolver, verdicts: verdictSet, schema: snap.schema, assetKinds: ASSET_KINDS };
    }),
    problems: R('Unreadable adapter sources and malformed or conflicted records', {}, async () => ({ problems: problems() })),
    'catalog.search': R('Search and filter units, collections or assets with facet counts and bounded pages', { section: 'string?', q: 'string?', filters: 'object?', page: 'number?', pageSize: 'number?' }, async (i) => search(i)),
    'unit.get': R('Inspect one content unit: attributes, visuals, review projection, notes, memberships', { id: 'string' }, async (i) => unitGet(i)),
    'collection.get': R('Inspect one collection: members, preview, review projection, notes', { id: 'string' }, async (i) => collectionGet(i)),
    'asset.get': R('Inspect one visual asset: usage, versions, verdicts referencing it, notes', { id: 'string' }, async (i) => assetGet(i)),
    'organization.list': R('Categories and tags with usage counts', {}, async () => organizationList()),
    'notes.list': R('List notes; state open (default), resolved or all; optional target filter', { state: 'string?', targetKind: 'string?', target: 'object?', by: 'string?', q: 'string?', page: 'number?', pageSize: 'number?' }, async (i) => notesList(i)),
    'reviews.list': R('Review submissions with item counts (waiting, approved, changes, rejected); optional target filter', { state: 'string?', q: 'string?', page: 'number?', pageSize: 'number?', target: 'object?' }, async (i) => reviewsList(i)),
    'review.get': R('One submission: items, parts, views, verdict projection, events, observations', { submission: 'string' }, async (i) => reviewGet(i)),
    'evidence.compare': R('Compare frozen evidence of a part with current content or another frozen part; each side resolves independently', { a: 'object', b: 'any?' }, async (i) => compare(i)),
    'collections.membership': R('Catalog-owned collections with how many of the given units each contains', { units: 'array', q: 'string?' }, async (i) => {
      const d = derive(); const q = (i.q ?? '').toLowerCase();
      return { collections: d.collections.filter((c) => c.owner === 'catalog' && `${c.name} ${c.category ?? ''} ${(c.tags ?? []).join(' ')}`.toLowerCase().includes(q)).sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name)).map((c) => ({ id: c.id, name: c.name, category: c.category ?? null, contains: i.units.filter((u) => c.members.some((m) => m.unit === u)).length, revision: c.revision })) };
    }),
    'locks.list': R('Record locks held on this machine', {}, async () => ({ locks: records.locks() })),

    'note.create': W('Create a standalone note on a unit, collection, asset or submission (optionally an item/part)', { target: 'object', body: 'string' }, noteCreate),
    'note.edit': W('Edit note text (expectedRevision guards concurrent edits)', { id: 'string', body: 'string', expectedRevision: 'number?' }, (i, m) => { check(nonempty(i.body), 'invalid', 'note text is required'); return noteChange(i, m, (n) => ({ ...n, body: i.body.trim(), editedAt: now() })); }),
    'note.resolve': W('Mark a note dealt with, with an optional explanation', { id: 'string', explanation: 'string?', expectedRevision: 'number?' }, (i, m) => noteChange(i, m, (n) => ({ ...n, resolved: { by: m.actor, at: now(), ...(nonempty(i.explanation) ? { explanation: i.explanation.trim() } : {}) } }))),
    'note.reopen': W('Return a dealt-with note to the open list', { id: 'string', expectedRevision: 'number?' }, (i, m) => noteChange(i, m, (n) => { const { resolved, ...rest } = n; return rest; })),
    'note.delete': W('Clear (delete) a note', { id: 'string', expectedRevision: 'number?' }, async (i) => records.withLock(`note:${i.id}`, () => { const n = getNote(i.id); records.remove('note', n, i.expectedRevision); return { deleted: i.id }; })),

    'organize.set': W('Set category and/or tags of a unit, asset or collection', { target: 'object', category: 'any?', tags: 'array?', expectedRevision: 'number?' }, async (i) => records.withLock('organization', async () => {
      const category = i.category !== undefined ? cleanCategory(i.category) : undefined; const tags = i.tags ? cleanTags(i.tags) : undefined;
      const [rec] = records.apply([labelOp(i.target, (o) => ({ category: category !== undefined ? category : o.category, tags: tags ?? o.tags }), i.expectedRevision)]);
      derivedCache = null;
      return { organization: org(i.target.kind, i.target.id), revision: rec.revision };
    })),
    'organize.bulk': W('Add/remove tags or set the category of many targets at once', { targets: 'array', addTags: 'array?', removeTags: 'array?', category: 'any?' }, async (i) => records.withLock('organization', async () => {
      check(i.targets.length && i.targets.length <= 1000, 'invalid', 'give 1-1000 targets');
      const add = i.addTags ? cleanTags(i.addTags) : []; const rm = i.removeTags ? cleanTags(i.removeTags) : [];
      const cat = i.category !== undefined ? cleanCategory(i.category) : undefined;
      check(new Set(i.targets.map((t) => `${t?.kind}:${t?.id}`)).size === i.targets.length, 'invalid', 'a target appears twice');
      const ops = i.targets.map((t) => labelOp(t, (o) => ({ category: cat !== undefined ? cat : o.category, tags: [...new Set([...o.tags.filter((x) => !rm.includes(x)), ...add])] })));
      records.apply(ops);
      return { updated: ops.length };
    })),
    'category.create': W('Register a category path (Parent/Child)', { path: 'string' }, async (i) => records.withLock('organization', () => {
      const p = requiredCategory(i.path);
      const cur = records.list('categories').items[0];
      records.apply([records.upsertOp('categories', { categories: [...new Set([...(cur?.categories ?? []), p])].sort() }, cur?.revision)]);
      return { category: p };
    })),
    'category.rename': W('Rename a category path (applies to catalog-owned organization; descendants follow)', { from: 'string', to: 'string' }, async (i) => records.withLock('organization', () => {
      const from = requiredCategory(i.from), to = requiredCategory(i.to);
      const re = (c) => (c === from || c?.startsWith(`${from}/`) ? to + c.slice(from.length) : c);
      const ops = organizationOps((o) => ({ category: re(o.category), tags: o.tags }));
      const cur = records.list('categories').items[0];
      if (cur) ops.push({ type: 'update', kind: 'categories', rec: { categories: [...new Set(cur.categories.map(re))].sort() } });
      records.apply(ops);
      const projectOwned = snap.units.filter((u) => re(u.adapterCategory) !== u.adapterCategory).length + snap.assets.filter((a) => re(a.adapterCategory) !== a.adapterCategory).length;
      return { renamed: ops.filter((o) => o.kind !== 'categories').length, projectOwnedUnchanged: projectOwned };
    })),
    'category.delete': W('Remove a category path from catalog-owned organization', { path: 'string' }, async (i) => records.withLock('organization', () => {
      const p = requiredCategory(i.path); const hit = (c) => c === p || c?.startsWith(`${p}/`);
      const ops = organizationOps((o) => ({ category: hit(o.category) ? null : o.category, tags: o.tags }));
      const cur = records.list('categories').items[0];
      if (cur && cur.categories.some(hit)) ops.push({ type: 'update', kind: 'categories', rec: { categories: cur.categories.filter((c) => !hit(c)) } });
      records.apply(ops);
      return { cleared: ops.filter((o) => o.kind !== 'categories').length };
    })),
    'tag.rename': W('Rename a catalog-owned tag; renaming onto an existing tag merges them', { from: 'string', to: 'string' }, async (i) => records.withLock('organization', () => {
      const from = cleanTag(i.from), to = cleanTag(i.to);
      const ops = organizationOps((o) => ({ category: o.category, tags: [...new Set(o.tags.map((t) => (t === from ? to : t)))] }));
      records.apply(ops);
      return { renamed: ops.length };
    })),
    'tag.delete': W('Remove a catalog-owned tag everywhere', { tag: 'string' }, async (i) => records.withLock('organization', () => {
      const tag = cleanTag(i.tag);
      const ops = organizationOps((o) => ({ category: o.category, tags: o.tags.filter((t) => t !== tag) }));
      records.apply(ops);
      return { removed: ops.length };
    })),
    'collection.create': W('Create a collection; members are references to content units', { name: 'string', id: 'string?', kind: 'string?', category: 'any?', tags: 'array?', members: 'array?' }, async (i, m) => records.withLock('organization', () => {
      check(nonempty(i.name), 'invalid', 'collection name is required');
      if (m.requestId) { const prior = priorRequest('collection', m.requestId, m.requestBinding); if (prior) return { collection: prior, replayed: true }; }
      if (i.kind) check(snap.schema.collectionKinds[i.kind], 'invalid', `unknown collection kind ${i.kind}`);
      const slug = i.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'collection';
      let id = i.id ?? `col/${slug}`;
      for (let n = 2; derive().collectionsById.has(id); n++) { check(!i.id, 'conflict', `collection ${i.id} already exists`); id = `col/${slug}-${n}`; }
      const members = (i.members ?? []).map((u) => (typeof u === 'string' ? { unit: u } : u));
      for (const mm of members) check(snap.unitsById.has(mm.unit), 'not_found', `content ${mm.unit} not found`);
      const c = { id, name: i.name.trim(), kind: i.kind ?? null, category: cleanCategory(i.category), tags: i.tags ? cleanTags(i.tags) : [], members, revision: 1, createdBy: m.actor, createdAt: now(), ...(m.requestId ? { requestId: m.requestId, requestBinding: m.requestBinding } : {}) };
      return { collection: records.create('collection', c) };
    })),
    'collection.update': W('Rename, reorder, add or remove members of a catalog-owned collection', { id: 'string', name: 'string?', members: 'array?', add: 'array?', remove: 'array?', expectedRevision: 'number?' }, async (i) => records.withLock('organization', () => {
      const c = derive().collectionsById.get(i.id);
      check(c, 'not_found', `collection ${i.id} not found`);
      check(c.owner === 'catalog', 'forbidden', `${c.name} is defined by the project adapter; change it in the project's source`);
      const rec = records.readOne('collection', c);
      let members = i.members ? i.members.map((u) => (typeof u === 'string' ? { unit: u } : u)) : rec.members;
      if (i.add) for (const u of i.add) if (!members.some((x) => x.unit === u)) members = [...members, { unit: u }];
      if (i.remove) members = members.filter((x) => !i.remove.includes(x.unit));
      for (const mm of members) if (!rec.members.some((x) => x.unit === mm.unit)) check(snap.unitsById.has(mm.unit), 'not_found', `content ${mm.unit} not found`);
      return { collection: records.update('collection', rec, { ...rec, name: nonempty(i.name) ? i.name.trim() : rec.name, members }, i.expectedRevision) };
    })),
    'collection.delete': W('Delete a catalog-owned collection (members are untouched)', { id: 'string', expectedRevision: 'number?' }, async (i) => records.withLock('organization', () => {
      const c = derive().collectionsById.get(i.id);
      check(c, 'not_found', `collection ${i.id} not found`);
      check(c.owner === 'catalog', 'forbidden', `${c.name} is defined by the project adapter`);
      records.remove('collection', records.readOne('collection', c), i.expectedRevision);
      return { deleted: i.id };
    })),

    'review.submit': W('Explicitly submit units/collections for review; freezes definitions and asset bytes. note is Markdown shown to the reviewer beside the items. A view may add before ({path} of a project file under the asset roots, or {submission, item, part, leaf?} of earlier evidence; optional label) and afterLabel to show its evidence as a before/after comparison', { title: 'string?', note: 'string?', items: 'array', supersedes: 'string?' }, submit),
    'review.decide': W('Record a verdict event on a submission item: whole (+exceptions) or specific parts, with an optional comment and optional notes per decided part', { submission: 'string', item: 'string', whole: 'string?', exceptions: 'object?', verdicts: 'object?', comment: 'string?', partNotes: 'object?' }, decide),
    'review.decideCurrent': W('Review current content: decide on a matching waiting item or submit current content and decide (same comment and part notes as review.decide)', { target: 'object', whole: 'string?', exceptions: 'object?', verdicts: 'object?', comment: 'string?', partNotes: 'object?' }, decideCurrent),
    unlock: W('Remove a lock whose owning process has exited on this machine', { lock: 'string' }, async (i) => records.unlock(i.lock)),
  };

  function organizationList() {
    const d = derive();
    const counts = (pred) => ({ units: snap.units.filter((u) => pred('unit', u.id)).length, collections: d.collections.filter((c) => pred('collection', c.id)).length, assets: snap.assets.filter((a) => pred('asset', a.id)).length });
    const cats = [...d.categories].sort().map((c) => ({ path: c, ...counts((k, id) => { const x = org(k, id).category; return x === c || x?.startsWith(`${c}/`); }) }));
    const tagSet = new Set();
    for (const u of snap.units) allTags('unit', u.id).forEach((t) => tagSet.add(t));
    for (const c of d.collections) allTags('collection', c.id).forEach((t) => tagSet.add(t));
    for (const a of snap.assets) allTags('asset', a.id).forEach((t) => tagSet.add(t));
    const projectTags = new Set([...snap.units.flatMap((u) => u.adapterTags), ...snap.assets.flatMap((a) => a.adapterTags), ...d.collections.flatMap((c) => c.adapterTags ?? [])]);
    const tags = [...tagSet].sort().map((t) => ({ tag: t, projectOwned: projectTags.has(t), ...counts((k, id) => allTags(k, id).includes(t)) }));
    return { categories: cats, tags };
  }
  function notesList({ state = 'open', targetKind, target, by, q, page = 1, pageSize = 100 }) {
    let list = derive().lists.note.items.slice().sort((a, b) => b.at.localeCompare(a.at));
    if (targetKind) list = list.filter((n) => n.target.kind === targetKind);
    if (target) list = list.filter((n) => n.target.kind === target.kind && n.target.id === target.id);
    if (by) list = list.filter((n) => n.by.name === by);
    let views = list.map(noteView);
    if (q) views = views.filter((n) => `${n.body} ${n.targetName}`.toLowerCase().includes(q.toLowerCase()));
    const counts = { open: views.filter((n) => !n.resolved).length, resolved: views.filter((n) => n.resolved).length, all: views.length };
    views = views.filter((n) => (state === 'open' ? !n.resolved : state === 'resolved' ? !!n.resolved : true));
    const size = Math.min(500, Math.max(1, pageSize | 0)); const pages = Math.max(1, Math.ceil(views.length / size)); const p = Math.min(pages, Math.max(1, page | 0));
    return { total: views.length, counts, page: p, pages, authors: [...new Set(derive().lists.note.items.map((n) => n.by.name))], notes: views.slice((p - 1) * size, p * size) };
  }
  function problems() {
    return [...(projectProblem ? [{ scope: 'project', ...projectProblem }] : []), ...snap.problems.map((p) => ({ scope: 'content', ...p })), ...records.problems().map((p) => ({ scope: 'records', source: p.file, error: p.error, recovery: p.recovery }))];
  }

  function validateInput(spec, input) {
    check(isObject(input), 'invalid', 'input must be a JSON object');
    for (const [k, t] of Object.entries(spec)) {
      const opt = t.endsWith('?'); const type = t.replace('?', ''); const v = input[k];
      if (v === undefined || v === null) { check(opt, 'invalid', `${k} is required`); continue; }
      const ok = type === 'any' || (type === 'array' ? Array.isArray(v) : type === 'object' ? isObject(v) : typeof v === type);
      check(ok, 'invalid', `${k} must be ${type}`);
    }
    for (const k of Object.keys(input)) check(k in spec, 'invalid', `unexpected field ${k}`);
  }

  // meta: { actor:{name,kind}, requestId, context (expected context key) }
  async function run(name, input = {}, meta = {}) {
    const a = actions[name];
    check(a, 'not_found', `unknown action ${name}`);
    validateInput(a.input, input);
    await load();
    if (a.kind === 'read') {
      // A synchronous projection uses one repository-record snapshot. Refresh
      // between actions, while avoiding a filesystem scan for every row/facet.
      // Restore before any await so concurrent requests cannot share this scope.
      const previous = readProjection;
      readProjection = derive();
      try { return a.run(input, { ctx: readCtx(root) }); }
      finally { readProjection = previous; }
    }
    const c = freshContext(root);
    if (meta.context) check(meta.context === c.key, 'context_changed', `this checkout changed to ${c.branch ?? `detached ${c.head?.slice(0, 8)}`}; reload before saving`, { context: c });
    check(meta.requestId == null || (typeof meta.requestId === 'string' && meta.requestId.length > 0 && meta.requestId.length <= 200), 'invalid', 'requestId must be a non-empty string');
    const actor = actorOf(meta);
    const boundInput = { input, actor };
    const requestBinding = meta.requestId ? { action: name, digest: digest(boundInput), context: c.key } : undefined;
    const exec = async () => {
      const result = await a.run(input, { actor, requestId: meta.requestId ?? null, requestBinding, ctx: c });
      derivedCache = null;
      return result;
    };
    if (!meta.requestId) return exec();
    // One request id, one effect: replay and the mutation run under the same lock, and the id is
    // bound to the checkout context in which it was first used.
    return records.withLock(`request:${meta.requestId}`, async () => {
      const prior = records.replay(meta.requestId, name, boundInput, c.key);
      if (prior) return { ...prior, replayed: true };
      for (const kind of ['note', 'submission', 'verdict', 'collection']) priorRequest(kind, meta.requestId, requestBinding);
      priorRequest('note', meta.requestId, requestBinding, 'lastRequestId');
      const result = await exec();
      records.remember(meta.requestId, name, boundInput, c.key, result);
      return result;
    });
  }

  function discover() {
    return Object.entries(actions).map(([name, a]) => ({ name, kind: a.kind, description: a.description, input: a.input }));
  }

  // Media access for the server: current assets (confined) and frozen evidence (verified).
  async function assetFile(id) {
    await load();
    const a = snap.assetsById.get(id);
    check(a, 'not_found', 'asset not found');
    const f = facts(a);
    check(f.state === 'ok', f.state === 'forbidden' ? 'forbidden' : 'unavailable', f.error ?? f.state);
    return { file: confinedPath(root, a.path, snap.assetRoots), mime: f.mime, sha256: f.sha256, size: f.size };
  }
  async function evidenceMedia(sub, item, part, leaf) { await load(); return evidenceBytes(sub, item, part, leaf); }
  async function beforeMedia(sub, item, view) { await load(); return befores.bytes(findItem(sub, item).item.views.find((v) => v.id === view)); }
  async function defaultActor() { return { name: actorFromGit(root) ?? 'Local user', kind: 'human' }; }

  await load();
  return { root, get config() { return config; }, previewModule, run, discover, assetFile, evidenceMedia, beforeMedia, defaultActor, records, context: () => readCtx(root) };
}

export { CatalogError };
