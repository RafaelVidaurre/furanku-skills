import { html, useState, useEffect, useRef, useQuery, write, href, withQuery, replace, entityHref, listParams, Icon, Popover, Thumb, NoteCount, Tags, CategoryPicker, CopyId, KindIcon, kindLabel, scopeOf, fmtSize, ago, toast, ErrorLine, shortHash, baseName, isTyping } from './core.js';
import { MediaViewer, UnavailableViewer } from './viewers.js';
import { PreviewHost } from './previews.js';
import { refusal, useActiveViewer, setSelectionProvider, setSelectHandler } from './controller.js';
import { NotesBlock } from './notes.js';
import { CollectionToggle } from './lists.js';
import { InspectorHost, PanelHost } from './views.js';

const organize = (target, body) => write('organization.set', { target, ...body }).catch((e) => toast(e.message, 'err'));

function Loading({ q }) {
  if (q.error && !q.data) return html`<div class="detail"><${ErrorLine} error=${q.error} onRetry=${q.reload} /></div>`;
  return html`<div class="detail"><div class="viewer-msg"><span class="spin" aria-label="Loading"></span></div></div>`;
}
function OrgLine({ target, o, tags }) {
  return html`<${CategoryPicker} value=${o.category} projectValue=${o.projectCategory} onChange=${(c) => organize(target, { category: c, expectedRevision: o.revision ?? undefined })} />
    <${Tags} tags=${tags} projectTags=${o.projectTags} onChange=${(t) => organize(target, { tags: t, expectedRevision: o.revision ?? undefined })} />`;
}

