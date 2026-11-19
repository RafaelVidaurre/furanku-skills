import { render } from 'preact';
import { useErrorBoundary } from 'preact/hooks';
import { html, boot, onSchema, useSession, useRoute, useQuery, href, entityHref, listParams, Icon, Thumb, Toasts, isTyping, useState, useEffect, useRef, enc, Popover, call, otherCheckoutDrafts, shortHash, ErrorLine, scopes, scopeOf, defaultScope, isListSection, sectionLabel } from './core.js';
// The built-in media kinds register themselves like a plugin's would.
import './kinds/image.js';
import './kinds/video.js';
import './kinds/model.js';
import './kinds/audio.js';
import { loadKindModules, kindProblems, useMediaKinds } from './media-kinds.js';
import { catalog } from './plugin-api.js';
import { InboxView } from './inbox.js';
import { ListPane, currentList, selectedFacets } from './lists.js';
import { UnitDetail, CollectionDetail, AssetDetail } from './detail.js';
import { ReviewsView, SubmissionView } from './review.js';
import { NotesView } from './notes.js';
import { OrganizationView } from './organize.js';
import { CompareOverlay } from './compare.js';
import { markRendered } from './controller.js';

function App() {
  const s = useSession();
  const route = useRoute();
  const [nav, setNav] = useState(false);
  useEffect(() => setNav(false), [location.hash]);
  useKeys(route);
  useEffect(() => { requestAnimationFrame(() => markRendered(location.hash)); });
  if (!s.boot) return html`<div class="boot"><span class="spin"></span></div>`;
  const listSection = isListSection(route.section);
  const detail = listSection && route.kind ? renderDetail(route) : null;
  return html`<div class=${`app${nav ? ' nav-open' : ''}`}>
    <${Top} s=${s} onMenu=${() => setNav(!nav)} />
    <${Side} route=${route} />
    <main class=${`main${detail ? ' has-detail' : ''}`}><${Boundary} key=${location.hash.split('?')[0]}>
      ${s.changed && html`<div class="banner" role="alert">This checkout is now on <b>${s.changed.branch ?? `detached ${shortHash(s.changed.head)}`}</b>. Saving is paused and drafts are kept for ${s.boot.checkout.branch ?? 'the previous checkout'}. <button class="btn xs" onClick=${() => location.reload()}>Reload</button></div>`}
      ${s.offline && html`<div class="banner" role="alert">The catalog server is not responding. Unsaved text stays in this page.</div>`}
      ${listSection && !detail && html`<${ListPane} route=${route} />`}
      ${detail && html`<div class="detail-pane">
        <a class="close-detail always" href=${href({ section: route.section, query: listParams(route.query) })} aria-label="Back to list" title="Back to list (Esc)"><${Icon} name="back" size=${14} /><span>${sectionLabel(route.section)}</span></a>
        ${detail}
      </div>`}
      ${route.section === 'notes' && html`<${NotesView} route=${route} />`}
      ${route.section === 'reviews' && (route.kind === 's' ? html`<div class="detail-pane full"><a class="close-detail always" href=${href({ section: 'reviews', query: new URLSearchParams([...route.query].filter(([k]) => ['state', 'q'].includes(k))) })}><${Icon} name="back" size=${14} /><span>Reviews</span></a><${SubmissionView} key=${route.id} route=${route} /></div>` : html`<${ReviewsView} route=${route} />`)}
      ${route.section === 'organization' && html`<${OrganizationView} />`}
      ${route.section === 'inbox' && html`<${InboxView} />`}
      ${!listSection && !['notes', 'reviews', 'organization', 'inbox'].includes(route.section) && html`<div class="page"><div class="errline" role="alert"><${Icon} name="warn" size=${13} /><span>There is no page "${route.section}" in this catalog.</span><a class="btn xs" href=${`#/${defaultScope()}`}>Open the catalog</a></div></div>`}
    <//></main>
    <${CompareOverlay} route=${route} />
    <${Toasts} />
  </div>`;
}

