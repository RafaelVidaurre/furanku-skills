// Local HTTP server: loopback only, host/origin validation, bounded bodies, confined file serving.
// The browser UI and HTTP agents call the same application actions.
import http from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, extname, relative, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { CatalogError, insideReal } from '../core/util.mjs';
import { createRenderer, VIEWER_ACTIONS } from './renderer.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const PKG = resolve(here, '../..');
const WEB = join(PKG, 'web');
const MODULES = join(PKG, 'node_modules');
const MAX_BODY = 1 << 20;
const STATUS = { invalid: 400, forbidden: 403, not_found: 404, conflict: 409, context_changed: 409, locked: 423, malformed: 422, unsupported: 422, unavailable: 503 };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
// Browser dependencies served from node_modules (explicit allow-list of folders).
const VENDOR = { 'preact/': 'preact/dist/', 'preact-hooks/': 'preact/hooks/dist/', 'htm/': 'htm/dist/', 'marked/': 'marked/lib/', 'dompurify/': 'dompurify/dist/', 'three/': 'three/build/', 'three-addons/': 'three/examples/jsm/' };

const inside = (base, file) => { const r = relative(base, file); return r && !r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r); };

export async function startServer({ app, port = 4600, host = '127.0.0.1' }) {
  const renderer = createRenderer({ app, baseUrl: () => `http://${host}:${server.address().port}` });
  const indexHtml = readFileSync(join(WEB, 'index.html'), 'utf8');
  const importMap = /<script type="importmap">([\s\S]*?)<\/script>/.exec(indexHtml)[1];
  const mapHash = createHash('sha256').update(importMap).digest('base64');
  const csp = `default-src 'none'; script-src 'self' 'sha256-${mapHash}'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' blob: data:; worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

  const allowedHosts = () => { const p = server.address().port; return new Set([`127.0.0.1:${p}`, `localhost:${p}`, `[::1]:${p}`]); };
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const sendError = (res, e) => {
    if (e instanceof CatalogError) return send(res, STATUS[e.code] ?? 400, { error: { code: e.code, message: e.message, details: e.details ?? null } });
    console.error(e);
    send(res, 500, { error: { code: 'internal', message: e.message } });
  };

  function serveFile(req, res, file, mime, extra = {}) {
    const size = statSync(file).size;
    const headers = { 'content-type': mime, 'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes', 'content-security-policy': "default-src 'none'; sandbox", ...extra };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && size > 0) {
      let start = range[1] ? +range[1] : Math.max(0, size - +range[2]);
      let end = range[1] && range[2] ? Math.min(+range[2], size - 1) : size - 1;
      if (start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
      return createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'content-length': size });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  }
  function serveBytes(req, res, buf, mime, extra = {}) {
    const headers = { 'content-type': mime, 'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes', 'content-security-policy': "default-src 'none'; sandbox", ...extra };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && buf.length) {
      const start = range[1] ? +range[1] : Math.max(0, buf.length - +range[2]);
      const end = range[1] && range[2] ? Math.min(+range[2], buf.length - 1) : buf.length - 1;
      if (start > end || start >= buf.length) { res.writeHead(416, { 'content-range': `bytes */${buf.length}` }); return res.end(); }
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${buf.length}`, 'content-length': end - start + 1 });
      return res.end(buf.subarray(start, end + 1));
    }
    res.writeHead(200, { ...headers, 'content-length': buf.length });
    res.end(req.method === 'HEAD' ? undefined : buf);
  }

  async function readBody(req) {
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > MAX_BODY) throw new CatalogError('invalid', 'request body too large'); chunks.push(c); }
    if (!size) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new CatalogError('invalid', 'request body is not valid JSON'); }
  }

  const server = http.createServer(async (req, res) => {
    try {
      // DNS-rebinding and cross-origin protection.
      if (!allowedHosts().has(req.headers.host ?? '')) return send(res, 403, { error: { code: 'forbidden', message: 'unexpected Host header' } });
      const origin = req.headers.origin;
      if (origin && !allowedHosts().has(origin.replace(/^http:\/\//, ''))) return send(res, 403, { error: { code: 'forbidden', message: 'cross-origin requests are not allowed' } });
      const url = new URL(req.url, 'http://local');
      let p;
      try { p = decodeURIComponent(url.pathname); } catch { return send(res, 400, { error: { code: 'invalid', message: 'bad path' } }); }

      if (p === '/api/actions' && req.method === 'GET') return send(res, 200, { actions: [...app.discover(), ...VIEWER_ACTIONS] });
      if (p.startsWith('/api/run/')) {
        if (req.method !== 'POST') return send(res, 405, { error: { code: 'invalid', message: 'use POST' } });
        if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) return send(res, 415, { error: { code: 'invalid', message: 'content-type must be application/json' } });
        if (req.headers['x-catalog-request'] !== '1') return send(res, 403, { error: { code: 'forbidden', message: 'missing X-Catalog-Request header' } });
        const name = p.slice('/api/run/'.length);
        const body = await readBody(req);
        if (VIEWER_ACTIONS.some((a) => a.name === name)) return send(res, 200, await renderer.run(name, body.input ?? {}));
        // Browser clients act as the local Git user (human). Other clients must declare themselves.
        const actor = body.actor ?? (req.headers['x-catalog-client'] === 'web' ? await app.defaultActor() : undefined);
        const result = await app.run(name, body.input ?? {}, { actor, requestId: body.requestId, context: body.context });
        return send(res, 200, result);
      }
      if (p.startsWith('/media/asset/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: { code: 'invalid', message: 'use GET' } });
        const f = await app.assetFile(p.slice('/media/asset/'.length));
        return serveFile(req, res, f.file, f.mime, { etag: `"${f.sha256}"`, 'cache-control': url.searchParams.get('v') === f.sha256.slice(0, 16) ? 'private, max-age=31536000, immutable' : 'no-cache' });
      }
      if (p.startsWith('/media/evidence/')) {
        const segs = url.pathname.slice('/media/evidence/'.length).split('/');
        if (segs.length !== 3) return send(res, 404, { error: { code: 'not_found', message: 'not found' } });
        const [sub, item, part] = segs.map(decodeURIComponent);
        const e = await app.evidenceMedia(sub, item, part, url.searchParams.get('leaf') ?? '');
        return serveBytes(req, res, e.bytes, e.mime ?? 'application/octet-stream', { etag: `"${e.sha256}"`, 'cache-control': 'private, max-age=31536000, immutable' });
      }
      if (p.startsWith('/media/before/')) {
        const segs = url.pathname.slice('/media/before/'.length).split('/');
        if (segs.length !== 3) return send(res, 404, { error: { code: 'not_found', message: 'not found' } });
        const e = await app.beforeMedia(...segs.map(decodeURIComponent));
        return serveBytes(req, res, e.bytes, e.mime ?? 'application/octet-stream', { etag: `"${e.sha256}"`, 'cache-control': 'private, max-age=31536000, immutable' });
      }
      if (p.startsWith('/project/preview/')) {
        // Trusted project preview module declared in catalog.config.json.
        const m = app.previewModule(decodeURIComponent(url.pathname.slice('/project/preview/'.length)));
        // A pinned request must get exactly that revision.
        const want = url.searchParams.get('v');
        if (want && !m.sha256.startsWith(want)) return send(res, 409, { error: { code: 'conflict', message: `preview module revision ${want} is not available (current ${m.sha256.slice(0, 16)})` } });
        return serveBytes(req, res, m.bytes, TYPES['.js'], { etag: `"${m.sha256}"`, 'cache-control': 'no-cache', 'content-security-policy': "default-src 'none'" });
      }
      if (p.startsWith('/vendor/')) {
        const rest = p.slice('/vendor/'.length);
        const key = Object.keys(VENDOR).find((k) => rest.startsWith(k));
        const base = key && join(MODULES, VENDOR[key]);
        const file = base && resolve(base, rest.slice(key.length));
        if (!file || !inside(base, file) || !/\.(m?js)$/.test(file) || !existsSync(file) || !insideReal(base, file)) return send(res, 404, { error: { code: 'not_found', message: 'not found' } });
        return serveFile(req, res, file, TYPES['.js'], { 'cache-control': 'no-cache', 'content-security-policy': "default-src 'none'" });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: { code: 'invalid', message: 'method not allowed' } });
      if (p === '/' || p === '/index.html') {
        res.writeHead(200, { 'content-type': TYPES['.html'], 'content-security-policy': csp, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-cache' });
        return res.end(indexHtml);
      }
      const file = resolve(WEB, `.${p}`);
      if (!inside(WEB, file) || !existsSync(file) || !TYPES[extname(file)] || !insideReal(WEB, file)) return send(res, 404, { error: { code: 'not_found', message: 'not found' } });
      return serveFile(req, res, file, TYPES[extname(file)], { 'cache-control': 'no-cache', 'content-security-policy': "default-src 'none'" });
    } catch (e) { if (!res.headersSent) sendError(res, e); else res.destroy(); }
  });
  server.requestTimeout = 120000;
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, host, ok); });
  const close = async () => { await renderer.close(); await new Promise((r) => server.close(r)); };
  return { server, url: `http://${host}:${server.address().port}/`, port: server.address().port, close, renderer };
}
