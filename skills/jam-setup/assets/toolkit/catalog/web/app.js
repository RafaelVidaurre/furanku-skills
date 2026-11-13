import { render } from 'preact';
import { useErrorBoundary } from 'preact/hooks';
import { html, boot, useSession, useRoute, useQuery, href, entityHref, listParams, Icon, Thumb, Toasts, isTyping, useState, useEffect, useRef, enc, Popover, call, otherContextDrafts, shortHash, ErrorLine } from './core.js';
import './thumbs.js';
import { ListPane, currentList, selectedFacets } from './lists.js';
import { UnitDetail, CollectionDetail, AssetDetail } from './detail.js';
import { ReviewsView, SubmissionView } from './review.js';
import { NotesView } from './notes.js';
import { OrganizeView } from './organize.js';
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
  const listSection = ['content', 'collections', 'assets'].includes(route.section);
  const detail = listSection && route.kind ? renderDetail(route) : null;
  return html`<div class=${`app${nav ? ' nav-open' : ''}`}>
    <${Top} s=${s} onMenu=${() => setNav(!nav)} />
    <${Side} route=${route} />
    <main class=${`main${detail ? ' has-detail' : ''}`}><${Boundary} key=${location.hash.split('?')[0]}>
      ${s.changed && html`<div class="banner" role="alert">This checkout is now on <b>${s.changed.branch ?? `detached ${shortHash(s.changed.head)}`}</b>. Saving is paused and drafts are kept for ${s.boot.context.branch ?? 'the previous checkout'}. <button class="btn xs" onClick=${() => location.reload()}>Reload</button></div>`}
      ${s.offline && html`<div class="banner" role="alert">The catalog server is not responding. Unsaved text stays in this page.</div>`}
      ${listSection && html`<${ListPane} route=${route} compact=${!!detail} />`}
      ${detail && html`<div class="detail-pane">
        <a class="close-detail" href=${href({ section: route.section, query: listParams(route.query) })} aria-label="Close" title="Close (Esc)"><${Icon} name="back" size=${14} /><span>${{ content: 'Content', collections: 'Collections', assets: 'Assets' }[route.section]}</span></a>
        ${detail}
      </div>`}
      ${route.section === 'notes' && html`<${NotesView} route=${route} />`}
      ${route.section === 'reviews' && (route.kind === 's' ? html`<div class="detail-pane full"><a class="close-detail always" href=${href({ section: 'reviews', query: new URLSearchParams([...route.query].filter(([k]) => ['state', 'q'].includes(k))) })}><${Icon} name="back" size=${14} /><span>Reviews</span></a><${SubmissionView} key=${route.id} route=${route} /></div>` : html`<${ReviewsView} route=${route} />`)}
      ${route.section === 'organize' && html`<${OrganizeView} />`}
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
      if ((e.key === 'j' || e.key === 'k') && ['content', 'collections', 'assets'].includes(route.section) && !route.member) {
        const list = currentList.hrefs; if (!list.length) return;
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

function Top({ s, onMenu }) {
  const c = s.ctx.context;
  const me = s.ctx.actor;
  const others = otherContextDrafts();
  return html`<header class="top">
    <button class="icon-btn menu" onClick=${onMenu} aria-label="Navigation"><${Icon} name="rows" /></button>
    <span class="proj">${s.ctx.project}</span>
    <span class="rev" title=${c.git ? `${c.branch ?? 'detached HEAD'} @ ${c.head ?? 'no commits'}${c.dirty ? ` · ${c.dirty} uncommitted changes` : ''}\n${c.root}` : c.root}>
      <${Icon} name="branch" size=${13} />${c.git ? c.branch ?? 'detached' : 'no Git'}${c.head && html`<span class="mono muted">${shortHash(c.head)}</span>`}${c.dirty > 0 && html`<span class="dirty">±${c.dirty}</span>`}</span>
    ${s.ctx.problems > 0 && html`<${Popover} label="Problems" trigger=${() => html`<button class="btn xs warn"><${Icon} name="warn" size=${12} />${s.ctx.problems}</button>`}><${Problems} /><//>`}
    ${others.length > 0 && html`<${Popover} label="Drafts from other checkouts" trigger=${() => html`<button class="btn xs ghost" title="Drafts saved for another branch or worktree">${others.length} other drafts</button>`}><${OtherDrafts} keys=${others} /><//>`}
    <${GlobalSearch} />
    <span class="me" title=${me}>${(me ?? '?').split(/\s+/).map((x) => x[0]).join('').slice(0, 2)}</span>
  </header>`;
}
function Problems() {
  const { data, error } = useQuery('problems', {});
  return html`<div class="problems"><${ErrorLine} error=${error} />${(data?.problems ?? []).map((p) => html`<div class="problem"><div class="mono small">${p.source}</div><div>${p.error}</div>${p.recovery && html`<div class="muted small">${p.recovery}</div>`}</div>`)}</div>`;
}
function OtherDrafts({ keys }) {
  const [, force] = useState(0);
  return html`<div class="problems">${keys.map((k) => { let v = null; try { v = JSON.parse(localStorage.getItem(k)); } catch {} const [, ctx, ...rest] = k.split(':'); return html`<div class="problem">
    <div class="mono small">${ctx} · ${rest.join(':')}</div><div class="draft-text">${v?.body ?? v?.comment ?? ''}</div>
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
      const [u, c, a] = await Promise.all(['units', 'collections', 'assets'].map((section) => call('catalog.search', { section, q: t, pageSize: 5 }).catch(() => ({ items: [] }))));
      if (!live) return;
      setRes([
        ...u.items.map((x) => ({ k: 'Content', label: x.name, sub: x.typeLabel, href: entityHref('unit', x.id), thumb: x.thumb })),
        ...c.items.map((x) => ({ k: 'Collection', label: x.name, sub: x.match?.member ? `Includes ${x.match.member.name}` : x.category ?? '', href: x.match?.member ? href({ section: 'collections', kind: 'c', id: x.id, member: x.match.member.id }) : entityHref('collection', x.id) })),
        ...a.items.map((x) => ({ k: 'Asset', label: x.path.split('/').pop(), sub: x.path.split('/').slice(0, -1).join('/'), href: entityHref('asset', x.id), thumb: x })),
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
  const units = useQuery('catalog.search', { section: 'units', pageSize: 1 }).data;
  const cols = useQuery('catalog.search', { section: 'collections', pageSize: 1 }).data;
  const assets = useQuery('catalog.search', { section: 'assets', pageSize: 1 }).data;
  const sel = selectedFacets(route);
  const only = (k, v) => sel[k]?.length === 1 && sel[k][0] === v && Object.keys(sel).length === 1;
  const none = Object.keys(sel).length === 0;
  const link = (section, k, v) => href({ section, query: k ? new URLSearchParams({ [`f.${k}`]: enc(v) }) : undefined });
  const Item = ({ to, active, label, n, depth = 0, strong }) => html`<a class=${`nav-i${active ? ' on' : ''}${strong ? ' strong' : ''}`} href=${to} style=${depth ? `padding-left:${12 + depth * 14}px` : ''} aria-current=${active ? 'page' : undefined}><span>${label}</span>${n != null && html`<span class="count">${n}</span>`}</a>`;
  return html`<nav class="side" aria-label="Catalog">
    <${Item} strong to=${link('content')} active=${route.section === 'content' && none} label="Content" n=${units?.all} />
    ${units?.facets.type.values.map((t) => html`<${Item} to=${link('content', 'type', t.value)} active=${route.section === 'content' && only('type', t.value)} label=${t.label} n=${t.count} depth=${1} />`)}
    <${Item} strong to=${link('collections')} active=${route.section === 'collections' && none} label="Collections" n=${cols?.all} />
    ${cols?.facets.cat.values.map((c) => html`<${Item} to=${link('collections', 'cat', c.value)} active=${route.section === 'collections' && only('cat', c.value)} label=${c.value.split('/').at(-1)} n=${c.count} depth=${c.value.split('/').length} />`)}
    <${Item} strong to=${link('assets')} active=${route.section === 'assets' && none} label="Assets" n=${assets?.all} />
    ${assets?.facets.kind.values.map((k) => html`<${Item} to=${link('assets', 'kind', k.value)} active=${route.section === 'assets' && only('kind', k.value)} label=${k.label} n=${k.count} depth=${1} />`)}
    <div class="nav-sep"></div>
    <${Item} strong to="#/notes" active=${route.section === 'notes'} label="Notes" n=${s.ctx.counts.openNotes} />
    <${Item} strong to="#/reviews" active=${route.section === 'reviews'} label="Reviews" n=${s.ctx.counts.waiting || null} />
    <${Item} strong to="#/organize" active=${route.section === 'organize'} label="Organize" />
  </nav>`;
}

boot().then(() => render(html`<${App} />`, document.getElementById('root')), (e) => { document.getElementById('root').textContent = `The catalog could not start: ${e.message}`; });
