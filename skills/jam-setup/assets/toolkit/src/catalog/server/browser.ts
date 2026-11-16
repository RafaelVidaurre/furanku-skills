// Headless Chromium for real rendering: captures, the sample project's art, the browser tests.
// Playwright is imported only here and only when a browser is first needed, so no data command
// and no ordinary page view pays for it.
import * as Effect from "effect/Effect"
import { fileURLToPath } from "node:url"
import type { Browser } from "playwright"
import { type ToolError, toolError } from "../../kernel/errors.ts"

// Software WebGL, so models render the same on a machine without a graphics card.
const ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]

// Where the toolkit (and its Playwright) is installed: the folder the install command runs in.
const toolkitFolder = fileURLToPath(new URL("../../../", import.meta.url))

export interface BrowserOptions {
  /** A browser channel to use instead of Playwright's own Chromium (for example `chrome`). */
  readonly channel?: string | undefined
}

const firstLine = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause)).split("\n")[0] ?? ""

/**
 * Start a browser: Playwright's Chromium when it is installed, otherwise an installed Google
 * Chrome. The caller closes it. When neither can start, the error says how to install one.
 */
export const launchBrowser = (options: BrowserOptions = {}): Effect.Effect<Browser, ToolError> =>
  Effect.tryPromise({
    try: async () => {
      const { chromium } = await import("playwright")
      const attempts = options.channel ? [{ channel: options.channel }] : [{}, { channel: "chrome" }]
      const errors: Array<string> = []
      for (const attempt of attempts) {
        try {
          return await chromium.launch({ ...attempt, args: ARGS })
        } catch (cause) {
          errors.push(firstLine(cause))
        }
      }
      throw new Error(errors.join("; "))
    },
    catch: (cause) =>
      toolError("unavailable", `no headless browser is available for rendering (${firstLine(cause)})`, {
        fix: `install Chromium once: run "npx playwright install chromium" in ${toolkitFolder}`
      })
  })
