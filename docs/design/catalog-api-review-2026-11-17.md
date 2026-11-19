# Catalog public API design review

Date: 2026-11-17. Input to the API overhaul (Beads epic drr.18 and its siblings). Findings are proposals, not decisions; the decisions live in catalog-api-decisions-2026-11-17.md.

## Overall verdict

Read this first: the short judgement, the scorecard per surface, and the five changes worth making before more projects build on these names.

**The mechanics are well designed; the naming and addressing are not.** The engine has one action registry for every client, a uniform error model, safe writes (declared actor, request ids, expected revisions, checkout keys), plain-file records that merge across branches, and a plugin contract that tolerates failures. Those are hard to get right and they are right.

**The vocabulary grew one feature at a time and was never reconciled.** The same word means different things on different surfaces (`view` has four meanings, `capture` three, `kind` nine, `context` seven), the same entity has several names (unit / content / entry; asset / file / media / visual), and action names follow at least six patterns. A newcomer can use any single entry once they read it, but cannot predict the name or shape of the next one. The suspicion that the names are ambiguous and poorly namespaced is correct.

**Addressing is the weakest part.** A unit, a part or a piece of evidence is addressed with at least six different shapes and four string micro-grammars, so every action has to be read before it can be called.

Nothing here is broken; it is all fixable by renaming with aliases, because the registry already sits between every caller and every handler. The cost of fixing rises with every project plugin and agent script written against the current names.

| Surface | Grade | Note |
|---|---|---|
| Plugin API | B− | Sound contract and failure isolation; one flat bag of 41 exports with mixed suffixes, a deep import path, and library re-exports as contract. |
| Actions | C | Excellent registry and write safety; inconsistent names, six target shapes, no result schemas. |
| CLI | B+ | Thin, predictable wrapper over actions; a few sugar commands renamed (`todo` = `inbox`) and server lifecycle mixed with data commands. |
| HTTP API | B | One RPC route, strict request rules, consistent errors; unversioned and its module routes inherit the overloaded words. |
| Browser plugin API | C+ | The shared viewer state for people and agents is a strong idea; three different module shapes and an untyped, Preact-bound surface. |
| Configuration & records | B | Clear files, schemas the engine really decodes with; options linked to plugins by an invisible name, folder names that differ from action names. |
| Embedding API | C+ | Small and effective, but the facade mixes engine, serving and test counters, results are `unknown`, and setup has three entry points. |

Top changes:

1. **Adopt one action naming rule and rename the outliers, keeping the old names as aliases** (A1, A2): Fixes the most visible inconsistency on every surface at once (CLI, HTTP, page, plugins) with no behaviour change.
2. **Introduce one reference shape for targets, parts and evidence, with one string form** (S1): Removes six target shapes and four micro-grammars; every action, record, viewer session and CLI flag then addresses things the same way.
3. **Retire the overloaded words: view, capture, kind, context, source** (N1, N2, N4, N5, N7): Each currently forces a reader to know which surface they are on before a field name means anything.
4. **Split plugin.ts by domain behind a stable entry, and export the helpers built-ins use** (P1, P4, S2, P5): Plugin authors get the same `optional`/null convention, readable type errors and an import path that survives refactors.
5. **Publish result schemas and split the Catalog facade** (A6, E1, E3): Agents and embedding code stop casting `unknown`; serving internals and test counters leave the public surface.


## What to keep

The parts that are well designed and should survive any renaming: these are the reasons the APIs work despite the naming problems.

- **One registry for every caller**: CLI, HTTP, the page and plugin code all call the same actions with the same decoding. A plugin action is listed, validated, attributed and replayable exactly like a built-in one. This is what makes a rename-with-aliases fix cheap.
- **Strict, discoverable inputs**: Every read and write input is a JSON Schema, decoded strictly at every level (unknown fields refused, verified). `jam catalog actions --json` is a complete machine-readable index.
- **One error model**: `{ code, message, fix?, details? }` everywhere, ten codes, mapped consistently to CLI exit codes and HTTP statuses. `fix` lines are genuinely useful to agents.
- **Write safety**: Declared actor on every write, request ids bound to action, input, actor and checkout, `expectedRevision` with the current record in `details.current`, checkout keys that refuse stale writes, validate-everything-before-writing. Few internal tools get this right.
- **Records as plain, mergeable files**: Immutable submissions and verdict events, content-addressed evidence verified on every read, random time-ordered ids that merge across branches without collisions.
- **A forgiving plugin contract**: A plugin is a plain object; functions may return values, promises or Effects; failures become problems scoped to the plugin. `inputs` gives precise reloads, `enrich` patches without forking, relations compute their inverse. The armory example worked on the first load from the README alone.
- **Media recognised by bytes, in two halves**: Engine half (sniff, validate, probes cached by digest and version) and browser half (viewer, thumbnail, compare). Clean separation.
- **People and agents share the same viewers**: `useViewer` and a view's `state()`/`control()` are what the page shows and what `viewer.state`/`viewer.control` return. A capture is refused unless the viewer shows exactly the requested bytes. The framework-free `mount(host, ctx)` is the best-designed browser contract here.
- **Links in results**: `route` plus `url` (or one `hint`) in every result that names a page means an agent never assembles a link.

## Naming across surfaces

Words that mean different things on different surfaces, and entities that go by several names: the main source of the ambiguity in these APIs.


### N1 [high] "view" means four unrelated things

**what:** A submission item's `views` are captioned camera framings of evidence (ids `vw_…`). A type's `views` are browser inspectors in the unit's strip (selected as part `view:<key>`), alongside `panels`. A plugin's `views` is a name-to-file map of browser modules that serves both type views and panels. In viewer sessions, `target.view` means a submission view while `viewer.control { view: … }` sends a command to a type view.

