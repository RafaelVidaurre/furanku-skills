// Pure domain rules: review parts, verdict normalization, deterministic resolvers, rollups, search.
import { digest } from './util.mjs';

const stem = (p) => p.split('/').pop().replace(/\.[^.]+$/, '');

// Live workflow facts remain visible, but are not content approved by a verdict.
export function reviewAttrs(unit, type) {
  const derived = new Set(type.fields.filter((f) => f.derived).map((f) => f.key));
  return Object.fromEntries(Object.entries(unit.attrs).filter(([k]) => !derived.has(k)));
}

// A unit's reviewable parts: each linked visual, keyed by role (single) or role + asset (many),
// plus its attributes. Part identity is explicit and independent of labels or order.
export function unitParts(unit, type) {
  const parts = [];
  for (const role of type.roles) {
    const links = unit.links.filter((l) => l.role === role.key);
    for (const l of links) parts.push({ id: role.many ? `${role.key}:${l.key ?? l.asset}` : role.key, label: role.many && links.length > 1 ? `${role.label} · ${stem(l.asset)}` : role.label, role: role.key, asset: l.asset });
  }
  if (type.fields.some((f) => !f.derived) || Object.keys(reviewAttrs(unit, type)).length) parts.push({ id: 'attributes', label: 'Attributes' });
  return parts;
}

// A collection's reviewable parts: each member in this collection's context, plus a combined
// preview when the project declares one for the collection kind.
export function collectionParts(col, unitsById, schema) {
  const parts = col.members.map((m) => ({ id: `member:${m.unit}`, label: unitsById.get(m.unit)?.name ?? m.unit, member: m.unit }));
  const kind = col.kind && schema.collectionKinds[col.kind];
  if (kind?.preview) parts.push({ id: 'preview', label: kind.preview.label ?? 'Preview' });
  return parts;
}

// Expand a verdict event to the per-part verdicts it records.
export function eventVerdicts(ev) {
  if (ev.scope.kind === 'whole') return Object.fromEntries(ev.scope.parts.map((p) => [p, ev.exceptions?.[p] ?? ev.verdict]));
  return { ...ev.verdicts };
}

// Documented deterministic order: recorded UTC time, then event identity.
export const eventOrder = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const SEVERITY = { approved: 0, changes: 1, rejected: 2 };
// Resolvers receive events (already ordered) that address one part and return the deciding one.
export const RESOLVERS = {
  // Default: the latest verdict addressing the part.
  latest: (events) => events.at(-1) ?? null,
  // Alternative: each actor's latest verdict counts; the most severe current verdict decides.
  strictest: (events, part) => {
    const byActor = new Map();
    for (const e of events) byActor.set(`${e.by.kind}:${e.by.name}`, e);
    let pick = null;
    for (const e of byActor.values()) if (!pick || SEVERITY[eventVerdicts(e)[part]] > SEVERITY[eventVerdicts(pick)[part]] || (SEVERITY[eventVerdicts(e)[part]] === SEVERITY[eventVerdicts(pick)[part]] && eventOrder(e, pick) > 0)) pick = e;
    return pick;
  },
};

export function resolveParts(events, partIds, resolver) {
  const sorted = [...events].sort(eventOrder);
  const out = {};
  for (const p of partIds) {
    const addressing = sorted.filter((e) => eventVerdicts(e)[p]);
    const ev = addressing.length ? resolver(addressing, p) : null;
    out[p] = ev ? { verdict: eventVerdicts(ev)[p], event: ev } : null;
  }
  return out;
}

export function summarize(parts) {
  const s = { total: parts.length, approved: 0, changes: 0, rejected: 0, undecided: 0, changed: 0 };
  for (const p of parts) { s[p.verdict ?? 'undecided']++; if (p.changed) s.changed++; }
  s.state = s.total === 0 ? 'none'
    : s.undecided === s.total ? 'undecided'
    : s.approved === s.total ? 'approved'
    : !s.changes && !s.rejected ? 'partial'
    : s.changes && !s.rejected ? 'changes'
    : s.rejected && !s.changes ? 'rejected' : 'mixed';
  return s;
}

export const partEvidenceDigest = (e) => e?.digest ?? (e ? digest(e) : null);

// ---- Search ranking: exact > prefix > alias > word > substring > member > fact > fuzzy.
export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9:./]+/g, ' ').trim();
const words = (s) => norm(s).split(/[\s/.]+/).filter(Boolean);

function damerau(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

// doc: { name, id, aliases[], facts[], members[{id,name}] }. Returns null or { score, member? }.
export function rankDoc(query, doc) {
  const q = norm(query);
  if (!q) return { score: 0 };
  const name = norm(doc.name), id = norm(doc.id);
  if (q === name || q === id) return { score: 1000 };
  if (name.startsWith(q) || id.startsWith(q)) return { score: 800 };
  const aliases = (doc.aliases ?? []).map(norm);
  if (aliases.some((a) => a === q || a.startsWith(q))) return { score: 700 };
  const qw = words(query);
  const nameWords = new Set([...words(doc.name), ...words(doc.id)]);
  const aliasWords = new Set(aliases.flatMap((a) => a.split(/[\s/.]+/)));
  const factText = (doc.facts ?? []).map(norm).join(' ');
  const memberDocs = (doc.members ?? []).map((m) => ({ ...m, w: new Set([...words(m.name), ...words(m.id)]), t: `${norm(m.name)} ${norm(m.id)}` }));
  let score = 0; let member = null;
  for (const w of qw) {
    const fuzzyMax = w.length >= 8 ? 2 : w.length >= 4 ? 1 : 0;
    const near = (set) => fuzzyMax > 0 && [...set].some((x) => damerau(w, x, fuzzyMax) <= fuzzyMax);
    let s = 0;
    if (nameWords.has(w)) s = 600;
    else if ([...nameWords].some((x) => x.startsWith(w))) s = 500;
    else if (aliasWords.has(w) || [...aliasWords].some((x) => x.startsWith(w))) s = 450;
    else if (name.includes(w) || id.includes(w)) s = 400;
    else {
      const m = memberDocs.find((md) => md.w.has(w) || [...md.w].some((x) => x.startsWith(w)) || md.t.includes(w));
      if (m) { s = 300; member ??= { id: m.id, name: m.name }; }
      else if (factText.includes(w)) s = 200;
      else if (near(nameWords) || near(aliasWords)) s = 150;
      else { const mf = memberDocs.find((md) => near(md.w)); if (mf) { s = 120; member ??= { id: mf.id, name: mf.name }; } }
    }
    if (!s) return null;
    score += s;
  }
  return { score: Math.round(score / qw.length), member };
}
