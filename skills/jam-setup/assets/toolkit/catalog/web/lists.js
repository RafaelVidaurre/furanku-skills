import { SubmitDialog } from './review.js';
import { html, useState, useEffect, useRef, useQuery, write, href, withQuery, replace, entityHref, Icon, Popover, Thumb, VerdictBar, NoteCount, TagPicker, kindIcon, toast, enc, ErrorLine, newRequestId, fmtSize } from './core.js';

export const SECTION_OF = { content: 'units', collections: 'collections', assets: 'assets' };
const KIND_OF = { content: 'unit', collections: 'collection', assets: 'asset' };
export function selectedFacets(route) {
  const out = {};
  for (const [k, v] of route.query) if (k.startsWith('f.') && v) out[k.slice(2)] = v.split(',').map(decodeURIComponent);
  return out;
}
export let currentList = { hrefs: [], ids: [] };
const scrollMemory = new Map();

export function ListPane({ route, compact }) {
  const section = SECTION_OF[route.section];
  const sel = selectedFacets(route);
  const q = route.query.get('q') ?? '';
  const page = +(route.query.get('page') ?? 1);
  const [mode, setMode] = useState(() => localStorage.getItem(`listMode:${route.section}`) ?? 'grid');
  const [picked, setPicked] = useState(new Set());
  const scroller = useRef();
  const query = useQuery('catalog.search', { section, q, filters: sel, page, pageSize: compact ? 100 : 60 });
  const { error, loading, reload } = query;
  // Keep showing the previous page while refining, but never another section's items.
  const data = query.data?.section === section ? query.data : null;
  useEffect(() => setPicked(new Set()), [route.section]);
  // Filter and search changes reset pagination; typing replaces history instead of adding entries.
  const setQ = (changes) => replace(withQuery(route, { ...changes, page: null }));
  const toggle = (k, v) => { const cur = sel[k] ?? []; const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]; setQ({ [`f.${k}`]: next.map(enc).join(',') }); };
  const listKey = `${route.section}?${[...route.query].filter(([k]) => k === 'q' || k === 'page' || k.startsWith('f.')).join('&')}`;
  useEffect(() => { const el = scroller.current; const y = scrollMemory.get(listKey); if (el && y != null && data) requestAnimationFrame(() => { el.scrollTop = y; }); }, [listKey, !!data, route.id]);
  const onScroll = (e) => scrollMemory.set(listKey, e.target.scrollTop);
  const kind = KIND_OF[route.section];
  const linkOf = (id) => entityHref(kind, id);
  if (data) currentList = { hrefs: data.ids.map(linkOf), ids: data.ids };
  const rows = compact || mode === 'rows';
  const pick = (id, e) => { e.preventDefault(); e.stopPropagation(); const n = new Set(picked); n.has(id) ? n.delete(id) : n.add(id); setPicked(n); };
  const go = (p) => location.hash = href(withQuery(route, { page: p > 1 ? p : null })).slice(1);
  return html`<div class=${`list-pane${compact ? ' compact' : ''}`} ref=${scroller} onScroll=${onScroll}>
    <div class="list-bar">
      <input class="search" type="search" placeholder="Filter" aria-label="Filter list" value=${q} onInput=${(e) => setQ({ q: e.target.value })} data-list-search
        onKeyDown=${(e) => { if (e.key === 'Escape' && e.target.value) { e.stopPropagation(); e.preventDefault(); setQ({ q: null }); } }} />
      ${data && Object.entries(data.facets).map(([k, f]) => html`<${FacetMenu} key=${k} name=${k} f=${f} onToggle=${(v) => toggle(k, v)} onClear=${() => setQ({ [`f.${k}`]: null })} />`)}
      <span class="push"></span>
      ${route.section === 'collections' && html`<${NewCollection} />`}
      ${!compact && html`<span class="seg" aria-label="Layout">
        ${[['grid', 'Grid'], ['rows', 'Rows']].map(([m, l]) => html`<button class=${`seg-b${mode === m ? ' on' : ''}`} aria-pressed=${mode === m} title=${l} aria-label=${l} onClick=${() => { setMode(m); localStorage.setItem(`listMode:${route.section}`, m); }}><${Icon} name=${m} /></button>`)}
      </span>`}
    </div>
    ${data && html`<div class="chips">
      <span class="muted small" aria-live="polite">${data.total === data.all ? `${data.total}` : `${data.total} of ${data.all}`}${data.pages > 1 ? ` · ${(data.page - 1) * data.pageSize + 1}–${Math.min(data.total, data.page * data.pageSize)}` : ''}</span>
      ${Object.entries(sel).flatMap(([k, vals]) => vals.map((v) => html`<button class="fchip" onClick=${() => toggle(k, v)} title="Remove filter">${data.facets[k]?.label}: ${data.facets[k]?.values.find((x) => x.value === v)?.label ?? v}<${Icon} name="x" size=${10} /></button>`))}
      ${(Object.keys(sel).length > 0 || q) && html`<button class="link small" onClick=${() => setQ(Object.fromEntries([...route.query.keys()].filter((k) => k === 'q' || k.startsWith('f.')).map((k) => [k, null])))}>Clear</button>`}
    </div>`}
    <${ErrorLine} error=${error} onRetry=${reload} />
    ${picked.size > 0 && html`<${BulkBar} ids=${[...picked]} kind=${kind} onClear=${() => setPicked(new Set())} />`}
    <div class=${rows ? 'rows' : `grid ${route.section}`} role="list" aria-busy=${loading}>
      ${data?.items.map((e) => {
        const props = { e, h: linkOf(e.id), selected: e.id === route.id, picked: picked.has(e.id), onPick: route.section !== 'assets' ? (ev) => pick(e.id, ev) : null, rows };
        return route.section === 'content' ? html`<${UnitItem} key=${e.id} ...${props} />` : route.section === 'collections' ? html`<${CollectionItem} key=${e.id} ...${props} />` : html`<${AssetItem} key=${e.id} ...${props} />`;
      })}
    </div>
    ${data?.pages > 1 && html`<nav class="pager" aria-label="Pages">
      <button class="btn sm" disabled=${data.page <= 1} onClick=${() => go(data.page - 1)}>Previous</button>
      <span class="muted small">Page ${data.page} of ${data.pages}</span>
      <button class="btn sm" disabled=${data.page >= data.pages} onClick=${() => go(data.page + 1)}>Next</button>
    </nav>`}
  </div>`;
}