**example:** {
 "lang": "json",
 "code": "// review.submit: a \"view\" is a framing of evidence\n{ \"items\": [{ \"target\": { \"kind\": \"unit\", \"id\": \"gear/helm\" },\n              \"views\": [{ \"part\": \"model\", \"caption\": \"Three-quarter front\", \"camera\": { … } }] }] }\n// TypeInput: a \"view\" is an inspector module\n{ \"views\": [{ \"key\": \"stats\", \"label\": \"Stat sheet\", \"module\": \"armory\", \"export\": \"statSheet\" }] }\n// viewer.open target.view = a submission view;  viewer.control.view = a command to a type view\n{ \"target\": { \"kind\": \"submission\", \"id\": \"sub_…\", \"item\": \"it_…\", \"view\": \"vw_…\" } }\n{ \"view\": { \"metric\": \"damage\" } }"
}

**why:** A plugin author who reads "views" in the README cannot tell from the name which of the four they are configuring, and an agent driving `viewer.*` has to know that the same key changes meaning between `open` and `control`. Panels being declared under `views` adds a fifth reading.

**fix:** Submission views → **shots** (`items[].shots`, ids `sh_…`). Type views → **inspectors** (`TypeInput.inspectors`, part `inspector:<key>`, `viewer.control { inspector: … }`). Plugin `views` → **pageModules** (it already serves panels). Keep the old keys as accepted aliases for one release.

**links:** [
 "a:review.submit",
 "p:TypeInput",
 "p:Plugin.views",
 "a:viewer.open",
 "a:viewer.control"
]


### N2 [high] "capture" names opposite things

**what:** A submission item's `captures` are evidence rendered **outside** the catalog (a game engine's screenshot; part `capture:<n>`). `viewer.capture` and `jam catalog capture` are the catalog's **own** render of its viewer. A media kind's `capture: { renderer, blocked }` describes how the catalog's own render labels itself. All of them meet in `.catalog/.local/captures`.

**example:** {
 "lang": "sh",
 "caption": "The worked example does exactly this: the catalog's capture becomes a submission's capture",
 "code": "jam catalog capture --target unit:weapon/ember-blade --part model --out captures/ember_blade_render.png\n# … then review.submit with  items[].captures: [{ \"label\": \"Nightly render\", \"file\": \"captures/ember_blade_render.png\" }]"
}

**why:** The README stresses that a submission capture is "not a screenshot of the running project" while the viewer capture's `renderer` says it is "a catalog render, not a screenshot": the distinction the whole review model depends on is carried by one word used for both sides.

**fix:** Submission evidence from outside → **renders** (`items[].renders`, part `render:<n>`, field `renderer` stays). Keep **capture** only for the catalog photographing its own viewer.

**links:** [
 "a:review.submit",
 "a:viewer.capture",
 "c:capture",
 "b:MediaKindDefinition"
]


### N3 [medium] "collection" covers two ownership models with one set of actions

**what:** Collections from sources are project-owned and read-only; collections made with `collection.create` are catalog-owned records. `collection.get` and `catalog.search` show both; `collection.update`/`collection.delete` and `collections.membership` only work on catalog-owned ones. The README calls the first kind "source", "project" and "project-owned" in different places.

**example:** {
 "lang": "sh",
 "code": "jam catalog run collection.get    --input '{\"id\":\"set/ironclad\"}'      # works (project-owned)\njam catalog run collection.update --input '{\"id\":\"set/ironclad\",…}'   # forbidden: \"Ironclad Set is defined by the project's sources; …\""
}

**why:** Nothing in the action names or results says which collections an action applies to, so a reader learns ownership from failures.

**fix:** Return `owner: "project" | "catalog"` on every collection, say "catalog-owned" in the descriptions of the actions that need it, and settle on one word ("project-owned") in docs. Optionally name the catalog-owned ones **lists** (`list.create`), which is what people use them for.

**links:** [
 "a:collection.create",
 "a:collection.update",
 "p:CollectionInput",
 "f:record.collection"
]


### N4 [medium] "kind" is nine different enums

**what:** Action kind (`read`/`write`/`viewer`), actor kind (`human`/`agent`), media kind (`image`, `model`…), field kind (`text`, `number`, `refs`, `code`), collection kind (a key into `collectionKinds`), target kind (`unit`/`collection`/`asset`/`submission`), item kind (`unit`/`collection`/`work`), evidence leaf kind, and the viewer state's `kind` (a media kind, or `view`, or `compare`).

**example:** {
 "lang": "json",
 "caption": "Two different kinds in one record",
 "code": "{ \"id\": \"set/ironclad\", \"kind\": \"armor-set\",               // a collection kind\n  \"members\": [{ \"unit\": \"gear/ironclad-helm\" }] }\n{ \"target\": { \"kind\": \"unit\", \"id\": \"gear/ironclad-helm\" } }   // a target kind"
}

**why:** `kind` carries no information about which vocabulary applies; readers must know the containing object. `RoleInput.kinds` (media kinds) next to `FieldInput.kind` (value format) in the same type definition is the sharpest case.

**fix:** Name enums by what they classify: `mediaKind` (assets, roles), `format` (fields), `collectionType` (collections), `access: read|write` (actions). Keep `kind` only for the discriminator of a reference (`{ kind: "unit", id }`).

**links:** [
 "p:FieldInput",
 "p:RoleInput",
 "p:CollectionInput",
 "e:ActionInfo"
]


### N5 [medium] "source" means a reader, a file list, a subject and an evidence identity

**what:** `Plugin.sources` are readers. `UnitInput.sources` are the files a unit came from. `ProblemInput.source` is what a problem is about (while `CheckProblem` calls the same thing `subject`). A viewer's `source` prop and state is the evidence identity it shows (while `viewer.capture` returns the same thing as `shows`).

