# Toolkit source conventions

TypeScript run directly by Node (type stripping, Node ≥ 22.20). No build step, no flags. `npm run typecheck` checks it; `node --test` runs tests.

## Layout and dependency direction

```
kernel/   errors, project files, Git, ids, processes, schema decoding, CLI conventions
catalog/  content catalog engine; its public entry for plugin authors is catalog/plugin.ts
jam/      config, recipes, runs, ledger, providers, engine host, audio; jam/catalog is the catalog's `jam` plugin and the review desk
cli/      main.ts runs the command groups; compose.ts connects the catalog and the ledger
```

`kernel` imports nothing from the others. `catalog` imports only `kernel`. `jam` imports `kernel` and the catalog's public entry (`catalog/plugin.ts`, `catalog/Catalog.ts`); the catalog never imports `jam`. `cli/compose.ts` is the one place both meet: it registers the `jam` plugin with the catalog and gives the run commands the catalog as their review desk, each loaded when first used.

## Rules

- **Syntax Node can strip.** No `enum`, `namespace` or constructor parameter properties. Relative imports carry the real `.ts` extension. Type-only imports use `import type` (or inline `type`).
- **Deep imports.** `import * as Effect from "effect/Effect"`, never the `effect` barrel: it halves start-up. The same for `@effect/platform-node/NodeRuntime` and friends. Load the HTTP stack with a dynamic `import()` inside the command that serves.
- **Services.** Anything that touches the outside world, holds state, or has more than one sensible implementation is a `Context.Service` with a `static layer` (and `layerNoDeps` when it has dependencies, `layerTest` when a test double is worth sharing). Pure rules are plain functions in their own module.
- **No ambient state.** No module-level caches, no `Date.now()`, `Math.random()`, `process.env` or `process.cwd()` outside `kernel` and the CLI edge. Time comes from `Clock` (`nowIso` in `kernel/Ids.ts`), ids from `Ids`.
- **Files and programs go through the kernel.** `ProjectFiles` for anything inside the project (it confines paths and refuses symlink escapes), `Process` for running programs (argv arrays, never a shell string), `Detached` for a program that must outlive the command that starts it, `Git` for the checkout.
- **One error type.** Operations fail with `ToolError` (`kernel/errors.ts`): a code, a message that names the field and the expected form, and a `fix` when there is one. Authored files and command input are decoded with `decode(schema, { what })` so every problem is reported at once with its field path.
- **Schemas are the source.** Every authored file (config, recipe, adapter, descriptor, record) has an Effect Schema; its JSON Schema under `schemas/` is generated from it by `jam schemas write`.
- **Commands return data.** A handler computes a value and calls `Output.emit(value, text)`. JSON goes to standard output with `--json`; notes for people go to standard error.
- **Paths in records** are project-relative with forward slashes. Never store an absolute path, a credential or a signed URL.

## Effect 4 notes

Verified samples for each of these live in the design notes' spike; the names below are the ones that differ from Effect 3.

| Effect 3 | Effect 4.1 |
|---|---|
| `Context.Tag`, `Effect.Service` | `class X extends Context.Service<X, Shape>()("id") {}` |
| `Effect.catchAll`, `catchAllCause` | `Effect.catch`, `Effect.catchCause` |
| `Effect.either` | `Effect.result` (`Result` module) |
| `Effect.fork`, `forkDaemon` | `Effect.forkChild`, `Effect.forkDetach` |
| `Effect.async` | `Effect.callback` |
| `Effect.zipRight` | `Effect.andThen` |
| `Schema.decodeUnknown` | `Schema.decodeUnknownEffect` |
| `Schema.Literal("a", "b")` | `Schema.Literals(["a", "b"])` |
| `Schema.optionalWith(S, { default })` | `S.pipe(Schema.withDecodingDefaultKey(Effect.succeed(v)))` |
| `Schema.pattern`, `Schema.filter` | `Schema.check(Schema.isPattern(/…/u))`, `Schema.check(Schema.makeFilter(…))` |
| `Schema.parseJson` | `Schema.fromJsonString` |
| `JSONSchema.make` | `Schema.toJsonSchemaDocument` (see `jsonSchemaOf` in `kernel/decode.ts`) |
| `FiberRef` | `Context.Reference`, `References` |
| `@effect/cli` `Options`, `Args` | `effect/cli/Flag`, `effect/cli/Argument` |

Things that bite:

- A layer is memoized by reference. Keep `static readonly layer = …` values; a function that builds a new layer per call builds a new service per call.
- A layer that reads a registry while sibling layers are still registering into it sees an empty registry. Make it depend on them, or read lazily.
- A forked fiber starts deferred; pass `{ startImmediately: true }` when it must subscribe before the next line publishes.
- A streamed HTTP response sends no headers until its first chunk.
- A RegExp reaches the generated JSON Schema only with the `u` flag.
- `Schema.optionalKey` means the key may be absent; `Schema.optional` also allows `undefined`.
- With `exactOptionalPropertyTypes`, write `field?: T | undefined` for fields you pass through as possibly undefined.

## Tests

`test/support.ts` gives a real temporary project (`tempProject`), kernel services with counting ids and captured output (`testKernel`), and `run` / `failure`. Tests exercise behaviour through public entries (a service, an action, a command) against real files and, where needed, a real Git repository. They never read the machine's own configuration.
