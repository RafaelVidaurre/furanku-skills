// Identities and the current time. Injected so tests are deterministic.
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { randomBytes, randomUUID } from "node:crypto"

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"

export class Ids extends Context.Service<Ids, {
  /**
   * `<prefix>_<time><random>`: roughly time-ordered and collision-resistant, so records created on
   * different branches merge without clashing.
   */
  next(prefix: string): Effect.Effect<string>
  readonly uuid: Effect.Effect<string>
}>()("jam/kernel/Ids") {
  static readonly layer: Layer.Layer<Ids> = Layer.succeed(Ids, {
    next: (prefix) =>
      Effect.map(Clock.currentTimeMillis, (ms) =>
        `${prefix}_${ms.toString(36)}${[...randomBytes(10)].map((byte) => ALPHABET[byte % ALPHABET.length]).join("")}`),
    uuid: Effect.sync(() => randomUUID())
  })

  /** Counting ids: `nt_0001`, `nt_0002`, … and uuids `00000000-0000-4000-8000-00000000000N`. */
  static readonly layerTest: Layer.Layer<Ids> = Layer.sync(Ids, () => {
    let count = 0
    const pad = (width: number): string => String(++count).padStart(width, "0")
    return {
      next: (prefix) => Effect.sync(() => `${prefix}_${pad(4)}`),
      uuid: Effect.sync(() => `00000000-0000-4000-8000-${pad(12)}`)
    }
  })
}

/** The short copyable reference of an id: the last six characters of its random part, upper case. */
export const shortRef = (id: string): string => (id.split("_")[1] ?? id).slice(-6).toUpperCase()

/** Current time as an ISO-8601 UTC string, from the Effect clock. */
export const nowIso: Effect.Effect<string> = Effect.map(Clock.currentTimeMillis, (ms) => new Date(ms).toISOString())
