import { html, useState, useQuery, write, href, enc, Icon, toast, ErrorLine } from './core.js';

const listLink = (section, key, v) => href({ section, query: new URLSearchParams({ [`f.${key}`]: enc(v) }) });

export function OrganizeView() {
  const { data, error, reload } = useQuery('organization.list', {});
  const [newCat, setNewCat] = useState('');
  const run = (action, input, msg) => write(action, input).then((r) => { if (msg) toast(msg(r)); }, (e) => toast(e.message, 'err'));
  if (!data) return html`<div class="page"><${ErrorLine} error=${error} onRetry=${reload} /></div>`;
  const groups = new Map();
  for (const t of data.tags) { const ns = t.tag.includes(':') ? t.tag.split(':')[0] : ''; if (!groups.has(ns)) groups.set(ns, []); groups.get(ns).push(t); }
  return html`<div class="page organize">
    <section class="block">
      <header class="block-h"><h3>Categories</h3><span class="badge">${data.categories.length}</span></header>
      <div class="org-add"><input value=${newCat} placeholder="New category (Parent/Child)" aria-label="New category" onInput=${(e) => setNewCat(e.target.value)}
        onKeyDown=${async (e) => { if (e.key === 'Enter' && newCat.trim()) { await run('category.create', { path: newCat }); setNewCat(''); } }} /></div>
      <div class="org-list">${data.categories.map((c) => html`<${OrgRow} key=${c.path} name=${c.path.split('/').at(-1)} depth=${c.path.split('/').length - 1} counts=${c} link=${(sec) => listLink(sec, 'cat', c.path)}
        onRename=${(to) => run('category.rename', { from: c.path, to: [...c.path.split('/').slice(0, -1), to].join('/') }, (r) => `Renamed in ${r.renamed} records${r.projectOwnedUnchanged ? `; ${r.projectOwnedUnchanged} project-defined unchanged` : ''}`)}
        onDelete=${() => run('category.delete', { path: c.path }, () => 'Category removed')} />`)}</div>
    </section>
    <section class="block">
      <header class="block-h"><h3>Tags</h3><span class="badge">${data.tags.length}</span></header>
      <div class="org-list">${[...groups].map(([ns, ts]) => html`
        ${ns && html`<div class="org-ns">${ns}</div>`}
        ${ts.map((t) => html`<${OrgRow} key=${t.tag} name=${t.tag} depth=${ns ? 1 : 0} counts=${t} project=${t.projectOwned} link=${(sec) => listLink(sec, 'tag', t.tag)}
          onRename=${(to) => run('tag.rename', { from: t.tag, to: to.trim().toLowerCase() }, () => (data.tags.some((x) => x.tag === to) ? `Merged into ${to}` : `Renamed to ${to}`))}
          onDelete=${() => run('tag.delete', { tag: t.tag }, () => `Removed ${t.tag}`)} />`)}`)}</div>
    </section>
  </div>`;
}

function OrgRow({ name, depth, counts, link, onRename, onDelete, project }) {
  const [editing, setEditing] = useState(false);
  const [del, setDel] = useState(false);
  return html`<div class="org-row" style=${`padding-left:${8 + depth * 16}px`}>
    ${editing
      ? html`<input class="rename sm" value=${name} autofocus aria-label="Rename" onKeyDown=${(e) => { if (e.key === 'Enter' && e.target.value.trim()) { onRename(e.target.value.trim()); setEditing(false); } if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setEditing(false); } }} onBlur=${() => setEditing(false)} />`
      : html`<span class="org-name">${name}</span>`}
    ${project && html`<span class="chip" title="Also defined by the project; only catalog-owned uses change">Project</span>`}
    <span class="org-counts">
      ${counts.units > 0 && html`<a href=${link('content')}>${counts.units} content</a>`}
      ${counts.collections > 0 && html`<a href=${link('collections')}>${counts.collections} coll.</a>`}
      ${counts.assets > 0 && html`<a href=${link('assets')}>${counts.assets} assets</a>`}
    </span>
    <button class="icon-btn sm" title="Rename" aria-label=${`Rename ${name}`} onClick=${() => setEditing(true)}><${Icon} name="edit" size=${12} /></button>
    ${del ? html`<button class="btn xs danger" autofocus onBlur=${() => setDel(false)} onClick=${onDelete}>Remove</button>`
      : html`<button class="icon-btn sm" title="Remove" aria-label=${`Remove ${name}`} onClick=${() => setDel(true)}><${Icon} name="trash" size=${12} /></button>`}
  </div>`;
}
