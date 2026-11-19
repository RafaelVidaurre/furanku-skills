// The catalog's plugin contract at a stable path: a project's plugin imports
// `../tools/jam/catalog-plugin.ts` (from `catalog/`), whatever the toolkit's sources look like.
// Browser modules use `catalog-plugin-web.d.ts` beside it through JSDoc.
export * from "./src/catalog/plugin.ts"
