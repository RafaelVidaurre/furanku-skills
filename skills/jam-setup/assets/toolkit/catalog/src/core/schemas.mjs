// Record validation: every field is type-checked at every nesting level. Returns an error
// message, or null when valid. Anything else in a file is reported as a scoped problem.
import { EVIDENCE_PATH } from './records.mjs';

const str = (v, max = 2000) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const iso = (v) => typeof v === 'string' && /Z$/.test(v) && !Number.isNaN(Date.parse(v));
const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hex = (v, n = 64) => typeof v === 'string' && new RegExp(`^[0-9a-f]{${n}}$`).test(v);
const int = (v) => Number.isSafeInteger(v) && v >= 0;
const num3 = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
export const TAG = /^[a-z0-9][a-z0-9:._/+-]{0,63}$/;
export const CATEGORY = /^[^/\s][^/]{0,63}(\/[^/\s][^/]{0,63}){0,7}$/;
export const VERDICTS = ['approved', 'changes', 'rejected'];
export const PART_NOTE_MAX = 5000;
export const isTag = (t) => typeof t === 'string' && TAG.test(t);
export const isCategory = (c) => typeof c === 'string' && CATEGORY.test(c);
const actor = (a) => obj(a) && str(a.name, 200) && ['human', 'agent'].includes(a.kind);
const target = (t, kinds) => obj(t) && kinds.includes(t.kind) && str(t.id, 500);
const tags = (t) => Array.isArray(t) && t.every(isTag) && new Set(t).size === t.length;
const optStr = (v, max) => v == null || str(v, max);
const MEDIA = ['image', 'video', 'model'];

// Evidence references must be complete: a content-addressed store path whose name is the digest,
// or a Git blob with its commit and path. The expected SHA-256 is always present.
export function validRef(ref, sha) {
  if (!obj(ref) || !hex(sha)) return false;
  if (ref.store !== undefined) { const m = EVIDENCE_PATH.exec(ref.store); return Object.keys(ref).length === 1 && !!m && m[2] === sha && m[1] === sha.slice(0, 2); }
  if (ref.git !== undefined) return Object.keys(ref).length === 1 && obj(ref.git) && (hex(ref.git.commit, 40) || hex(ref.git.commit, 64)) && (hex(ref.git.blob, 40) || hex(ref.git.blob, 64)) && str(ref.git.path, 1000);
  return false;
}
export function validLeaf(e) {
  if (!obj(e)) return false;
  if (e.kind === 'attributes') return obj(e.attrs) && hex(e.digest);
  return MEDIA.includes(e.kind) && hex(e.sha256) && e.digest === e.sha256 && str(e.asset, 500) && str(e.path, 1000) && int(e.size) && optStr(e.mime, 100) && validRef(e.ref, e.sha256);
}
const validDefinition = (d) => obj(d) && hex(d.sha256) && validRef(d.ref, d.sha256);
const leafMap = (m) => obj(m) && Object.entries(m).every(([k, v]) => str(k, 600) && validLeaf(v));
function validPartEvidence(p) {
  const e = p.evidence;
  if (!obj(e) || !hex(e.digest)) return false;
  if (p.id === 'preview') {
    return obj(e.members) && Object.entries(e.members).every(([u, m]) => str(u, 500) && leafMap(m))
      && (e.base == null || validLeaf(e.base)) && (e.module == null || str(e.module, 100)) && (e.config == null || obj(e.config)) && (e.roles == null || (Array.isArray(e.roles) && e.roles.every((r) => str(r, 100))));
  }
  if (p.id.startsWith('member:')) return str(e.unit, 500) && validDefinition(e.definition) && leafMap(e.parts);
  return validLeaf(e);
}
// A view's before side: frozen media of the same kind, optionally from an earlier submission.
const validBefore = (v) => v.before == null ? v.afterLabel == null
  : obj(v.before) && str(v.before.label, 100) && str(v.afterLabel, 100) && validLeaf(v.before.evidence) && v.before.evidence.kind !== 'attributes'
    && (v.before.from == null || (obj(v.before.from) && /^sub_[a-z0-9]+$/.test(v.before.from.submission ?? '') && /^it_[a-z0-9]+$/.test(v.before.from.item ?? '') && str(v.before.from.part, 600) && optStr(v.before.from.leaf, 1200)));
