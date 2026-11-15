import { html, useEffect, useRef, useState, useCallback, Icon, prefersReducedMotion } from './core.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { registerViewer } from './controller.js';

const Msg = ({ status, error, onRetry, name }) => html`
  ${status === 'loading' && html`<div class="viewer-msg" aria-live="polite"><span class="spin" aria-label="Loading"></span></div>`}
  ${status === 'error' && html`<div class="viewer-msg err" role="alert"><span>${error ?? `Failed to load ${name ?? ''}`}</span>${onRetry && html`<button class="btn xs" onClick=${onRetry}>Retry</button>`}</div>`}`;

// ---------- 2D image: fit, zoom around pointer, pan, 1:1; controlled or uncontrolled view ----------
export function ImageViewer({ src, label, view: extView, onView, viewerId, source, onStatus }) {
  const box = useRef(); const img = useRef();
  const [loaded, setLoaded] = useState({ src: null });
  const [failed, setFailed] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [localView, setLocalView] = useState(null);
  const natural = loaded.src === src ? loaded : null;
  const status = failed === src ? 'error' : natural ? 'ready' : 'loading';
  const view = extView !== undefined ? extView : localView;
  const setView = onView ?? setLocalView;
  const [, force] = useState(0);
  useEffect(() => { const ro = new ResizeObserver(() => force((n) => n + 1)); ro.observe(box.current); return () => ro.disconnect(); }, []);
  useEffect(() => { onStatus?.(status); }, [status]);
  const fit = () => {
    if (!natural || !box.current) return null;
    const r = box.current.getBoundingClientRect();
    const scale = Math.min((r.width - 24) / natural.w, (r.height - 24) / natural.h, 4);
    return { scale, x: (r.width - natural.w * scale) / 2, y: (r.height - natural.h * scale) / 2 };
  };
  const v = view ?? fit();
  const center = () => { const r = box.current.getBoundingClientRect(); return [r.width / 2, r.height / 2]; };
  const zoomAt = (factor, cx, cy) => { if (!v) return; const scale = Math.min(32, Math.max(0.05, v.scale * factor)); const k = scale / v.scale; setView({ scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }); };
  const oneToOne = () => { const [cx, cy] = center(); setView({ scale: 1, x: cx - natural.w / 2, y: cy - natural.h / 2 }); };
  useEffect(() => {
    const el = box.current;
    const wheel = (e) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });
  const onDown = (e) => {
    if (!v || e.button !== 0 || e.target.closest('.viewer-tools')) return;
    const el = box.current; const start = { x: e.clientX, y: e.clientY, v };
    el.setPointerCapture(e.pointerId);
    const move = (m) => setView({ ...start.v, x: start.v.x + m.clientX - start.x, y: start.v.y + m.clientY - start.y });
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  const onKey = (e) => {
    if (e.key === '+' || e.key === '=') zoomAt(1.25, ...center());
    else if (e.key === '-') zoomAt(0.8, ...center());
    else if (e.key === '0') setView(null);
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  registerViewer(viewerId, () => ({ kind: 'image', status, error: status === 'error' ? `Failed to load ${source?.path ?? src}` : null, source, natural: natural ? { width: natural.w, height: natural.h } : null, zoom: v ? { scale: +v.scale.toFixed(4), x: Math.round(v.x), y: Math.round(v.y) } : null, controls: ['zoom'] }),
    (c) => { if (c.zoom) { if (c.zoom.fit) setView(null); else setView({ scale: c.zoom.scale ?? v?.scale ?? 1, x: c.zoom.x ?? v?.x ?? 0, y: c.zoom.y ?? v?.y ?? 0 }); return true; } return false; });
  return html`<div class="viewer viewer-2d" ref=${box} tabindex="0" data-viewer-input aria-label=${label ?? 'Image'} onPointerDown=${onDown} onDblClick=${() => (view ? setView(null) : natural && oneToOne())} onKeyDown=${onKey}>
    <${Msg} status=${status} error=${status === 'error' ? 'Image could not be decoded or loaded' : null} onRetry=${() => { setFailed(null); setNonce(nonce + 1); }} />
    <img ref=${img} key=${`${src}#${nonce}`} src=${src} draggable="false" alt="" style=${v ? `transform: translate(${v.x}px, ${v.y}px) scale(${v.scale}); opacity: 1` : 'opacity:0'}
      onLoad=${async (e) => { const el = e.target; try { await el.decode(); setLoaded({ src, w: el.naturalWidth, h: el.naturalHeight }); } catch { setFailed(src); } }} onError=${() => setFailed(src)} />
    ${natural && html`<div class="viewer-tools">
      <button class="tool" onClick=${() => setView(null)} title="Fit (0)">Fit</button>
      <button class="tool" onClick=${oneToOne} title="Actual size">1:1</button>
      <span class="tool-readout">${Math.round((v?.scale ?? 1) * 100)}%</span>
    </div>`}
  </div>`;
}

// ---------- Video: ordinary controls, muted, no surprise audio; explicit readiness ----------
export function VideoViewer({ src, videoRef, viewerId, source, onStatus }) {
  const [status, setStatus] = useState('loading');
  const [nonce, setNonce] = useState(0);
  const local = useRef(); const ref = videoRef ?? local;
  useEffect(() => setStatus('loading'), [src, nonce]);
  useEffect(() => { onStatus?.(status); }, [status]);
  registerViewer(viewerId, () => ({ kind: 'video', status, error: status === 'error' ? `Video could not be played: ${source?.path ?? src}` : null, source, time: ref.current ? +ref.current.currentTime.toFixed(2) : null, duration: ref.current?.duration ?? null, paused: ref.current?.paused ?? null, controls: ['video'] }),
    (c) => { if (c.video && ref.current) { if (c.video.time != null) ref.current.currentTime = c.video.time; if (c.video.playing === false) ref.current.pause(); if (c.video.playing === true) ref.current.play(); return true; } return false; });
  return html`<div class="viewer viewer-video">
    <${Msg} status=${status} error="Video could not be decoded or loaded" onRetry=${() => setNonce(nonce + 1)} />
    <video key=${`${src}#${nonce}`} ref=${ref} src=${src} controls loop muted playsinline preload="auto" autoplay=${!prefersReducedMotion()} data-viewer-input
      onLoadedData=${() => setStatus('ready')} onError=${() => setStatus('error')} style=${status === 'error' ? 'visibility:hidden' : ''}></video>
  </div>`;
}

// ---------- 3D model (GLB) ----------
export function createCameraSync() {
  const subs = new Set();
  return { subs, anim: null, publish(from, msg) { if (msg.anim) this.anim = msg.anim; for (const s of subs) if (s !== from) s(msg); } };
}
const loader = new GLTFLoader();
const CLAY = new THREE.MeshStandardMaterial({ color: '#b8b2a7', roughness: 0.85, metalness: 0 });
const TEX_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'];

async function loadGltf(url, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(r.status === 404 ? 'file not found' : (await r.json().catch(() => null))?.error?.message ?? `HTTP ${r.status}`);
  const buf = await r.arrayBuffer();
  return new Promise((ok, fail) => loader.parse(buf, '', ok, (e) => fail(new Error(`not a readable GLB model (${e.message ?? e})`))));
}
function disposeScene(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material ?? [])) { for (const s of TEX_SLOTS) m[s]?.dispose?.(); m.dispose?.(); }
  });
}

// srcs and ghost entries are URLs or { url, position, rotation, scale } placements.
export function ModelViewer({ srcs, ghost = [], sync, label, viewerId, source, initialCamera, initialState, keepCamera, onStatus, animationNote }) {
  const box = useRef();
  const api = useRef({});
  const [st, setSt] = useState({ status: 'loading', error: null });
  const [mode, setMode] = useState('textured');
  const [clips, setClips] = useState([]);
  const [anim, setAnim] = useState({ clip: null, playing: false });
  const [meshes, setMeshes] = useState([]);
  const [isolate, setIsolate] = useState(null);
  const [textures, setTextures] = useState([]);
  const [texView, setTexView] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [missingClip, setMissingClip] = useState(null);
  const [restoreIssues, setRestoreIssues] = useState([]);
  const items = srcs.map((x) => (typeof x === 'string' ? { url: x } : x));
  const ghosts = ghost.map((x) => (typeof x === 'string' ? { url: x } : x));

  // Renderer lifetime: one per viewer, disposed on unmount.
  useEffect(() => {
    const el = box.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#14171b');
    scene.add(new THREE.HemisphereLight('#e4ecff', '#2a2218', 1.5));
    const key = new THREE.DirectionalLight('#ffffff', 2.4); key.position.set(2, 3.5, 2.5); scene.add(key);
    const rim = new THREE.DirectionalLight('#9fb8ff', 0.8); rim.position.set(-2, 1.5, -2.5); scene.add(rim);
    const grid = new THREE.GridHelper(4, 16, '#2c323a', '#20252b'); scene.add(grid);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    const root = new THREE.Group(); scene.add(root);
    const mixerClock = new THREE.Clock();
    let mixer = null, action = null, playing = false, raf = 0, applying = false;
    const render = () => renderer.render(scene, camera);
    const tick = () => { raf = 0; if (!playing || document.hidden) return; mixer?.update(mixerClock.getDelta()); render(); raf = requestAnimationFrame(tick); };
    const resize = () => { const r = el.getBoundingClientRect(); renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'; camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); render(); };
    const ro = new ResizeObserver(resize); ro.observe(el);
    const onSync = (msg) => {
      if (msg.camera) { applying = true; camera.position.fromArray(msg.camera.position); controls.target.fromArray(msg.camera.target); controls.update(); applying = false; render(); }
      if (msg.anim) api.current.onSyncAnim?.(msg.anim);
    };
    if (sync) sync.subs.add(onSync);
    controls.addEventListener('change', () => { render(); if (sync && !applying) sync.publish(onSync, { camera: { position: camera.position.toArray(), target: controls.target.toArray() } }); });
    const vis = () => { if (!document.hidden && playing && !raf) { mixerClock.getDelta(); raf = requestAnimationFrame(tick); } };
    document.addEventListener('visibilitychange', vis);
    let home = null, radius = 1;
    api.current = {
      renderer, scene, camera, controls, root, render,
      fit(keep) {
        const b = new THREE.Box3().setFromObject(root);
        if (b.isEmpty()) return;
        const c = b.getCenter(new THREE.Vector3()); const size = b.getSize(new THREE.Vector3()).length() || 1;
        const prev = keep && api.current.lastOffset;
        home = { pos: new THREE.Vector3(c.x + size * 0.75, c.y + size * 0.35, c.z + size * 1.2), target: c };
        camera.near = size / 100; camera.far = size * 40; camera.updateProjectionMatrix();
        if (prev) { camera.position.copy(c).add(prev.clone().multiplyScalar(size)); controls.target.copy(c); }
        else { camera.position.copy(home.pos); controls.target.copy(home.target); }
        radius = size;
        controls.update(); grid.position.y = b.min.y; render();
      },
      reset() { if (home) { camera.position.copy(home.pos); controls.target.copy(home.target); controls.update(); } },
      remember() { api.current.lastOffset = camera.position.clone().sub(controls.target).multiplyScalar(1 / radius); },
      setCamera(c) { if (c.position) camera.position.fromArray(c.position); if (c.target) controls.target.fromArray(c.target); controls.update(); },
      setMixer(m) { mixer?.stopAllAction(); mixer = m; action = null; },
      animate(a, fromSync) {
        if (!mixer) return { missing: a.clip ?? null };
        mixer.stopAllAction(); action = null; playing = false;
        const clip = a.clip && api.current.clips.find((c) => c.name === a.clip);
        if (a.clip && !clip) { api.current.resetPose(); render(); return { missing: a.clip }; }
        if (clip) { action = mixer.clipAction(clip); action.play(); mixer.setTime(a.time ?? 0); playing = !!a.playing && !prefersReducedMotion(); if (playing) { mixerClock.getDelta(); raf ||= requestAnimationFrame(tick); } }
        else api.current.resetPose();
        render();
        if (!fromSync && sync) sync.publish(onSync, { anim: a });
        return { missing: null };
      },
      time: () => (mixer ? +mixer.time.toFixed(3) : null),
      dispose() { cancelAnimationFrame(raf); playing = false; mixer?.stopAllAction(); for (const ch of [...root.children]) { disposeScene(ch); root.remove(ch); } },
    };
    resize();
    return () => { api.current.dispose(); ro.disconnect(); sync?.subs.delete(onSync); document.removeEventListener('visibilitychange', vis); controls.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); };
  }, []);

  // Content lifetime: obsolete loads are aborted and their results discarded.
  const key = `${JSON.stringify(items)}#${JSON.stringify(ghosts)}#${JSON.stringify(initialState ?? null)}#${nonce}`;
  useEffect(() => {
    const ctrl = new AbortController();
    const a = api.current;
    if (a.root.children.length) a.remember();
    a.dispose();
    setSt({ status: 'loading', error: null }); setIsolate(null); setTexView(null);
    const place = (g, it) => { if (it.position) g.scene.position.fromArray(it.position); if (it.rotation) g.scene.rotation.fromArray(it.rotation); if (it.scale != null) g.scene.scale.setScalar(it.scale); return g; };
    Promise.all([...ghosts.map((it) => loadGltf(it.url, ctrl.signal).then((g) => ({ g: place(g, it), ghost: true }))), ...items.map((it) => loadGltf(it.url, ctrl.signal).then((g) => ({ g: place(g, it) })))])
      .then((items) => {
        if (ctrl.signal.aborted) { items.forEach(({ g }) => disposeScene(g.scene)); return; }
        const all = []; const tex = new Map(); const allClips = [];
        for (const { g, ghost: isGhost } of items) {
          g.scene.traverse((o) => {
            if (!o.isMesh) return;
            if (isGhost) { o.material = new THREE.MeshStandardMaterial({ color: '#8a8f96', transparent: true, opacity: 0.3, depthWrite: false }); return; }
            o.userData.original = o.material;
            all.push(o);
            for (const m of [].concat(o.material)) for (const s of TEX_SLOTS) if (m[s]?.image) tex.set(m[s].uuid, { id: m[s].uuid, name: m[s].name || `${m.name || 'material'} ${s}`, slot: s, texture: m[s] });
          });
          a.root.add(g.scene);
          if (!isGhost) allClips.push(...g.animations);
        }
        a.meshes = all; a.clips = allClips; a.textures = [...tex.values()];
        const rest = new Map(); a.root.traverse((o) => rest.set(o, { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }));
        a.resetPose = () => rest.forEach((v, o) => { o.position.copy(v.p); o.quaternion.copy(v.q); o.scale.copy(v.s); });
        a.setMixer(allClips.length ? new THREE.AnimationMixer(a.root) : null);
        setMeshes(all.map((m, i) => ({ i, name: m.name || `Mesh ${i + 1}` })));
        setClips(allClips.map((c) => ({ name: c.name, duration: +c.duration.toFixed(2) })));
        setTextures(a.textures.map((t) => ({ id: t.id, name: t.name, slot: t.slot, width: t.texture.image.width, height: t.texture.image.height })));
        a.fit(keepCamera);
        if (initialCamera) a.setCamera(initialCamera);
        // Restore a declared view state; anything the loaded model cannot honor is reported, not dropped.
        const issues = [];
        const st0 = initialState ?? {};
        const m0 = st0.mode ?? mode;
        setMode(m0); applyMode(m0);
        const shared = sync?.anim;
        const want = st0.animation ? { clip: st0.animation.clip ?? null, time: st0.animation.time ?? 0, playing: !!st0.animation.playing } : shared ?? (allClips.length && !prefersReducedMotion() ? { clip: allClips[0].name, time: 0, playing: false } : { clip: null });
        const r = a.animate(want, true); setMissingClip(r.missing); setAnim({ clip: r.missing ? null : want.clip ?? null, playing: !!want.playing && !r.missing });
        if (r.missing && st0.animation) issues.push(`animation "${r.missing}" is not in this model`);
        if (st0.isolate != null) { const k = all.findIndex((m, i) => i === st0.isolate || m.name === st0.isolate); if (k >= 0) { setIsolate(k); all.forEach((m, i) => { m.visible = i === k; }); } else issues.push(`mesh "${st0.isolate}" is not in this model`); }
        if (st0.texture != null) { const t = a.textures.find((x) => x.name === st0.texture || x.id === st0.texture); if (t) setTexView(t.id); else issues.push(`texture "${st0.texture}" is not in this model`); }
        setRestoreIssues(issues);
        a.render();
        setSt({ status: 'ready', error: null });
      })
      .catch((e) => { if (!ctrl.signal.aborted) setSt({ status: 'error', error: e.message }); });
    return () => ctrl.abort();
  }, [key]);
  useEffect(() => { onStatus?.(st.status); }, [st.status]);

  function applyMode(m) {
    const a = api.current;
    for (const mesh of a.meshes ?? []) {
      const orig = mesh.userData.original;
      if (m === 'textured') mesh.material = orig;
      else if (m === 'clay') mesh.material = CLAY;
      else mesh.material = [].concat(orig).map((x) => { const w = x.clone(); w.wireframe = true; return w; }).at(0);
    }
    a.render?.();
  }
  const setModeAndApply = (m) => { setMode(m); applyMode(m); };
  const doIsolate = (i) => { setIsolate(i); for (const [k, m] of (api.current.meshes ?? []).entries()) m.visible = i == null || k === i; api.current.render(); };
  const doAnimate = (a, fromSync) => { const r = api.current.animate(a, fromSync); setMissingClip(r.missing); setAnim({ clip: r.missing ? null : a.clip, playing: !!a.playing && !r.missing }); };
  api.current.onSyncAnim = (a) => doAnimate(a, true);

  registerViewer(viewerId, () => {
    const a = api.current;
    return {
      kind: 'model', status: st.status, error: st.error, source, restoreIssues, files: { models: items.map((x) => x.url), ghosts: ghosts.map((x) => x.url) },
      camera: a.camera ? { position: a.camera.position.toArray().map((x) => +x.toFixed(4)), target: a.controls.target.toArray().map((x) => +x.toFixed(4)) } : null,
      mode, modes: ['textured', 'clay', 'wireframe'], clips, animation: { ...anim, time: a.time?.() ?? null, missing: missingClip }, meshes, isolate, textures: textures.map(({ id, name, slot, width, height }) => ({ id, name, slot, width, height })),
      controls: ['camera', 'mode', ...(clips.length ? ['animation'] : []), ...(meshes.length > 1 ? ['isolate'] : []), ...(textures.length ? ['texture'] : [])],
    };
  }, (c) => {
    if (st.status !== 'ready') return false;
    let did = false;
    if (c.camera) { api.current.setCamera(c.camera); did = true; }
    if (c.mode) { if (!['textured', 'clay', 'wireframe'].includes(c.mode)) return { error: `unknown mode ${c.mode}`, code: 'invalid' }; setModeAndApply(c.mode); did = true; }
    if (c.animation) { if (c.animation.clip && !clips.some((x) => x.name === c.animation.clip)) return { error: `this model has no animation clip "${c.animation.clip}"`, code: 'unsupported' }; doAnimate({ clip: c.animation.clip ?? null, time: c.animation.time ?? 0, playing: !!c.animation.playing }); did = true; }
    if (c.isolate !== undefined) { if (c.isolate !== null && !meshes.some((m) => m.i === c.isolate || m.name === c.isolate)) return { error: 'no such mesh', code: 'invalid' }; doIsolate(c.isolate === null ? null : meshes.find((m) => m.i === c.isolate || m.name === c.isolate).i); did = true; }
    if (c.texture !== undefined) { if (c.texture !== null && !textures.some((t) => t.id === c.texture || t.name === c.texture)) return { error: 'no such texture', code: 'unsupported' }; setTexView(c.texture === null ? null : textures.find((t) => t.id === c.texture || t.name === c.texture).id); did = true; }
    return did;
  });

  const texImage = texView && api.current.textures?.find((t) => t.id === texView);
  return html`<div class="viewer viewer-3d" ref=${box} tabindex="0" data-viewer-input aria-label=${label ?? '3D model'} onKeyDown=${(e) => { if (e.key === '0') { api.current.reset(); e.stopPropagation(); } }}>
    <${Msg} status=${st.status} error=${st.error && `Model failed to load: ${st.error}`} onRetry=${() => setNonce(nonce + 1)} />
    ${st.status === 'ready' && html`<div class="viewer-tools" onPointerDown=${(e) => e.stopPropagation()}>
      <button class="tool" onClick=${() => api.current.reset()} title="Reset view (0)">Reset</button>
      <span class="seg tool-seg" role="radiogroup" aria-label="Surface">${['textured', 'clay', 'wireframe'].map((m) => html`<button role="radio" aria-checked=${mode === m} class=${`tool${mode === m ? ' on' : ''}`} onClick=${() => setModeAndApply(m)}>${{ textured: 'Material', clay: 'Clay', wireframe: 'Wire' }[m]}</button>`)}</span>
      ${clips.length > 0 && html`<select class="tool" aria-label="Animation" value=${anim.clip ?? ''} onChange=${(e) => doAnimate({ clip: e.target.value || null, time: 0, playing: !!e.target.value })}>
        <option value="">Rest pose</option>${clips.map((c) => html`<option value=${c.name}>${c.name}</option>`)}</select>`}
      ${clips.length > 0 && anim.clip && html`<button class="tool" aria-pressed=${anim.playing} onClick=${() => doAnimate({ clip: anim.clip, time: api.current.time() ?? 0, playing: !anim.playing })}>${anim.playing ? 'Pause' : 'Play'}</button>`}
      ${meshes.length > 1 && html`<select class="tool" aria-label="Isolate mesh" value=${isolate ?? ''} onChange=${(e) => doIsolate(e.target.value === '' ? null : +e.target.value)}><option value="">All meshes</option>${meshes.map((m) => html`<option value=${m.i}>${m.name}</option>`)}</select>`}
      ${textures.length > 0 && html`<select class="tool" aria-label="Inspect texture" value=${texView ?? ''} onChange=${(e) => setTexView(e.target.value || null)}><option value="">Textures</option>${textures.map((t) => html`<option value=${t.id}>${t.name} · ${t.width}×${t.height}</option>`)}</select>`}
    </div>`}
    ${(missingClip || animationNote || restoreIssues.length > 0) && st.status === 'ready' && html`<div class="viewer-note">${[missingClip && `No "${missingClip}" clip · rest pose`, animationNote, ...restoreIssues.filter((x) => !x.startsWith('animation'))].filter(Boolean).join(' · ')}</div>`}
    ${texImage && html`<${TexturePanel} t=${texImage} onClose=${() => setTexView(null)} />`}
  </div>`;
}

function TexturePanel({ t, onClose }) {
  const ref = useRef();
  useEffect(() => {
    const img = t.texture.image; const c = ref.current;
    c.width = img.width; c.height = img.height;
    try { c.getContext('2d').drawImage(img, 0, 0); } catch {}
  }, [t.id]);
  return html`<div class="tex-panel"><div class="tex-h"><span>${t.name}</span><span class="muted">${t.texture.image.width}×${t.texture.image.height}</span><button class="icon-btn sm" aria-label="Close texture" onClick=${onClose}><${Icon} name="x" size=${12} /></button></div><canvas ref=${ref}></canvas></div>`;
}

export function UnavailableViewer({ asset, viewerId, source, message }) {
  const error = message ?? asset?.error ?? 'Not available';
  registerViewer(viewerId, () => ({ kind: asset?.kind ?? null, status: 'error', error, state: asset?.state ?? null, source, controls: [] }), () => false);
  return html`<div class="viewer"><div class="viewer-msg err" role="alert">${error}</div></div>`;
}

export function AssetViewer({ asset, viewerId, sync, view, onView, source, keepCamera, initialCamera, onStatus }) {
  if (!asset || asset.state !== 'ok') return html`<${UnavailableViewer} asset=${asset} viewerId=${viewerId} source=${source} />`;
  if (asset.kind === 'model') return html`<${ModelViewer} srcs=${[asset.url]} sync=${sync} label=${asset.id} viewerId=${viewerId} source=${source} keepCamera=${keepCamera} initialCamera=${initialCamera} onStatus=${onStatus} />`;
  if (asset.kind === 'video') return html`<${VideoViewer} src=${asset.url} viewerId=${viewerId} source=${source} onStatus=${onStatus} />`;
  return html`<${ImageViewer} src=${asset.url} view=${view} onView=${onView} label=${asset.id} viewerId=${viewerId} source=${source} onStatus=${onStatus} />`;
}

export { useCallback };
