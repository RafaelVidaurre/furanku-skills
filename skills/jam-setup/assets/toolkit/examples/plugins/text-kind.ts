// A fifth media kind, end to end: plain text files shown in the catalog like images or models.
// The plugin has two halves. This half runs in the engine: it says how a text file is recognised
// from its bytes and where the kind's browser module is. The other half, text-kind.web.js beside
// this file, runs in the page: it registers the viewer and thumbnail for the kind.
//
// Use it from a project by listing it in catalog.config.json ("./catalog/text-kind.ts", with both
// files copied there), or register it by name where the catalog is composed
// (`Catalog.layerWith({ plugins: { "text-kind": textKind } })`). A type then accepts it in a role:
//   roles: [{ key: "script", label: "Script", mediaKinds: ["text"] }]
import { defineMediaKind, definePlugin } from "../../catalog-plugin.ts"

/** Text is what holds no control bytes: tabs, line ends and anything printable or non-ASCII. */
const isText = (head: Uint8Array): boolean => head.length > 0 && head.every((byte) => byte === 9 || byte === 10 || byte === 13 || byte >= 32)

export default definePlugin({
  name: "text-kind",
  mediaKinds: [defineMediaKind({
    id: "text",
    label: "Text",
    extensions: ["txt", "md"],
    // The built-in kinds are asked first, so a PNG or a WAV never reaches this test.
    sniff: (head) => (isText(head) ? "text/plain; charset=utf-8" : null),
    // The browser module ships beside this file, wherever the plugin is installed.
    web: new URL("./text-kind.web.js", import.meta.url).href
  })]
})