**example:** {
 "lang": "json",
 "code": "{ \"units\": [{ \"id\": \"weapon/ember-blade\", \"sources\": [\"data/weapons.csv\"] }] }      // files\n{ \"problems\": [{ \"source\": \"data/weapons.csv\", \"error\": \"…\" }] }                        // subject\n{ \"viewer\": { \"source\": { \"unit\": \"weapon/ember-blade\", \"part\": \"model\", \"sha256\": \"…\" } } } // identity"
}

**why:** Two of the four meanings already have better names elsewhere in the same API (`subject`, `shows`); the inconsistency is visible side by side.

**fix:** `UnitInput.files`; `ProblemInput.subject` (matching `CheckProblem`); viewer `shows` (matching `viewer.capture`). Keep `sources` for readers only.

**links:** [
 "p:Source",
 "p:UnitInput",
 "p:ProblemInput",
 "p:CheckProblem",
 "b:viewer-state"
]


### N6 [low] "scope" is both a page section and a verdict's coverage

**what:** `Plugin.scopes`/`TypeInput.scope`/`catalog.search scope` are top-level page sections; a verdict record's `scope: { kind: "whole" | "parts", parts }` is which parts a decision covers.

**example:** {
 "lang": "json",
 "code": "{ \"scopes\": [{ \"id\": \"story\", \"label\": \"Story\" }] }            // a page section\n{ \"scope\": { \"kind\": \"whole\", \"parts\": [\"icon\", \"model\"] } }     // a verdict's coverage"
}

**why:** Mildly confusing for anyone reading records next to plugin code.

**fix:** Page sections → **sections** (`Plugin.sections`, `TypeInput.section`); or verdict scope → `covers`.

**links:** [
 "p:Plugin.scopes",
 "f:record.verdict"
]


### N7 [medium] "context" has seven meanings, two of them nested in one result

**what:** Plugin runtime arguments (`PluginContext`, `CheckContext`, `ActionContext`); the `context` action (project summary); the checkout key a write may carry (`RunMeta.context`, `context` in the HTTP body); the submission record's `context` (`branch`, `head`, `dirty`); `RequestBinding.context`; the viewer prop `context` (`{ unit, type, link }`); the `ctx` of browser modules.

**example:** {
 "lang": "js",
 "caption": "To bind a write to the checkout you read context.context.key from the context action and send it as context",
 "code": "const { context } = await run(\"context\", {})          // the action\nawait run(\"note.create\", { …, context: context.key })  // the write precondition"
}

**why:** The value a client must round-trip for safe writes is found at `context.context.key` and sent back as `context`; the name never says "checkout key".

**fix:** Action `context` → `project.status`; the write precondition → `checkoutKey` (body and `RunMeta`); submission `context` → `checkout`. Plugin contexts can keep the name: that is the conventional meaning.

**links:** [
 "a:context",
 "a:concept.context",
 "e:RunMeta",
 "f:record.submission"
]


### N8 [medium] The core entities go by several names

**what:** A **unit** is also called "content" and "entry": `unit.get` is described as "Inspect one catalog entry", its not-found error says "content gear/nope is not in this checkout", the default scope is `content`, and `review.submit` documents "Content part ids". An **asset** is also a "file", "media" and "visual": the page section and route are `#/files/a/<asset>`, the byte route is `/media/asset/<id>`, the missing-role facet is `visual: missing:<role>`, the search section is `assets`.

**example:** {
 "lang": "json",
 "code": "{ \"error\": { \"code\": \"not_found\", \"message\": \"content gear/nope is not in this checkout\" } }   // from unit.get\n\"#/files/a/art%2Fgear%2Fhelm.png\"   vs   \"/media/asset/art%2Fgear%2Fhelm.png\"   vs   section: \"assets\""
}

