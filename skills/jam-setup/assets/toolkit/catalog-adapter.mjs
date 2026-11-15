// Project content combines Jam workflow assets with sourced external content (a manifest, default Art/catalog.json).
// Imported content stays outside Jam's generation and acceptance records.
// A project with its own adapter composes the same way: load both adapters and merge their results as below.
import jamAdapter from './catalog/adapters/jam.mjs';
import manifestAdapter from './catalog/src/adapters/manifest.mjs';

export default function projectAdapter({ root, options = {} }) {
  const adapters = [jamAdapter({ root }), manifestAdapter({ root, options: { ...options, manifest: options.manifest ?? 'Art/catalog.json' } })];
  return {
    name: 'project',
    sources: () => [...new Set(adapters.flatMap((adapter) => adapter.sources()))],
    async load() {
      const parts = await Promise.all(adapters.map((adapter) => adapter.load()));
      return {
        project: null,
        schema: {
          types: Object.assign({}, ...parts.map((part) => part.schema?.types)),
          collectionKinds: Object.assign({}, ...parts.map((part) => part.schema?.collectionKinds)),
        },
        ...Object.fromEntries(['assetRoots', 'assets', 'units', 'collections', 'problems'].map((key) => [key, parts.flatMap((part) => part[key] ?? [])])),
      };
    },
  };
}