function FacetMenu({ f, onToggle, onClear }) {
  const sel = f.values.filter((v) => v.selected);
  return html`<${Popover} label=${f.label} trigger=${(open) => html`<button class=${`facet${sel.length ? ' active' : ''}${open ? ' open' : ''}`}>${f.label}${sel.length > 0 && html`<span class="facet-n">${sel.length}</span>`}</button>`}>
    <div class="picker facet-menu">
      ${f.values.length > 8 && html`<input placeholder="Find" aria-label=${`Find ${f.label}`} onInput=${(e) => { const q = e.target.value.toLowerCase(); e.target.parentElement.querySelectorAll('[data-name]').forEach((el) => { el.style.display = el.dataset.name.includes(q) ? '' : 'none'; }); }} />`}
      <div class="picker-list" role="group" aria-label=${f.label}>
        ${f.values.map((v) => html`<label class=${`picker-item check${!v.count && !v.selected ? ' zero' : ''}`} data-name=${v.label.toLowerCase()} style=${f.tree ? `padding-left:${8 + (v.value.split('/').length - 1) * 12}px` : ''}>
          <input type="checkbox" checked=${v.selected} disabled=${!v.count && !v.selected} onChange=${() => onToggle(v.value)} />${f.tree ? v.value.split('/').at(-1) : v.label}<span class="count">${v.count}</span></label>`)}
      </div>
      ${sel.length > 0 && html`<button class="link small" onClick=${onClear}>Clear</button>`}
    </div>
  <//>`;
}

function Pick({ picked, onPick }) {
  if (!onPick) return null;
  return html`<button class=${`pick${picked ? ' on' : ''}`} role="checkbox" aria-checked=${picked} aria-label="Select" onClick=${onPick}>${picked && html`<${Icon} name="check" size=${11} />`}</button>`;
}
export function RoleGlyphs({ e }) {
  return html`<span class="glyphs">
    ${e.roles.map((r) => html`<span class=${`glyph${r.shared ? ' shared' : ''}`} title=${r.label + (r.shared ? ' (shared)' : '')}><${Icon} name=${kindIcon(r.kind)} size=${12} /></span>`)}
    ${e.missing.map((r) => html`<span class="glyph missing" title=${`Missing ${r.label.toLowerCase()}`}><${Icon} name=${kindIcon(r.kind)} size=${12} /></span>`)}
  </span>`;
}
const Match = ({ m }) => (m?.member ? html`<span class="match" title="Matching member">Includes ${m.member.name}</span>` : null);

