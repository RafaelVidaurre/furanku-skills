import { html, useState, useRef, useEffect, useQuery, write, href, withQuery, entityHref, ago, Icon, Person, Verdict, VerdictBar, VERDICT, STATE_LABEL, useDraft, useDialog, useUnsaved, toast, newRequestId, ErrorLine, shortHash, CopyId, replace, isTyping, scopes, scopeOf, defaultScope, pixelArt } from './core.js';
import { MediaViewer, UnavailableViewer } from './viewers.js';
import { mediaKind } from './media-kinds.js';
import { PreviewHost } from './previews.js';
import { CompareRows } from './compare.js';
import { useActiveViewer, setSelectionProvider, setSelectHandler } from './controller.js';
import { NotesBlock } from './notes.js';
import { Markdown } from './markdown.js';

const VERDICTS = [['approved', 'check', 'Approve'], ['changes', 'x', 'Request changes'], ['rejected', 'stop', 'Reject']];
const PART_NOTE_MAX = 5000; // Matches PART_NOTE_MAX in the catalog's record schemas.

// Whole-with-exceptions when every part has a verdict; otherwise a part-only decision.
export function decisionFrom(verdicts, partIds) {
  const set = partIds.filter((p) => verdicts[p]);
  if (!set.length) return null;
  if (set.length === partIds.length) {
    const counts = {}; for (const p of set) counts[verdicts[p]] = (counts[verdicts[p]] ?? 0) + 1;
    const whole = Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] === 'approved' ? -1 : 1))[0][0];
    return { whole, exceptions: Object.fromEntries(set.filter((p) => verdicts[p] !== whole).map((p) => [p, verdicts[p]])) };
  }
  return { verdicts: Object.fromEntries(set.map((p) => [p, verdicts[p]])) };
}
// Part notes to send: only for parts the decision gives a verdict, trimmed, blanks dropped.
// A note on a part left without a verdict stays in the draft but is not recorded.
export function notesFor(dec, notes = {}, partIds) {
  if (!dec) return undefined;
  const kept = Object.fromEntries(Object.entries(notes).filter(([p, t]) => t?.trim() && partIds.includes(p) && (dec.whole || dec.verdicts[p])).map(([p, t]) => [p, t.trim()]));
  return Object.keys(kept).length ? kept : undefined;
}
function effectLine(dec, parts, name) {
  if (!dec) return '';
  const label = (p) => parts.find((x) => x.id === p)?.label ?? p;
  if (dec.whole) {
    const ex = Object.entries(dec.exceptions);
    return `${VERDICT[dec.whole]}: ${name}${ex.length ? ` except ${ex.map(([p, v]) => `${label(p)} (${VERDICT[v].toLowerCase()})`).join(', ')}` : ''}`;
  }
  return Object.entries(dec.verdicts).map(([p, v]) => `${label(p)}: ${VERDICT[v].toLowerCase()}`).join(' · ');
}