**why:** A reader cannot tell whether "content" is a unit or something broader (it is the default scope's name too), or whether a "file" route and an "asset" action address the same thing.

**fix:** Fix the glossary: **unit**, **asset**, **collection**, **submission**, **part**, **evidence**. Use only those in action names, errors, routes (`#/assets/a/…`) and facets (`role: missing:<role>`). Rename the default scope to something that is not an entity name (`main`).

**links:** [
 "a:unit.get",
 "a:catalog.search",
 "h:get-media-asset",
 "a:concept.links"
]


### N9 [low] Smaller collisions: label, item, version, schema, note

**what:** `label` is a display name everywhere, but a "Label record" (`labels/` folder) holds category and tags. `items` is both a submission's items and every list's results (`reviews.list` returns `items` of submissions, each with `items`). `version` is a schema token (`context`), a file token (`?v=`), a module digest prefix, a file format and a probe cache key. `schema` is the project's type model (action), every action's JSON Schema, and the re-exported Effect `Schema`. A submission's `note` (Markdown brief) is not a Note record, and a verdict's `partNotes` are not notes either.

**example:** {
 "lang": "json",
 "code": "// reviews.list: \"items\" twice with two meanings\n{ \"items\": [{ \"id\": \"sub_…\", \"items\": [{ \"id\": \"it_…\", \"target\": { … } }] }] }"
}

**why:** Each is small; together they make every field name provisional until checked.

**fix:** Label record → **organization record** (`organization/`). Lists return the plural entity (`submissions`, `units`). `schemaVersion`, `fileVersion`. Action `schema` → `project.types`. Submission `note` → `brief`; `partNotes` → `partComments` (it pairs with `comment`).

**links:** [
 "f:record.label",
 "a:reviews.list",
 "a:schema",
 "a:review.decide"
]


## Actions: naming and domain split

Whether the 43 action names follow a rule a newcomer could infer, how plugin actions fit in, and what the registry publishes.


### A1 [high] Six naming patterns and no inferable rule

**what:** Bare names (`context`, `schema`, `checkout`, `problems`, `inbox`, `doctor`, `unlock`); the product as a namespace for one action (`catalog.search`); singular entity + verb (`unit.get`, `note.create`, `review.submit`, `tag.rename`); plural entity + verb (`notes.list`, `reviews.list`, `locks.list`, `collections.membership`); a noun namespace for the read and a verb namespace for the writes of one domain (`organization.list` vs `organize.set`, `organize.bulk`, with `category.*` and `tag.*` beside them); a write under a read's name (`doctor` reads, `doctor.fix` writes); a camelCase compound verb (`review.decideCurrent`).

**example:** {
 "lang": "text",
 "caption": "One domain, four patterns",
 "code": "notes.list        note.create   note.edit   note.resolve\norganization.list organize.set  organize.bulk  category.create  tag.rename\nreviews.list      review.get    review.submit  review.decideCurrent  evidence.compare\nlocks.list        unlock"
}

**why:** Without a rule, every call needs a lookup: is it `note.list` or `notes.list`? `organization.set` or `organize.set`? `lock.remove` or `unlock`? Agents guess wrong and get `not_found` for names that "should" exist.

**fix:** Rule: **`<entity>.<verb>`**, entity singular, verbs from a closed set (`get`, `list`, `search`, `create`, `update`, `delete`, plus domain verbs `submit`, `decide`, `remove`, `resolve`, `reopen`, `rename`, `compare`, `fix`). Project-wide reads go under `project.*`. Renames (old names stay as aliases, listed with `deprecated: true` by `actions`):

**renames:** [
 [
  "context",
  "project.status"
 ],
 [
  "schema",
  "project.types"
 ],
 [
  "checkout",
  "project.checkout"
 ],
 [
  "problems",
  "project.problems"
 ],
 [
  "inbox",
  "project.inbox"
 ],
 [
  "doctor",
  "doctor.run"
 ],
 [
  "unlock",
  "lock.remove"
 ],
 [
  "locks.list",
  "lock.list"
 ],
 [
  "catalog.search",
  "unit.search · collection.search · asset.search (or search.query)"
 ],
 [
  "notes.list",
  "note.list"
 ],
 [
  "reviews.list",
  "review.list"
 ],
 [
  "collections.membership",
  "collection.membership"
 ],
 [
  "organization.list",
  "organization.list (keep)"
 ],
 [
  "organize.set",
  "organization.set"
 ],
 [
  "organize.bulk",
  "organization.setMany"
 ],
 [
  "review.decideCurrent",
  "review.decideCurrentContent (or review.approveCurrent…)"
 ],
 [
  "evidence.compare",
  "review.compareEvidence"
 ]
]

**links:** [
 "a:concept.registry",
 "c:actions"
]


### A2 [medium] Plugin actions share the built-in namespace space

**what:** Plugin actions are told to use `<plugin>.<verb>` (`storybook.outline`, `armory.dps`), which is the same shape as built-in `<entity>.<verb>` names. The registry only refuses an exact clash, so a plugin named `note` can add `note.pin`, which reads as built-in.

**example:** {
 "lang": "text",
 "code": "armory.dps          read   (plugin)\nreview.decide       write  (built-in)\nnote.pin            write  (would be a plugin, indistinguishable by name)"
}

**why:** Readers and agents cannot tell project actions from engine actions, or know which ones every catalog has.

**fix:** Reserve the built-in entity namespaces, and give plugin actions a visibly different separator: `armory:dps` (or `x.armory.dps`). `discover` already reports `plugin`.

**links:** [
 "p:Plugin.actions",
 "p:PluginAction",
 "x:armory-plugin"
]


### A3 [medium] "viewer" is a third action kind that mixes where an action runs with what it does

**what:** `read`/`write` describe effect and attribution rules; `viewer` describes that the action runs in a server's browser. `viewer.capture` writes a file under `.catalog/.local` but takes no actor; `viewer.*` inputs are also published without refusing excess properties, unlike reads and writes.

**example:** {
 "lang": "json",
 "code": "{ \"name\": \"viewer.capture\", \"kind\": \"viewer\" }   // writes a PNG, needs a server, no actor"
}

**why:** Code that branches on `kind` to decide whether to send an actor or whether the action is side-effect free gets the wrong answer for viewer actions.

**fix:** Two fields: `access: "read" | "write"` and `runsIn: "process" | "server"`.

**links:** [
 "a:viewer.capture",
 "e:ActionInfo"
]


### A4 [medium] Two listing models

**what:** `catalog.search` serves units, collections and assets through one input with `section`, returning `items`, `facets` and `ids` whose shape depends on the section. Notes and reviews have their own `notes.list`/`reviews.list` with different filters (`state`, `targetKind` and `target` side by side) and their own result keys (`notes`, `items`).

**example:** {
 "lang": "json",
 "code": "catalog.search  { \"section\": \"assets\", \"filters\": { \"use\": [\"unused\"] } }  → { items, facets, ids, … }\nnotes.list      { \"state\": \"open\", \"targetKind\": \"unit\" }               → { notes, counts, authors, … }\nreviews.list    { \"state\": \"waiting\" }                                  → { items, counts, … }"
}

**why:** A client needs a different pager and filter model per entity; `section` hides that units, collections and assets return different item shapes.

**fix:** `<entity>.search` for every listable entity, with one envelope `{ <entities>, total, page, pages, facets }`.

**links:** [
 "a:catalog.search",
 "a:notes.list",
 "a:reviews.list"
]


### A5 [low] Single/bulk and set/rename asymmetries

**what:** Organization has `organize.set` (one target) and `organize.bulk` (many targets, different field names: `addTags`/`removeTags` instead of `tags`); categories and tags have create/rename/delete but tags have no create; collections have `add`/`remove` and a full `members` replacement in one input.

**example:** {
 "lang": "json",
 "code": "organize.set   { \"target\": {…}, \"tags\": [...] }\norganize.bulk  { \"targets\": [...], \"addTags\": [...], \"removeTags\": [...] }"
}

**why:** Small, but each is another shape to learn.

**fix:** One `organization.set` taking `targets` (one or many) with `tags`, `addTags`, `removeTags`.

**links:** [
 "a:organize.set",
 "a:organize.bulk"
]


### A6 [high] Results have no schema

**what:** Every input is published as JSON Schema, but no result is. Result shapes are only discoverable by running the action; plugin code and embedding code cast `unknown`.

**example:** {
 "lang": "ts",
 "caption": "From the worked example's check: the result of unit.get has to be typed by hand",
 "code": "const unit = (await run(\"unit.get\", { id })) as {\n  unit: { attrs: { triBudget?: number } }\n  links: Array<{ role: string; asset: { path: string }; facts?: Record<string, { facts?: { triangles?: number } }> }>\n}"
}

**why:** Agents and scripts depend on result fields (`submission.url`, `links[].facts`) that no contract guarantees; renames in results are silent breaking changes.

**fix:** Declare an output schema per action (`ActionDef.output`), publish it beside `input`, and generate a typed `ActionMap` for `Catalog.run` and plugin `run`.

**links:** [
 "e:Catalog.run",
 "p:RunAction",
 "x:armory-plugin"
]


## Shapes: addressing, null, read/write, errors

How targets, parts and evidence are addressed, and whether optional values, write rules, results and errors follow one convention.


### S1 [high] Six target shapes and four string micro-grammars

**what:** Objects with different allowed kinds per action: `note.create` `{ kind: unit|collection|asset|submission, id, item?, part? }`; `organize.set` `{ kind: unit|asset|collection, id }`; `reviews.list` `{ kind: unit|collection, id }`; `review.decideCurrent` `{ kind: string, id: string }` (unchecked); `viewer.open` `{ kind, id, item, member, part, view, compare }`. Bare fields: `unit.get {id}`, `review.get {submission}` (id or six-character ref), `review.decide {submission, item}`, `evidence.compare {a: {submission, item, part}}`, `collections.membership {units}`, `notes.list {targetKind, target}`. Strings: CLI `--target unit:<id>` and `submission:<id>/<item>`; `viewer.open compare: "<submission>~<item>~<part>[~…]"`; part ids `role`, `role:key`, `member:<unit>`, `capture:<n>`, `view:<key>`, `preview`, `attributes`, `decision`; leaves `<unit>/<part>` or `base`; routes `#/<scope>/u/<id>`, `#/files/a/<id>`, `#/reviews/s/<sub>/<item>`.

**example:** {
 "lang": "json",
 "caption": "The same part of the same unit, addressed four ways",
 "code": "note.create     { \"target\": { \"kind\": \"unit\", \"id\": \"gear/helm\", \"part\": \"model\" } }\nviewer.open     { \"target\": { \"kind\": \"unit\", \"id\": \"gear/helm\", \"part\": \"model\" } }\njam catalog capture --target unit:gear/helm --part model\nevidence.compare { \"a\": { \"submission\": \"sub_…\", \"item\": \"it_…\", \"part\": \"model\" } }\nviewer.open     { \"target\": { \"kind\": \"submission\", \"id\": \"sub_…\", \"item\": \"it_…\", \"compare\": \"sub_…~it_…~model\" } }"
}

**why:** Every action has to be read before it can be called; tools cannot pass a reference from one result into another action unchanged; the `~` and `:` grammars are undocumented outside descriptions and break on ids that contain those characters.

**fix:** One `Ref`: `{ kind: "unit" | "collection" | "asset" | "submission", id, item?, part?, leaf? }`, accepted by every action that addresses something (`target`, or `a`/`b`) and returned in every result. One string form for CLIs and links (`unit:gear/helm#model`, `submission:sub_x/it_y#render:1`), parsed by one function. Parts stay strings for display but are also returned structured (`{ role, key }`).

**links:** [
 "a:note.create",
 "a:viewer.open",
 "a:evidence.compare",
 "a:review.decideCurrent",
 "c:capture"
]


### S2 [medium] The optional/null convention is not available to plugins

**what:** Built-in inputs accept `null` for every optional field (the internal `optional()` helper is `optionalKey(NullOr(…))`). Plugin actions only get `Schema.optionalKey`, so their optional fields refuse `null` (verified: `armory.dps` publishes `damageType: { type: "string" }`). The TypeScript input types mix `?:` and `| null` with no pattern: `thumb?: string | null`, `scope?: string`, `help?: string | null`, `label?: string`, `category?: string | null`.

**example:** {
 "lang": "json",
 "code": "// built-in (catalog.search):  \"q\": { \"anyOf\": [{ \"type\": \"string\" }, { \"type\": \"null\" }] }\n// plugin   (armory.dps):      \"damageType\": { \"type\": \"string\" }"
}

**why:** A client that sends `null` for "not given" (as the README tells it to) breaks on project actions only.

**fix:** Export `optional`, `Text`, `Page` and `targetOf` from plugin.ts; make the TS inputs `?: T` everywhere and normalise `null` at the boundary.

**links:** [
 "p:PluginAction",
 "a:concept.registry",
 "x:armory-plugin"
]


### S3 [medium] Write rules are runtime checks, not types

**what:** `ActionContext.actor` is `Actor | null` and `requestId` is `string | null` for every action, although a write always has an actor and a read never does. The JSON Schema of a write does not say an actor is required.

**example:** {
 "lang": "ts",
 "code": "note: input.note ?? `Requested by ${context.actor?.name ?? \"someone\"}`   // a write action still null-checks its actor"
}

**why:** Plugin authors write defensive code for impossible states and cannot tell from the listing what a write needs besides its input.

**fix:** `defineAction` overloads keyed on `kind`, giving `ReadContext` or `WriteContext` (`actor: Actor`); `actions --json` adds `requires: ["actor"]` for writes.

**links:** [
 "p:ActionContext",
 "p:defineAction",
 "a:concept.actor"
]


### S4 [low] Result envelopes vary

**what:** `note.create` returns `{ note }`, `collection.create` `{ collection }`, `review.submit` `{ submission }`, but `review.decide` returns `{ event }`, `note.delete` `{ deleted: <id> }`, `unlock` `{ removed }`, `review.remove` `{ removed: boolean, … }`; `unit.get` is flat (`{ route, unit, type, links, … }`) while `review.get` puts the submission's own fields at the top level.

**example:** {
 "lang": "json",
 "code": "{ \"note\": { … } }      { \"event\": { … } }      { \"deleted\": \"nt_…\" }      { \"removed\": true, \"plan\": \"…\" }"
}

**why:** Generic client code ("show what was written") cannot be written once.

**fix:** Writes return `{ <entity>: record, replayed? }`; deletes `{ deleted: Ref }`; detail reads `{ <entity>, … }`.

**links:** [
 "a:review.decide",
 "a:note.delete",
 "a:unit.get"
]


### S5 [low] Errors are uniform, except in the browser

**what:** Engine and HTTP errors are one `ToolError`. Browser modules use three conventions: `useViewer` control returns `true`, `false` or `{ error, code }`; a mount controller's `control` returns a result or `false` and throws for bad input; `registerMediaKind` throws.

**example:** {
 "lang": "js",
 "code": "useViewer(id, getState, (command) => ({ error: \"text needs { wrap }\", code: \"invalid\" }))\nmount → control: (command) => { throw new Error(\"metric must be one of …\") }"
}

**why:** Plugin authors write two error styles in the same module.

**fix:** One control result for both: return a value, `false` for "not mine", or throw `{ code, message }` (the page already maps throws to `invalid`).

**links:** [
 "b:useViewer",
 "b:mount",
 "p:ToolError"
]


## Plugin API

Whether plugin.ts is organised the way the domain is, and what a plugin author is coupled to.


### P1 [medium] plugin.ts is one flat bag of 41 exports with mixed suffixes

**what:** Declarative data (`TypeInput`, `UnitInput`, `SourceOutput`, `EnrichPatch`, `ScopeDef`), callback objects (`Source`, `Relation`, `Probe`, `Check`, `MediaKind`, `PluginAction`), runtime contexts (`PluginContext`, `CheckContext`, `ActionContext`), results (`CheckProblem`, `PluginResult`), domain records (`Actor`, `VerdictRecord`), library modules (`Effect`, `Schema`), errors and version 1 compatibility, all at one level. Suffixes follow no rule: `*Input`, `*Output`, `*Patch`, `*Def`, and bare names for the same category of thing (`ScopeDef` vs `MediaKind` vs `TypeInput`).

**example:** {
 "lang": "ts",
 "code": "import { type CheckProblem, defineAction, definePlugin, type PluginContext, Schema, toolError, type UnitInput } from \"../tools/jam/src/catalog/plugin.ts\""
}

**why:** An author cannot see from the exports which part of the domain a type belongs to or whether it is something they return, receive or implement.

**fix:** Group by domain behind one entry: `content` (Type, Field, Role, Unit, Link, Asset, Collection, CollectionKind, SourceOutput, EnrichPatch), `media` (MediaKind, Probe, ProbeFile), `review` (VerdictResolver, VerdictEvent), `page` (Section, Mount, previews), `actions` (defineAction, contexts), `compat` (AdapterFactory). Suffix rule: declarative data `*Spec`, implemented objects bare, received objects `*Context`.

**links:** [
 "p:Plugin",
 "p:TypeInput",
 "p:ScopeDef",
 "p:MediaKind"
]


### P2 [medium] Browser modules are declared in three places, linked by strings

**what:** A media kind declares its module inline (`MediaKind.web`); collection previews are a name map (`Plugin.previews`) referenced by `preview.module`; type views and panels are another name map (`Plugin.views`) referenced by `module` + `export`. The `module` strings are not checked by TypeScript; a typo surfaces as an `error` on the unit's views at runtime.

**example:** {
 "lang": "ts",
 "code": "views: [{ key: \"stats\", label: \"Stat sheet\", module: \"armory\", export: \"statSheet\" }],   // name → …\nviews: { armory: new URL(\"./armory.views.js\", import.meta.url).href }                    // … → file"
}

**why:** Three mechanisms for one idea ("this plugin ships a browser file") and a two-step string lookup make plugins harder to read and refactor.

**fix:** One `browser` block (`browser: { modules: { armory: url } }`) and typed handles: `const armory = browserModule(url)`, then `module: armory.export("statSheet")`.

**links:** [
 "p:Plugin.views",
 "p:Plugin.previews",
 "p:MediaKind",
 "p:MountInput"
]


### P3 [medium] Library modules are part of the contract

**what:** `Effect` and `Schema` are re-exported so plugins can build inputs and return Effects. The contract therefore includes Effect's major version (the examples use Effect 4's `Schema.optionalKey`); there is no `apiVersion` on a plugin.

