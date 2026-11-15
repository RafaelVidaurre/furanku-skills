import { html, useState, useQuery, write, ago, Icon, Person, Popover, useDraft, useUnsaved, href, withQuery, replace, entityHref, Thumb, toast, newRequestId, ErrorLine, baseName } from './core.js';

const same = (a, b) => a.kind === b.kind && a.id === b.id;
const targetHref = (t) => (t.kind === 'submission' ? href({ section: 'reviews', kind: 's', id: t.id, member: t.item }) : entityHref(t.kind, t.id, t.part && t.kind === 'unit' ? { part: t.part } : {}));

// Notes on a target (and its parts), plus related notes (e.g. on linked assets). No replies.
export function NotesBlock({ target, notes, parts = [] }) {
  const open = notes.filter((n) => !n.resolved);
  const done = notes.filter((n) => n.resolved);
  return html`<section class="block" aria-label="Notes">
    <header class="block-h"><h3>Notes</h3>${open.length > 0 && html`<span class="badge">${open.length}</span>`}</header>
    <${NoteComposer} target=${target} parts=${parts} />
    <div class="notes">${open.map((n) => html`<${NoteItem} n=${n} key=${n.id} ctx=${target} />`)}</div>
    ${done.length > 0 && html`<details class="history"><summary>Dealt with · ${done.length}</summary>
      <div class="notes">${done.map((n) => html`<${NoteItem} n=${n} key=${n.id} ctx=${target} />`)}</div></details>`}
  </section>`;
}