function UnitItem({ e, h, selected, rows, picked, onPick }) {
  if (rows) return html`<a class=${`row${selected ? ' sel' : ''}`} href=${h} role="listitem" aria-current=${selected ? 'true' : undefined}>
    <${Pick} picked=${picked} onPick=${onPick} /><${Thumb} asset=${e.thumb} size=${34} label=${e.typeLabel[0]} />
    <span class="row-main"><span class="row-name">${e.name}</span><span class="row-sub">${e.typeLabel}<${RoleGlyphs} e=${e} /></span></span>
    <${NoteCount} n=${e.notes} /><${VerdictBar} parts=${e.status.parts} />
  </a>`;
  return html`<a class=${`card${selected ? ' sel' : ''}${picked ? ' picked' : ''}`} href=${h} role="listitem">
    <${Pick} picked=${picked} onPick=${onPick} />
    <span class="card-media">${e.thumb ? html`<${Thumb} asset=${e.thumb} fill />` : html`<span class="card-attrs">${(e.attrsPreview ?? []).map((a) => html`<span><b>${a.label}</b> ${String(a.value)}</span>`)}</span>`}</span>
    <span class="card-name">${e.name}</span>
    <span class="card-sub"><span>${e.typeLabel}</span><${RoleGlyphs} e=${e} /><span class="push"></span><${NoteCount} n=${e.notes} /><${VerdictBar} parts=${e.status.parts} /></span>
  </a>`;
}
function Mosaic({ c }) {
  return html`<span class=${`mosaic n${Math.min(4, c.thumbs.length)}`}>${c.thumbs.map((t) => html`<${Thumb} asset=${t.thumb} fill label=${t.typeLabel[0]} />`)}</span>`;
}
function CollectionItem({ e: c, h, selected, rows, picked, onPick }) {
  const sub = [c.kindLabel, c.category?.split('/').at(-1), `${c.memberCount}`].filter(Boolean).join(' · ');
  if (rows) return html`<a class=${`row${selected ? ' sel' : ''}`} href=${h} role="listitem" aria-current=${selected ? 'true' : undefined}>
    <${Pick} picked=${picked} onPick=${onPick} /><span class="thumb" style="width:34px;height:34px"><${Mosaic} c=${c} /></span>
    <span class="row-main"><span class="row-name">${c.name}</span><span class="row-sub">${sub}<${Match} m=${c.match} /></span></span>
    <${NoteCount} n=${c.notes} /><${VerdictBar} parts=${c.status.parts} />
  </a>`;
  return html`<a class=${`card${selected ? ' sel' : ''}${picked ? ' picked' : ''}`} href=${h} role="listitem">
    <${Pick} picked=${picked} onPick=${onPick} />
    <span class="card-media"><${Mosaic} c=${c} /><span class="card-count">${c.memberCount}</span></span>
    <span class="card-name">${c.name}</span>
    <span class="card-sub"><span>${[c.kindLabel, c.category?.split('/').join(' / ')].filter(Boolean).join(' · ')}</span><span class="push"></span><${NoteCount} n=${c.notes} /><${VerdictBar} parts=${c.status.parts} /></span>
    ${c.match && html`<span class="card-match"><${Match} m=${c.match} /></span>`}
  </a>`;
}
function AssetItem({ e: a, h, selected, rows }) {
  const use = html`<span class=${`uses${a.usedBy > 1 ? ' shared' : a.usedBy === 0 ? ' unused' : ''}`} title=${`Used by ${a.usedBy} content unit${a.usedBy === 1 ? '' : 's'}`}><${Icon} name="link" size=${11} />${a.usedBy}</span>`;
  const name = a.path.split('/').pop();
  if (rows) return html`<a class=${`row${selected ? ' sel' : ''}`} href=${h} role="listitem" aria-current=${selected ? 'true' : undefined}>
    <${Thumb} asset=${a} size=${34} />
    <span class="row-main"><span class="row-name mono">${name}</span><span class="row-sub"><${Icon} name=${kindIcon(a.kind)} size=${11} />${a.state === 'ok' ? fmtSize(a.size) : a.error}</span></span>
    <${NoteCount} n=${a.notes} />${use}
  </a>`;
  return html`<a class=${`card${selected ? ' sel' : ''}`} href=${h} role="listitem">
    <span class="card-media"><${Thumb} asset=${a} fill /><span class="card-kind"><${Icon} name=${kindIcon(a.kind)} size=${12} /></span></span>
    <span class="card-name mono">${name}</span>
    <span class="card-sub"><span class="mono">${a.path.split('/').slice(0, -1).join('/')}</span><span class="push"></span><${NoteCount} n=${a.notes} />${use}</span>
  </a>`;
}

