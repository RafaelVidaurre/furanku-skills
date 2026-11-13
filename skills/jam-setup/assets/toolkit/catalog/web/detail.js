import { html, useState, useEffect, useRef, useQuery, write, href, withQuery, replace, entityHref, listParams, Icon, Popover, Thumb, VerdictBar, Verdict, NoteCount, Tags, CategoryPicker, CopyId, kindIcon, fmtSize, ago, Person, toast, ErrorLine, shortHash, baseName, isTyping } from './core.js';
import { AssetViewer, ModelViewer, UnavailableViewer } from './viewers.js';
import { PreviewHost } from './previews.js';
import { useActiveViewer, setSelectionProvider, setSelectHandler } from './controller.js';
import { ReviewBlock } from './review.js';
import { NotesBlock } from './notes.js';
import { CollectionToggle, RoleGlyphs } from './lists.js';

const organize = (target, body) => write('organize.set', { target, ...body }).catch((e) => toast(e.message, 'err'));

function Loading({ q }) {
  if (q.error && !q.data) return html`<div class="detail"><${ErrorLine} error=${q.error} onRetry=${q.reload} /></div>`;
  return html`<div class="detail"><div class="viewer-msg"><span class="spin" aria-label="Loading"></span></div></div>`;
}
function OrgLine({ target, o, tags }) {
  return html`<${CategoryPicker} value=${o.category} projectValue=${o.projectCategory} onChange=${(c) => organize(target, { category: c, expectedRevision: o.revision ?? undefined })} />
    <${Tags} tags=${tags} projectTags=${o.projectTags} onChange=${(t) => organize(target, { tags: t, expectedRevision: o.revision ?? undefined })} />`;
}

// ---------- Content unit ----------
export function UnitDetail({ route, ctx }) {
  const id = ctx ? route.member : route.id;
  const q = useQuery('unit.get', { id });
  const d = q.data;
  const partId = route.query.get('part');
  const visual = d ? d.review.parts.filter((p) => p.asset) : [];
  // No part named: show the first visual. A named part that does not exist is an error, never a substitute.
  const sel = partId ? visual.find((p) => p.id === partId) : visual[0];
  const badPart = !!d && !!partId && !sel;
  const col = useQuery('collection.get', { id: ctx ?? '' }, !!ctx);
  const notMember = !!ctx && !!col.data && col.data.collection.id === ctx && !col.data.members.some((m) => m.id === id);
  const setPart = (pid) => replace(withQuery(route, { part: pid }));
  const link = sel && d.links.find((l) => l.asset.id === sel.asset && l.role === sel.role);
  const unavailable = notMember ? `${id} is not a member of ${ctx}` : badPart ? `${d.unit.name} has no visual part "${partId}"` : (q.error && !d ? q.error.message : null);
  setSelectionProvider(() => ({ kind: 'unit', id, collection: ctx ?? null, part: sel?.id ?? (badPart ? partId : null), loading: (!d && !q.error) || q.stale || (!!ctx && !col.data), unavailable: !!unavailable, error: unavailable, parts: visual.map((p) => p.id), asset: link ? { id: link.asset.id, sha256: link.asset.sha256, kind: link.asset.kind } : null }));
  setSelectHandler((s) => { if (!s.part) return { ok: true }; if (!visual.some((p) => p.id === s.part)) return { error: `no visual part ${s.part}`, code: 'not_found' }; setPart(s.part); return { ok: true }; });
  useEffect(() => () => { setSelectionProvider(() => null); setSelectHandler(null); }, []);
  if (notMember) return html`<div class="detail"><${MemberNav} route=${route} col=${ctx} unitId=${id} /><div class="errline" role="alert"><${Icon} name="warn" size=${13} /><span>${unavailable}</span></div></div>`;
  if (!d || d.unit.id !== id) return html`<${Loading} q=${q} />`;
  const target = { kind: 'unit', id };
  return html`<div class="detail">
    <header class="d-head">
      ${ctx && html`<${MemberNav} route=${route} col=${ctx} unitId=${id} />`}
      <div class="d-title"><h1>${d.unit.name}</h1><${CopyId} id=${d.unit.id} /></div>
      <div class="d-meta"><span class="type" title=${d.type.help ?? ''}>${d.type.label}</span><${OrgLine} target=${target} o=${d.organization} tags=${d.tags} /></div>
    </header>
    <div class=${`d-body${visual.length || d.missing.length || badPart ? '' : ' single'}`}>
      ${(visual.length > 0 || d.missing.length > 0 || badPart) && html`<div class="d-main"><${Stage} d=${d} visual=${visual} sel=${sel} link=${link} setPart=${setPart} badPart=${badPart ? partId : null} /></div>`}
      <div class="d-side">
        <${Attributes} d=${d} />
        <${ReviewBlock} target=${target} detail=${d} onPart=${setPart} name=${d.unit.name} parts=${d.review.parts} />
        <section class="block" aria-label="Collections">
          <header class="block-h"><h3>Collections</h3><span class="badge">${d.memberships.length}</span><span class="push"></span>
            <${Popover} align="right" label="Edit collections" trigger=${() => html`<button class="btn sm"><${Icon} name="plus" size=${12} />Add</button>`}><${CollectionToggle} unitIds=${[id]} /><//>
          </header>
          <div class="memberships">${d.memberships.map((c) => html`<a class="mship" href=${href({ section: 'collections', kind: 'c', id: c.id, member: id })}>
            <span>${c.name}</span><span class="muted small">${c.category ?? ''}</span><span class="push"></span>${c.verdict && html`<${Verdict} v=${c.verdict} short />`}</a>`)}</div>
        </section>
        <${NotesBlock} target=${target} notes=${d.notes} parts=${d.review.parts} />
      </div>
    </div>
  </div>`;
}