// Explicit submission. A single target can choose parts, several captioned views per part with a
// captured camera/viewer state, and the earlier submission it replaces.
export function SubmitDialog({ targets, parts, detail, onClose }) {
  useActiveViewer('stage', true);
  const [previewPart, setPreviewPart] = useState(null);
  const single = targets.length === 1 && parts?.length ? targets[0] : null;
  const name = single?.name ?? '';
  const defaultViews = () => (parts ?? []).filter((p) => p.asset || p.member || p.id === 'preview').map((p) => ({ part: p.id, caption: p.label }));
  const key = `submit:${targets.map((t) => `${t.kind}:${t.id}`).join(',')}`;
  const [draft, setDraft] = useDraft(key, null);
  const d = draft ?? { title: name, note: '', requestId: newRequestId(), parts: (parts ?? []).map((p) => p.id), views: defaultViews(), supersedes: '' };
  const set = (x) => setDraft({ ...d, ...x });
  const ref = useDialog(onClose);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const prior = useQuery('reviews.list', { state: 'all', pageSize: 50, target: single ? { kind: single.kind, id: single.id } : { kind: 'unit', id: '' } }, !!single);
  const visualParts = (parts ?? []).filter((p) => d.parts.includes(p.id) && (p.asset || p.member || p.id === 'preview'));
  const views = d.views.filter((v) => d.parts.includes(v.part));
  const togglePart = (id) => set({ parts: d.parts.includes(id) ? d.parts.filter((x) => x !== id) : [...d.parts, id] });
  const setViewAt = (i, x) => set({ views: views.map((v, j) => (j === i ? { ...v, ...x } : v)) });
  // Capture the live stage viewer's camera and state for a view of the same part.
  const previewLink = detail?.links?.find(l => l.asset.id === parts?.find(p => p.id === previewPart)?.asset) ?? detail?.links?.find(l => mediaKind(l.asset.kind)?.framing) ?? detail?.links?.[0];
  const shownPart = parts?.find(p => p.asset === previewLink?.asset.id)?.id;
  const live = (part) => { const v = window.catalogViewer?.viewers().find((x) => x.id === 'stage'); return v && v.status === 'ready' && v.camera && v.source?.part === part ? v : null; };
  // A viewer that can be framed reports its camera and the view state it can restore.
  const capture = (i) => { const v = live(views[i].part); if (v) setViewAt(i, { camera: v.camera, ...(v.view ? { state: v.view } : {}) }); };
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const items = single
        ? [{ target: { kind: single.kind, id: single.id }, parts: d.parts, ...(views.length ? { views: views.map((v) => ({ part: v.part, caption: v.caption, ...(v.camera ? { camera: v.camera } : {}), ...(v.state ? { state: v.state } : {}) })) } : {}) }]
        : targets.map(({ kind, id }) => ({ target: { kind, id } }));
      const r = await write('review.submit', { items, ...(d.title.trim() ? { title: d.title.trim() } : {}), ...(d.note.trim() ? { note: d.note.trim() } : {}), ...(d.supersedes ? { supersedes: d.supersedes } : {}) }, d.requestId);
      setDraft(null); onClose(); toast(`Submitted ${r.submission.ref}`);
      location.hash = href({ section: 'reviews', kind: 's', id: r.submission.id }).slice(1);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return html`<div class="scrim" onPointerDown=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="dialog composer submit" ref=${ref} role="dialog" aria-modal="true" aria-label="Submit for review">
      <header class="dialog-h"><h2>Submit for review</h2><button class="icon-btn" onClick=${onClose} aria-label="Close"><${Icon} name="x" /></button></header>
      ${previewLink && html`<div class="submit-preview"><div class="stage-view" data-viewer-root data-active="true"><${MediaViewer} key=${previewLink.asset.id} media=${previewLink.asset} viewerId="stage" source=${{ part: shownPart }} /></div><label class="preview-select">Preview <select aria-label="Preview part" value=${shownPart} onChange=${e => setPreviewPart(e.target.value)}>${parts.filter(p => p.asset).map(p => html`<option value=${p.id}>${p.label}</option>`)}</select></label></div>`}
      <div class="submit-form">
        <input value=${d.title} placeholder="Title" aria-label="Title" autofocus onInput=${(e) => set({ title: e.target.value })} />
        <textarea rows="2" placeholder="Note (Markdown)" aria-label="Note" value=${d.note} onInput=${(e) => set({ note: e.target.value })}></textarea>
        ${!single && html`<div class="muted small">${targets.length} items: ${targets.map((t) => t.name ?? t.id).join(', ')}</div>`}
        ${single && html`
          <div class="part-toggles" role="group" aria-label="Parts">${parts.map((p) => html`<label class=${`ptog${d.parts.includes(p.id) ? ' on' : ''}`}><input type="checkbox" checked=${d.parts.includes(p.id)} onChange=${() => togglePart(p.id)} />${p.label}</label>`)}</div>
          <div class="view-list" role="list" aria-label="Views">${views.map((v, i) => html`<div class="view-row" role="listitem" key=${i}>
            <select aria-label=${`View ${i + 1} part`} value=${v.part} onChange=${(e) => setViewAt(i, { part: e.target.value, camera: undefined, state: undefined })}>${visualParts.map((p) => html`<option value=${p.id}>${p.label}</option>`)}</select>
            <input value=${v.caption} aria-label=${`View ${i + 1} caption`} placeholder="Caption" onInput=${(e) => setViewAt(i, { caption: e.target.value })} />
            ${v.camera ? html`<button class="btn xs on" title="Captured camera and viewer state" onClick=${() => setViewAt(i, { camera: undefined, state: undefined })}><${Icon} name="check" size=${11} />View</button>`
              : html`<button class="btn xs" disabled=${!live(v.part)} title=${live(v.part) ? 'Use the current camera and viewer state' : 'Show this part in the viewer to capture its camera'} onClick=${() => capture(i)}>Use current view</button>`}
            <button class="icon-btn sm" aria-label=${`Remove view ${i + 1}`} onClick=${() => set({ views: views.filter((_, j) => j !== i) })}><${Icon} name="x" size=${11} /></button>
          </div>`)}
            ${visualParts.length > 0 && html`<button class="btn xs ghost add-view" onClick=${() => set({ views: [...views, { part: (live(visualParts[0].id) ? visualParts[0] : visualParts.find((p) => live(p.id)) ?? visualParts[0]).id, caption: `${name} · ${visualParts[0].label}` }] })}><${Icon} name="plus" size=${11} />View</button>`}
          </div>
          ${(prior.data?.items.length ?? 0) > 0 && html`<label class="replaces"><span class="muted small">Replaces</span><select aria-label="Replaces" value=${d.supersedes} onChange=${(e) => set({ supersedes: e.target.value })}><option value="">—</option>${prior.data.items.map((x) => html`<option value=${x.id}>${x.ref} · ${x.title}</option>`)}</select></label>`}`}
      </div>
      <${ErrorLine} error=${err} onRetry=${err && err.code !== 'context_changed' ? go : null} />
      <footer class="dialog-f"><span class="push"></span><button class="btn primary" disabled=${busy || (single && !d.parts.length)} onClick=${go}>Submit</button></footer>
    </div>
  </div>`;
}

