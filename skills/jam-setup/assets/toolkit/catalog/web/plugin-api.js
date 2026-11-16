// What a plugin's browser module receives. A media kind's module (`mediaKinds[].web`) is a
// declared file that default-exports `(catalog) => void` and registers itself:
//
//   export default function (catalog) {
//     const { html, registerMediaKind } = catalog;
//     registerMediaKind('text', { viewer: ({ media, viewerId, source }) => html`…` });
//   }
//
// `registerMediaKind` and `registerPreview` are the same functions the built-in kinds call.
import { html, useState, useEffect, useLayoutEffect, useRef, useCallback, Icon } from './core.js';
import { registerViewer } from './controller.js';
import { registerMediaKind } from './media-kinds.js';
import { registerPreview } from './previews.js';
import { Msg, MediaViewer, UnavailableViewer } from './viewers.js';

export const catalog = {
  html,
  hooks: { useState, useEffect, useLayoutEffect, useRef, useCallback },
  registerMediaKind,
  registerPreview,
  // Call inside a viewer component: `useViewer(viewerId, () => state, (command) => handled)`.
  // The state must carry `kind`, `status` ('loading' | 'ready' | 'error'), `error` and `source`;
  // that is what agents read, and a capture is taken only when the status is 'ready'.
  useViewer: registerViewer,
  // Building blocks: the loading and error overlay, a viewer for any registered kind, and the
  // viewer shown when media cannot be shown.
  Msg,
  MediaViewer,
  UnavailableViewer,
  Icon,
};