**example:** {
 "lang": "ts",
 "code": "input: Schema.Struct({ damageType: Schema.optionalKey(Schema.String) })   // Effect 4 API in every project plugin"
}

**why:** An Effect upgrade in the toolkit becomes a breaking change for every project plugin, with no version to detect it.

**fix:** Accept a Standard Schema or JSON Schema for `input` (Effect Schema implements Standard Schema), keep Effect returns optional, and add `apiVersion` to `Plugin`.

**links:** [
 "p:Schema",
 "p:Effect",
 "p:PluginResult"
]


### P4 [medium] The public entry is a deep path into vendored source

**what:** Plugins import `../tools/jam/src/catalog/plugin.ts`. Writing the worked example also showed that the project needs `"type": "module"` in a `package.json` for TypeScript to accept the plugin (TS1295 otherwise); the README does not say so.

**example:** {
 "lang": "text",
 "code": "catalog/armory.ts(3,29): error TS1295: ECMAScript imports and exports cannot be written in a CommonJS file under 'verbatimModuleSyntax'."
}

**why:** Any reorganisation of `src/` breaks every project plugin; first-time authors hit a type error unrelated to their code.

**fix:** A stable top-level entry (`tools/jam/catalog-plugin.ts`, or a package export `jam-toolkit/catalog-plugin`), and setup that writes or checks the ESM `package.json`.