// Recorded part notes, each labeled with its part and that part's verdict in the event.
function PartNotes({ e, label }) {
  const notes = Object.keys(e.verdicts).filter((p) => e.partNotes?.[p]).map((p) => [p, e.partNotes[p]]);
  return notes.length > 0 && html`<ul class="part-notes" aria-label="Part notes">${notes.map(([p, t]) => html`<li class="part-note" key=${p}>
    <span class=${`pv ${e.verdicts[p]}`}><${Icon} name=${e.verdicts[p] === 'approved' ? 'check' : e.verdicts[p] === 'changes' ? 'x' : 'stop'} size=${11} />${label(p)}</span><span class="part-note-t">${t}</span></li>`)}</ul>`;
}

// Part verdict editor shared by the catalog composer and the submission view.
// A part with a verdict can carry its own note; the note is kept in the draft if the verdict is cleared.
// A note field starts open when it has text; its toggle then overrides that, keeping the text.
function PartVerdicts({ parts, verdicts, onChange, notes = {}, onNotes, current, onSelect }) {
  const setPart = (p, v) => { const next = { ...verdicts }; if (v) next[p] = v; else delete next[p]; onChange(next); };
  const [opened, setOpened] = useState({});
  const setNote = (p, t) => onNotes({ ...notes, [p]: t });
  return html`<div class="comp-parts" role="list">
    ${parts.map((p) => { const showNote = !!verdicts[p.id] && (opened[p.id] ?? !!notes[p.id]?.trim()); return html`<div class=${`comp-row${verdicts[p.id] ? ' set' : ''}`} role="listitem" key=${p.id}>
      <button class="pl part-select" aria-label=${`View ${p.label}`} onClick=${() => onSelect(p.id)}>${p.label}${p.changed && html`<span class="delta-inline" title="Changed since its verdict"><${Icon} name="delta" size=${10} /></span>`}</button>
      <span class="cur"><${Verdict} v=${current?.(p) ?? p.verdict} short /></span>
      <span class="seg" role="radiogroup" aria-label=${p.label}>
        <button role="radio" aria-checked=${!verdicts[p.id]} title="No verdict" class=${`seg-b none${!verdicts[p.id] ? ' on' : ''}`} onClick=${() => setPart(p.id, null)}>—</button>
        ${VERDICTS.map(([v, ic, t]) => html`<button role="radio" aria-checked=${verdicts[p.id] === v} title=${t} aria-label=${`${t}: ${p.label}`} class=${`seg-b ${v}${verdicts[p.id] === v ? ' on' : ''}`} onClick=${() => setPart(p.id, v)}><${Icon} name=${ic} size=${12} /></button>`)}
      </span>
      ${onNotes && html`<button class=${`icon-btn sm note-tog${notes[p.id]?.trim() ? ' has' : ''}`} disabled=${!verdicts[p.id]} aria-expanded=${!!showNote} aria-label=${`Note on ${p.label}`} title=${verdicts[p.id] ? `Note on ${p.label}` : 'Choose a verdict to add a note on this part'} onClick=${() => setOpened({ ...opened, [p.id]: !showNote })}><${Icon} name="note" size=${12} /></button>`}
      ${onNotes && showNote && html`<textarea class="part-note-in" rows="2" maxLength=${PART_NOTE_MAX} placeholder=${`Note on ${p.label}`} aria-label=${`Note on ${p.label}`} value=${notes[p.id] ?? ''} onInput=${(e) => setNote(p.id, e.target.value)}></textarea>`}
    </div>`; })}
  </div>`;
}
function AllParts({ parts, onChange }) {
  return html`<div class="comp-all"><span class="muted small">All parts</span>
    ${VERDICTS.map(([v, ic, t]) => html`<button class="btn sm" onClick=${() => onChange(Object.fromEntries(parts.map((p) => [p.id, v])))}><${Icon} name=${ic} size=${12} />${t}</button>`)}</div>`;
}