// ---------- Unit ----------
export function UnitDetail({ route, ctx }) {
  const id = ctx ? route.member : route.id;
  const q = useQuery('unit.get', { id });
  const d = q.data;
  useEffect(() => {
    // A unit is shown under its own scope, whichever section the address named.
    if (!ctx && d?.unit.id === id && d.unit.scope && scopeOf(d.unit.scope) && route.section !== d.unit.scope) replace({ ...route, section: d.unit.scope });
  }, [d?.unit.id, d?.unit.scope, route.section, ctx]);
  const partId = route.query.get('part');
  const media = d ? d.review.parts.filter((p) => p.asset) : [];
  const inspectors = d?.inspectors ?? [];
  // No part named: the type's default inspector, else the first media part. Inspectors are parts
  // `inspector:<key>`. A named part or inspector that does not exist is an error, never a substitute.
  const selInspector = partId ? (partId.startsWith('inspector:') ? inspectors.find((v) => `inspector:${v.key}` === partId) ?? null : null) : inspectors.find((v) => v.default) ?? null;
  const sel = selInspector ? null : partId ? media.find((p) => p.id === partId) : media[0];
  const badPart = !!d && !!partId && !sel && !selInspector;
  const col = useQuery('collection.get', { id: ctx ?? '' }, !!ctx);
  const notMember = !!ctx && !!col.data && col.data.collection.id === ctx && !col.data.members.some((m) => m.id === id);
  const setPart = (pid) => replace(withQuery(route, { part: pid }));
  const link = sel && d.links.find((l) => l.asset.id === sel.asset && l.role === sel.role);
  const unavailable = notMember ? `${id} is not a member of ${ctx}` : badPart ? `${d.unit.name} has no media part or inspector "${partId}"` : (q.error && !d ? q.error.message : null);
  const inspectorIds = inspectors.map((v) => `inspector:${v.key}`);
  setSelectionProvider(() => ({ kind: 'unit', id, collection: ctx ?? null, part: selInspector ? `inspector:${selInspector.key}` : sel?.id ?? (badPart ? partId : null), loading: (!d && !q.error) || q.stale || (!!ctx && !col.data), unavailable: !!unavailable, error: unavailable, parts: [...inspectorIds, ...media.map((p) => p.id)], asset: link ? { id: link.asset.id, sha256: link.asset.sha256, kind: link.asset.kind } : null }));
  setSelectHandler((s) => { if (!s.part) return; if (!media.some((p) => p.id === s.part) && !inspectorIds.includes(s.part)) throw refusal('not_found', `no media part or inspector ${s.part}`); setPart(s.part); });
  useEffect(() => () => { setSelectionProvider(() => null); setSelectHandler(null); }, []);
  if (notMember) return html`<div class="detail"><${MemberNav} route=${route} col=${ctx} unitId=${id} /><div class="errline" role="alert"><${Icon} name="warn" size=${13} /><span>${unavailable}</span></div></div>`;
  if (!d || d.unit.id !== id) return html`<${Loading} q=${q} />`;
  const target = { kind: 'unit', id };
  const contentFields = Object.keys(d.unit.attrs).filter(k => !d.type.fields.find(f => f.key === k)?.derived);
  const technicalFields = d.type.fields.filter(f => f.derived && d.unit.attrs[f.key] != null);
  return html`<div class="detail">
    <header class="d-head">
      ${ctx && html`<${MemberNav} route=${route} col=${ctx} unitId=${id} />`}
      <div class="d-title"><h1>${d.unit.name}</h1></div>
      <div class="d-meta"><span class="type" title=${d.type.help ?? ''}>${d.type.label}</span><${OrgLine} target=${target} o=${d.organization} tags=${d.tags} /></div>
    </header>
    <div class=${`d-body${media.length || inspectors.length || d.missing.length || badPart ? '' : ' single'}`}>
      ${(media.length > 0 || inspectors.length > 0 || d.missing.length > 0 || badPart) && html`<div class="d-main"><${Stage} d=${d} media=${media} inspectors=${inspectors} selInspector=${selInspector} sel=${sel} link=${link} setPart=${setPart} badPart=${badPart ? partId : null} route=${route} /></div>`}
      ${!media.length && !inspectors.length && contentFields.length > 0 && html`<section class="block content-properties" aria-label="Unit details"><${Attributes} d=${d} technical=${false} /></section>`}
      <div class="d-side">
        ${(media.length > 0 || inspectors.length > 0) && contentFields.length > 0 && html`<section class="block content-properties" aria-label="Unit details"><${Attributes} d=${d} technical=${false} /></section>`}
        ${d.links.length > 0 && html`<section class="block" aria-label="Assets"><header class="block-h"><h3>Assets</h3><span class="badge">${d.links.length}</span></header><div class="usage">${d.links.map(l => html`<a class="mship" href=${entityHref('asset', l.asset.id)}><${KindIcon} kind=${l.asset.kind} size=${16} /><span><strong>${l.roleLabel}</strong><span class="asset-filename">${baseName(l.asset.path)}</span></span><${Icon} name="chev" size=${12} /></a>`)}</div></section>`}
        <${Relations} d=${d} />
        ${(technicalFields.length > 0 || d.unit.sources.length > 0) && html`<details class="disclosure"><summary>Technical details</summary><${Attributes} d=${d} technical /></details>`}
        <section class="block" aria-label="Collections">
          <header class="block-h"><h3>Collections</h3><span class="badge">${d.memberships.length}</span><span class="push"></span>
            <${Popover} align="right" label="Edit collections" trigger=${() => html`<button class="btn sm"><${Icon} name="plus" size=${12} />Add</button>`}><${CollectionToggle} unitIds=${[id]} /><//>
          </header>
          <div class="memberships">${d.memberships.map((c) => html`<a class="mship" href=${href({ section: 'collections', kind: 'c', id: c.id, member: id })}>
            <span>${c.name}</span><span class="muted small">${c.category ?? ''}</span><span class="push"></span></a>`)}</div>
        </section>
        ${(d.panels ?? []).map((p) => html`<${PanelHost} key=${`${d.unit.id}:${p.key}`} unit=${d.unit} panel=${p} />`)}
        <details class="disclosure"><summary>Notes${d.notes.length ? ` (${d.notes.length})` : ''}</summary><${NotesBlock} target=${target} notes=${d.notes} parts=${d.review.parts} /></details>
      </div>
    </div>
  </div>`;
}

// An inspector's own state (its selections) lives in the page address, so a link reopens it as it was.
const inspectorStateOf = (route) => { try { return JSON.parse(route.query.get('vs') ?? '{}'); } catch { return {}; } };