function BulkBar({ ids, kind, onClear }) {
  const targets = ids.map((id) => ({ kind, id }));
  const [submitting, setSubmitting] = useState(false);
  return html`<div class="bulk" role="toolbar" aria-label="Selection">
    <b>${ids.length} selected</b>
    ${kind === 'unit' && html`<${Popover} label="Add to collection" trigger=${() => html`<button class="btn sm">Collections</button>`}><${CollectionToggle} unitIds=${ids} /><//>`}
    <${Popover} label="Add tag" trigger=${() => html`<button class="btn sm">Add tag</button>`}>
      ${(close) => html`<${TagPicker} onPick=${async (t) => { try { await write('organize.bulk', { targets, addTags: [t] }); toast(`Tagged ${ids.length} with ${t}`); close(); } catch (e) { toast(e.message, 'err'); } }} />`}
    <//>
    <button class="btn sm" onClick=${() => setSubmitting(true)}><${Icon} name="send" size=${12} />Submit for review</button>
    ${submitting && html`<${SubmitDialog} targets=${targets} onClose=${() => setSubmitting(false)} />`}
    <button class="btn sm ghost push" onClick=${onClear}>Clear</button>
  </div>`;
}

// Membership toggles for one or many units. Membership is by reference: nothing is copied.
export function CollectionToggle({ unitIds }) {
  const [q, setQ] = useState('');
  const { data, reload } = useQuery('collections.membership', { units: unitIds, q });
  const cols = data?.collections ?? [];
  const state = (c) => (c.contains === 0 ? 'none' : c.contains === unitIds.length ? 'all' : 'some');
  const toggle = async (c) => { try { await write('collection.update', state(c) === 'all' ? { id: c.id, remove: unitIds } : { id: c.id, add: unitIds }); reload(); } catch (e) { toast(e.message, 'err'); } };
  const create = async () => { try { const r = await write('collection.create', { name: q.trim(), members: unitIds }); toast(`Created ${r.collection.name}`); setQ(''); } catch (e) { toast(e.message, 'err'); } };
  return html`<div class="picker wide">
    <input value=${q} placeholder="Collection" aria-label="Find or create collection" onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && q.trim() && !cols.length) create(); }} />
    <div class="picker-list tall">
      ${cols.map((c) => { const st = state(c); return html`<label class="picker-item check"><input type="checkbox" checked=${st === 'all'} indeterminate=${st === 'some'} onChange=${() => toggle(c)} />${c.name}<span class="count">${c.category ?? ''}</span></label>`; })}
      ${q.trim() && !cols.some((c) => c.name.toLowerCase() === q.trim().toLowerCase()) && html`<button class="picker-item" onClick=${create}><span class="muted">New</span> ${q.trim()}</button>`}
    </div>
  </div>`;
}

function NewCollection() {
  return html`<${Popover} align="right" label="New collection" trigger=${() => html`<button class="btn sm"><${Icon} name="plus" size=${12} />Collection</button>`}>
    ${(close) => html`<${NewCollectionForm} close=${close} />`}
  <//>`;
}
function NewCollectionForm({ close }) {
  const [name, setName] = useState('');
  const [cat, setCat] = useState('');
  const [err, setErr] = useState(null);
  const rid = useRef(newRequestId());
  const create = async () => {
    if (!name.trim()) return;
    try { const r = await write('collection.create', { name, category: cat || null }, rid.current); close(); location.hash = entityHref('collection', r.collection.id).slice(1); }
    catch (e) { setErr(e); }
  };
  const { data } = useQuery('organization.list', {});
  return html`<div class="picker form">
    <input value=${name} placeholder="Name" aria-label="Name" onInput=${(e) => setName(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && create()} />
    <input value=${cat} placeholder="Category" aria-label="Category" list="cat-list" onInput=${(e) => setCat(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && create()} />
    <datalist id="cat-list">${(data?.categories ?? []).map((c) => html`<option value=${c.path} />`)}</datalist>
    <${ErrorLine} error=${err} />
    <button class="btn primary sm" onClick=${create} disabled=${!name.trim()}>Create</button>
  </div>`;
}