function NoteComposer({ target, parts }) {
  const [d, setD] = useDraft(`note:${target.kind}:${target.id}:${target.item ?? ''}`, null);
  const draft = d ?? { body: '', part: '', requestId: newRequestId() };
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useUnsaved(`note:${target.id}`, !!d?.body);
  const add = async () => {
    if (!draft.body.trim()) return;
    setBusy(true); setErr(null);
    try { await write('note.create', { target: { ...target, ...(draft.part ? { part: draft.part } : {}) }, body: draft.body }, draft.requestId); setD(null); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return html`<div class=${`note-new${draft.body ? ' active' : ''}`}>
    <textarea rows=${draft.body ? 3 : 1} placeholder="Add a note" aria-label="Add a note" value=${draft.body}
      onInput=${(e) => setD({ ...draft, body: e.target.value })} onKeyDown=${(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add(); }}></textarea>
    <${ErrorLine} error=${err} onRetry=${err && err.code !== 'context_changed' ? add : null} />
    ${draft.body && html`<div class="note-new-f">
      ${parts.length > 0 && html`<select aria-label="Part" value=${draft.part} onChange=${(e) => setD({ ...draft, part: e.target.value })}>
        <option value="">${target.kind === 'submission' ? 'Item' : 'Whole'}</option>${parts.map((p) => html`<option value=${p.id}>${p.label}</option>`)}</select>`}
      <button class="btn ghost sm push" onClick=${() => setD(null)}>Discard</button>
      <button class="btn primary sm" disabled=${busy} onClick=${add}>Add</button>
    </div>`}
  </div>`;
}

export function NoteItem({ n, ctx, showTarget }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(n.body);
  const [confirmDel, setConfirmDel] = useState(false);
  const [err, setErr] = useState(null);
  const t = n.target;
  const foreign = ctx && !same(t, ctx);
  const act = async (action, input) => { setErr(null); try { await write(action, { id: n.id, expectedRevision: n.revision, ...input }); return true; } catch (e) { setErr(e); return false; } };
  const save = async () => { if (await act('note.edit', { body })) setEditing(false); };
  return html`<article class=${`note${n.resolved ? ' resolved' : ''}`} aria-label="Note">
    <div class="note-h">
      ${showTarget && html`<a class="note-target" href=${targetHref(t)}>
        ${n.thumb ? html`<${Thumb} asset=${n.thumb} size=${22} />` : html`<span class="kind-chip">${{ collection: 'Collection', submission: 'Review', unit: 'Content', asset: 'Asset' }[t.kind]}</span>`}
        ${n.targetName}</a>`}
      ${!n.targetExists && html`<span class="chip c-bad" title=${`${t.kind} ${t.id}`}>Target missing</span>`}
      ${foreign && !showTarget && html`<a class="chip" href=${targetHref(t)} title=${t.id}>${baseName(t.id)}</a>`}
      ${n.partLabel && html`<span class="chip">${n.partLabel}</span>`}
      <${Person} by=${n.by} /><span class="muted small" title=${n.at}>${ago(n.at)}${n.editedAt ? ' · edited' : ''}</span>
      <span class="note-actions push">
        ${!n.resolved && html`<${Popover} align="right" label="Mark dealt with" trigger=${() => html`<button class="btn xs" title="Mark dealt with"><${Icon} name="check" size=${12} />Dealt with</button>`}>
          ${(close) => html`<${Resolve} n=${n} close=${close} />`}<//>`}
        ${n.resolved && html`<button class="btn xs ghost" onClick=${() => act('note.reopen', {})}>Reopen</button>`}
        <button class="icon-btn sm" title="Edit" aria-label="Edit note" onClick=${() => { setBody(n.body); setEditing(!editing); }}><${Icon} name="edit" size=${12} /></button>
        ${confirmDel
          ? html`<button class="btn xs danger" autofocus onBlur=${() => setConfirmDel(false)} onClick=${() => act('note.delete', {}).then((ok) => ok && toast('Note cleared'))}>Clear</button>`
          : html`<button class="icon-btn sm" title="Clear note" aria-label="Clear note" onClick=${() => setConfirmDel(true)}><${Icon} name="trash" size=${12} /></button>`}
      </span>
    </div>
    ${editing
      ? html`<div class="note-edit"><textarea rows="3" value=${body} onInput=${(e) => setBody(e.target.value)} aria-label="Edit note"
          onKeyDown=${(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setEditing(false); } }}></textarea>
          <div class="note-new-f"><button class="btn ghost sm push" onClick=${() => setEditing(false)}>Cancel</button><button class="btn primary sm" onClick=${save}>Save</button></div></div>`
      : html`<p class="note-b">${n.body}</p>`}
    <${ErrorLine} error=${err} />
    ${n.resolved && html`<p class="note-res"><${Icon} name="check" size=${11} /> <${Person} by=${n.resolved.by} /> · ${ago(n.resolved.at)}${n.resolved.explanation && html` — ${n.resolved.explanation}`}</p>`}
  </article>`;
}

function Resolve({ n, close }) {
  const [why, setWhy] = useState('');
  const [err, setErr] = useState(null);
  const go = async () => { try { await write('note.resolve', { id: n.id, explanation: why || undefined, expectedRevision: n.revision }); close(); } catch (e) { setErr(e); } };
  return html`<div class="picker resolve">
    <input value=${why} placeholder="Explanation (optional)" aria-label="Explanation" onInput=${(e) => setWhy(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && go()} />
    <${ErrorLine} error=${err} />
    <button class="btn primary sm" onClick=${go}>Mark dealt with</button>
  </div>`;
}

// Project-wide notes inbox. Reading never changes a note.
export function NotesView({ route }) {
  const st = route.query.get('state') ?? 'open';
  const k = route.query.get('k') ?? ''; const by = route.query.get('by') ?? ''; const q = route.query.get('q') ?? '';
  const { data, error, reload } = useQuery('notes.list', { state: st, ...(k ? { targetKind: k } : {}), ...(by ? { by } : {}), ...(q ? { q } : {}), pageSize: 200 });
  const set = (x) => replace(withQuery(route, x));
  return html`<div class="page">
    <div class="list-bar">
      <span class="seg" role="radiogroup" aria-label="Note state">${[['open', 'Open'], ['resolved', 'Dealt with'], ['all', 'All']].map(([v, l]) => html`<button role="radio" aria-checked=${st === v} class=${`seg-b${st === v ? ' on' : ''}`} onClick=${() => set({ state: v === 'open' ? null : v })}>${l}<span class="count">${data?.counts[v] ?? ''}</span></button>`)}</span>
      <input class="search sm" type="search" placeholder="Filter" aria-label="Filter notes" value=${q} onInput=${(e) => set({ q: e.target.value })} data-list-search />
      <select aria-label="On" value=${k} onChange=${(e) => set({ k: e.target.value })}><option value="">On anything</option><option value="unit">Content</option><option value="collection">Collections</option><option value="asset">Assets</option><option value="submission">Reviews</option></select>
      <select aria-label="Author" value=${by} onChange=${(e) => set({ by: e.target.value })}><option value="">Anyone</option>${(data?.authors ?? []).map((p) => html`<option value=${p}>${p}</option>`)}</select>
    </div>
    <${ErrorLine} error=${error} onRetry=${reload} />
    <div class="notes wide">${data?.notes.map((n) => html`<${NoteItem} n=${n} showTarget key=${n.id} />`)}</div>
  </div>`;
}
