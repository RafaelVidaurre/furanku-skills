// Compile-only: `npm run typecheck` checks that the browser module contract in
// catalog-plugin-web.d.ts types the modules a plugin writes (a media kind, an inspector, a panel, a
// preview) and refuses the shapes of the earlier contract. Nothing here runs.
import type {
  CatalogApi,
  Controller,
  InspectorContext,
  MediaKindDefinition,
  MountContext,
  MountFunction,
  PreviewContext,
  PreviewFunction,
  ViewerState
} from "../../catalog-plugin-web.d.ts"

/** A media kind's module: registers a viewer that reports `shows` and refuses a wrong command by throwing. */
export const textKind = (catalog: CatalogApi): void => {
  const { html, hooks: { useState }, registerMediaKind, useViewer } = catalog
  const definition: MediaKindDefinition = {
    controls: ["text"],
    viewer: ({ media, viewerId, shows }) => {
      const [wrap, setWrap] = useState(true)
      useViewer(viewerId, (): ViewerState => ({ kind: "text", status: "ready", error: null, shows: shows ?? {}, controls: ["text"], wrap }), (command) => {
        if (!command["text"]) return false
        if (typeof command["text"] !== "object") throw Object.assign(new Error("text needs { wrap }"), { code: "invalid" })
        setWrap(!wrap)
        return true
      })
      return html`<pre>${media.url}</pre>`
    },
    capture: { renderer: (state) => `catalog text viewer (${state.status})` }
  }
  registerMediaKind("text", definition)
}

/** An inspector: framework-free, with its own state kept in the page address. */
export const inspector: MountFunction<InspectorContext> = (host, ctx) => {
  const stage = document.createElement("div")
  ctx.markStage(stage)
  host.append(stage)
  let level = typeof ctx.state["level"] === "number" ? ctx.state["level"] : 1
  void ctx.call("unit.get", { id: ctx.unit.id })
  const controller: Controller = {
    state: () => ({ status: "ready", renderer: "kit renderer", level, shows: { unit: ctx.unit.id } }),
    control: (command) => {
      if (!("level" in command)) return false
      level = Number(command["level"])
      ctx.setState({ level })
      return { level }
    },
    dispose: () => host.replaceChildren()
  }
  return controller
}

/** A panel: a mount context only, and it may mount asynchronously. */
export const panel: MountFunction = async (host, ctx: MountContext) => {
  host.textContent = `${ctx.key}: ${ctx.unit.name} (${ctx.assetUrl("art/a.png")})`
  return { dispose: () => host.replaceChildren() }
}

/** A collection preview: page-integrated, passing `viewerId` and `shows` on to a viewer. */
export const preview: PreviewFunction = (ctx: PreviewContext) => {
  const { html, viewers } = ctx
  const ModelViewer = viewers["ModelViewer"]
  return ModelViewer
    ? html`<${ModelViewer} srcs=${ctx.members.map((member) => member.asset.url)} viewerId=${ctx.viewerId} shows=${{ ...ctx.shows, spacing: ctx.config["spacing"] }} />`
    : html`<p>${ctx.label}</p>`
}

// The earlier contract does not type-check.
// @ts-expect-error a preview receives `shows`, not `source`
export const oldPreview: PreviewFunction = (ctx) => ctx.source
// @ts-expect-error a status is loading, ready or error
export const badStatus: ViewerState = { kind: "text", status: "done" }
// @ts-expect-error a controller must be disposable
export const noDispose: MountFunction = () => ({ state: () => ({}) })
