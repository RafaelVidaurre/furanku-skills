// Browser preview module for the storybook example: the member images of a collection side by
// side, in member order. A preview module default-exports `(ctx) => markup`; see the catalog
// README, "Collection previews", and `PreviewFunction` in catalog-plugin-web.d.ts.

/** @type {import('../../catalog-plugin-web.d.ts').PreviewFunction} */
export default function storyboard(ctx) {
  const images = ctx.members.filter((member) => member.asset.state === 'ok');
  return ctx.html`<div style="display:flex;gap:8px;overflow-x:auto">
    ${images.map((member) => ctx.html`<img src=${member.asset.url} alt=${member.unit} style="height:240px" />`)}
  </div>`;
}