// A failing view shows its error and keeps the rest of the application usable.
function Boundary({ children }) {
  const [error, reset] = useErrorBoundary((e) => console.error(e));
  if (error) return html`<div class="page"><div class="errline" role="alert"><${Icon} name="warn" size=${13} /><span>This view failed to render: ${error.message}</span><button class="btn xs" onClick=${reset}>Retry</button></div></div>`;
  return children;
}

function renderDetail(route) {
  if (route.kind === 'u') return html`<${UnitDetail} key=${route.id} route=${route} />`;
  if (route.kind === 'a') return html`<${AssetDetail} key=${route.id} route=${route} />`;
  if (route.kind === 'c') return route.member ? html`<${UnitDetail} key=${`${route.id}/${route.member}`} route=${route} ctx=${route.id} />` : html`<${CollectionDetail} key=${route.id} route=${route} />`;
  return null;
}

function useKeys(route) {
  useEffect(() => {
    const key = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); document.querySelector('[data-global-search]')?.focus(); return; }
      if (e.defaultPrevented || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.scrim') || document.querySelector('.pop')) return;
      if (e.key === '/') { e.preventDefault(); document.querySelector('[data-list-search]')?.focus(); }
      if ((e.key === 'j' || e.key === 'k') && isListSection(route.section) && !route.member) {
        const list = currentList.hrefs; if (currentList.section !== route.section || !list.length) return;
        const cur = list.findIndex((h) => h.split('?')[0] === location.hash.split('?')[0]);
        const next = list[Math.max(0, Math.min(list.length - 1, cur + (e.key === 'j' ? 1 : -1)))] ?? list[0];
        location.hash = next.slice(1);
        requestAnimationFrame(() => document.querySelector('.list-pane [aria-current="true"]')?.scrollIntoView({ block: 'nearest' }));
      }
      if (e.key === 'Escape' && (route.kind || route.member)) document.querySelector('.close-detail')?.click();
    };
    addEventListener('keydown', key); return () => removeEventListener('keydown', key);
  }, [route]);
}

// The scope the person is browsing. Collections and assets belong to no scope, so the last one
// visited stays the frame around them.
let lastScope = null;
function currentScope(section) {
  if (scopeOf(section)) lastScope = section;
  return scopeOf(lastScope) ?? scopes()[0] ?? null;
}