**links:** [
 "p:definePlugin",
 "x:armory-plugin"
]


### P5 [low] Type help stops at definePlugin

**what:** A mistake deep in a source's `load` result is reported against the whole inferred object: the worked example with `kinds: "image"` produced a TS2322 error several hundred characters long naming the `PromiseLike<SourceOutput>` union, not the role.

**example:** {
 "lang": "text",
 "code": "catalog/zz-bad.ts(61,30): error TS2322: Type 'Promise<{ types: { weapon: { label: string; thumb: string; fields: ({ key: string; … })[]; roles: … }' is not assignable to type 'PluginResult<SourceOutput>'."
}

**why:** Authors cannot find the field that is wrong.

**fix:** Export identity helpers per part (`defineSource`, `defineType`, `defineMediaKind`, `defineCheck`) so errors point at the property.

**links:** [
 "p:definePlugin",
 "p:Source",
 "p:TypeInput"
]


### P6 [low] Internal and legacy types leak into the contract

**what:** `Actor` and `VerdictRecord` are re-exported directly from the internal `model/types.ts` (with `requestBinding`); `SourceOutput.schema` and `AdapterFactory` are version 1 leftovers in the main contract.

**example:** {
 "lang": "ts",
 "code": "export type { Actor, VerdictRecord } from \"./model/types.ts\""
}

