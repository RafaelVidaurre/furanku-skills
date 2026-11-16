// Origins a catalog server admits besides this machine's own: opt-in, each given exactly, for a
// private HTTPS proxy in front of the loopback server (a person reviewing from a phone). Parsing
// them is cheap, so the commands that start a server check the flag before loading the HTTP stack.
import * as Effect from "effect/Effect"
import { fail, type ToolError } from "../../kernel/errors.ts"

/** The admitted origins, and their hosts, which are admitted as a Host header. */
export interface AllowedOrigins {
  readonly origins: ReadonlySet<string>
  readonly hosts: ReadonlySet<string>
}
export const NO_ORIGINS: AllowedOrigins = { origins: new Set(), hosts: new Set() }

/** Check `--allow-origin` values: each is one exact origin, `https://host[:port]` (or `http://`), and nothing more. */
export const allowedOrigins = (given: ReadonlyArray<string>): Effect.Effect<AllowedOrigins, ToolError> =>
  Effect.gen(function*() {
    const origins = new Set<string>()
    for (const value of given) {
      const url = URL.canParse(value) ? new URL(value) : null
      if (url === null || (url.protocol !== "https:" && url.protocol !== "http:") || url.origin !== value.replace(/\/$/, "") || url.username !== "" || url.password !== "") {
        return yield* fail("invalid", `--allow-origin ${JSON.stringify(value)} is not one origin`, { fix: "give the exact origin the proxy serves, such as https://box.example.ts.net:8443, without a path" })
      }
      origins.add(url.origin)
    }
    return { origins, hosts: new Set([...origins].map((origin) => new URL(origin).host)) }
  })