function Top({ s, onMenu }) {
  useMediaKinds();
  const c = s.summary.checkout;
  const me = s.summary.actor;
  const others = otherCheckoutDrafts();
  const r = useRoute();
  const all = scopes();
  const attention = useQuery('inbox', { limit: 1 }).data?.counts;
  const waiting = attention ? attention.waiting + attention.notes + attention.changed + attention.problems : 0;
  const problems = s.summary.problems + kindProblems().length;
  return html`<header class="top">
    <button class="icon-btn menu" onClick=${onMenu} aria-label="Navigation"><${Icon} name="rows" /></button>
    <span class="proj">${s.summary.project}</span>
    ${all.length > 1 && html`<nav class="primary-nav" aria-label="Library">${all.map((scope) => html`<a href=${`#/${enc(scope.id)}`} title=${scope.description} aria-current=${r.section === scope.id ? 'page' : undefined}>${scope.label}</a>`)}</nav>`}
    <${Popover} label="Workspace details" trigger=${() => html`<button class="icon-btn" aria-label="Workspace details"><${Icon} name="branch" size=${14} /></button>`}>
      <div class="picker workspace-details"><strong>${c.branch ?? 'Local workspace'}</strong><span class="mono">${c.head ?? ''}</span><span class="mono">${c.root}</span><${Uncommitted} />${others.length > 0 && html`<details><summary>Recover unsent text from other workspaces</summary><${OtherDrafts} keys=${others} /></details>`}</div>
    <//>
    ${problems > 0 && html`<${Popover} label="Problems" trigger=${() => html`<button class="btn xs warn"><${Icon} name="warn" size=${12} />${problems}</button>`}><${Problems} /><//>`}
    <a class=${`btn xs attention-link${waiting ? ' has' : ''}`} href="#/inbox" aria-current=${r.section === 'inbox' ? 'page' : undefined} title="Reviews waiting, open notes, changed verdicts and problems"><${Icon} name="inbox" size=${13} /><span>Needs attention</span>${waiting > 0 && html`<span class="badge">${waiting}</span>`}</a>

    <${GlobalSearch} />
    <span class="me" title=${me}>${(me ?? '?').split(/\s+/).map((x) => x[0]).join('').slice(0, 2)}</span>
  </header>`;
}
// Asked for when the details are opened: counting uncommitted files runs Git, so it is not polled.
function Uncommitted() {
  const dirty = useQuery('checkout', {}).data?.checkout.dirty;
  return dirty > 0 ? html`<span>${dirty} uncommitted change${dirty === 1 ? '' : 's'}</span>` : null;
}
function Problems() {
  const { data, error } = useQuery('problems', {});
  return html`<div class="problems"><${ErrorLine} error=${error} />${kindProblems().map((p) => html`<div class="problem"><div class="mono small">media kind ${p.kind}</div><div>${p.error}</div></div>`)}${(data?.problems ?? []).map((p) => html`<div class="problem"><div class="mono small">${p.subject}</div><div>${p.error}</div>${p.recovery && html`<div class="muted small">${p.recovery}</div>`}</div>`)}</div>`;
}
function OtherDrafts({ keys }) {
  const [, force] = useState(0);
  return html`<div class="problems">${keys.map((k) => { let v = null; try { v = JSON.parse(localStorage.getItem(k)); } catch {} const [, checkoutKey, ...rest] = k.split(':'); return html`<div class="problem">
    <div class="mono small">${checkoutKey} · ${rest.join(':')}</div><div class="draft-text">${v?.body ?? v?.comment ?? ''}</div>
    <button class="btn xs" onClick=${() => navigator.clipboard?.writeText(v?.body ?? v?.comment ?? '')}>Copy text</button>
    <button class="btn xs ghost" onClick=${() => { localStorage.removeItem(k); force((n) => n + 1); }}>Discard</button></div>`; })}</div>`;
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState([]);
  const box = useRef();
  useEffect(() => {
    const t = q.trim();
    if (!t) { setRes([]); return; }
    let live = true;
    const h = setTimeout(async () => {
      const [u, c, a] = await Promise.all([
        call('unit.search', { q: t, pageSize: 5 }).catch(() => ({ units: [] })),
        call('collection.search', { q: t, pageSize: 5 }).catch(() => ({ collections: [] })),
        call('asset.search', { q: t, pageSize: 5 }).catch(() => ({ assets: [] })),
      ]);
      if (!live) return;
      setRes([
        ...u.units.map((x) => ({ k: scopeOf(x.scope)?.label ?? 'Unit', label: x.name, sub: x.typeLabel, href: entityHref('unit', x.id), thumb: x.thumb })),
        ...c.collections.map((x) => ({ k: 'Collection', label: x.name, sub: x.match?.member ? `Includes ${x.match.member.name}` : x.category ?? '', href: x.match?.member ? href({ section: 'collections', kind: 'c', id: x.id, member: x.match.member.id }) : entityHref('collection', x.id) })),
        ...a.assets.map((x) => ({ k: 'Asset', label: x.path.split('/').pop(), sub: x.path.split('/').slice(0, -1).join('/'), href: entityHref('asset', x.id), thumb: x })),
      ]);
    }, 120);
    return () => { live = false; clearTimeout(h); };
  }, [q]);
  const goTo = (r) => { location.hash = r.href.slice(1); setQ(''); setOpen(false); box.current.querySelector('input').blur(); };
  useEffect(() => { const off = (e) => !box.current.contains(e.target) && setOpen(false); document.addEventListener('pointerdown', off); return () => document.removeEventListener('pointerdown', off); }, []);
  return html`<div class="gsearch" ref=${box}>
    <${Icon} name="search" size=${14} />
    <input data-global-search value=${q} placeholder="Search" aria-label="Search catalog" role="combobox" aria-expanded=${open && res.length > 0}
      onFocus=${() => setOpen(true)} onInput=${(e) => { setQ(e.target.value); setHi(0); setOpen(true); }}
      onKeyDown=${(e) => {
        if (e.key === 'ArrowDown') { setHi(Math.min(hi + 1, res.length - 1)); e.preventDefault(); }
        if (e.key === 'ArrowUp') { setHi(Math.max(hi - 1, 0)); e.preventDefault(); }
        if (e.key === 'Enter' && res[hi]) goTo(res[hi]);
        if (e.key === 'Escape') { e.preventDefault(); setOpen(false); e.target.blur(); }
      }} />
    <kbd>⌘K</kbd>
    ${open && res.length > 0 && html`<div class="gresults" role="listbox">${res.map((r, i) => html`
      <a class=${`gres${i === hi ? ' hi' : ''}`} href=${r.href} role="option" aria-selected=${i === hi} onClick=${(e) => { e.preventDefault(); goTo(r); }} onMouseEnter=${() => setHi(i)}>
        ${r.thumb ? html`<${Thumb} asset=${r.thumb} size=${22} />` : html`<span class="gres-k">${r.k[0]}</span>`}<span>${r.label}</span><span class="muted small">${r.sub ?? ''}</span><span class="push muted small">${r.k}</span></a>`)}</div>`}
  </div>`;
}

function Side({ route }) {
  const s = useSession();
  const scope = currentScope(route.section);
  const area = scope?.id;
  const units = useQuery('unit.search', { scope: area, pageSize: 1 }, !!area).data;
  const cols = useQuery('collection.search', { pageSize: 1 }).data;
  const assets = useQuery('asset.search', { pageSize: 1 }).data;
  const sel = selectedFacets(route);
  const only = (k, v) => sel[k]?.length === 1 && sel[k][0] === v && Object.keys(sel).length === 1;
  const none = Object.keys(sel).length === 0;
  const link = (section, k, v) => href({ section, query: k ? new URLSearchParams({ [`f.${k}`]: enc(v) }) : undefined });
  const Item = ({ to, active, label, n, depth = 0, strong }) => html`<a class=${`nav-i${active ? ' on' : ''}${strong ? ' strong' : ''}`} href=${to} style=${depth ? `padding-left:${12 + depth * 14}px` : ''} aria-current=${active ? 'page' : undefined}><span>${label}</span>${n != null && html`<span class="count">${n}</span>`}</a>`;
  // A previous scope's counts and categories cannot describe this one.
  const mine = units?.scope === area ? units : null;
  return html`<nav class="side" aria-label="Catalog">
    ${scope && html`<div class="nav-caption" title=${scope.description}>${scope.label}</div>
    <${Item} strong to=${link(area)} active=${route.section === area && none} label=${`All ${scope.label.toLowerCase()}`} n=${mine?.all} />
    ${(mine?.facets.cat.values.filter(c => !c.value.includes('/')) ?? []).map(c => html`<${Item} to=${link(area, 'cat', c.value)} active=${route.section === area && only('cat', c.value)} label=${c.label} n=${c.count} depth=${1} />`)}
    <div class="nav-sep"></div>`}
    <${Item} to=${link('collections')} active=${route.section === 'collections' && none} label="Collections" n=${cols?.all} />
    <${Item} to=${link('assets')} active=${route.section === 'assets' && none} label="Assets" n=${assets?.all} />
    <div class="nav-sep"></div>
    <${Item} strong to="#/notes" active=${route.section === 'notes'} label="Notes" n=${s.summary.counts.openNotes} />
    <${Item} strong to="#/reviews" active=${route.section === 'reviews'} label="Reviews" n=${s.summary.counts.waiting || null} />
    <${Item} strong to="#/organization" active=${route.section === 'organization'} label="Categories & tags" />
  </nav>`;
}

// Media kinds a plugin adds bring their viewer as a module; load them before the first page is
// drawn, and again whenever the schema changes.
onSchema((schema) => loadKindModules(schema.mediaKinds, catalog));
boot().then(() => render(html`<${App} />`, document.getElementById('root')), (e) => { document.getElementById('root').textContent = `The catalog could not start: ${e.message}`; });
