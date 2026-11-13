// Procedural art for the Hollowmere sample project: PNG images (rendered from SVG), GLB models
// and MP4 clips. Used only by the example/test project, never by a real project catalog.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '../..');

globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((r) => { this.result = r; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then((r) => { this.result = 'data:application/octet-stream;base64,' + Buffer.from(r).toString('base64'); this.onloadend?.(); }); }
};

const P = {
  steel: { bg: ['#3a4656', '#141a22'], m: ['#e3e9f0', '#6f7c8c'], a: '#b8433a' },
  rust: { bg: ['#4a3a2c', '#1a130d'], m: ['#d0a47a', '#6b4128'], a: '#8a3b22' },
  leather: { bg: ['#4c3b2a', '#1b140d'], m: ['#d3a46a', '#6f4a26'], a: '#3e6b4a' },
  ash: { bg: ['#3a1f1f', '#120909'], m: ['#6a6470', '#1e1b22'], a: '#ff6a2a' },
  oak: { bg: ['#3f4a2a', '#151a0e'], m: ['#d39d5e', '#7a5230'], a: '#b8433a' },
  fire: { bg: ['#4a1a0e', '#120604'], m: ['#ffe07a', '#ff4d1a'], a: '#fff3b0' },
  frost: { bg: ['#18324a', '#081420'], m: ['#f0faff', '#4aa8e0'], a: '#ffffff' },
  shadow: { bg: ['#2a2240', '#0c0a14'], m: ['#c9b8ff', '#5b46b8'], a: '#ffffff' },
  stone: { bg: ['#3a3a36', '#121210'], m: ['#cfc9b6', '#66625a'], a: '#9fd0ff' },
  mire: { bg: ['#24402e', '#0a140e'], m: ['#a6dc7e', '#356a32'], a: '#f2f76a' },
  matriarch: { bg: ['#2e2440', '#0d0a14'], m: ['#c08ae0', '#4a2a6a'], a: '#f7e86a' },
  ridge: { bg: ['#33404c', '#0f1418'], m: ['#c4ccd4', '#55606b'], a: '#ffcf5a' },
  cinder: { bg: ['#3a1a10', '#100604'], m: ['#ffa24e', '#7a2a10'], a: '#fff0a8' },
  clay: { bg: ['#333', '#111'], m: ['#bdb6aa', '#8a8378'], a: '#999' },
};