function Stage({ d, visual, sel, link, setPart, badPart }) {
  useActiveViewer('stage', true);
  const a = link?.asset;
  const source = a && { unit: d.unit.id, part: sel.id, asset: a.id, path: a.path, sha256: a.sha256 };
  return html`<div class="stage">
    ${badPart && html`<div class="stage-view" data-viewer-root data-active="true"><${UnavailableViewer} viewerId="stage" source=${{ unit: d.unit.id, part: badPart }} message=${`No visual part "${badPart}"`} /></div>`}
    ${a && html`<div class="stage-view" data-viewer-root data-active="true">
      ${a.kind === 'model' && a.state === 'ok'
        ? html`<${ModelViewer} key="model" srcs=${[a.url]} viewerId="stage" source=${source} label=${a.id} keepCamera />`
        : html`<${AssetViewer} key=${a.id} asset=${a} viewerId="stage" source=${source} />`}
    </div>`}
    <div class="strip" role="tablist" aria-label="Visuals"
      onKeyDown=${(e) => { if (isTyping(e) && !e.target.closest('.strip')) return; const i = visual.indexOf(sel); const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null; if (n != null && visual[n]) { setPart(visual[n].id); e.preventDefault(); requestAnimationFrame(() => document.querySelector('.strip [aria-selected="true"]')?.focus()); } }}>
      ${visual.map((p) => {
        const l = d.links.find((x) => x.asset.id === p.asset && x.role === p.role);
        const shared = l.alsoUsedBy.length;
        return html`<button role="tab" aria-selected=${p === sel} tabindex=${p === sel ? 0 : -1} class=${`tile${p === sel ? ' on' : ''}`} onClick=${() => setPart(p.id)} title=${l.asset.id}>
          <${Thumb} asset=${l.asset} size=${52} />
          <span class="tile-l">${l.roleLabel}</span>
          ${shared > 0 && html`<span class="tile-shared" title=${`Shared by ${shared + 1} content units`}><${Icon} name="link" size=${10} />${shared + 1}</span>`}
          <i class=${`tile-v ${p.verdict ?? 'none'}${p.changed ? ' changed' : ''}`}></i>
        </button>`;
      })}
      ${d.missing.map((r) => html`<span class="tile missing" title=${`No ${r.label.toLowerCase()}`}><span class="thumb empty" style="width:52px;height:52px"><${Icon} name=${kindIcon(r.kinds[0])} size=${18} /></span><span class="tile-l">${r.label}</span></span>`)}
    </div>
    ${a && html`<div class="asset-line">
      <a class="mono" href=${entityHref('asset', a.id)}>${a.id}</a>
      <span class="muted">${a.state === 'ok' ? html`${fmtSize(a.size)} · <span class="mono">${shortHash(a.sha256)}</span>` : html`<span class="c-bad">${a.error}</span>`}</span>
      ${link.alsoUsedBy.length > 0 && html`<span class="also"><${Icon} name="link" size=${11} />Also used by ${link.alsoUsedBy.slice(0, 3).map((x, i) => html`${i ? ', ' : ' '}<a href=${entityHref('unit', x.unit, { part: x.role })}>${x.name}</a>`)}${link.alsoUsedBy.length > 3 && html`, <a href=${entityHref('asset', a.id)}>+${link.alsoUsedBy.length - 3}</a>`}</span>`}
    </div>`}
  </div>`;
}