// ---------- Review queue ----------
export function ReviewsView({ route }) {
  const [creating, setCreating] = useState(false);
  const st = route.query.get('state') ?? 'waiting';
  const q = route.query.get('q') ?? '';
  const { data, error, reload } = useQuery('reviews.list', { state: st, q, pageSize: 100 });
  const set = (x) => replace(withQuery(route, x));
  return html`<div class="page">
    <header class="browse-head"><div><span class="eyebrow">Decisions & feedback</span><h1>Reviews</h1></div><button class="btn primary" onClick=${() => setCreating(true)}>New review</button></header>
    ${creating && html`<${NewReview} onClose=${() => setCreating(false)} />`}
    <div class="list-bar">
      <span class="seg" role="radiogroup" aria-label="Review state">${[['waiting', 'Waiting'], ['changes', 'Changes'], ['rejected', 'Rejected'], ['approved', 'Approved'], ['all', 'All']].map(([v, l]) => html`<button role="radio" aria-checked=${st === v} class=${`seg-b${st === v ? ' on' : ''}`} onClick=${() => set({ state: v === 'waiting' ? null : v })}>${l}<span class="count">${data?.counts[v] ?? ''}</span></button>`)}</span>
      <input class="search sm" type="search" placeholder="Filter" aria-label="Filter submissions" value=${q} onInput=${(e) => set({ q: e.target.value })} data-list-search />
    </div>
    <${ErrorLine} error=${error} onRetry=${reload} />
    <div class="feed">${data?.items.map((s) => html`<a class="sub-row" key=${s.id} href=${href({ section: 'reviews', kind: 's', id: s.id, query: new URLSearchParams(route.query) })}>
      <span class="sub-main"><span class="row-name">${s.title}</span><span class="row-sub"><span class="mono">${s.ref}</span> · <${Person} by=${s.by} /> · ${ago(s.at)}${s.context.dirty ? ' · uncommitted work' : ''}</span></span>
      <span class="sub-counts">${s.counts.waiting ? html`<span class="cnt wait">${s.counts.waiting} waiting</span>` : ''}${s.counts.changes ? html`<span class="cnt changes">${s.counts.changes} changes</span>` : ''}${s.counts.rejected ? html`<span class="cnt rejected">${s.counts.rejected} rejected</span>` : ''}<span class="cnt">${s.counts.approved}/${s.counts.items}</span></span>
    </a>`)}</div>
  </div>`;
}

// ---------- Submission: items, evidence views, part verdicts, observations ----------
export function SubmissionView({ route }) {
  const subId = route.id;
  const { data: sub, error, reload } = useQuery('review.get', { submission: subId });
  // Nothing named: the first item and view. A named item or view that does not exist is an error.
  const itemId = route.member ?? sub?.items[0]?.id;
  const item = sub?.items.find((i) => i.id === itemId);
  const viewId = route.query.get('view');
  const view = item && (viewId ? item.views.find((v) => v.id === viewId) : item.views.find(v => item.parts.some(p => p.id === v.part && p.reviewable !== false)) ?? item.views[0]);
  const unavailable = sub && !item ? `Item ${route.member} is not in this submission` : item && viewId && !view ? `View ${viewId} is not in this item` : null;
  const goItem = (id, push = true) => { const r = { section: 'reviews', kind: 's', id: subId, member: id, query: new URLSearchParams([...route.query].filter(([k]) => ['state', 'q'].includes(k))) }; push ? (location.hash = href(r).slice(1)) : replace(r); };
  const setView = (id) => replace(withQuery(route, { view: id }));
  setSelectionProvider(() => ({ kind: 'submission', submission: subId, item: itemId, view: view?.id ?? viewId ?? null, part: view?.part ?? null, loading: !sub && !error, unavailable: !!(unavailable || error), error: unavailable ?? error?.message ?? null, evidence: view && item ? leafOf(item, view) : null, before: view?.before ? { label: view.before.label, path: view.before.path, sha256: view.before.sha256, status: view.before.status, from: view.before.from } : null }));
  setSelectHandler((s) => {
    if (s.item && !sub?.items.some((i) => i.id === s.item)) return { error: 'no such item', code: 'not_found' };
    if (s.item) goItem(s.item, false);
    if (s.view) { const it = sub.items.find((i) => i.id === (s.item ?? itemId)); if (!it?.views.some((v) => v.id === s.view)) return { error: 'no such view', code: 'not_found' }; setTimeout(() => setView(s.view), 0); }
    return { ok: true };
  });
  useEffect(() => () => { setSelectionProvider(() => null); setSelectHandler(null); }, []);
  if (error) return html`<div class="detail"><${ErrorLine} error=${error} onRetry=${reload} /></div>`;
  if (!sub) return html`<div class="detail"><div class="viewer-msg"><span class="spin"></span></div></div>`;
  const idx = sub.items.findIndex((i) => i.id === itemId);
  return html`<div class="submission">
    <aside class="sub-items" aria-label="Items">
      <div class="sub-head">
        <h1>${sub.title}</h1>
        <div class="row-sub"><${CopyId} id=${sub.id} label=${sub.ref} /> · <${Person} by=${sub.by} /> · ${ago(sub.at)}</div>
        <div class="row-sub">${sub.context.branch ?? 'detached'} @ <span class="mono">${shortHash(sub.context.head)}</span>${sub.context.dirty ? ` · ${sub.context.dirty} uncommitted` : ''}</div>
        ${sub.supersedes && html`<div class="row-sub">Replaces <a href=${href({ section: 'reviews', kind: 's', id: sub.supersedes })}>${sub.supersedes.slice(-6).toUpperCase()}</a></div>`}
        ${sub.supersededBy.length > 0 && html`<div class="row-sub">Replaced by ${sub.supersededBy.map((x) => html`<a href=${href({ section: 'reviews', kind: 's', id: x.id })}>${x.ref}</a> `)}</div>`}
        <div class="sub-counts">${sub.counts.waiting ? html`<span class="cnt wait">${sub.counts.waiting} waiting</span>` : ''}<span class="cnt">${sub.counts.approved}/${sub.counts.items} approved</span></div>
      </div>
      <div class="rows" role="list">${sub.items.map((it) => html`<a key=${it.id} role="listitem" class=${`row${it.id === itemId ? ' sel' : ''}`} aria-current=${it.id === itemId ? 'true' : undefined} href=${href({ section: 'reviews', kind: 's', id: subId, member: it.id })}>
        <span class="row-main"><span class="row-name">${it.title}</span><span class="row-sub">${!it.target ? 'Work' : it.target.kind === 'collection' ? 'Collection' : scopeOf(it.targetScope)?.label ?? 'Entry'} · ${STATE_LABEL[it.state]}${it.target && !it.targetExists ? ' · removed from catalog' : ''}</span></span><${VerdictBar} parts=${it.parts.filter(p => p.reviewable !== false)} /></a>`)}</div>
    </aside>
    ${item && html`<${ItemView} key=${item.id} sub=${sub} item=${item} view=${view} viewError=${unavailable} setView=${setView} idx=${idx} goItem=${goItem} />`}
    ${!item && html`<div class="item-view"><div class="errline" role="alert"><${Icon} name="warn" size=${13} /><span>${unavailable}</span></div></div>`}
  </div>`;
}