function Stage({ d, media, inspectors = [], selInspector, sel, link, setPart, badPart, route }) {
  useActiveViewer('stage', true);
  const a = link?.asset;
  const shows = a && { unit: d.unit.id, part: sel.id, asset: a.id, path: a.path, sha256: a.sha256 };
  const ids = [...inspectors.map((v) => `inspector:${v.key}`), ...media.map((p) => p.id)];
  const current = selInspector ? `inspector:${selInspector.key}` : sel?.id;
  return html`<div class=${`stage${d.display?.pixelArt ? ' pixel-art' : ''}`}>
    ${selInspector && html`<div class="stage-view view-stage" data-viewer-root data-active="true"><${InspectorHost} key=${`${d.unit.id}:${selInspector.key}`} unit=${d.unit} inspector=${selInspector} shows=${{ unit: d.unit.id, part: `inspector:${selInspector.key}`, inspector: selInspector.key }}
      inspectorState=${inspectorStateOf(route)} onState=${(state) => replace(withQuery(route, { vs: state && Object.keys(state).length ? JSON.stringify(state) : null }))} /></div>`}
    ${badPart && html`<div class="stage-view" data-viewer-root data-active="true"><${UnavailableViewer} viewerId="stage" shows=${{ unit: d.unit.id, part: badPart }} message=${`No media part or inspector "${badPart}"`} /></div>`}
    ${a && html`<div class="stage-view" data-viewer-root data-active="true">
      <${MediaViewer} media=${a} viewerId="stage" shows=${shows} label=${a.id} keepCamera context=${{ unit: d.unit, type: d.type, link }} />
    </div>`}
    <div class="strip" role="tablist" aria-label="Media"
      onKeyDown=${(e) => { if (isTyping(e) && !e.target.closest('.strip')) return; const i = ids.indexOf(current); const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null; if (n != null && ids[n]) { setPart(ids[n]); e.preventDefault(); requestAnimationFrame(() => document.querySelector('.strip [aria-selected="true"]')?.focus()); } }}>
      ${inspectors.map((v) => html`<button role="tab" aria-selected=${v === selInspector} tabindex=${v === selInspector ? 0 : -1} class=${`tile${v === selInspector ? ' on' : ''}`} onClick=${() => setPart(`inspector:${v.key}`)} title=${v.help ?? v.label}>
        <span class="thumb view-thumb" style="width:52px;height:52px"><${Icon} name="expand" size=${20} /></span><span class="tile-l">${v.label}</span></button>`)}
      ${media.map((p) => {
        const l = d.links.find((x) => x.asset.id === p.asset && x.role === p.role);
        const shared = l.alsoUsedBy.length;
        return html`<button role="tab" aria-selected=${p === sel} tabindex=${p === sel ? 0 : -1} class=${`tile${p === sel ? ' on' : ''}`} onClick=${() => setPart(p.id)} title=${l.asset.id}>
          <${Thumb} asset=${l.asset} size=${52} pixel=${!!d.display?.pixelArt} />
          <span class="tile-l">${p.label}</span>
          ${shared > 0 && html`<span class="tile-shared" title=${`Shared by ${shared + 1} units`}><${Icon} name="link" size=${10} />${shared + 1}</span>`}

        </button>`;
      })}
      ${d.missing.map((r) => html`<span class="tile missing" title=${`No ${r.label.toLowerCase()}`}><span class="thumb empty" style="width:52px;height:52px"><${KindIcon} kind=${r.mediaKinds[0]} size=${18} /></span><span class="tile-l">${r.label}</span></span>`)}
    </div>
    ${a && html`<div class="asset-line">
      <a class="link" href=${entityHref('asset', a.id)}>Open asset <${Icon} name="chev" size=${12} /></a>
      <span class="muted">${a.state === 'ok' ? html`${fmtSize(a.size)}` : html`<span class="c-bad">${a.error}</span>`}</span>
      ${link.alsoUsedBy.length > 0 && html`<span class="also"><${Icon} name="link" size=${11} />Also used by ${link.alsoUsedBy.slice(0, 3).map((x, i) => html`${i ? ', ' : ' '}<a href=${entityHref('unit', x.unit, { part: x.role })}>${x.name}</a>`)}${link.alsoUsedBy.length > 3 && html`, <a href=${entityHref('asset', a.id)}>+${link.alsoUsedBy.length - 3}</a>`}</span>`}
    </div>`}
  </div>`;
}

