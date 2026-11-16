// Preloaded by startup.test.ts (`node --import`): records every module the command loads, one
// URL per line, in the file TRACE_IMPORTS names.
import { appendFileSync } from "node:fs"
import { registerHooks } from "node:module"

const file = process.env["TRACE_IMPORTS"]
if (file !== undefined) {
  registerHooks({
    resolve(specifier, context, next) {
      const resolved = next(specifier, context)
      appendFileSync(file, `${resolved.url}\n`)
      return resolved
    }
  })
}
