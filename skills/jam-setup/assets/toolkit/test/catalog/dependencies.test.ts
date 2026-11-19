// The catalog depends only on the kernel (src/README.md): no module under src/catalog imports
// from the command line's composition (src/cli) or from the rest of the toolkit (src/jam).
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const SRC = fileURLToPath(new URL("../../src/", import.meta.url))
const CATALOG = join(SRC, "catalog")
// Static `import … from "…"`, `export … from "…"` and dynamic `import("…")`.
const SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gmu

const modules = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? modules(join(dir, entry.name)) : /\.(ts|mjs|js)$/u.test(entry.name) ? [join(dir, entry.name)] : [])

test("no module under src/catalog imports from src/cli or src/jam", () => {
  const found = modules(CATALOG).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(SPECIFIER)]
      .map((match) => match[1]!)
      .filter((specifier) => specifier.startsWith("."))
      .map((specifier) => relative(SRC, resolve(dirname(file), specifier)).split("\\").join("/"))
      .filter((target) => target.startsWith("cli/") || target.startsWith("jam/"))
      .map((target) => `${relative(SRC, file).split("\\").join("/")} -> ${target}`))
  assert.deepEqual(found, [])
})
