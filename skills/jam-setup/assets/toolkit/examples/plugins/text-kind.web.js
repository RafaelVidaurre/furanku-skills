// The browser half of the text-kind example plugin (see text-kind.ts). A media kind's browser
// module default-exports a function that receives the catalog's page API and registers the kind:
// the same `registerMediaKind` call the built-in image, video, model and audio kinds make. Its
// types are in the toolkit's catalog-plugin-web.d.ts (`../tools/jam/catalog-plugin-web.d.ts` from
// a project's catalog/ folder).

/** @param {import('../../catalog-plugin-web.d.ts').CatalogApi} catalog */
export default function textKind(catalog) {
  const { html, hooks: { useEffect, useState }, registerMediaKind, useViewer, Msg } = catalog;

  // A viewer shows `media` ({ url, path, sha256, … }) and reports itself through `useViewer`:
  // its state is what an agent reads (`shows` is the identity of what it shows), and a capture is
  // taken only while `status` is 'ready'.
  /** @param {Parameters<import('../../catalog-plugin-web.d.ts').MediaKindDefinition['viewer']>[0]} props */
  function TextViewer({ media, viewerId, shows, label, onStatus }) {
    const [loaded, setLoaded] = useState({ url: null, text: null, error: null });
    const [wrap, setWrap] = useState(true);
    useEffect(() => {
      let live = true;
      fetch(media.url)
        .then((response) => (response.ok ? response.text() : Promise.reject(new Error(`HTTP ${response.status}`))))
        .then((text) => live && setLoaded({ url: media.url, text, error: null }), (e) => live && setLoaded({ url: media.url, text: null, error: e.message }));
      return () => { live = false; };
    }, [media.url]);
    const current = loaded.url === media.url ? loaded : { text: null, error: null };
    const status = current.error ? 'error' : current.text == null ? 'loading' : 'ready';
    useEffect(() => { onStatus?.(status); }, [status]);
    useViewer(viewerId,
      () => ({ kind: 'text', status, error: current.error, shows, lines: current.text == null ? null : current.text.split('\n').length, wrap, controls: ['text'] }),
      // Controls arrive as { <name>: … }: return false for one this viewer does not have, and
      // throw for a wrong one (an Error's `code` is what the agent gets, `invalid` by default).
      (command) => { if (!command.text) return false; if (typeof command.text.wrap !== 'boolean') throw new Error('text needs { wrap: true | false }'); setWrap(command.text.wrap); return true; });
    return html`<div class="viewer" tabindex="0" data-viewer-input aria-label=${label ?? 'Text'} style="overflow:auto">
      <${Msg} status=${status} error=${current.error && `Text could not be loaded: ${current.error}`} />
      ${status === 'ready' && html`<pre data-text-viewer style=${`margin:0;padding:20px 24px;font:13px/1.6 ui-monospace,monospace;white-space:${wrap ? 'pre-wrap' : 'pre'}`}>${current.text}</pre>`}
    </div>`;
  }

  registerMediaKind('text', {
    icon: 'M4 5h12 M4 9h12 M4 13h8',
    viewer: TextViewer,
    // The control names its viewer's state lists; session, select and inspector are the page's own.
    controls: ['text'],
    // Shown inside the square thumbnail of lists and tiles.
    thumbnail: () => html`<span style="font:600 15px/1 ui-serif,serif;opacity:.8" aria-hidden="true">Aa</span>`,
    // No `compare`: two versions are shown side by side with this viewer.
    capture: { renderer: 'catalog text viewer' },
  });
}