// ---------- SVG ----------
const SHAPES = {
  helm: (o) => `<path d="M-62 26 C-62 -46 -32 -76 0 -76 C32 -76 62 -46 62 26 L62 58 L26 58 L26 14 L-26 14 L-26 58 L-62 58 Z" fill="url(#m)" stroke="#0b0d10" stroke-width="5" stroke-linejoin="round"/>
    <rect x="-46" y="-6" width="92" height="11" rx="3" fill="#0b0d10"/><path d="M0 -76 L0 10" stroke="#0b0d10" stroke-width="3" opacity=".5"/>
    ${o.crest ? `<path d="M-6 -74 C-4 -100 30 -112 62 -86 L50 -72 C30 -88 14 -84 8 -72 Z" fill="${o.p.a}" stroke="#0b0d10" stroke-width="4" stroke-linejoin="round"/>` : ''}`,
  hood: () => `<path d="M-64 64 C-74 -30 -30 -86 0 -86 C30 -86 74 -30 64 64 L30 64 C36 6 20 -12 0 -12 C-20 -12 -36 6 -30 64 Z" fill="url(#m)" stroke="#0b0d10" stroke-width="5" stroke-linejoin="round"/>
    <ellipse cx="0" cy="26" rx="28" ry="36" fill="#0b0d10" opacity=".85"/>`,
  chest: (o) => `<path d="M-72 -58 L-30 -72 Q0 -50 30 -72 L72 -58 L64 2 Q52 62 0 76 Q-52 62 -64 2 Z" fill="url(#m)" stroke="#0b0d10" stroke-width="5" stroke-linejoin="round"/>
    <path d="M0 -52 L0 70" stroke="#0b0d10" stroke-width="3" opacity=".45"/><path d="M-50 14 Q0 34 50 14" stroke="#0b0d10" stroke-width="4" fill="none" opacity=".55"/>
    ${[-40, 40].map((x) => `<circle cx="${x}" cy="-40" r="5" fill="${o.p.a}"/>`).join('')}`,
  gloves: () => `<path d="M-40 72 L-40 12 L-54 -8 L-52 -58 L-36 -60 L-32 -20 L-24 -76 L-8 -76 L-6 -26 L2 -84 L18 -82 L16 -24 L26 -72 L42 -70 L36 -10 L56 -32 L68 -20 L40 30 L40 72 Z" fill="url(#m)" stroke="#0b0d10" stroke-width="5" stroke-linejoin="round"/>
    <rect x="-44" y="42" width="88" height="14" fill="#0b0d10" opacity=".4"/>`,
  boots: () => `<path d="M-34 -82 L18 -82 L18 -2 L68 26 L72 62 L-42 62 L-42 36 Z" fill="url(#m)" stroke="#0b0d10" stroke-width="5" stroke-linejoin="round"/>
    <rect x="-46" y="58" width="122" height="14" rx="4" fill="#0b0d10"/><path d="M-34 -50 L18 -50" stroke="#0b0d10" stroke-width="4" opacity=".5"/>`,
  sword: (o) => `<g transform="rotate(45)"><path d="M-8 -100 L0 -116 L8 -100 L8 36 L-8 36 Z" fill="url(#m)" stroke="#0b0d10" stroke-width="5" stroke-linejoin="round"/>
    <rect x="-38" y="34" width="76" height="12" rx="4" fill="${o.p.a}" stroke="#0b0d10" stroke-width="4"/><rect x="-6" y="46" width="12" height="40" fill="#4a2e1a" stroke="#0b0d10" stroke-width="4"/>
    <circle cx="0" cy="92" r="10" fill="${o.p.a}" stroke="#0b0d10" stroke-width="4"/></g>`,
  shield: (o) => `<path d="M-64 -72 L64 -72 L64 -10 Q64 52 0 86 Q-64 52 -64 -10 Z" fill="url(#m)" stroke="#0b0d10" stroke-width="5" stroke-linejoin="round"/>
    <path d="M0 -60 L0 70 M-52 -14 L52 -14" stroke="${o.p.a}" stroke-width="12"/>`,
  buckler: (o) => `<circle r="74" fill="url(#m)" stroke="#0b0d10" stroke-width="5"/><circle r="56" fill="none" stroke="#0b0d10" stroke-width="3" opacity=".4"/>
    <circle r="20" fill="#9aa3ad" stroke="#0b0d10" stroke-width="4"/>${[0, 60, 120, 180, 240, 300].map((a) => `<circle cx="${Math.cos(a * Math.PI / 180) * 64}" cy="${Math.sin(a * Math.PI / 180) * 64}" r="4" fill="#0b0d10"/>`).join('')}`,
  flame: () => `<path d="M0 -88 C32 -40 60 -20 52 22 C46 62 18 82 0 82 C-18 82 -50 66 -52 24 C-54 -6 -30 -22 -24 -52 C-10 -32 -6 -26 0 -88 Z" fill="url(#m)" stroke="#2a0a02" stroke-width="4"/>
    <path d="M0 -20 C14 6 26 18 22 40 C18 60 8 66 0 66 C-8 66 -24 58 -24 40 C-24 22 -10 12 0 -20 Z" fill="#fff3b0"/>`,
  frost: () => `${[-60, -20, 20, 60].map((a, i) => `<path d="M0 0 L${-10} -6 L0 ${-96 + i * 8} L10 -6 Z" transform="rotate(${a})" fill="url(#m)" stroke="#06223a" stroke-width="3"/>`).join('')}
    <path d="M-80 50 L80 -30" stroke="#ffffff" stroke-width="10" stroke-linecap="round"/><path d="M80 -30 L52 -36 L60 -10 Z" fill="#fff"/>`,
  dash: () => `${[-46, 0, 46].map((x, i) => `<path d="M${x - 26} -60 L${x + 22} 0 L${x - 26} 60" fill="none" stroke="url(#m)" stroke-width="${18 - i * 2}" stroke-linecap="round" stroke-linejoin="round" opacity="${0.45 + i * 0.27}"/>`).join('')}`,
  ward: () => `<path d="M0 -84 L72 -42 L72 42 L0 84 L-72 42 L-72 -42 Z" fill="none" stroke="url(#m)" stroke-width="14" stroke-linejoin="round"/><path d="M0 -50 L42 -24 L42 24 L0 50 L-42 24 L-42 -24 Z" fill="url(#m)" opacity=".6"/>`,
  ration: (o) => `<rect x="-70" y="-44" width="140" height="92" rx="22" fill="url(#m)" stroke="#0b0d10" stroke-width="5"/>
    <path d="M-30 -44 L-30 48 M30 -44 L30 48" stroke="${o.p.a}" stroke-width="8"/><path d="M-30 -44 C-50 -70 -60 -64 -66 -80 M30 -44 C46 -72 60 -66 64 -84" stroke="${o.p.a}" stroke-width="5" fill="none"/>`,
  flask: (o) => `<path d="M-14 -84 L14 -84 L14 -40 C56 -24 66 30 40 62 C24 82 -24 82 -40 62 C-66 30 -56 -24 -14 -40 Z" fill="#cfe9ff22" stroke="#0b0d10" stroke-width="5"/>
    <path d="M-52 18 C-40 8 40 8 52 18 C54 40 40 72 0 74 C-40 72 -54 40 -52 18 Z" fill="url(#m)"/><rect x="-20" y="-98" width="40" height="16" rx="4" fill="#7a5230" stroke="#0b0d10" stroke-width="4"/>
    <circle cx="-16" cy="34" r="6" fill="${o.p.a}" opacity=".8"/><circle cx="12" cy="50" r="4" fill="${o.p.a}" opacity=".8"/>`,
  bomb: (o) => `<circle cx="-6" cy="14" r="62" fill="url(#m)" stroke="#0b0d10" stroke-width="5"/><rect x="18" y="-58" width="26" height="22" rx="4" transform="rotate(35 30 -46)" fill="#3a3a3a" stroke="#0b0d10" stroke-width="4"/>
    <path d="M40 -60 C52 -86 70 -84 78 -96" stroke="#c9a46a" stroke-width="5" fill="none"/><circle cx="80" cy="-98" r="10" fill="${o.p.a}"/>`,
  herb: (o) => `${[-50, -15, 20, 55].map((a) => `<path d="M0 70 C-30 20 -28 -40 0 -86 C28 -40 30 20 0 70 Z" transform="rotate(${a} 0 70) scale(.8)" fill="url(#m)" stroke="#06223a" stroke-width="4"/>`).join('')}
    <circle cx="0" cy="-30" r="14" fill="${o.p.a}"/>`,
};