// A capture: evidence rendered outside the catalog, its own part. A pair shows its two files compared.
const isCapture = (part) => !!part && part.id.startsWith('capture:');
const isPair = (item, view) => !!view && !view.leaf && !!item.parts.find((x) => x.id === view.part)?.pairLabels;

function leafOf(item, view) {
  const p = item.parts.find((x) => x.id === view.part);
  if (!p) return null;
  if (view.part === 'preview') return { part: 'preview', module: item.preview?.module, leaves: p.leaves.map((l) => ({ key: l.key, sha256: l.sha256, status: l.status })) };
  // Both files of a pair, by digest: what a capture of the comparison is checked against.
  if (isPair(item, view)) return { part: p.id, renderer: p.renderer ?? null, pair: p.leaves.map((l) => ({ leaf: l.key, kind: l.kind, path: l.path, sha256: l.sha256, status: l.status, error: l.error ?? null })) };
  const l = view.leaf ? p.leaves.find((x) => x.key === view.leaf) : (p.leaves.find((x) => x.url) ?? p.leaves[0]);
  return l ? { part: p.id, leaf: l.key, kind: l.kind, path: l.path, sha256: l.sha256, status: l.status, error: l.error ?? null, storage: l.storage } : null;
}

// Frozen evidence for one view: its own bytes, declared camera and viewer state.
function EvidenceStage({ sub, item, view, viewError }) {
  const p = view && item.parts.find((x) => x.id === view.part);
  useActiveViewer('stage', true);
  if (viewError) return html`<${UnavailableViewer} viewerId="stage" source=${{ submission: sub.id, item: item.id }} message=${viewError} />`;
  if (!view || !p) return html`<div class="viewer"><div class="viewer-msg muted">No preview for this view</div></div>`;
  const src = { submission: sub.id, item: item.id, view: view.id, ...leafOf(item, view) };
  if (view.part === 'preview') {
    // The project preview module renders the frozen member and base bytes with the frozen config.
    const pv = item.preview ?? {};
    const asset = (l) => ({ url: l.url, kind: l.kind, sha256: l.sha256, state: l.status === 'ok' ? 'ok' : l.status, error: l.error });
    const members = p.leaves.filter((l) => l.key !== 'base').map((l) => ({ unit: l.unit, part: l.part, role: l.part.split(':')[0], asset: asset(l) }));
    const baseLeaf = p.leaves.find((l) => l.key === 'base');
    return html`<${PreviewHost} key=${view.id} module=${pv.module} moduleUrl=${pv.moduleUrl} moduleError=${pv.moduleError} members=${members} base=${baseLeaf ? asset(baseLeaf) : null} config=${pv.config ?? {}} label=${view.caption} viewerId="stage" source=${src} initialCamera=${view.camera} initialState=${view.state} />`;
  }
  if (isPair(item, view)) {
    const [before, after] = p.leaves;
    const row = { key: view.id, label: view.caption, a: before, b: after, identical: false };
    return html`<div class="stage-cmp capture-pair"><${CompareRows} key=${view.id} rows=${[row]} labels=${p.pairLabels} viewerId="stage" source=${src} /></div>`;
  }
  const l = view.leaf ? p.leaves.find((x) => x.key === view.leaf) : (p.leaves.find((x) => x.url) ?? p.leaves[0]);
  if (!l) return html`<${UnavailableViewer} viewerId="stage" source=${src} message=${`Preview ${view.leaf ?? ''} is not recorded for this view`} />`;
  if (view.before) {
    // The submitter chose a before side for this view: show both, each resolved independently.
    const b = view.before;
    const row = { key: view.id, label: view.caption, a: b, b: l, identical: b.status === 'ok' && l.status === 'ok' && b.sha256 === l.sha256 };
    return html`<div class="stage-cmp"><${CompareRows} key=${view.id} rows=${[row]} labels=${[b.label, view.afterLabel]} viewerId="stage" source=${{ ...src, before: { path: b.path, sha256: b.sha256 } }} camera=${view.camera} state=${view.state} /></div>`;
  }
  if (l.status !== 'ok') return html`<${UnavailableViewer} viewerId="stage" source=${src} asset=${{ kind: l.kind }} message=${`${l.status === 'corrupt' ? 'Saved file has changed: ' : 'Preview unavailable: '}${l.error}`} />`;
  // Each view is its own viewer: its camera and state are those the submitter declared.
  return html`<${MediaViewer} key=${view.id} media=${{ kind: l.kind, url: l.url, path: l.path, sha256: l.sha256 }} viewerId="stage" source=${src} initialCamera=${view.camera} initialState=${view.state} label=${view.caption} />`;
}

