// What needs attention, in one place: reviews waiting for a verdict, open notes, content that
// changed since its verdict, and problems. The same list the `todo` command prints.
import { html, useQuery, ago, Icon, Person, ErrorLine, Verdict } from './core.js';

const Section = ({ title, total, shown, children }) => (total === 0 ? null : html`<section class="block attention" aria-label=${title}>
  <header class="block-h"><h3>${title}</h3><span class="badge">${total}</span></header>
  <div class="feed">${children}</div>
  ${shown < total && html`<p class="muted small">Showing the first ${shown} of ${total}.</p>`}
</section>`);

export function InboxView() {
  const { data, error, reload } = useQuery('inbox', { limit: 100 });
  const c = data?.counts;
  const nothing = c && c.waiting + c.notes + c.changed + c.problems === 0;
  return html`<div class="page">
    <header class="browse-head"><div><span class="eyebrow">Waiting on someone</span><h1>Needs attention</h1></div></header>
    <${ErrorLine} error=${error} onRetry=${reload} />
    ${nothing && html`<p class="attention-empty muted" role="status">Nothing is waiting: no undecided reviews, open notes, changed verdicts or problems.</p>`}
    ${data && html`<div class="attention-list">
      <${Section} title="Reviews waiting for a verdict" total=${c.waiting} shown=${data.waiting.length}>${data.waiting.map((r) => html`<a class="sub-row" key=${r.submission} href=${r.route}>
        <span class="sub-main"><span class="row-name">${r.title}</span><span class="row-sub"><span class="mono">${r.ref}</span> · <${Person} by=${r.by} /> · ${ago(r.at)}</span></span>
        <span class="sub-counts"><span class="cnt wait">${r.waiting} of ${r.items} waiting</span></span></a>`)}<//>
      <${Section} title="Open notes" total=${c.notes} shown=${data.notes.length}>${data.notes.map((n) => html`<a class="sub-row" key=${n.id} href=${n.route ?? '#/notes'}>
        <span class="sub-main"><span class="row-name">${n.targetName}${n.partLabel ? html` <span class="muted">· ${n.partLabel}</span>` : ''}</span><span class="row-sub attention-text">${n.body}</span></span>
        <span class="sub-counts"><span class="cnt"><${Person} by=${n.by} /> · ${ago(n.at)}</span></span></a>`)}<//>
      <${Section} title="Changed since their verdict" total=${c.changed} shown=${data.changed.length}>${data.changed.map((e) => html`<a class="sub-row" key=${`${e.target.kind}:${e.target.id}`} href=${e.route ?? '#/reviews'}>
        <span class="sub-main"><span class="row-name">${e.name}</span><span class="row-sub">${e.parts.map((p, i) => html`${i ? ', ' : ''}${p.label} `)}changed after ${e.parts.length === 1 ? 'its verdict' : 'their verdicts'}</span></span>
        <span class="sub-counts">${e.parts.map((p) => html`<${Verdict} v=${p.verdict} short />`)}</span></a>`)}<//>
      <${Section} title="Problems" total=${c.problems} shown=${data.problems.length}>${data.problems.map((p) => html`<div class="problem">
        <div class="mono small"><${Icon} name="warn" size=${12} /> ${p.source}</div><div>${p.error}</div>${p.recovery && html`<div class="muted small">${p.recovery}</div>`}</div>`)}<//>
    </div>`}
  </div>`;
}
