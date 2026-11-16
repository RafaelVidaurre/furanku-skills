// How the jam services are wired. Each service names its own dependencies; this is the one place
// that decides which implementation satisfies them.
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { Kernel } from "../kernel/cli.ts"
import { Executables } from "../kernel/Executable.ts"
import { Stamps } from "../kernel/Stamps.ts"
import { Aligner } from "./audio/Aligner.ts"
import { AudioProvider } from "./audio/AudioProvider.ts"
import { audioChecksLayer } from "./audio/checks.ts"
import { Ffmpeg } from "./audio/Ffmpeg.ts"
import { Checks } from "./checks/Checks.ts"
import { shippedChecks } from "./checks/shipped.ts"
import { Config } from "./config/Config.ts"
import { Engine } from "./engine/Engine.ts"
import { LOCAL_STATE_DIR } from "./layout.ts"
import { Measure } from "./measure/Measure.ts"
import { Providers } from "./providers/Providers.ts"
import { Recipes } from "./recipes/Recipes.ts"
import { ReviewDesk } from "./runs/ReviewDesk.ts"
import { Runs } from "./runs/Runs.ts"
import { Toolkit } from "./Toolkit.ts"

/** Everything of jam except where a person reviews work. */
export type JamCore = Toolkit | Executables | Config | Recipes | Stamps | Measure | Engine | Providers | Runs | Checks | Ffmpeg | AudioProvider | Aligner
export type JamServices = JamCore | ReviewDesk

export interface JamOptions {
  /** The installed toolkit whose shipped data is read (default: the one this source belongs to). */
  readonly toolkit?: Layer.Layer<Toolkit>
  /** Where a person reviews work (default: no desk; human gates take a relay). It may use the other jam services. */
  readonly desk?: Layer.Layer<ReviewDesk, never, JamCore | Kernel>
  readonly executables?: Layer.Layer<Executables>
}

// File digests are remembered under the scratch root, which Git ignores. Without a configuration
// there is no scratch root and nothing is remembered.
const stamps = Stamps.layerAt(Effect.flatMap(Config, (config) =>
  config.state.pipe(
    Effect.map((state) => (state.kind === "ready" ? `${state.config.roots.scratch}/${LOCAL_STATE_DIR}/stamps.json` : null)),
    Effect.catch(() => Effect.succeed(null))
  )))

const makeJamCore = (options: JamOptions): Layer.Layer<JamCore, never, Kernel> => {
  const config = Config.layerNoDeps.pipe(Layer.provideMerge(Layer.mergeAll(options.toolkit ?? Toolkit.layer, options.executables ?? Executables.layer)))
  const data = Layer.mergeAll(Recipes.layerNoDeps, stamps, Measure.layerNoDeps, Engine.layerNoDeps, Providers.layerNoDeps).pipe(Layer.provideMerge(config))
  const audio = Layer.mergeAll(Ffmpeg.layerNoDeps, AudioProvider.layerNoDeps, Aligner.layerNoDeps).pipe(Layer.provideMerge(data))
  // The audio checks are handed to the registry before it is built, so it never reads an empty list.
  return Layer.mergeAll(Runs.layerNoDeps, Checks.layerOf(shippedChecks).pipe(Layer.provide(audioChecksLayer))).pipe(Layer.provideMerge(audio))
}

export const makeJamLayer = (options: JamOptions = {}): Layer.Layer<JamServices, never, Kernel> =>
  (options.desk ?? ReviewDesk.layerNone).pipe(Layer.provideMerge(makeJamCore(options)))

/** jam without a review desk: what the catalog plugin reads runs through. */
export const jamCoreLayer: Layer.Layer<JamCore, never, Kernel> = makeJamCore({})

/** The services of the `jam` command when nothing connects it to the catalog. */
export const jamLayer: Layer.Layer<JamServices, never, Kernel> = makeJamLayer()