// Horizontal touch swipe on the caption bar changes views; it never starts on a viewer surface.
function useSwipe(onSwipe) {
  const start = useRef(null);
  return {
    onPointerDown: (e) => { if (e.pointerType === 'touch') start.current = { x: e.clientX, y: e.clientY, t: e.timeStamp }; },
    onPointerUp: (e) => {
      const s0 = start.current; start.current = null;
      if (!s0 || e.pointerType !== 'touch') return;
      const dx = e.clientX - s0.x, dy = e.clientY - s0.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > 2 * Math.abs(dy) && e.timeStamp - s0.t < 800) onSwipe(dx < 0 ? 1 : -1);
    },
    onPointerCancel: () => { start.current = null; },
  };
}

function ItemView({ sub, item, view, viewError, setView, idx, goItem }) {
  const [draft, setDraft] = useDraft(`item:${sub.id}:${item.id}`, null);
  const d = draft ?? { verdicts: {}, notes: {}, comment: '', requestId: newRequestId() };
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const saving = useRef(false);
  const stageRef = useRef(null);
  const attributesRef = useRef(null);
  const update = (x) => setDraft({ ...d, ...x });
  const parts = item.parts.filter(p => p.reviewable !== false);
  const dec = decisionFrom(d.verdicts, parts.map((p) => p.id));
  useUnsaved(`item:${item.id}`, !!draft);
  const attrPart = parts.find((x) => x.id === 'attributes');
  const nextWaiting = () => sub.items.slice(idx + 1).concat(sub.items.slice(0, idx)).find((i) => i.summary.undecided > 0 && i.id !== item.id);
  // One activation targets the item shown at activation time; the item id is captured here.
  const save = async (decision = dec, comment = d.comment, requestId = d.requestId, partNotes = notesFor(decision, d.notes, parts.map((p) => p.id))) => {
    if (!decision || saving.current) return;
    saving.current = true; setBusy(true); setErr(null);
    const firstVerdict = item.summary.undecided === item.summary.total;
    try {
      await write('review.decide', { submission: sub.id, item: item.id, ...decision, comment: comment || undefined, partNotes }, requestId);
      setDraft(null);
      toast(effectLine(decision, parts, item.title));
      const next = firstVerdict && nextWaiting();
      if (next) goItem(next.id);
    } catch (e) { setErr(e); } finally { saving.current = false; setBusy(false); }
  };
  useEffect(() => {
    const key = (e) => {
      if (e.defaultPrevented || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.scrim')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        // Read the current view from the URL: rapid presses must not reuse a stale selection.
        const cur = new URLSearchParams(location.hash.split('?')[1] ?? '').get('view');
        const i = Math.max(0, primaryViews.findIndex((v) => v.id === cur));
        const n = primaryViews[i + (e.key === 'ArrowRight' ? 1 : -1)];
        if (n) { location.replace(href({ section: 'reviews', kind: 's', id: sub.id, member: item.id, query: new URLSearchParams([...new URLSearchParams(location.hash.split('?')[1] ?? '')].filter(([k]) => k !== 'view').concat([['view', n.id]])) })); e.preventDefault(); }
      }
      if (e.key === ']' && sub.items[idx + 1]) goItem(sub.items[idx + 1].id);
      if (e.key === '[' && idx > 0) goItem(sub.items[idx - 1].id);
      if (e.key === 'a' && !e.repeat) { e.preventDefault(); save({ whole: 'approved', exceptions: {} }, d.comment, newRequestId()); }
    };
    addEventListener('keydown', key); return () => removeEventListener('keydown', key);
  });
  const targetHref = !item.target ? null : item.target.kind === 'unit' ? entityHref('unit', item.target.id) : entityHref('collection', item.target.id);
  const primaryViews = item.views.filter(v => parts.some(p => p.id === v.part));
  // Content follows its type's display policy; a capture is a renderer's own pixels and keeps smooth scaling.
  const pixelView = !!view && !isCapture(item.parts.find((p) => p.id === view.part)) && pixelArt(item.targetType);
  const references = item.views.filter(v => !parts.some(p => p.id === v.part));
  const vIdx = primaryViews.indexOf(view);
  const stepView = (dir) => { const n = primaryViews[vIdx + dir]; if (n) setView(n.id); };
  const swipe = useSwipe(stepView);
  // Historical default captions include the item's name. Keep authored view names (including
  // multiple views of one part), while using the part label for those default captions.
  const viewLabel = (v) => {
    const part = item.parts.find(p => p.id === v.part);
    return v.caption === `${item.title} · ${part?.label}` ? part.label : v.caption;
  };
  const selectPart = (id) => {
    const evidence = item.views.find(v => v.part === id);
    const element = id === 'attributes' ? attributesRef.current : stageRef.current;
    if (id === 'attributes' && element) element.open = true;
    else if (evidence) setView(view?.part === id ? view.id : evidence.id);
    if (element) { element.scrollIntoView({ block: 'start', inline: 'nearest' }); element.focus({ preventScroll: true }); }
  };
  return html`<div class="item-view">
    <header class="d-head">
      <div class="d-title"><h1>${item.title}</h1>${!item.target ? null : item.targetExists ? html`<a class="small" href=${targetHref}>${item.target.id}</a>` : html`<span class="small c-bad">${item.target.id} is no longer in this checkout</span>`}
        <span class="push muted small">${idx + 1} / ${sub.items.length}</span>
        <button class="icon-btn sm" disabled=${idx === 0} onClick=${() => goItem(sub.items[idx - 1].id)} aria-label="Previous item" title="Previous item ([)"><${Icon} name="back" size=${12} /></button>
        <button class="icon-btn sm" disabled=${idx === sub.items.length - 1} onClick=${() => goItem(sub.items[idx + 1].id)} aria-label="Next item" title="Next item (])"><${Icon} name="chev" size=${12} /></button>
      </div>
    </header>
    <div class="d-body">
      <div class="d-main">
        ${item.text && html`<p class="item-text">${item.text}</p>`}
        ${item.views.length > 0 && html`<div class="stage">
          <div ref=${stageRef} tabindex="-1" aria-label="Preview" class=${`stage-view${view?.before || isPair(item, view) ? ' compare-view' : ''}${pixelView ? ' pixel-art' : ''}`} data-viewer-root data-active="true"><${EvidenceStage} sub=${sub} item=${item} view=${view} viewError=${viewError} /></div>
          ${primaryViews.length > 0 && html`<div class="strip" role="tablist" aria-label="Views">${primaryViews.map((v) => html`<button role="tab" aria-selected=${v === view} tabindex=${v === view ? 0 : -1} class=${`tile view-tile${v === view ? ' on' : ''}`} onClick=${() => setView(v.id)}>${v.before && html`<span class="view-cmp" title=${`${v.before.label} / ${v.afterLabel} comparison`}><${Icon} name="split" size=${11} /></span>`}${viewLabel(v)}</button>`)}</div>`}
          ${view && html`<div class="asset-line caption-bar" ...${swipe}>
            ${vIdx >= 0 && primaryViews.length > 1 && html`<button class="icon-btn sm" disabled=${vIdx <= 0} onClick=${() => stepView(-1)} aria-label="Previous view"><${Icon} name="back" size=${12} /></button><span class="muted small">${vIdx + 1}/${primaryViews.length}</span><button class="icon-btn sm" disabled=${vIdx >= primaryViews.length - 1} onClick=${() => stepView(1)} aria-label="Next view"><${Icon} name="chev" size=${12} /></button>`}
            <span class="caption">${viewLabel(view)}</span>
            ${(() => { const r = item.parts.find((x) => x.id === view.part)?.renderer; return r && html`<span class="renderer-badge" title="Rendered outside the catalog: these are the renderer's own pixels">${r}</span>`; })()}
            ${view.before?.from && html`<span class="push muted small">${view.before.label} from <a href=${href({ section: 'reviews', kind: 's', id: view.before.from.submission, member: view.before.from.item })}>${view.before.from.submission.slice(-6).toUpperCase()}</a></span>`}</div>`}
        </div>`}
        ${sub.note && html`<section class="block submission-note"><${Markdown} text=${sub.note} label="Submission note" /></section>`}
        ${references.length > 0 && html`<details class="disclosure"><summary>Supporting views (${references.length})</summary><div class="reference-links">${references.map(v => html`<button class="btn sm" onClick=${() => setView(v.id)}>${v.caption.replace(/Evidence[ ·:]*/gi, '')}</button>`)}</div></details>`}
        ${attrPart && html`<details ref=${attributesRef} tabindex="-1" class="disclosure"><summary>Properties</summary><${FrozenAttributes} part=${attrPart} /></details>`}
      </div>
      <div class="d-side">
        <section class="block" aria-label="Decision">
          <header class="block-h"><h3>Decision</h3><${VerdictBar} parts=${parts} /><span class="muted small">${STATE_LABEL[item.state]}</span></header>
          <${AllParts} parts=${parts} onChange=${(v) => update({ verdicts: v })} />
          <${PartVerdicts} onSelect=${selectPart} parts=${parts} verdicts=${d.verdicts} onChange=${(v) => update({ verdicts: v })} notes=${d.notes ?? {}} onNotes=${(n) => update({ notes: n })} />
          <textarea class="comp-comment" placeholder="Comment on the whole review" aria-label="Comment" rows="2" value=${d.comment} onInput=${(e) => update({ comment: e.target.value })}></textarea>
          <${ErrorLine} error=${err} onRetry=${err && err.code !== 'context_changed' ? () => save() : null} />
          <div class="decide-f"><span class="scope-line">${effectLine(dec, parts, item.title)}</span>
            ${draft && html`<button class="btn ghost sm" onClick=${() => setDraft(null)}>Discard</button>`}
            <button class="btn primary sm" disabled=${!dec || busy} onClick=${() => save()}>Save</button></div>
        </section>
        <section class="block" aria-label="Verdicts">
          <header class="block-h"><h3>Verdicts</h3><span class="badge">${sub.events.filter((e) => e.item === item.id).length}</span></header>
          ${sub.events.filter(e => e.item === item.id && Object.keys(e.verdicts).some(id => parts.some(p => p.id === id))).map((e) => html`<div class="ritem" key=${e.id}><div class="ritem-h"><${Person} by=${e.by} /><span class="muted small">${ago(e.at)}</span><span class="scope">${e.scope === 'whole' ? 'Whole' : 'Parts'}</span></div>
            <div class="pvs">${Object.entries(e.verdicts).filter(([pid]) => parts.some(p => p.id === pid)).map(([pid, v]) => html`<span class=${`pv ${v}`}><${Icon} name=${v === 'approved' ? 'check' : v === 'changes' ? 'x' : 'stop'} size=${11} />${parts.find((x) => x.id === pid)?.label ?? pid}</span>`)}</div>
            <${PartNotes} e=${{ ...e, verdicts: Object.fromEntries(Object.entries(e.verdicts).filter(([id]) => parts.some(p => p.id === id))) }} label=${(pid) => parts.find((x) => x.id === pid)?.label ?? pid} />${e.comment && html`<p class="ritem-c">${e.comment}</p>`}</div>`)}
        </section>
        <${NotesBlock} target=${{ kind: 'submission', id: sub.id, item: item.id }} notes=${sub.observations.filter((n) => n.target.item === item.id || !n.target.item)} parts=${parts} />
      </div>
    </div>
  </div>`;
}