**why:** Internal model changes become contract changes; newcomers see v1 shapes beside v2 ones.

**fix:** A public `VerdictEvent` type for resolvers; move v1 to a `compat` export.

**links:** [
 "p:VerdictRecord",
 "p:AdapterFactory",
 "p:SourceOutput"
]


## Browser plugin API

Whether the page-side API gives module authors one model to learn.


### B1 [high] Three module shapes for one idea

**what:** A media kind module default-exports `(catalog) => void` and registers itself; a preview module default-exports `(ctx) => markup` (Preact markup via `ctx.html`); a view or panel module exports named `mount(host, ctx)` functions that use the DOM directly and return a controller. They report state differently (`useViewer` vs `state()`), receive different context objects and use different rendering technology.

**example:** {
 "lang": "js",
 "code": "export default function (catalog) { catalog.registerMediaKind(\"text\", { viewer: TextViewer }) }   // kind\nexport default function lineup(ctx) { return ctx.html`<${ctx.viewers.ModelViewer} … />` }        // preview\nexport function statSheet(host, ctx) { …; return { state, control, dispose } }                      // view"
}

**why:** Learning one does not teach the others; a project that needs a viewer, a preview and an inspector writes three styles.

**fix:** One contract: `mount(host, ctx)` for viewers, previews, inspectors and panels, with the shared `catalog` helpers on `ctx`; Preact wrappers as an optional convenience.

**links:** [
 "b:catalog-api",
 "b:preview-module",
 "b:mount"
]


### B2 [medium] Untyped and bound to Preact

**what:** `html`, `hooks` and all components are Preact; a kind's `viewer` must be a Preact component. There are no type declarations for the browser side: the viewer state contract (`kind`, `status`, `error`, `source`, `controls`) is prose in comments. `useViewer` is `registerViewer` renamed, and is a hook despite registering callbacks.

**example:** {
 "lang": "js",
 "code": "useViewer: registerViewer,   // catalog/web/plugin-api.js"
}

**why:** A Preact upgrade breaks plugins; authors get no editor help on the most error-prone part (state fields that gate captures).

**fix:** Ship a `catalog-web.d.ts` (or JSDoc typedefs) with the module contract and `ViewerState`; isolate Preact behind the optional wrappers.

**links:** [
 "b:useViewer",
 "b:viewer-state",
 "b:MediaKindDefinition"
]


### B3 [medium] Control names share one flat object with session metadata