function Value({ v, f, refs }) {
  if (f?.kind === 'refs' && refs) return html`<span class="refs">${refs.map((r) => (r.exists ? html`<a class="ref" href=${entityHref('unit', r.id)}><${Thumb} asset=${r.thumb} size=${18} />${r.name}</a>` : html`<span class="ref missing" title="Not in this checkout">${r.id}</span>`))}</span>`;
  if (f?.kind === 'code') return html`<pre class="code-value">${String(v)}</pre>`;
  if (v && typeof v === 'object') return html`<details class="nested"><summary>${Array.isArray(v) ? `${v.length} items` : `${Object.keys(v).length} fields`}</summary><pre>${JSON.stringify(v, null, 2)}</pre></details>`;
  return html`${String(v)}${f?.unit ? html`<span class="muted"> ${f.unit}</span>` : ''}`;
}
function Attributes({ d, technical = false }) {
  const fields = d.type.fields.filter((f) => !!f.derived === technical && d.unit.attrs[f.key] != null);
  const extra = technical ? [] : Object.keys(d.unit.attrs).filter((k) => !d.type.fields.some((f) => f.key === k));
  if (!fields.length && !extra.length && !(technical && d.unit.sources.length)) return null;
  const groups = [...new Set(fields.map((f) => f.group ?? ''))];
  return html`<div class="attr-wrap">${groups.map((g) => html`
    ${g && html`<div class="attr-group">${g}</div>`}
    <dl class="attrs">${fields.filter((f) => (f.group ?? '') === g).map((f) => html`<div><dt>${f.label}${(f.help || d.unit.explain[f.key]) && html`<${Help} text=${d.unit.explain[f.key] ?? f.help} label=${f.label} />`}</dt><dd><${Value} v=${d.unit.attrs[f.key]} f=${f} refs=${d.refs[f.key]} /></dd></div>`)}</dl>`)}
    ${extra.length > 0 && html`<dl class="attrs">${extra.map((k) => html`<div><dt>${k}</dt><dd><${Value} v=${d.unit.attrs[k]} /></dd></div>`)}</dl>`}
    ${technical && d.unit.sources.length > 0 && html`<details class="source"><summary>Source</summary>${d.unit.sources.map((s) => html`<div class="mono small">${s}</div>`)}</details>`}
  </div>`;
}
// Both directions of every relation plugins declare ("Uses" / "Used by", "Made from" / "In the
// engine"…). A relation whose units an attribute of the details already lists is not shown twice.
const RELATED_SHOWN = 40;
function Relations({ d }) {
  const sorted = (ids) => [...ids].sort().join('\n');
  // Only attributes shown with the unit's details count; derived ones sit under Technical details.
  const listed = d.type.fields.filter((f) => f.kind === 'refs' && !f.derived && d.unit.attrs[f.key] != null).map((f) => sorted([d.unit.attrs[f.key]].flat()));
  const shown = (d.relations ?? []).filter((r) => r.units.length > 0 && !listed.includes(sorted(r.units.map((u) => u.id))));
  if (!shown.length) return null;
  return html`<section class="block" aria-label="Related"><header class="block-h"><h3>Related</h3></header><div class="attr-wrap related-list">${shown.map((r) => html`
    <div class="related" aria-label=${r.label}><div class="attr-group">${r.label} <span class="badge">${r.units.length}</span></div>
      <span class="refs">${r.units.slice(0, RELATED_SHOWN).map((u) => (u.exists ? html`<a class="ref" href=${entityHref('unit', u.id)}><${Thumb} asset=${u.thumb} size=${18} />${u.name}</a>` : html`<span class="ref missing" title="Not in this checkout">${u.id}</span>`))}${r.units.length > RELATED_SHOWN && html`<span class="muted small">and ${r.units.length - RELATED_SHOWN} more</span>`}</span>
    </div>`)}</div></section>`;
}
function Help({ text, label }) {
  return html`<${Popover} label=${`About ${label}`} trigger=${() => html`<button class="help" aria-label=${`About ${label}`}>?</button>`}><p class="help-text">${text}</p><//>`;
}

