// What every media viewer shares: the loading and error overlay, the viewer shown when media
// cannot be shown, and the one component that shows an asset of any kind by asking the registry.
import { html } from './core.js';
import { registerViewer } from './controller.js';
import { mediaKind, useMediaKinds, kindsLoading } from './media-kinds.js';

export const Msg = ({ status, error, onRetry, name }) => html`
  ${status === 'loading' && html`<div class="viewer-msg" aria-live="polite"><span class="spin" aria-label="Loading"></span></div>`}
  ${status === 'error' && html`<div class="viewer-msg err" role="alert"><span>${error ?? `Failed to load ${name ?? ''}`}</span>${onRetry && html`<button class="btn xs" onClick=${onRetry}>Retry</button>`}</div>`}`;

export function UnavailableViewer({ asset, viewerId, source, message }) {
  const error = message ?? asset?.error ?? 'Not available';
  registerViewer(viewerId, () => ({ kind: asset?.kind ?? null, status: 'error', error, state: asset?.state ?? null, source, controls: [] }), () => false);
  return html`<div class="viewer"><div class="viewer-msg err" role="alert">${error}</div></div>`;
}

function LoadingViewer({ viewerId, source, kind }) {
  registerViewer(viewerId, () => ({ kind, status: 'loading', error: null, source, controls: [] }), () => false);
  return html`<div class="viewer"><${Msg} status="loading" /></div>`;
}

// Shows one piece of media with the viewer its kind registered. `media` is an asset reference or
// frozen evidence: { kind, url, state?, error?, id?, path?, sha256?, version? }. Everything else
// is passed to the kind's viewer: viewerId and source (so people and agents share its state),
// label, onStatus, context (the unit, type and link it is shown for), and a kind's own options
// such as a camera.
export function MediaViewer({ media, ...rest }) {
  useMediaKinds();
  if (!media || (media.state && media.state !== 'ok')) return html`<${UnavailableViewer} asset=${media} viewerId=${rest.viewerId} source=${rest.source} />`;
  const kind = mediaKind(media.kind);
  if (!kind) {
    // The kind's module may still be on its way; once nothing is loading, say that nothing shows it.
    if (kindsLoading()) return html`<${LoadingViewer} viewerId=${rest.viewerId} source=${rest.source} kind=${media.kind} />`;
    return html`<${UnavailableViewer} asset=${media} viewerId=${rest.viewerId} source=${rest.source} message=${`No viewer is registered for ${media.kind ?? 'this kind of'} media`} />`;
  }
  // A kind may keep one viewer instance across media (a model keeps its camera between parts).
  return html`<${kind.viewer} key=${kind.reuse ? `kind:${media.kind}` : media.url} media=${media} ...${rest} />`;
}
