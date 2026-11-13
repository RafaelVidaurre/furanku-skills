// Before/after views. A submission view may show its evidence against a "before" side: a project
// file under the asset roots, or an earlier submission's frozen media. Both sides are the same kind
// of media. The before side is frozen at submission like part evidence, but it is never a
// reviewable part: it only changes how the view is shown.
import { assetFacts } from './project.mjs';
import { check, fail, nonempty, isObject, confinedPath } from './util.mjs';

const LEAF_KEYS = ['digest', 'asset', 'path', 'kind', 'mime', 'size', 'sha256', 'ref'];
const label = (x, what) => { check(x == null || (nonempty(x) && x.length <= 100), 'invalid', `${what} must be text (at most 100 characters)`); return x?.trim(); };

// earlierLeaf({ submission, item, part, leaf }) returns that frozen leaf's evidence (or throws not_found).
// evidenceStatus(e) returns { status, error? } after verifying the bytes.
export function createBeforeSides({ root, evidence, assetRoots, earlierLeaf, evidenceStatus }) {
  // Validate one requested view's before side against the media kind the view shows. No effects.
  function plan(v, shownKind) {
    const b = v.before;
    check(isObject(b) && (b.path != null) !== (b.submission != null), 'invalid', 'view before needs either a path or submission, item and part');
    const out = { label: label(b.label, 'before label') ?? 'Before', afterLabel: label(v.afterLabel, 'afterLabel') ?? 'After' };
    check(shownKind, 'invalid', `view of ${v.part} shows no single image, video or model to compare with`);
    let kind;
    if (b.path != null) {
      check(nonempty(b.path), 'invalid', 'before path must be a project file path');
      const f = assetFacts(root, { path: b.path }, assetRoots());
      check(f.state === 'ok', f.state === 'forbidden' ? 'forbidden' : 'invalid', `cannot use ${b.path} as before: ${f.error ?? f.state}`);
      out.file = { path: b.path, facts: f }; kind = f.kind;
    } else {
      check(nonempty(b.item) && nonempty(b.part) && (b.leaf == null || typeof b.leaf === 'string'), 'invalid', 'view before needs submission, item and part (leaf is optional)');
      const e = earlierLeaf(b);
      check(e?.ref, 'invalid', `${b.part}${b.leaf ? ` leaf ${b.leaf}` : ''} in ${b.submission} has no single image, video or model`);
      const r = evidence.readRef(e.ref, e.sha256);
      check(r.status === 'ok', 'invalid', `earlier evidence is not readable: ${r.error}`);
      out.from = { submission: b.submission, item: b.item, part: b.part, ...(b.leaf ? { leaf: b.leaf } : {}) };
      out.evidence = Object.fromEntries(LEAF_KEYS.filter((k) => e[k] != null).map((k) => [k, e[k]])); kind = e.kind;
    }
    check(kind === shownKind, 'invalid', `before is ${kind} but the view of ${v.part} shows ${shownKind}; compare like with like`);
    return out;
  }
  function freezeOne(p) {
    let e = p.evidence;
    if (p.file) {
      const { path, facts: f } = p.file;
      const ref = evidence.freezeFile(path, confinedPath(root, path, assetRoots()), f.sha256, path.split('.').pop().toLowerCase());
      check(ref, 'conflict', `${path} changed while it was being captured; submit again`);
      e = { digest: f.sha256, asset: path, path, kind: f.kind, mime: f.mime, size: f.size, sha256: f.sha256, ref };
    }
    return { before: { label: p.label, evidence: e, ...(p.from ? { from: p.from } : {}) }, afterLabel: p.afterLabel };
  }
  // Attach planned before sides to built views. Requested views are built in request order.
  const freeze = (views, plans) => views.map((v, i) => (plans?.[i] ? { ...v, ...freezeOne(plans[i]) } : v));
  // The public form of a stored view: the before side's verified status and media URL.
  function project(subId, itemId, v) {
    if (!v.before) return v;
    const e = v.before.evidence; const st = evidenceStatus(e);
    return { ...v, before: { label: v.before.label, from: v.before.from ?? null, kind: e.kind, path: e.path, sha256: e.sha256, storage: e.ref.git ? 'git' : 'catalog', ...st, url: st.status === 'ok' ? `/media/before/${encodeURIComponent(subId)}/${encodeURIComponent(itemId)}/${encodeURIComponent(v.id)}` : null } };
  }
  function bytes(v) {
    check(v?.before, 'not_found', 'this view has no before evidence');
    const e = v.before.evidence; const r = evidence.readRef(e.ref, e.sha256);
    if (r.status !== 'ok') fail(r.status === 'corrupt' ? 'malformed' : 'unavailable', r.error);
    return { bytes: r.bytes, mime: r.media?.mime ?? e.mime, sha256: r.sha256 };
  }
  return { plan, freeze, project, bytes };
}
