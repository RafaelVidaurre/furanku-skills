// Example project preview module (not part of the core). Declare it in catalog.config.json:
//   "previewModules": { "lineup": "./catalog/previews/lineup.mjs" }
// and reference it from a collection kind:
//   "preview": { "module": "lineup", "label": "Lineup", "roles": ["model"], "base": "art/stand.glb", "config": { "spacing": 1.5 } }
// Members stand in a row `spacing` apart, each on a grey copy of the base. The shared ModelViewer
// keeps human controls and agent viewer actions identical.
export default function lineup(ctx) {
  const { html, viewers: { ModelViewer } } = ctx;
  const spacing = typeof ctx.config.spacing === 'number' ? ctx.config.spacing : 1;
  const ok = ctx.members.filter((m) => m.asset.state === 'ok' && m.asset.kind === 'model');
  const srcs = ok.map((m, i) => ({ url: m.asset.url, position: [i * spacing, 0.25, 0] }));
  const ghost = ctx.base?.state === 'ok' ? ok.map((_, i) => ({ url: ctx.base.url, position: [i * spacing, 0, 0], scale: 0.5 })) : [];
  return html`<${ModelViewer} srcs=${srcs} ghost=${ghost} viewerId=${ctx.viewerId} source=${{ ...ctx.source, spacing }} label=${ctx.label}
    initialCamera=${ctx.initialCamera} initialState=${ctx.initialState} />`;
}