function MemberNav({ route, col, unitId }) {
  const q = useQuery('collection.get', { id: col });
  const c = q.data;
  const members = c?.members ?? [];
  const i = members.findIndex((m) => m.id === unitId);
  const to = (j) => href({ section: 'collections', kind: 'c', id: col, member: members[j].id, query: listParams(route.query) });
  useEffect(() => {
    const key = (e) => {
      if (e.defaultPrevented || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.scrim')) return;
      if (e.key === '[' && i > 0) location.hash = to(i - 1).slice(1);
      if (e.key === ']' && i >= 0 && i < members.length - 1) location.hash = to(i + 1).slice(1);
    };
    addEventListener('keydown', key); return () => removeEventListener('keydown', key);
  });
  return html`<nav class="ctx" aria-label="Collection">
    <a class="ctx-back" href=${href({ section: 'collections', kind: 'c', id: col, query: listParams(route.query) })}><${Icon} name="back" size=${12} />${c?.collection.name ?? col}</a>
    ${i >= 0 && html`<span class="ctx-pos">
      <a class=${`icon-btn sm${i > 0 ? '' : ' disabled'}`} href=${i > 0 ? to(i - 1) : undefined} aria-label="Previous member" title="Previous ([)"><${Icon} name="back" size=${12} /></a>
      ${i + 1} / ${members.length}
      <a class=${`icon-btn sm${i < members.length - 1 ? '' : ' disabled'}`} href=${i < members.length - 1 ? to(i + 1) : undefined} aria-label="Next member" title="Next (])"><${Icon} name="chev" size=${12} /></a>
    </span>`}

  </nav>`;
}

// ---------- Collection ----------
export function CollectionDetail({ route }) {
  const q = useQuery('collection.get', { id: route.id });
  const d = q.data;
  const [renaming, setRenaming] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  setSelectionProvider(() => ({ kind: 'collection', id: route.id, loading: !d || q.stale, preview: !!d?.preview }));
  setSelectHandler(null);
  useEffect(() => () => setSelectionProvider(() => null), []);
  if (!d || d.collection.id !== route.id) return html`<${Loading} q=${q} />`;
  const c = d.collection;
  const own = c.owner === 'catalog';
  const target = { kind: 'collection', id: c.id };
  const Preview = !!d.preview;
  const update = (body) => write('collection.update', { id: c.id, expectedRevision: c.revision, ...body }).catch((e) => toast(e.message, 'err'));
  const move = (i, dir) => { const ids = d.members.map((m) => m.id); const j = i + dir; [ids[i], ids[j]] = [ids[j], ids[i]]; update({ members: ids }); };
  return html`<div class="detail">
    <header class="d-head">
      <div class="d-title">
        ${renaming
          ? html`<input class="rename" value=${c.name} autofocus aria-label="Name" onKeyDown=${(e) => { if (e.key === 'Enter') { update({ name: e.target.value }); setRenaming(false); } if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setRenaming(false); } }} onBlur=${() => setRenaming(false)} />`
          : html`<h1>${c.name}</h1>`}
        <${CopyId} id=${c.id} />
        <span class="push"></span>
        ${own && html`<button class="icon-btn sm" title="Rename" aria-label="Rename" onClick=${() => setRenaming(true)}><${Icon} name="edit" size=${12} /></button>`}
        ${own && (confirmDel
          ? html`<button class="btn xs danger" autofocus onBlur=${() => setConfirmDel(false)} onClick=${async () => { try { await write('collection.delete', { id: c.id, expectedRevision: c.revision }); location.hash = '/collections'; } catch (e) { toast(e.message, 'err'); } }}>Delete collection</button>`
          : html`<button class="icon-btn sm" title="Delete" aria-label="Delete collection" onClick=${() => setConfirmDel(true)}><${Icon} name="trash" size=${12} /></button>`)}
      </div>
      <div class="d-meta">${c.kindLabel && html`<span class="type">${c.kindLabel}</span>`}${!own && html`<span class="chip" title="Defined in the project's own files">Project</span>`}<${OrgLine} target=${target} o=${d.organization} tags=${d.tags} /></div>
    </header>
    <div class="d-body">
      <div class="d-main">
        ${Preview && html`<${PreviewStage} d=${d} />`}
        <section class="block" aria-label="Members">
          <header class="block-h"><h3>Members</h3><span class="badge">${d.members.length}</span><span class="push"></span>
            ${own && html`<${Popover} align="right" label="Add members" trigger=${() => html`<button class="btn sm"><${Icon} name="plus" size=${12} />Add</button>`}><${MemberPicker} col=${c} members=${d.members} update=${update} /><//>`}
          </header>
          <div class="members">${d.members.map((m, i) => (m.missingTarget
            ? html`<div class="member missing" key=${m.id}><span class="thumb err" style="width:56px;height:56px"><${Icon} name="warn" /></span><span class="member-main"><span class="row-name mono">${m.id}</span><span class="row-sub c-bad">Not in this checkout</span></span></div>`
            : html`<div class="member" key=${m.id}>
              <a class="member-a" href=${href({ section: 'collections', kind: 'c', id: c.id, member: m.id, query: listParams(route.query) })}>
                <${Thumb} asset=${m.thumb} size=${56} label=${m.typeLabel[0]} />
                <span class="member-main"><span class="row-name">${m.name}</span><span class="row-sub">${m.extra && html`<b>${m.extra}</b>`}${m.typeLabel}</span></span>
              </a>


              <${NoteCount} n=${m.notes} />
              ${own && html`<span class="member-ops">
                <button class="icon-btn sm" disabled=${i === 0} onClick=${() => move(i, -1)} aria-label=${`Move ${m.name} up`} title="Move up"><${Icon} name="back" size=${11} cls="up" /></button>
                <button class="icon-btn sm" disabled=${i === d.members.length - 1} onClick=${() => move(i, 1)} aria-label=${`Move ${m.name} down`} title="Move down"><${Icon} name="chev" size=${11} cls="down" /></button>
                <button class="icon-btn sm" title="Remove from collection" aria-label=${`Remove ${m.name}`} onClick=${() => update({ remove: [m.id] })}><${Icon} name="x" size=${12} /></button></span>`}
            </div>`))}</div>
        </section>
      </div>
      <div class="d-side">
        <details class="disclosure"><summary>Notes${d.notes.length ? ` (${d.notes.length})` : ''}</summary><${NotesBlock} target=${target} notes=${d.notes} parts=${d.review.parts} /></details>
      </div>
    </div>
  </div>`;
}
function PreviewStage({ d }) {
  useActiveViewer('stage', true);
  const pv = d.preview;
  const shows = { collection: d.collection.id, part: 'preview', module: pv.module, members: pv.members.map((m) => ({ unit: m.unit, part: m.part, sha256: m.asset.sha256 })), base: pv.base?.sha256 ?? null };
  return html`<div class="stage"><div class="stage-view" data-viewer-root data-active="true"><${PreviewHost} module=${pv.module} moduleUrl=${pv.moduleUrl} moduleError=${pv.moduleError} members=${pv.members} base=${pv.base} config=${pv.config} label=${pv.label} viewerId="stage" shows=${shows} /></div>
    <div class="asset-line"><span>${pv.label}</span><span class="muted small">${pv.represents === 'representative' ? 'Representative member' : `${new Set(pv.members.map((m) => m.unit)).size} of ${d.members.length} members`}</span></div></div>`;
}
function MemberPicker({ members, update }) {
  const [q, setQ] = useState('');
  const { data } = useQuery('unit.search', { q, pageSize: 40 });
  const has = (id) => members.some((m) => m.id === id);
  return html`<div class="picker wide">
    <input value=${q} placeholder="Units" aria-label="Find units" onInput=${(e) => setQ(e.target.value)} />
    <div class="picker-list tall">${(data?.units ?? []).map((u) => html`<label class="picker-item check">
      <input type="checkbox" checked=${has(u.id)} onChange=${() => update(has(u.id) ? { remove: [u.id] } : { add: [u.id] })} />
      <${Thumb} asset=${u.thumb} size=${20} label=${u.typeLabel[0]} />${u.name}<span class="count">${u.typeLabel}</span></label>`)}</div>
  </div>`;
}

// ---------- Asset ----------
export function AssetDetail({ route }) {
  const q = useQuery('asset.get', { id: route.id });
  const d = q.data;
  const ver = route.query.get('rev');
  setSelectionProvider(() => ({ kind: 'asset', id: route.id, version: ver ?? 'current', loading: (!d && !q.error) || q.stale, unavailable: !!q.error || (!!d && !!ver && !d.versions.some((v) => v.sha256 === ver)), error: q.error?.message ?? (ver ? `version ${ver} not recorded` : null) }));
  setSelectHandler(null);
  useEffect(() => () => setSelectionProvider(() => null), []);
  if (!d || d.asset.id !== route.id) return html`<${Loading} q=${q} />`;
  const a = d.asset;
  const target = { kind: 'asset', id: a.id };
  const setQ = (x) => replace(withQuery(route, x));
  const old = ver && d.versions.find((v) => v.sha256 === ver && !v.current);
  const badVersion = !!ver && !old && !d.versions.some((v) => v.current && v.sha256 === ver);
  const shown = badVersion ? { ...a, state: 'missing', error: `Version ${shortHash(ver)} is not recorded for this asset` } : old ? { ...a, url: old.submissions[0].url, sha256: old.sha256, size: old.size, state: 'ok' } : a;
  return html`<div class="detail">
    <header class="d-head">
      <div class="d-title"><h1 class="mono">${baseName(a.path)}</h1></div>
      <div class="d-meta"><span class="type"><${KindIcon} kind=${a.kind} size=${12} />${kindLabel(a.kind)}</span>
        <span class="muted small">${a.state === 'ok' ? fmtSize(a.size) : html`<span class="c-bad">${a.error}</span>`}</span>
        <${OrgLine} target=${target} o=${d.organization} tags=${d.tags} /></div>
    </header>
    <div class="d-body">
      <div class="d-main">
        <div class="stage"><${AssetStage} a=${shown} key=${shown.sha256 ?? a.id} shows=${{ asset: a.id, sha256: shown.sha256, version: old ? 'evidence' : 'current' }} />
          <details class="disclosure"><summary>Version history</summary><div class="versions" role="list">${d.versions.map((v) => html`<div class=${`version${(old ? v.sha256 === old.sha256 : v.current) ? ' on' : ''}`} role="listitem">
            <button class="link mono" onClick=${() => setQ({ rev: v.current ? null : v.sha256 })}>${shortHash(v.sha256)}</button>
            <span class="muted small">${v.current ? 'Current' : `Reviewed ${ago(v.firstSeen)} ago · ${v.submissions.map((s) => s.ref).join(', ')}`} · ${fmtSize(v.size)}</span>
            ${!v.current && a.state === 'ok' && html`<a class="btn xs push" href=${href(withQuery(route, { cmp: JSON.stringify({ a: { submission: v.submissions[0].submission, item: v.submissions[0].item, part: v.submissions[0].part } }) }))}>Compare with current</a>`}
          </div>`)}</div></details>
        </div>
      </div>
      <div class="d-side">
        <section class="block" aria-label="Used by">
          <header class="block-h"><h3>Used by</h3><span class="badge">${new Set(d.usage.map((x) => x.unit)).size}</span></header>
          <div class="usage">${d.usage.map((x) => html`<a class="mship" href=${entityHref('unit', x.unit, { part: x.part })}><${Thumb} asset=${x.thumb} size=${28} /><span>${x.name}</span><span class="chip">${x.roleLabel}</span><span class="push"></span><span class="muted small">${x.typeLabel}</span></a>`)}</div>
        </section>
        <details class="disclosure"><summary>Notes${d.notes.length ? ` (${d.notes.length})` : ''}</summary><${NotesBlock} target=${target} notes=${d.notes} /></details>
      </div>
    </div>
  </div>`;
}
function AssetStage({ a, shows }) {
  useActiveViewer('stage', true);
  return html`<div class="stage-view" data-viewer-root data-active="true"><${MediaViewer} media=${a} viewerId="stage" shows=${shows} /></div>`;
}
