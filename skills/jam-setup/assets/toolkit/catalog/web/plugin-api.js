// What a plugin's page-integrated browser module receives (types: `CatalogApi` in
// catalog-plugin-web.d.ts at the toolkit root). A media kind's module (`mediaKinds[].web`) is a
// declared file that default-exports `(catalog) => void` and registers itself:
//
//   export default function (catalog) {
//     const { html, registerMediaKind } = catalog;
//     registerMediaKind('text', { viewer: ({ media, viewerId, shows }) => html`…` });
//   }
//
// `registerMediaKind` and `registerPreview` are the same functions the built-in kinds call.
// Inspector and panel modules receive none of this: they are framework-free (see views.js).
import { html, useState, useEffect, useLayoutEffect, useRef, useCallback, Icon } from './core.js';
import { useViewer } from './controller.js';
import { registerMediaKind } from './media-kinds.js';
import { registerPreview } from './previews.js';
import { Msg, MediaViewer, UnavailableViewer } from './viewers.js';

export const catalog = {
  html,
  hooks: { useState, useEffect, useLayoutEffect, useRef, useCallback },
  registerMediaKind,
  registerPreview,
  // Call inside a viewer component: `useViewer(viewerId, () => state, (command) => result)`.
  // The state must carry `kind`, `status` ('loading' | 'ready' | 'error'), `error`, `shows` and
  // `controls`; that is what agents read, and a capture is taken only when the status is 'ready'.
  // `control` returns false for a command that is not one of its controls and throws for a wrong one.
  useViewer,
  // Building blocks: the loading and error overlay, a viewer for any registered kind, and the
  // viewer shown when media cannot be shown.
  Msg,
  MediaViewer,
  UnavailableViewer,
  Icon,
};