export const validCamera = (c) => c == null || (obj(c) && (c.position == null || num3(c.position)) && (c.target == null || num3(c.target)));
export function validViewState(s) {
  if (s == null) return true;
  if (!obj(s)) return false;
  if (s.mode != null && !['textured', 'clay', 'wireframe'].includes(s.mode)) return false;
  if (s.animation != null && !(obj(s.animation) && (s.animation.clip == null || str(s.animation.clip, 200)) && (s.animation.time == null || (typeof s.animation.time === 'number' && s.animation.time >= 0)) && (s.animation.playing == null || typeof s.animation.playing === 'boolean'))) return false;
  if (s.isolate != null && !(typeof s.isolate === 'string' || int(s.isolate))) return false;
  if (s.texture != null && !str(s.texture, 300)) return false;
  return Object.keys(s).every((k) => ['mode', 'animation', 'isolate', 'texture'].includes(k));
}

const validRequest = (id, binding) => id == null ? binding == null
  : str(id, 300) && obj(binding) && str(binding.action, 100) && hex(binding.digest) && str(binding.context, 1000);

export const validators = {
  note(r) {
    if (!validRequest(r.lastRequestId, r.lastRequestBinding)) return 'last request binding is invalid';
    if (!validRequest(r.requestId, r.requestBinding)) return 'request binding is invalid';
    if (!/^nt_[a-z0-9]+$/.test(r.id ?? '')) return 'note id is invalid';
    if (!target(r.target, ['unit', 'collection', 'asset', 'submission'])) return 'note target is invalid';
    if (!optStr(r.target.part, 600) || !optStr(r.target.item, 200)) return 'note part/item is invalid';
    if (!str(r.body, 20000)) return 'note text is required (at most 20000 characters)';
    if (!actor(r.by) || !iso(r.at) || (r.editedAt != null && !iso(r.editedAt))) return 'note attribution is invalid';
    if (r.resolved != null && !(obj(r.resolved) && actor(r.resolved.by) && iso(r.resolved.at) && (r.resolved.explanation == null || typeof r.resolved.explanation === 'string'))) return 'note disposition is invalid';
    if (!Number.isInteger(r.revision) || r.revision < 1 || !optStr(r.requestId, 300) || !optStr(r.lastRequestId, 300)) return 'note revision is invalid';
    return null;
  },
  label(r) {
    if (!target(r.target, ['unit', 'asset', 'collection'])) return 'label target is invalid';
    if (r.category != null && !isCategory(r.category)) return 'category is invalid';
    if (!tags(r.tags)) return 'tags are invalid';
    if (!Number.isInteger(r.revision) || r.revision < 1) return 'label revision is invalid';
    return null;
  },
  collection(r) {
    if (!validRequest(r.requestId, r.requestBinding)) return 'request binding is invalid';
    if (typeof r.id !== 'string' || !/^[a-z0-9][a-z0-9/_-]{0,119}$/.test(r.id)) return 'collection id is invalid';
    if (!str(r.name, 200)) return 'collection name is required';
    if (r.kind != null && !str(r.kind, 100)) return 'collection kind is invalid';
    if (r.category != null && !isCategory(r.category)) return 'category is invalid';
    if (!tags(r.tags)) return 'tags are invalid';
    if (!Array.isArray(r.members) || !r.members.every((m) => obj(m) && str(m.unit, 500) && Object.entries(m).every(([k, v]) => k === 'unit' || ['number', 'string', 'boolean'].includes(typeof v)))) return 'members are invalid';
    if (new Set(r.members.map((m) => m.unit)).size !== r.members.length) return 'a unit appears twice in members';
    if (!Number.isInteger(r.revision) || r.revision < 1) return 'collection revision is invalid';
    if (r.createdBy != null && !actor(r.createdBy)) return 'collection attribution is invalid';
    return null;
  },
  categories(r) {
    if (!Array.isArray(r.categories) || !r.categories.every(isCategory)) return 'categories are invalid';
    if (!Number.isInteger(r.revision) || r.revision < 1) return 'categories revision is invalid';
    return null;
  },
  submission(r) {
    if (!validRequest(r.requestId, r.requestBinding)) return 'request binding is invalid';
    if (!/^sub_[a-z0-9]+$/.test(r.id ?? '')) return 'submission id is invalid';
    if (!str(r.title, 300) || !actor(r.by) || !iso(r.at)) return 'submission title/attribution is invalid';
    if (!obj(r.context) || !optStr(r.context.branch, 300) || !(r.context.head == null || hex(r.context.head, 40) || hex(r.context.head, 64)) || !int(r.context.dirty ?? 0)) return 'submission context is invalid';
    if (r.supersedes != null && !/^sub_[a-z0-9]+$/.test(r.supersedes)) return 'supersedes is invalid';
    if (!optStr(r.note, 5000)) return 'submission note is invalid';
    if (!Array.isArray(r.items) || r.items.length === 0) return 'submission needs items';
    for (const it of r.items) {
      if (!obj(it) || !/^it_[a-z0-9]+$/.test(it.id ?? '') || !target(it.target, ['unit', 'collection']) || !str(it.title, 300)) return 'submission item is invalid';
      if (!validDefinition(it.definition)) return 'item definition evidence is invalid';
      if (!Array.isArray(it.parts) || !it.parts.length || !it.parts.every((p) => obj(p) && str(p.id, 600) && str(p.label, 600) && validPartEvidence(p))) return `item ${it.id} parts or evidence are invalid`;
      if (new Set(it.parts.map((p) => p.id)).size !== it.parts.length) return 'duplicate part ids';
      if (!Array.isArray(it.views) || !it.views.every((v) => obj(v) && /^vw_[a-z0-9]+$/.test(v.id ?? '') && str(v.caption, 300) && it.parts.some((p) => p.id === v.part) && (v.leaf == null || str(v.leaf, 1200)) && validCamera(v.camera) && validViewState(v.state) && validBefore(v))) return `item ${it.id} views are invalid`;
      if (it.preview != null && !(obj(it.preview) && str(it.preview.module, 100))) return 'item preview is invalid';
    }
    return null;
  },
  verdict(r) {
    if (!validRequest(r.requestId, r.requestBinding)) return 'request binding is invalid';
    if (!/^vd_[a-z0-9]+$/.test(r.id ?? '') || !/^sub_[a-z0-9]+$/.test(r.submission ?? '') || !/^it_[a-z0-9]+$/.test(r.item ?? '')) return 'verdict identity is invalid';
    if (!actor(r.by) || !iso(r.at)) return 'verdict attribution is invalid';
    if (!obj(r.scope) || !['whole', 'parts'].includes(r.scope.kind) || !Array.isArray(r.scope.parts) || r.scope.parts.length === 0 || !r.scope.parts.every((p) => str(p, 600))) return 'verdict scope is invalid';
    if (r.scope.kind === 'whole') {
      if (!VERDICTS.includes(r.verdict)) return 'whole verdict is invalid';
      if (!obj(r.exceptions) || !Object.entries(r.exceptions).every(([p, v]) => r.scope.parts.includes(p) && VERDICTS.includes(v) && v !== r.verdict)) return 'exceptions are invalid';
    } else if (!obj(r.verdicts) || Object.keys(r.verdicts).sort().join('\n') !== [...r.scope.parts].sort().join('\n') || !Object.values(r.verdicts).every((v) => VERDICTS.includes(v))) return 'part verdicts are invalid';
    if (r.comment != null && typeof r.comment !== 'string') return 'comment is invalid';
    // Part notes may only address parts this event decides.
    const decided = r.scope.kind === 'whole' ? r.scope.parts : Object.keys(r.verdicts);
    if (r.partNotes != null && !(obj(r.partNotes) && Object.entries(r.partNotes).every(([p, t]) => decided.includes(p) && str(t, PART_NOTE_MAX)))) return 'part notes are invalid';
    if (!optStr(r.requestId, 300)) return 'request id is invalid';
    return null;
  },
};
