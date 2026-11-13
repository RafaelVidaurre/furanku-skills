// <model-thumb src sha>: model thumbnails rendered by one shared offscreen WebGL renderer,
// lazily (near the viewport), sequentially, cancellable, cached by content digest + renderer version.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const RENDER_VERSION = 'thumb-v1-256';
const MEM_LIMIT = 300;
const mem = new Map();
const loader = new GLTFLoader();
let renderer = null, scene, camera;
const queue = [];
let running = false;

let dbp = null;
function db() {
  dbp ??= new Promise((ok) => {
    try {
      const r = indexedDB.open('catalog-thumbs', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('thumbs');
      r.onsuccess = () => ok(r.result); r.onerror = () => ok(null);
    } catch { ok(null); }
  });
  return dbp;
}
async function idbGet(k) { const d = await db(); if (!d) return null; return new Promise((ok) => { const r = d.transaction('thumbs').objectStore('thumbs').get(k); r.onsuccess = () => ok(r.result ?? null); r.onerror = () => ok(null); }); }
async function idbPut(k, v) { const d = await db(); if (!d) return; try { d.transaction('thumbs', 'readwrite').objectStore('thumbs').put(v, k); } catch {} }
function remember(k, v) { mem.delete(k); mem.set(k, v); if (mem.size > MEM_LIMIT) mem.delete(mem.keys().next().value); }

function setup() {
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.setSize(256, 256, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#15181c');
  scene.add(new THREE.HemisphereLight('#e4ecff', '#2a2218', 1.6));
  const d = new THREE.DirectionalLight('#fff', 2.2); d.position.set(2, 3, 2); scene.add(d);
  camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
}

async function render(el) {
  const key = `${RENDER_VERSION}:${el.sha}`;
  if (mem.has(key)) return mem.get(key);
  const cached = await idbGet(key);
  if (cached) { remember(key, cached); return cached; }
  if (el.cancelled) return null;
  const r = await fetch(el.src, { signal: el.ctrl.signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = await r.arrayBuffer();
  const gltf = await new Promise((ok, fail) => loader.parse(buf, '', ok, fail));
  if (!renderer) setup();
  const obj = gltf.scene;
  scene.add(obj);
  const b = new THREE.Box3().setFromObject(obj);
  const c = b.getCenter(new THREE.Vector3()); const size = b.getSize(new THREE.Vector3()).length() || 1;
  camera.near = size / 100; camera.far = size * 20; camera.updateProjectionMatrix();
  camera.position.set(c.x + size * 0.62, c.y + size * 0.3, c.z + size * 0.95); camera.lookAt(c);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/webp', 0.86);
  scene.remove(obj);
  obj.traverse((o) => { o.geometry?.dispose(); for (const m of [].concat(o.material ?? [])) { for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) m[k]?.dispose(); m.dispose(); } });
  remember(key, url); idbPut(key, url);
  return url;
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const el = queue.shift();
    if (el.cancelled || !el.isConnected) continue;
    try { const url = await render(el); if (url && el.isConnected) el.show(url); }
    catch (e) { if (el.isConnected && e.name !== 'AbortError') el.fail(); }
  }
  running = false;
}

const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting && !e.target.queued) { e.target.queued = true; io.unobserve(e.target); queue.push(e.target); pump(); }
}, { rootMargin: '160px' });

class ModelThumb extends HTMLElement {
  static get observedAttributes() { return ['src', 'sha']; }
  connectedCallback() { this.start(); }
  attributeChangedCallback() { if (this.isConnected) this.start(); }
  start() {
    this.stop();
    this.src = this.getAttribute('src'); this.sha = this.getAttribute('sha');
    if (!this.src || !this.sha) return;
    this.cancelled = false; this.queued = false; this.ctrl = new AbortController();
    const hit = mem.get(`${RENDER_VERSION}:${this.sha}`);
    if (hit) return this.show(hit);
    this.innerHTML = '';
    io.observe(this);
  }
  stop() { this.cancelled = true; this.ctrl?.abort(); io.unobserve(this); }
  disconnectedCallback() { this.stop(); }
  show(url) { const img = document.createElement('img'); img.alt = ''; img.src = url; this.replaceChildren(img); }
  fail() { this.replaceChildren(); this.classList.add('failed'); this.title = 'Model preview unavailable'; }
}
customElements.define('model-thumb', ModelThumb);