**what:** `viewer.control` mixes meta keys (`session`, `select`) with control names (`camera`, `mode`, `audio`, a plugin kind's own) and with `view`, the envelope for a type view's command.

**example:** {
 "lang": "json",
 "code": "{ \"session\": \"default\", \"select\": { \"part\": \"model\" }, \"mode\": \"clay\", \"view\": { \"metric\": \"damage\" } }"
}

**why:** A plugin control named `select` or `session` is impossible, and the envelope rule differs per target.

**fix:** `{ session?, select?, controls: { camera?, mode?, …, inspector? } }`.

**links:** [
 "a:viewer.control"
]


## Configuration and records

Whether the files read like the API that writes them.


### C1 [medium] Plugin options are linked to plugins by an invisible name

**what:** `plugins` lists module paths, but `options` is keyed by the `name` inside each module: `"./catalog/armory.ts"` gets `options.armory` because the module says `name: "armory"`.

**example:** {
 "lang": "json",
 "code": "{ \"plugins\": [\"manifest\", \"./catalog/armory.ts\"],\n  \"options\": { \"armory\": { \"table\": \"data/weapons.csv\" } } }"
}

**why:** The file does not show which options belong to which entry, and renaming the plugin's `name` detaches its options. Worse, there are two keying rules: a module whose default export is a plugin object gets `options[<its name>]`, while a module that exports an adapter function gets `options[<its path>]` (`src/catalog/Plugins.ts`).

**fix:** Allow `plugins: ["manifest", { "module": "./catalog/armory.ts", "options": { … } }]`.

**links:** [
 "f:config.v2",
 "p:PluginContext"
]


### C2 [low] Record names differ from action names

**what:** `labels/` holds what the actions call organization; review folders hold "submissions"; verdict files are "verdict events" returned as `{ event }`.

**example:** {
 "lang": "text",
 "code": ".catalog/labels/unit/…json    ← organize.set\n.catalog/reviews/sub_…/verdicts/vd_….json   ← review.decide returns { \"event\": … }"
}

**why:** Someone reading the Git diff of a review cannot map files to the action that made them by name.

**fix:** `organization/`; return `{ verdict }`; call the record "verdict" everywhere.

**links:** [
 "f:records",
 "f:record.label",
 "f:record.verdict"
]


### C3 [low] Role keys are global in review policy

**what:** `review.referenceRoles` lists role keys without types, so `concept` is reference material in every type that has a `concept` role.

**example:** {
 "lang": "json",
 "code": "{ \"review\": { \"referenceRoles\": [\"concept\"] } }"
}

**why:** A project cannot make a role reference material in one type only.

**fix:** Accept `type:role` as well as `role`.

**links:** [
 "f:config.v2",
 "p:RoleInput"
]


## CLI and HTTP

The two transports: thin and mostly consistent, with a few names that drift from the actions they wrap.


### H1 [low] Sugar commands renamed, server lifecycle mixed in

**what:** `todo` prints `inbox`; `doctor --fix` runs `doctor.fix`; `capture` runs `viewer.open` + `viewer.control` + `viewer.capture`; `open`, `status`, `stop`, `serve` (server lifecycle) sit beside `run` and `actions` in one flat group.

**example:** {
 "lang": "sh",
 "code": "jam catalog todo          # = jam catalog run inbox\njam catalog open          # starts a server\njam catalog run inbox"
}

**why:** Two names for one thing; the group mixes data and process management.

**fix:** `jam catalog inbox` (keep `todo` as alias); `jam catalog server open|status|stop|serve`.

**links:** [
 "c:todo",
 "c:open",
 "c:capture"
]


### H2 [low] Unversioned routes that inherit the overloaded words

**what:** `/api/run/<action>` has no version; browser modules are served at `/project/kind/`, `/project/preview/`, `/project/view/` (the last serves panels too); bytes at `/media/asset/` while the page calls assets `files`. The page is attributed through a header (`X-Catalog-Client: web`) while every other client sends `actor`.

**example:** {
 "lang": "http",
 "code": "GET /project/view/armory?v=a6cbc28cb6e7b48c     (serves the weapon's inspector and its panel)"
}

**why:** Renames later will need a version to coexist; two attribution mechanisms complicate auditing.

**fix:** `/api/v1/…`; `/modules/<name>`; attribute the page by sending its actor like any client.

**links:** [
 "h:post-run",
 "h:get-project-view"
]


## Embedding API

Whether toolkit code gets a small, typed facade.


### E1 [medium] The facade mixes engine, serving and test diagnostics

**what:** `Catalog` has the engine API (`run`, `discover`, `context`, `config`, `defaultActor`), the HTTP server's needs (`assetFile`, `evidenceMedia`, `beforeMedia`, `previewModule`, `kindModule`, `viewModule`, `server`, `writeLocal`) and `stats`, counters that exist for the performance tests.

**example:** {
 "lang": "ts",
 "code": "readonly stats: Effect.Effect<CatalogStats>   // \"used by the performance tests\""
}

**why:** Embedding code sees fifteen members where five matter, and test hooks become contract.

**fix:** `Catalog` (engine), `CatalogMedia` (serving), internal `CatalogDiagnostics`.

**links:** [
 "e:Catalog",
 "e:Catalog.stats",
 "e:Catalog.assetFile"
]


### E2 [medium] Three ways to set up one engine

**what:** `Catalog.layer`, `Catalog.layerWith(Partial<Setup>)` and providing the `CatalogSetup` reference directly; `layerWith` passes on only two of `Setup`'s three fields. `layerNoDeps` is public too.

**example:** {
 "lang": "ts",
 "code": "static readonly layerWith = (setup: Partial<Setup>) =>\n  Catalog.layer.pipe(Layer.provide(Layer.succeed(CatalogSetup, { plugins: setup.plugins ?? {}, overrides: setup.overrides ?? {} })))"
}

**why:** Callers choose between equivalent-looking entry points that are not equivalent.

**fix:** One `Catalog.layer(setup?: Setup)`; make `CatalogSetup` and `layerNoDeps` internal.

**links:** [
 "e:Catalog.layerWith",
 "e:CatalogSetup",
 "e:Setup"
]


### E3 [medium] run returns unknown

**what:** `Catalog.run(action: string, …): Effect<unknown>`; plugin `RunAction` returns `Promise<unknown>`. Action names are strings with no completion.

**example:** {
 "lang": "ts",
 "code": "const found = yield* catalog.run(\"catalog.search\", { q: \"helm\" })   // unknown"
}

**why:** Every caller casts, and typos in action names are runtime `not_found` errors.

**fix:** A generated `ActionMap` (from input and output schemas, see A6) so `run<"unit.get">` is typed.

**links:** [
 "e:Catalog.run",
 "p:RunAction"
]