function iconSvg(o) {
  const p = P[o.palette];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
<defs><radialGradient id="bg" cx="50%" cy="38%" r="78%"><stop offset="0" stop-color="${p.bg[0]}"/><stop offset="1" stop-color="${p.bg[1]}"/></radialGradient>
<linearGradient id="m" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="${p.m[0]}"/><stop offset="1" stop-color="${p.m[1]}"/></linearGradient></defs>
<rect width="256" height="256" rx="30" fill="url(#bg)"/><rect x="7" y="7" width="242" height="242" rx="25" fill="none" stroke="${p.m[0]}" stroke-opacity=".22" stroke-width="3"/>
<g transform="translate(128 134)">${SHAPES[o.shape]({ ...o, p })}</g></svg>`;
}

const CREATURES = {
  lurker: (p, o) => `<ellipse cx="256" cy="430" rx="210" ry="34" fill="#000" opacity=".35"/>
    ${[-150, -95, -40, 40, 95, 150].map((x, i) => `<path d="M${256 + x * 0.6} 360 C${256 + x * 1.1} ${400 + (i % 2) * 20} ${256 + x * 1.5} 390 ${256 + x * 1.7} 430" stroke="${p.m[1]}" stroke-width="22" fill="none" stroke-linecap="round"/>`).join('')}
    <path d="M90 360 C70 220 160 130 256 130 C352 130 442 220 422 360 C380 400 132 400 90 360 Z" fill="url(#m)" stroke="#05080a" stroke-width="6"/>
    ${[[150, 190], [200, 150], [256, 140], [312, 150], [362, 190]].map(([x, y]) => `<path d="M${x - 14} ${y + 8} L${x} ${y - 34} L${x + 14} ${y + 8} Z" fill="${p.m[1]}"/>`).join('')}
    ${[[206, 270, 18], [256, 250, 24], [306, 270, 18]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r + (o.glow ? 14 : 0)}" fill="${p.a}" opacity="${o.glow ? 0.25 : 0}"/><circle cx="${x}" cy="${y}" r="${r}" fill="${p.a}"/><circle cx="${x}" cy="${y}" r="${r * 0.4}" fill="#05080a"/>`).join('')}
    <path d="M190 330 Q256 360 322 330" stroke="#05080a" stroke-width="8" fill="none"/>
    ${o.crown ? `<path d="M170 150 L196 84 L226 132 L256 66 L286 132 L316 84 L342 150 Z" fill="${p.a}" stroke="#05080a" stroke-width="6"/>` : ''}`,
  wolf: (p) => `<ellipse cx="256" cy="440" rx="170" ry="28" fill="#000" opacity=".35"/>
    <path d="M120 420 L150 250 L110 120 L200 190 L256 170 L312 190 L402 120 L362 250 L392 420 Q256 470 120 420 Z" fill="url(#m)" stroke="#05080a" stroke-width="6" stroke-linejoin="round"/>
    <path d="M200 300 L256 420 L312 300 Q256 330 200 300 Z" fill="${p.m[1]}"/><circle cx="210" cy="270" r="15" fill="${p.a}"/><circle cx="302" cy="270" r="15" fill="${p.a}"/>
    <path d="M236 392 L256 410 L276 392 Z" fill="#05080a"/>`,
  moth: (p) => `<ellipse cx="256" cy="440" rx="150" ry="22" fill="#000" opacity=".3"/>
    ${[-1, 1].map((s) => `<path d="M256 250 C${256 + s * 90} 90 ${256 + s * 230} 110 ${256 + s * 220} 220 C${256 + s * 210} 280 ${256 + s * 120} 270 256 260 Z" fill="url(#m)" stroke="#05080a" stroke-width="5"/>
      <path d="M256 270 C${256 + s * 160} 300 ${256 + s * 170} 390 ${256 + s * 100} 390 C${256 + s * 60} 390 ${256 + s * 30} 330 256 280 Z" fill="${p.m[1]}" stroke="#05080a" stroke-width="5"/>
      <circle cx="${256 + s * 140}" cy="190" r="22" fill="${p.a}" opacity=".85"/>`).join('')}
    <ellipse cx="256" cy="280" rx="22" ry="90" fill="#2a1408" stroke="#05080a" stroke-width="5"/>
    <path d="M246 196 C230 150 210 130 190 120 M266 196 C282 150 302 130 322 120" stroke="#2a1408" stroke-width="5" fill="none"/>`,
  toad: (p) => `<ellipse cx="256" cy="430" rx="200" ry="30" fill="#000" opacity=".35"/>
    <path d="M80 410 C70 300 150 230 256 230 C362 230 442 300 432 410 Z" fill="url(#m)" stroke="#05080a" stroke-width="6"/>
    <circle cx="190" cy="236" r="42" fill="url(#m)" stroke="#05080a" stroke-width="6"/><circle cx="322" cy="236" r="42" fill="url(#m)" stroke="#05080a" stroke-width="6"/>
    <circle cx="190" cy="232" r="20" fill="${p.a}"/><circle cx="322" cy="232" r="20" fill="${p.a}"/><rect x="184" y="222" width="12" height="20" rx="5" fill="#05080a"/><rect x="316" y="222" width="12" height="20" rx="5" fill="#05080a"/>
    <path d="M150 340 Q256 380 362 340" stroke="#05080a" stroke-width="7" fill="none"/>
    ${[[140, 300], [370, 310], [250, 290], [300, 380], [200, 380]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9" fill="${p.m[1]}"/>`).join('')}`,
  warden: (p) => `<ellipse cx="256" cy="450" rx="200" ry="26" fill="#000" opacity=".35"/>
    <path d="M150 440 L130 300 L90 260 L120 160 L200 130 L210 80 L302 80 L312 130 L392 160 L422 260 L382 300 L362 440 Z" fill="url(#m)" stroke="#05080a" stroke-width="6" stroke-linejoin="round"/>
    <rect x="220" y="110" width="72" height="22" fill="${p.a}" opacity=".9"/><path d="M200 220 L312 220 M180 300 L332 300 M256 140 L256 440" stroke="#05080a" stroke-width="5" opacity=".5"/>
    <text x="256" y="490" font-family="monospace" font-size="20" fill="#ffffff66" text-anchor="middle">PLACEHOLDER</text>`,
};

function portraitSvg(o) {
  const p = P[o.palette];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs><radialGradient id="bg" cx="50%" cy="35%" r="80%"><stop offset="0" stop-color="${p.bg[0]}"/><stop offset="1" stop-color="${p.bg[1]}"/></radialGradient>
<linearGradient id="m" x1="0" y1="0" x2="0.2" y2="1"><stop offset="0" stop-color="${p.m[0]}"/><stop offset="1" stop-color="${p.m[1]}"/></linearGradient></defs>
<rect width="512" height="512" fill="url(#bg)"/>${[0, 1, 2].map((i) => `<ellipse cx="${120 + i * 150}" cy="${400 + i * 8}" rx="160" ry="30" fill="${p.m[0]}" opacity=".05"/>`).join('')}
${CREATURES[o.shape](p, o)}</svg>`;
}

function sheetSvg(o) {
  const p = P[o.palette];
  const ink = '#2b2620';
  const items = o.creature
    ? [{ x: 300, y: 330, s: 0.9 }, { x: 760, y: 300, s: 0.55 }]
    : o.shapes.map((s, i) => ({ s, x: 150 + i * (760 / Math.max(1, o.shapes.length - 1 || 1)), y: 300 + (i % 2) * 30 }));
  const drawings = o.creature
    ? `<g transform="translate(40 40) scale(.9)" fill="none" stroke="${ink}" stroke-width="2.5" opacity=".85">${CREATURES[o.creature]({ ...p, m: [p.m[0], p.m[1]], a: p.a }, {}).replace(/fill="[^"]*"/g, 'fill="none"').replace(/stroke="#05080a"/g, `stroke="${ink}"`)}</g>
       <g transform="translate(560 110) scale(.6)" opacity=".9">${CREATURES[o.creature](p, {})}</g>`
    : items.map((it, i) => `<g transform="translate(${it.x} ${it.y}) scale(${i === 0 ? 1.5 : 1.2})">${SHAPES[it.s]({ p, crest: o.crest && i > 0 })
        .replace(/fill="url\(#m\)"/g, i % 2 ? 'fill="url(#m)"' : 'fill="none"').replace(/stroke="#0b0d10"/g, `stroke="${ink}"`)}</g>
        <text x="${it.x}" y="${it.y + 150}" font-family="Georgia, serif" font-style="italic" font-size="20" fill="${ink}" text-anchor="middle">${['front', 'side', 'detail', 'back', 'alt'][i % 5]}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 640" width="1024" height="640">
<defs><linearGradient id="m" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="${p.m[0]}"/><stop offset="1" stop-color="${p.m[1]}"/></linearGradient>
<pattern id="g" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0 L0 0 0 32" fill="none" stroke="#b9ae98" stroke-width=".6"/></pattern></defs>
<rect width="1024" height="640" fill="#ebe4d4"/><rect width="1024" height="640" fill="url(#g)" opacity=".6"/>
<text x="40" y="60" font-family="Georgia, serif" font-size="30" letter-spacing="4" fill="${ink}">${o.title}</text>
<path d="M40 74 L420 74" stroke="${ink}" stroke-width="1.5"/>
${drawings}
${[p.m[0], p.m[1], p.a, p.bg[0]].map((c, i) => `<circle cx="${880 + (i % 2) * 56}" cy="${520 + Math.floor(i / 2) * 56}" r="22" fill="${c}" stroke="${ink}" stroke-width="2"/>`).join('')}
<text x="40" y="606" font-family="Georgia, serif" font-style="italic" font-size="18" fill="${ink}" opacity=".8">rev. — keep silhouette readable at 20 m</text></svg>`;
}

// ---------- Meshes ----------
function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.6, metalness: o.metal ?? 0.1, emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissive ? 1 : 0, side: o.side ?? THREE.FrontSide });
}
function facet(geo) { const g = geo.toNonIndexed(); g.computeVertexNormals(); return g; }
function part(group, geo, material, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], name) {
  const m = new THREE.Mesh(facet(geo), material);
  m.position.set(...pos); m.rotation.set(...rot); m.scale.set(...scale); if (name) m.name = name;
  group.add(m); return m;
}

const MESHES = {
  mannequin: (g, p) => {
    const c = mat(p.m[1], { rough: 0.9 });
    part(g, new THREE.SphereGeometry(0.11, 10, 8), c, [0, 1.62, 0]);
    part(g, new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), c, [0, 1.5, 0]);
    part(g, new THREE.CylinderGeometry(0.21, 0.17, 0.55, 10), c, [0, 1.2, 0], [0, 0, 0], [1, 1, 0.6]);
    part(g, new THREE.CylinderGeometry(0.17, 0.15, 0.2, 10), c, [0, 0.88, 0], [0, 0, 0], [1, 1, 0.7]);
    for (const s of [-1, 1]) {
      part(g, new THREE.CapsuleGeometry(0.045, 0.5, 4, 8), c, [s * 0.29, 1.15, 0], [0, 0, s * 0.12]);
      part(g, new THREE.CapsuleGeometry(0.065, 0.7, 4, 8), c, [s * 0.1, 0.45, 0]);
    }
  },
  helm: (g, p, o) => {
    const m = mat(p.m[0], { metal: 0.8, rough: 0.35 });
    part(g, new THREE.SphereGeometry(0.15, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), m, [0, 1.6, 0], [0, 0, 0], [1, 1.15, 1.08]);
    part(g, new THREE.CylinderGeometry(0.15, 0.13, 0.14, 14, 1, true), m, [0, 1.56, 0], [0, 0, 0], [1, 1, 1.08]);
    part(g, new THREE.BoxGeometry(0.2, 0.018, 0.04), mat('#0b0d10'), [0, 1.6, 0.155]);
    for (const s of [-1, 1]) part(g, new THREE.BoxGeometry(0.03, 0.12, 0.1), m, [s * 0.14, 1.5, 0.06]);
    if (o.crest) part(g, new THREE.BoxGeometry(0.025, 0.12, 0.3), mat(p.a, { rough: 0.8 }), [0, 1.8, -0.02]);
    if (o.horns) for (const s of [-1, 1]) part(g, new THREE.ConeGeometry(0.035, 0.22, 8), mat(p.m[1], { emissive: '#3a0a00' }), [s * 0.17, 1.75, 0], [0, 0, -s * 0.9]);
  },
  hood: (g, p) => {
    const m = mat(p.m[0], { rough: 0.95 });
    part(g, new THREE.SphereGeometry(0.16, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.7), m, [0, 1.6, -0.01], [0, 0, 0], [1, 1.15, 1.1]);
    part(g, new THREE.ConeGeometry(0.28, 0.28, 12, 1, true), m, [0, 1.42, -0.02], [0, 0, 0], [1, 1, 0.75]);
  },
  chest: (g, p) => {
    const m = mat(p.m[0], { metal: p === P.leather ? 0.05 : 0.75, rough: p === P.leather ? 0.9 : 0.4 });
    part(g, new THREE.CylinderGeometry(0.24, 0.19, 0.56, 12), m, [0, 1.2, 0], [0, 0, 0], [1, 1, 0.64]);
    for (const s of [-1, 1]) part(g, new THREE.SphereGeometry(0.1, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), m, [s * 0.27, 1.42, 0], [0, 0, -s * 0.4]);
    part(g, new THREE.CylinderGeometry(0.2, 0.2, 0.05, 12), mat(p.a, { rough: 0.8 }), [0, 0.95, 0], [0, 0, 0], [1, 1, 0.68]);
  },
  gloves: (g, p) => {
    const m = mat(p.m[0], { metal: p === P.leather ? 0.05 : 0.75, rough: 0.45 });
    for (const s of [-1, 1]) {
      part(g, new THREE.BoxGeometry(0.08, 0.13, 0.1), m, [s * 0.34, 0.8, 0.02], [0, 0, s * 0.12]);
      part(g, new THREE.CylinderGeometry(0.06, 0.05, 0.12, 8), m, [s * 0.33, 0.92, 0], [0, 0, s * 0.12]);
    }
  },
  boots: (g, p, o) => {
    const m = mat(p.m[0], { metal: p === P.leather ? 0.05 : 0.7, rough: 0.5 });
    const k = o.bulky ? 1.4 : 1;
    for (const s of [-1, 1]) {
      part(g, new THREE.BoxGeometry(0.12 * k, 0.24, 0.13 * k), m, [s * 0.1, 0.2, 0]);
      part(g, new THREE.BoxGeometry(0.13 * k, 0.08, 0.26 * k), m, [s * 0.1, 0.04, 0.05]);
    }
  },
  shield: (g, p) => {
    const sh = new THREE.Shape();
    sh.moveTo(-0.22, 0.3); sh.lineTo(0.22, 0.3); sh.lineTo(0.22, 0.05); sh.quadraticCurveTo(0.22, -0.2, 0, -0.38); sh.quadraticCurveTo(-0.22, -0.2, -0.22, 0.05); sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1 });
    part(g, geo, mat(p.m[0], { metal: 0.7, rough: 0.4 }), [-0.45, 1.0, 0.05], [0, -Math.PI / 2, 0]);
    part(g, new THREE.BoxGeometry(0.01, 0.6, 0.06), mat(p.a), [-0.49, 0.99, 0.05]);
  },
  buckler: (g, p) => {
    part(g, new THREE.CylinderGeometry(0.2, 0.2, 0.035, 18), mat(p.m[0], { rough: 0.9 }), [-0.45, 1.0, 0.05], [0, 0, Math.PI / 2]);
    part(g, new THREE.SphereGeometry(0.05, 10, 8), mat('#9aa3ad', { metal: 0.8, rough: 0.3 }), [-0.48, 1.0, 0.05]);
  },
  sword: (g, p) => {
    const steel = mat(p.m[0], { metal: 0.9, rough: 0.25, emissive: p === P.ash ? '#5a1200' : undefined });
    part(g, new THREE.BoxGeometry(0.05, 0.85, 0.012), steel, [0.36, 0.38, 0.12]);
    part(g, new THREE.ConeGeometry(0.035, 0.08, 4), steel, [0.36, -0.08, 0.12], [Math.PI, 0, 0], [1, 1, 0.3]);
    part(g, new THREE.BoxGeometry(0.2, 0.03, 0.04), mat(p.a, { metal: 0.6 }), [0.36, 0.82, 0.12]);
    part(g, new THREE.CylinderGeometry(0.018, 0.018, 0.14, 8), mat('#4a2e1a'), [0.36, 0.9, 0.12]);
    part(g, new THREE.SphereGeometry(0.03, 8, 6), mat(p.a, { metal: 0.6 }), [0.36, 0.98, 0.12]);
  },
  lurker: (g, p) => {
    const skin = mat(p.m[0], { rough: 0.8 });
    skin.name = 'skin';
    part(g, new THREE.IcosahedronGeometry(0.6, 2), skin, [0, 0.5, 0], [0, 0, 0], [1, 0.62, 1.2]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(Math.cos(a) * 0.4, 0.3, Math.sin(a) * 0.5), new THREE.Vector3(Math.cos(a) * 0.8, 0.12, Math.sin(a) * 0.9), new THREE.Vector3(Math.cos(a + 0.4) * 1.1, 0.03, Math.sin(a + 0.4) * 1.15)]);
      part(g, new THREE.TubeGeometry(curve, 10, 0.06, 6), mat(p.m[1], { rough: 0.8 }));
    }
    for (let i = 0; i < 5; i++) part(g, new THREE.ConeGeometry(0.06, 0.25, 6), mat(p.m[1]), [(i - 2) * 0.18, 0.86, -0.1 - Math.abs(i - 2) * 0.05], [-0.3, 0, (i - 2) * 0.2]);
    for (const [x, y, z, r] of [[-0.18, 0.62, 0.62, 0.07], [0, 0.68, 0.66, 0.09], [0.18, 0.62, 0.62, 0.07]]) part(g, new THREE.SphereGeometry(r, 10, 8), mat(p.a, { emissive: p.a }), [x, y, z]);
  },
  wolf: (g, p) => {
    const fur = mat(p.m[0], { rough: 0.95 });
    part(g, new THREE.CapsuleGeometry(0.2, 0.6, 4, 8), fur, [0, 0.6, 0], [Math.PI / 2, 0, 0]);
    part(g, new THREE.BoxGeometry(0.26, 0.24, 0.3), fur, [0, 0.78, 0.5]);
    part(g, new THREE.BoxGeometry(0.14, 0.12, 0.2), mat(p.m[1]), [0, 0.72, 0.72]);
    for (const s of [-1, 1]) {
      part(g, new THREE.ConeGeometry(0.06, 0.16, 4), fur, [s * 0.08, 0.98, 0.46]);
      part(g, new THREE.SphereGeometry(0.03, 6, 6), mat(p.a, { emissive: p.a }), [s * 0.07, 0.83, 0.65]);
      for (const z of [-0.3, 0.3]) part(g, new THREE.CylinderGeometry(0.05, 0.04, 0.45, 6), fur, [s * 0.12, 0.22, z]);
    }
    part(g, new THREE.ConeGeometry(0.07, 0.45, 6), fur, [0, 0.66, -0.6], [-1.1, 0, 0]);
  },
  moth: (g, p) => {
    part(g, new THREE.CapsuleGeometry(0.07, 0.35, 4, 8), mat('#2a1408'), [0, 0.8, 0], [Math.PI / 2 - 0.3, 0, 0]);
    for (const s of [-1, 1]) {
      const w = new THREE.Shape(); w.moveTo(0, 0); w.bezierCurveTo(0.2, 0.35, 0.6, 0.3, 0.55, 0); w.bezierCurveTo(0.5, -0.2, 0.2, -0.15, 0, 0);
      part(g, new THREE.ShapeGeometry(w), mat(p.m[0], { emissive: '#5a1a00', side: THREE.DoubleSide }), [s * 0.04, 0.85, 0], [-Math.PI / 2 + 0.3, 0, 0], [s, 1, 1]);
      part(g, new THREE.ShapeGeometry(w), mat(p.m[1], { side: THREE.DoubleSide }), [s * 0.04, 0.8, -0.1], [-Math.PI / 2 + 0.4, 0, -s * 0.5], [s * 0.7, 0.7, 1]);
    }
  },
  toad: (g, p) => {
    const skin = mat(p.m[0], { rough: 0.7 });
    part(g, new THREE.IcosahedronGeometry(0.4, 2), skin, [0, 0.3, 0], [0, 0, 0], [1.2, 0.7, 1]);
    for (const s of [-1, 1]) {
      part(g, new THREE.SphereGeometry(0.1, 10, 8), skin, [s * 0.2, 0.58, 0.22]);
      part(g, new THREE.SphereGeometry(0.06, 8, 6), mat(p.a, { emissive: p.a }), [s * 0.2, 0.6, 0.29]);
      part(g, new THREE.CapsuleGeometry(0.07, 0.25, 4, 6), mat(p.m[1]), [s * 0.45, 0.12, -0.1], [0.6, 0, s * 0.9]);
    }
  },
};

async function meshGlb(o, texturePng) {
  const p = P[o.palette];
  const g = new THREE.Group();
  g.name = 'root';
  MESHES[o.shape](g, p, o);
  const scene = new THREE.Scene(); scene.add(g);
  const bytes = Buffer.from(await new GLTFExporter().parseAsync(scene, { binary: true }));
  if (!o.texture && !o.clips) return bytes;
  // Add a real base-color texture and named animation clips with glTF Transform.
  const { NodeIO } = await import('@gltf-transform/core');
  const io = new NodeIO();
  const doc = await io.readBinary(new Uint8Array(bytes));
  const root = doc.getRoot();
  if (o.texture && texturePng) {
    const t = doc.createTexture(o.texture).setImage(new Uint8Array(texturePng)).setMimeType('image/png').setURI(`${o.texture}.png`);
    for (const m of root.listMaterials()) if (m.getName() === 'skin') { m.setBaseColorTexture(t); m.setBaseColorFactor([1, 1, 1, 1]); }
  }
  const node = root.listScenes()[0].listChildren()[0];
  const buf = root.listBuffers()[0];
  const clip = (name, path, times, values, type) => {
    const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buf);
    const output = doc.createAccessor().setType(type).setArray(new Float32Array(values)).setBuffer(buf);
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    doc.createAnimation(name).addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
  };
  const q = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
  for (const name of o.clips ?? []) {
    if (name === 'Idle') clip('Idle', 'translation', [0, 0.75, 1.5], [0, 0, 0, 0, 0.06, 0, 0, 0, 0], 'VEC3');
    if (name === 'Alert') clip('Alert', 'rotation', [0, 0.4, 0.8, 1.2], [...q(0), ...q(0.5), ...q(-0.5), ...q(0)], 'VEC4');
  }
  return Buffer.from(await io.writeBinary(doc));
}

const TEXTURES = {
  scales: (p) => `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" fill="${p.m[1]}"/>
    ${Array.from({ length: 64 }, (_, i) => { const x = (i % 8) * 32 + ((Math.floor(i / 8) % 2) * 16); const y = Math.floor(i / 8) * 32; return `<circle cx="${x}" cy="${y + 16}" r="15" fill="${p.m[0]}" stroke="${p.m[1]}" stroke-width="3"/><circle cx="${x - 4}" cy="${y + 11}" r="4" fill="${p.a}" opacity=".35"/>`; }).join('')}</svg>`,
};

function vfxMp4(o, file) {
  const s = o.speed;
  let r, gch, b;
  if (o.look === 'ember') {
    const d = 'hypot(X-180,Y-180)';
    const I = `exp(-pow((${d}-T*${s}*170)/14,2))*max(0,1-T*${s}/1.7)*(0.7+0.3*sin(atan2(Y-180,X-180)*9+T*6))`;
    const C = `exp(-pow(${d}/(26+60*T*${s}),2))*max(0,1-T*${s}*0.85)`;
    r = `min(255,255*(${I}+${C})*1.3)`; gch = `min(255,${o.hot ? 210 : 150}*${I}+230*${C})`; b = `min(255,30*${I}+${o.hot ? 170 : 110}*${C})`;
  } else {
    const head = `(T*${s}*420-40)`;
    const beam = `exp(-pow((Y-180)/(5+(${head}-X)/40),2))*lt(X,${head})*exp(-(${head}-X)/140)`;
    const glow = `exp(-pow(hypot(X-${head},Y-180)/24,2))`;
    r = `min(255,180*${beam}+255*${glow})`; gch = `min(255,220*${beam}+255*${glow})`; b = `min(255,255*${beam}+255*${glow})`;
  }
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `nullsrc=s=360x360:d=2.5:r=24,format=rgb24,geq=r='${r}':g='${gch}':b='${b}'`, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-movflags', '+faststart', file]);
}


const TURNTABLE_HTML = `<!doctype html><html><body style="margin:0;background:#15181c">
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three'; import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); r.setSize(480, 360); document.body.appendChild(r.domElement);
r.setClearColor('#1b1f24'); r.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(); scene.add(new THREE.HemisphereLight('#dfe8ff', '#30261c', 1.6)); const d = new THREE.DirectionalLight('#fff', 2.2); d.position.set(2, 3, 2); scene.add(d);
const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), new THREE.MeshStandardMaterial({ color: '#2a2f36' })); floor.rotation.x = -Math.PI / 2; scene.add(floor);
const cam = new THREE.PerspectiveCamera(35, 480 / 360, 0.01, 50); let obj, center = new THREE.Vector3(), dist = 3;
window.load = async (src) => { if (obj) scene.remove(obj); obj = (await new GLTFLoader().loadAsync(src)).scene; scene.add(obj);
  const b = new THREE.Box3().setFromObject(obj); b.getCenter(center); dist = b.getSize(new THREE.Vector3()).length() * 1.35; };
window.frame = (a) => { cam.position.set(center.x + Math.sin(a) * dist, center.y + dist * 0.35, center.z + Math.cos(a) * dist); cam.lookAt(center); r.render(scene, cam); };
</script></body></html>`;

// Render one version of each asset spec into `dir/<asset path>`. Images become PNG.
export async function renderAssets(specs, dir, browser, { videos = true } = {}) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  const turntables = [];
  for (const { path: rel, spec } of specs) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (['icon', 'portrait', 'sheet'].includes(spec.g)) {
      const svg = spec.g === 'icon' ? iconSvg(spec) : spec.g === 'portrait' ? portraitSvg(spec) : sheetSvg(spec);
      await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
      await page.locator('svg').first().screenshot({ path: file, omitBackground: true });
    } else if (spec.g === 'mesh') {
      let png = null;
      if (spec.texture) {
        await page.setContent(`<html><body style="margin:0">${TEXTURES[spec.texture](P[spec.palette])}</body></html>`);
        png = await page.locator('svg').first().screenshot();
      }
      fs.writeFileSync(file, await meshGlb(spec, png));
    }
    else if (spec.g === 'vfx' && videos) vfxMp4(spec, file);
    else if (spec.g === 'turntable' && videos) turntables.push({ file, mesh: path.join(dir, spec.mesh) });
  }
  await page.close();
  if (!turntables.length) return;
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/') { res.setHeader('content-type', 'text/html'); return res.end(TURNTABLE_HTML); }
    const f = u.startsWith('/node_modules/') ? path.join(pkg, u) : u.startsWith('/model/') ? path.join(dir, u.slice(7)) : null;
    if (!f || !fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    fs.createReadStream(f).pipe(res);
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const tp = await browser.newPage({ viewport: { width: 480, height: 360 } });
  await tp.goto(`http://127.0.0.1:${server.address().port}/`);
  for (const job of turntables) {
    const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'tt-'));
    await tp.evaluate((src) => window.load(src), `/model/${path.relative(dir, job.mesh).split(path.sep).join('/')}`);
    for (let i = 0; i < 48; i++) {
      await tp.evaluate((a) => window.frame(a), (i / 48) * Math.PI * 2);
      await tp.locator('canvas').screenshot({ path: path.join(tmp, `f${String(i).padStart(3, '0')}.png`) });
    }
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '16', '-i', path.join(tmp, 'f%03d.png'), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-movflags', '+faststart', job.file]);
    fs.rmSync(tmp, { recursive: true });
  }
  await tp.close(); server.close();
}

export function hasFfmpeg() { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } }
