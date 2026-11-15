// Viewer sessions for agents: drive the real browser UI viewers headlessly, read their state,
// apply controls and capture rendered pixels. A capture is refused unless the viewer is ready.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { launchBrowser } from '../browser.mjs';
import { CatalogError, check, isObject, nonempty } from '../core/util.mjs';

export const VIEWER_ACTIONS = [
  { name: 'viewer.open', kind: 'viewer', description: 'Open a unit, collection, asset or submission item in a headless viewer session', input: { target: 'object', size: 'object?', session: 'string?' } },
  { name: 'viewer.state', kind: 'viewer', description: 'Current viewer selection, readiness, evidence identity, camera and supported controls', input: { session: 'string?' } },
  { name: 'viewer.control', kind: 'viewer', description: 'Select a part/view or apply camera, surface mode, animation, mesh isolation, zoom or comparison controls', input: { session: 'string?', select: 'object?', camera: 'object?', mode: 'string?', animation: 'object?', isolate: 'any?', texture: 'any?', zoom: 'object?', compare: 'object?' } },
  { name: 'viewer.capture', kind: 'viewer', description: 'Capture the ready viewer as PNG; returns the file and the evidence identity shown', input: { session: 'string?' } },
  { name: 'viewer.close', kind: 'viewer', description: 'Close a viewer session', input: { session: 'string?' } },
];

const enc = encodeURIComponent;
export function routeFor(t) {
  check(isObject(t) && nonempty(t.kind) && nonempty(t.id), 'invalid', 'target needs kind and id');
  const q = new URLSearchParams();
  if (t.part) q.set('part', t.part);
  if (t.view) q.set('view', t.view);
  if (t.compare) q.set('cmp', t.compare);
  const qs = q.toString() ? `?${q}` : '';
  if (t.kind === 'unit') return `#/content/u/${enc(t.id)}${qs}`;
  if (t.kind === 'collection') return `#/collections/c/${enc(t.id)}${t.member ? `/${enc(t.member)}` : ''}${qs}`;
  if (t.kind === 'asset') return `#/assets/a/${enc(t.id)}${qs}`;
  if (t.kind === 'submission') { check(nonempty(t.item), 'invalid', 'submission targets need an item'); return `#/reviews/s/${enc(t.id)}/${enc(t.item)}${qs}`; }
  throw new CatalogError('invalid', `unknown target kind ${t.kind}`);
}

// The rendered viewer must show exactly the requested selection and its loaded bytes.
function verifyIdentity(t, state) {
  const sel = state.selection ?? {}; const src = state.viewer?.source ?? {};
  const mismatch = (what) => { throw new CatalogError('conflict', `viewer shows a different ${what} than requested; nothing was captured`, { requested: t, selection: sel, source: src }); };
  if (!t) return;
  if (t.compare) { if (state.viewer?.kind !== 'compare') mismatch('view (no comparison is open)'); return; }
  if (t.kind === 'unit') {
    if (sel.kind !== 'unit' || sel.id !== t.id) mismatch('content unit');
    if (t.part && (sel.part !== t.part || src.part !== t.part)) mismatch('part');
    if (src.sha256 && sel.asset?.sha256 && src.sha256 !== sel.asset.sha256) mismatch('asset version');
  }
  if (t.kind === 'submission') {
    if (sel.submission !== t.id || sel.item !== t.item) mismatch('submission item');
    if (t.view && (sel.view !== t.view || src.view !== t.view)) mismatch('evidence view');
  }
  if (t.kind === 'collection' && (sel.kind === 'collection' && sel.id !== t.id)) mismatch('collection');
  if (t.kind === 'asset' && (sel.id !== t.id)) mismatch('asset');
}

export function createRenderer({ app, baseUrl }) {
  let browser = null;
  const sessions = new Map();

  async function page(name, create) {
    if (sessions.has(name)) return sessions.get(name);
    check(create, 'not_found', `no viewer session ${name}; call viewer.open first`);
    browser ??= await launchBrowser();
    const p = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    sessions.set(name, { p, errors });
    return sessions.get(name);
  }
  async function settled(p, timeout = 20000) {
    await p.waitForFunction(() => window.catalogViewer?.booted, null, { timeout });
    await p.evaluate((t) => window.catalogViewer.settled(t), timeout);
    return p.evaluate(() => window.catalogViewer.state());
  }

  async function run(name, input) {
    const s = input.session ?? 'default';
    if (name === 'viewer.open') {
      const { p, errors } = await page(s, true);
      if (input.size) { check(Number.isInteger(input.size.width) && Number.isInteger(input.size.height) && input.size.width >= 320 && input.size.width <= 3840 && input.size.height >= 240 && input.size.height <= 2160, 'invalid', 'size must be integer width 320-3840 and height 240-2160'); await p.setViewportSize(input.size); }
      const url = `${baseUrl()}/?agent=1${routeFor(input.target)}`;
      if (p.url().startsWith(baseUrl())) await p.evaluate((h) => { location.hash = h; }, routeFor(input.target));
      else await p.goto(url);
      const state = await settled(p);
      sessions.get(s).target = { ...input.target };
      check(!state.selection?.unavailable, 'not_found', state.selection?.error ?? 'the requested selection is not available', { state });
      return { session: s, state, pageErrors: errors.splice(0) };
    }
    if (name === 'viewer.close') {
      const x = sessions.get(s);
      if (x) { await x.p.close(); sessions.delete(s); }
      return { closed: s };
    }
    const { p, errors } = await page(s, false);
    if (name === 'viewer.state') return { session: s, state: await p.evaluate(() => window.catalogViewer.state()) };
    if (name === 'viewer.control') {
      const { session, ...cmd } = input;
      const res = await p.evaluate((c) => window.catalogViewer.control(c), cmd);
      if (res?.error) throw new CatalogError(res.code ?? 'unsupported', res.error, res.details);
      if (cmd.select) Object.assign(sessions.get(s).target, cmd.select);
      const state = await settled(p);
      return { session: s, state, pageErrors: errors.splice(0) };
    }
    if (name === 'viewer.capture') {
      const state = await settled(p);
      check(!state.selection?.unavailable, 'unavailable', `the selection is not available (${state.selection?.error}); nothing was captured`, { state });
      verifyIdentity(sessions.get(s).target, state);
      check(state.viewer?.status === 'ready', 'unavailable', `viewer is not showing ready media (${state.viewer?.status ?? 'nothing selected'}${state.viewer?.error ? `: ${state.viewer.error}` : ''}); nothing was captured`, { state });
      const el = p.locator('[data-viewer-root][data-active="true"]').last();
      const png = await el.screenshot({ type: 'png', animations: 'disabled' });
      const sha = createHash('sha256').update(png).digest('hex');
      const rel = app.records.writeLocal(`captures/${new Date().toISOString().replace(/[:.]/g, '-')}-${sha.slice(0, 8)}.png`, png);
      const box = await el.boundingBox();
      // A catalog render of the loaded asset, not a native engine screenshot.
      const renderer = state.viewer.kind === 'model' || state.viewer.kind === 'compare' ? `catalog WebGL viewer (three.js ${await p.evaluate(() => window.__THREE__ ?? 'unknown')}, headless Chromium)` : 'catalog browser viewer (headless Chromium)';
      return { session: s, file: rel, sha256: sha, width: Math.round(box.width), height: Math.round(box.height), shows: state.viewer.source, renderer, state };
    }
    throw new CatalogError('not_found', `unknown viewer action ${name}`);
  }

  async function close() {
    for (const { p } of sessions.values()) await p.close().catch(() => {});
    sessions.clear();
    if (browser) await browser.close().catch(() => {});
    browser = null;
  }
  return { run, close };
}