function Value({ v, f, refs }) {
  if (f?.kind === 'refs' && refs) return html`<span class="refs">${refs.map((r) => (r.exists ? html`<a class="ref" href=${entityHref('unit', r.id)}><${Thumb} asset=${r.thumb} size=${18} />${r.name}</a>` : html`<span class="ref missing" title="Not in this checkout">${r.id}</span>`))}</span>`;
  if (v && typeof v === 'object') return html`<details class="nested"><summary>${Array.isArray(v) ? `${v.length} items` : `${Object.keys(v).length} fields`}</summary><pre>${JSON.stringify(v, null, 2)}</pre></details>`;
  return html`${String(v)}${f?.unit ? html`<span class="muted"> ${f.unit}</span>` : ''}`;
}
function Attributes({ d }) {
  const fields = d.type.fields.filter((f) => d.unit.attrs[f.key] != null);
  const extra = Object.keys(d.unit.attrs).filter((k) => !d.type.fields.some((f) => f.key === k));
  if (!fields.length && !extra.length) return null;
  const groups = [...new Set(fields.map((f) => f.group ?? ''))];
  return html`<div class="attr-wrap">${groups.map((g) => html`
    ${g && html`<div class="attr-group">${g}</div>`}
    <dl class="attrs">${fields.filter((f) => (f.group ?? '') === g).map((f) => html`<div><dt>${f.label}${(f.help || d.unit.explain[f.key]) && html`<${Help} text=${d.unit.explain[f.key] ?? f.help} label=${f.label} />`}</dt><dd><${Value} v=${d.unit.attrs[f.key]} f=${f} refs=${d.refs[f.key]} /></dd></div>`)}</dl>`)}
    ${extra.length > 0 && html`<dl class="attrs">${extra.map((k) => html`<div><dt>${k}</dt><dd><${Value} v=${d.unit.attrs[k]} /></dd></div>`)}</dl>`}
    ${d.unit.sources.length > 0 && html`<details class="source"><summary>Source</summary>${d.unit.sources.map((s) => html`<div class="mono small">${s}</div>`)}</details>`}
  </div>`;
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
  const p = members[i]?.inCollection;
  return html`<nav class="ctx" aria-label="Collection">
    <a class="ctx-back" href=${href({ section: 'collections', kind: 'c', id: col, query: listParams(route.query) })}><${Icon} name="back" size=${12} />${c?.collection.name ?? col}</a>
    ${i >= 0 && html`<span class="ctx-pos">
      <a class=${`icon-btn sm${i > 0 ? '' : ' disabled'}`} href=${i > 0 ? to(i - 1) : undefined} aria-label="Previous member" title="Previous ([)"><${Icon} name="back" size=${12} /></a>
      ${i + 1} / ${members.length}
      <a class=${`icon-btn sm${i < members.length - 1 ? '' : ' disabled'}`} href=${i < members.length - 1 ? to(i + 1) : undefined} aria-label="Next member" title="Next (])"><${Icon} name="chev" size=${12} /></a>
    </span>`}
    ${p?.verdict && html`<span class="ctx-v">In ${c.collection.name}: <${Verdict} v=${p.verdict} /></span>`}
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
                <span class="member-main"><span class="row-name">${m.name}</span><span class="row-sub">${m.extra && html`<b>${m.extra}</b>`}${m.typeLabel}<${RoleGlyphs} e=${m} /></span></span>
              </a>
              <span class="member-v" title="Verdict in this collection"><${Verdict} v=${m.inCollection?.verdict} short /></span>
              <span class="member-own" title="The content unit's own review"><${VerdictBar} parts=${m.status.parts} /></span>
              <${NoteCount} n=${m.notes} />
              ${own && html`<span class="member-ops">
                <button class="icon-btn sm" disabled=${i === 0} onClick=${() => move(i, -1)} aria-label=${`Move ${m.name} up`} title="Move up"><${Icon} name="back" size=${11} cls="up" /></button>
                <button class="icon-btn sm" disabled=${i === d.members.length - 1} onClick=${() => move(i, 1)} aria-label=${`Move ${m.name} down`} title="Move down"><${Icon} name="chev" size=${11} cls="down" /></button>
                <button class="icon-btn sm" title="Remove from collection" aria-label=${`Remove ${m.name}`} onClick=${() => update({ remove: [m.id] })}><${Icon} name="x" size=${12} /></button></span>`}
            </div>`))}</div>
        </section>
      </div>
      <div class="d-side">
        <${ReviewBlock} target=${target} detail=${d} name=${c.name} parts=${d.review.parts} />
        <${NotesBlock} target=${target} notes=${d.notes} parts=${d.review.parts} />
      </div>
    </div>
  </div>`;
}
function PreviewStage({ d }) {
  useActiveViewer('stage', true);
  const p = d.review.parts.find((x) => x.id === 'preview');
  const pv = d.preview;
  const source = { collection: d.collection.id, part: 'preview', module: pv.module, members: pv.members.map((m) => ({ unit: m.unit, part: m.part, sha256: m.asset.sha256 })), base: pv.base?.sha256 ?? null };
  return html`<div class="stage"><div class="stage-view" data-viewer-root data-active="true"><${PreviewHost} module=${pv.module} moduleUrl=${pv.moduleUrl} moduleError=${pv.moduleError} members=${pv.members} base=${pv.base} config=${pv.config} label=${pv.label} viewerId="stage" source=${source} /></div>
    <div class="asset-line"><span>${pv.label}</span><span class="muted small">${pv.represents === 'representative' ? 'Representative member' : `${new Set(pv.members.map((m) => m.unit)).size} of ${d.members.length} members`}</span><span class="push"></span><${Verdict} v=${p?.verdict} /></div></div>`;
}
function MemberPicker({ members, update }) {
  const [q, setQ] = useState('');
  const { data } = useQuery('catalog.search', { section: 'units', q, pageSize: 40 });
  const has = (id) => members.some((m) => m.id === id);
  return html`<div class="picker wide">
    <input value=${q} placeholder="Content" aria-label="Find content" onInput=${(e) => setQ(e.target.value)} />
    <div class="picker-list tall">${(data?.items ?? []).map((u) => html`<label class="picker-item check">
      <input type="checkbox" checked=${has(u.id)} onChange=${() => update(has(u.id) ? { remove: [u.id] } : { add: [u.id] })} />
      <${Thumb} asset=${u.thumb} size=${20} label=${u.typeLabel[0]} />${u.name}<span class="count">${u.typeLabel}</span></label>`)}</div>
  </div>`;
}

// ---------- Visual asset ----------
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
      <div class="d-title"><h1 class="mono">${baseName(a.path)}</h1><${CopyId} id=${a.id} /></div>
      <div class="d-meta"><span class="type"><${Icon} name=${kindIcon(a.kind)} size=${12} />${{ image: 'Image', video: 'Video', model: '3D model' }[a.kind] ?? 'Unknown'}</span>
        <span class="muted small">${a.state === 'ok' ? fmtSize(a.size) : html`<span class="c-bad">${a.error}</span>`}</span>
        <${OrgLine} target=${target} o=${d.organization} tags=${d.tags} /></div>
    </header>
    <div class="d-body">
      <div class="d-main">
        <div class="stage"><${AssetStage} a=${shown} key=${shown.sha256 ?? a.id} source=${{ asset: a.id, sha256: shown.sha256, version: old ? 'evidence' : 'current' }} />
          <div class="versions" role="list">${d.versions.map((v) => html`<div class=${`version${(old ? v.sha256 === old.sha256 : v.current) ? ' on' : ''}`} role="listitem">
            <button class="link mono" onClick=${() => setQ({ rev: v.current ? null : v.sha256 })}>${shortHash(v.sha256)}</button>
            <span class="muted small">${v.current ? 'Current' : `Reviewed ${ago(v.firstSeen)} ago · ${v.submissions.map((s) => s.ref).join(', ')}`} · ${fmtSize(v.size)}</span>
            ${!v.current && a.state === 'ok' && html`<a class="btn xs push" href=${href(withQuery(route, { cmp: `${v.submissions[0].submission}~${v.submissions[0].item}~${v.submissions[0].part}` }))}>Compare with current</a>`}
          </div>`)}</div>
        </div>
      </div>
      <div class="d-side">
        <section class="block" aria-label="Used by">
          <header class="block-h"><h3>Used by</h3><span class="badge">${new Set(d.usage.map((x) => x.unit)).size}</span></header>
          <div class="usage">${d.usage.map((x) => html`<a class="mship" href=${entityHref('unit', x.unit, { part: x.part })}><${Thumb} asset=${x.thumb} size=${28} /><span>${x.name}</span><span class="chip">${x.roleLabel}</span><span class="push"></span><span class="muted small">${x.typeLabel}</span></a>`)}</div>
        </section>
        ${d.verdicts.length > 0 && html`<section class="block" aria-label="Verdicts">
          <header class="block-h"><h3>Verdicts</h3><span class="badge">${d.verdicts.length}</span></header>
          <div class="usage">${d.verdicts.map((v) => html`<a class="mship" href=${href({ section: 'reviews', kind: 's', id: v.submission, member: v.item })}><${Verdict} v=${v.verdict} short /><span>${v.targetName}</span><span class="chip">${v.partLabel}</span>${v.note && html`<span class="muted" title=${v.note} aria-label=${`Note on ${v.partLabel}: ${v.note}`}><${Icon} name="note" size=${11} /></span>`}<span class="muted small mono">${shortHash(v.sha256)}</span><span class="push"></span><${Person} by=${v.by} /><span class="muted small">${ago(v.at)}</span></a>`)}</div>
        </section>`}
        <${NotesBlock} target=${target} notes=${d.notes} />
      </div>
    </div>
  </div>`;
}
function AssetStage({ a, source }) {
  useActiveViewer('stage', true);
  return html`<div class="stage-view" data-viewer-root data-active="true"><${AssetViewer} asset=${a} viewerId="stage" source=${source} /></div>`;
}