function FrozenAttributes({ part }) {
  const l = part.leaves[0];
  if (!l?.attrs) return null;
  return html`<dl class="attrs" aria-label="Submitted attributes">${Object.entries(l.attrs).map(([k, v]) => html`<div><dt>${k}</dt><dd>${typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></div>`)}</dl>`;
}

function NewReview({ onClose }) {
  const [q, setQ] = useState('');
  const [section, setSection] = useState(defaultScope);
  const [selected, setSelected] = useState([]);
  const [composing, setComposing] = useState(false);
  const { data, error } = useQuery('catalog.search', { section: section === 'collections' ? 'collections' : 'units', scope: section === 'collections' ? undefined : section, q, pageSize: 100 });
  const one = selected.length === 1 ? selected[0] : null;
  const detail = useQuery(one?.kind === 'collection' ? 'collection.get' : 'unit.get', { id: one?.id ?? '' }, !!one);
  const ref = useDialog(onClose);
  if (composing) return html`<${SubmitDialog} targets=${selected} parts=${one ? detail.data?.review.parts.filter(p => p.reviewable !== false) : undefined} detail=${one ? detail.data : null} onClose=${onClose} />`;
  const key = u => `${u.kind}:${u.id}`;
  const targets = data?.items.map(u => ({ kind: section === 'collections' ? 'collection' : 'unit', id: u.id, name: u.name, label: u.typeLabel ?? 'Collection' })) ?? [];
  return html`<div class="scrim"><div class="dialog composer" ref=${ref} role="dialog" aria-modal="true" aria-label="Choose items for review">
    <header class="dialog-h"><h2>Choose items</h2><button class="icon-btn" onClick=${onClose} aria-label="Close"><${Icon} name="x" /></button></header>
    <div class="submit-form"><label>From <select aria-label="Review source" value=${section} onChange=${e => setSection(e.target.value)}>${scopes().map((s) => html`<option value=${s.id}>${s.label}</option>`)}<option value="collections">Collections</option></select></label><input type="search" aria-label="Find items to review" placeholder="Search items" value=${q} onInput=${e => setQ(e.target.value)} />
    <${ErrorLine} error=${error ?? detail.error} /><div class="picker-list tall">${targets.map(u => html`<label class="picker-item check"><input type="checkbox" checked=${selected.some(x => key(x) === key(u))} onChange=${() => setSelected(selected.some(x => key(x) === key(u)) ? selected.filter(x => key(x) !== key(u)) : [...selected, u])} />${u.name}<span class="count">${u.label}</span></label>`)}</div>${data?.total > data?.items.length && html`<p class="muted">Showing the first ${data.items.length} results. Search to find more.</p>`}</div>
    <footer class="dialog-f"><span class="muted">${selected.length} selected</span><button class="btn primary push" disabled=${!selected.length || (one && (!detail.data || detail.loading || detail.error))} onClick=${() => setComposing(true)}>Continue</button></footer>
  </div></div>`;
}
