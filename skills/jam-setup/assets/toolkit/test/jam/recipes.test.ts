import * as Effect from "effect/Effect"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { Checks } from "../../src/jam/checks/Checks.ts"
import { resolveGuide } from "../../src/jam/recipes/guides.ts"
import { Recipes } from "../../src/jam/recipes/Recipes.ts"
import { recipeProblems } from "../../src/jam/recipes/resolve.ts"
import { cli, jam, jamFailure, jamProject, readJson, write } from "./fixtures.ts"

const recipe = (id: string, body: Record<string, unknown>): string => JSON.stringify({ version: 1, id, ...body })
const get = (root: string, id: string) => jam(root, Effect.flatMap(Recipes, (recipes) => recipes.get(id)))
const getFailure = (root: string, id: string) => jamFailure(root, Effect.flatMap(Recipes, (recipes) => recipes.get(id)))

describe("shipped recipes", () => {
  it("resolve, name only known checks, and point at guides whose file and heading exist", async () => {
    const root = jamProject()
    await jam(root, Effect.gen(function*() {
      const recipes = yield* Recipes
      const checks = new Set((yield* (yield* Checks).list).map((check) => check.id))
      const ids = yield* recipes.shipped
      assert.deepEqual([...ids].sort(), ["asset", "character", "image", "prop", "provider-test", "sfx", "voice-line"])
      for (const id of ids) {
        const resolved = yield* recipes.get(id)
        assert.ok(resolved.when, `${id} says which requests it is for`)
        const guides = new Map<string, string | null>()
        for (const step of resolved.steps) {
          const guide = step.guide ?? ""
          assert.ok(guide.startsWith("toolkit:docs/recipes/"), `${id} ${step.id} has a shipped guide`)
          guides.set(guide, (yield* resolveGuide(guide)).problem)
        }
        assert.deepEqual(recipeProblems(resolved, { checks, guides }), [], id)
      }
    }))
  })

  it("keep topology, UVs and textures as separate steps with the version 1 names", async () => {
    const root = jamProject()
    assert.deepEqual((await get(root, "asset")).steps.map((step) => step.id), ["concept", "turnaround", "mesh", "topology", "uv", "texture", "delivery"])
    const prop = await get(root, "prop")
    assert.deepEqual(prop.steps.map((step) => step.id), ["concept", "turnaround", "mesh", "topology", "uv", "texture", "collision", "import", "delivery"])
    assert.deepEqual(prop.steps.map((step) => step.skill), ["jam-concept", "jam-turnaround", "jam-model", "jam-retopo", "jam-uv", "jam-texture", "jam-engine", "jam-engine", undefined])
    assert.equal(prop.budget, "prop")
    assert.deepEqual(prop.chain, ["builtin:prop", "builtin:asset"])
    const character = await get(root, "character")
    assert.deepEqual(character.steps.map((step) => step.id), ["concept", "turnaround", "mesh", "topology", "uv", "texture", "rig", "conform", "import", "delivery"])
    const rig = character.steps.find((step) => step.id === "rig")!
    assert.equal(rig.skill, "jam-rig")
    assert.deepEqual(rig.checks, ["deformation-evidence"])
    assert.deepEqual(character.steps.find((step) => step.id === "conform")!.when, { engine: "conform-skeleton" })
    assert.deepEqual(character.steps.find((step) => step.id === "import")!.when, { engine: "import" })
  })
})

describe("recipe resolution", () => {
  it("a project recipe shadows a shipped one of the same id and records where each field came from", async () => {
    const root = jamProject({ files: { "jam/recipes/prop.json": recipe("prop", { extends: "builtin:prop", steps: [{ id: "mesh", review: "human" }] }) } })
    const prop = await get(root, "prop")
    const mesh = prop.steps.find((step) => step.id === "mesh")!
    assert.equal(mesh.review, "human")
    assert.equal(mesh.origin["review"], "project:prop")
    assert.equal(mesh.origin["skill"], "builtin:asset")
    assert.deepEqual(prop.chain, ["project:prop", "builtin:prop", "builtin:asset"])
    assert.equal((await get(root, "builtin:prop")).steps.find((step) => step.id === "mesh")!.review, "agent", "the shipped recipe is still reachable")
  })

  it("extends merges steps by id, removes with remove, and places new steps with after", async () => {
    const root = jamProject({
      files: {
        "jam/recipes/crate.json": recipe("crate", {
          extends: "builtin:asset",
          steps: [
            { id: "turnaround", remove: true },
            { id: "mesh", needs: ["concept"] },
            { id: "blockout", after: "concept", needs: ["concept"], produces: [{ role: "model", kind: "model", max: 1 }] },
            { id: "notes", review: "none" }
          ]
        })
      }
    })
    const crate = await get(root, "crate")
    assert.deepEqual(crate.steps.map((step) => step.id), ["concept", "blockout", "mesh", "topology", "uv", "texture", "delivery", "notes"])
    assert.deepEqual(crate.steps.find((step) => step.id === "mesh")!.needs, ["concept"])
    assert.equal(crate.steps.find((step) => step.id === "blockout")!.review, "agent", "a step that names no gate is reviewed by an agent")
  })

  it("refuses unknown needs, cycles, duplicate ids, a removal of nothing and a cycle of extends, each with its fix", async () => {
    const cases: ReadonlyArray<readonly [string, Record<string, unknown>, RegExp]> = [
      ["needs", { steps: [{ id: "a", needs: ["ghost"] }] }, /step a needs ghost, which is not a step/],
      ["cycle", { steps: [{ id: "a", needs: ["b"] }, { id: "b", needs: ["a"] }] }, /cycle: a -> b -> a/],
      ["twice", { steps: [{ id: "a" }, { id: "a" }] }, /step id a appears twice/],
      ["gone", { extends: "builtin:image", steps: [{ id: "ghost", remove: true }] }, /no inherited step has that id/],
      ["dangling", { extends: "builtin:asset", steps: [{ id: "turnaround", remove: true }] }, /step mesh needs turnaround, which is not a step/],
      ["self", { extends: "self", steps: [] }, /extend each other in a cycle/]
    ]
    for (const [id, body, message] of cases) {
      const root = jamProject({ files: { [`jam/recipes/${id}.json`]: recipe(id, body) } })
      const error = await getFailure(root, id)
      assert.match(error.message, message, id)
      assert.equal(error.code, "invalid", id)
    }
    const root = jamProject({ files: { "jam/recipes/odd.json": recipe("other", { steps: [] }), "jam/recipes/typo.json": recipe("typo", { steps: [{ id: "a", reveiw: "human" }] }) } })
    assert.match((await getFailure(root, "odd")).message, /id is other, expected odd/)
    assert.match((await getFailure(root, "typo")).message, /steps\[0\]\.reveiw|reveiw/)
    assert.equal((await getFailure(root, "nowhere")).code, "not_found")
  })

  it("recipe check reports unknown checks and missing guides or headings; a project check from config is known", () => {
    const root = jamProject({
      config: { checks: { "collision-covers": { run: ["node", "check.mjs", "{file:model}"] } } },
      files: {
        "docs/props.md": "# Props\n\n## Collision shapes\n",
        "jam/recipes/crate.json": recipe("crate", {
          steps: [
            { id: "a", checks: ["collision-covers", "no-such-check"], guide: "docs/props.md#collision-shapes" },
            { id: "b", guide: "docs/props.md#nowhere" },
            { id: "c", guide: "docs/missing.md" },
            { id: "d", guide: "toolkit:docs/recipes/prop.md#mesh" }
          ]
        })
      }
    })
    const result = cli(root, "recipe", "check", "crate", "--json")
    assert.equal(result.status, 2)
    const problems = (JSON.parse(result.stdout) as { recipes: Array<{ problems: Array<{ message: string }> }> }).recipes[0]!.problems.map((problem) => problem.message)
    assert.equal(problems.length, 3, problems.join("\n"))
    assert.match(problems[0]!, /step a names check no-such-check/)
    assert.match(problems[1]!, /docs\/props\.md has no heading for #nowhere/)
    assert.match(problems[2]!, /docs\/missing\.md does not exist/)
    assert.equal(cli(root, "recipe", "check", "prop").status, 0)
  })
})

describe("recipe commands", () => {
  it("list says what each recipe is for; show marks where gates came from and whether conditions hold", () => {
    const root = jamProject()
    const list = cli(root, "recipe", "list", "--json").json<{ recipes: Array<{ id: string; when: string; source: string }> }>()
    assert.match(list.recipes.find((entry) => entry.id === "prop")!.when, /does not deform/)
    const show = cli(root, "recipe", "show", "prop", "--json").json<{ steps: Array<{ id: string; condition?: { when: string; met: boolean; reason?: string } }> }>()
    const condition = show.steps.find((step) => step.id === "import")!.condition!
    assert.equal(condition.when, "engine provides import")
    assert.equal(condition.met, false)
    assert.match(condition.reason!, /no engine adapter is configured/)
    const shown = cli(root, "recipe", "show", "prop").stdout
    assert.match(shown, /mesh\s+turnaround\s+model \(model\)\s+agent \[builtin:asset\]/)
    // A recipe's own guide for a step is read with its base recipe's guide, never instead of it.
    assert.match(shown, /guide toolkit:docs\/recipes\/prop\.md#mesh \+ toolkit:docs\/recipes\/asset\.md#mesh/)
  })

  it("set changes one gate in a project recipe that extends the shipped one, and new scaffolds a recipe that validates", async () => {
    const root = jamProject()
    assert.equal(cli(root, "recipe", "set", "prop", "mesh", "--review", "human").status, 0)
    // The project recipe lists only what differs; the title and "when" are inherited.
    assert.deepEqual(readJson(root, "jam/recipes/prop.json"), { version: 1, id: "prop", extends: "builtin:prop", steps: [{ id: "mesh", review: "human" }] })
    assert.equal((await get(root, "prop")).title, "Static prop")
    assert.equal(cli(root, "recipe", "set", "prop", "concept", "--reviewer", "art lead").status, 0)
    assert.match(cli(root, "recipe", "show", "prop").stdout, /concept\s+concept \(image\)\s+human by art lead/)
    assert.equal(cli(root, "recipe", "set", "prop", "mesh", "--optional", "true").status, 0)
    assert.deepEqual(readJson<{ steps: unknown }>(root, "jam/recipes/prop.json").steps, [{ id: "mesh", review: "human", optional: true }, { id: "concept", reviewer: "art lead" }])
    assert.equal((await get(root, "prop")).steps.find((step) => step.id === "mesh")!.optional, true)
    assert.match(cli(root, "recipe", "set", "prop", "ghost", "--review", "human").stderr, /step ghost is not in recipe prop/)
    assert.equal(existsSync(join(root, "tools")), false, "the installed toolkit is never edited")

    assert.equal(cli(root, "recipe", "new", "crate", "--extends", "builtin:prop").status, 0)
    const crate = readJson<{ extends: string; title?: string; when?: string }>(root, "jam/recipes/crate.json")
    assert.deepEqual([crate.extends, crate.title, crate.when], ["builtin:prop", undefined, undefined], "an extending scaffold inherits what the recipe is for")
    assert.equal((await get(root, "crate")).when, (await get(root, "prop")).when)
    assert.equal(cli(root, "recipe", "new", "crate").status, 1, "an existing recipe is not replaced")
    assert.equal(cli(root, "recipe", "new", "loose").status, 0)
    assert.equal(cli(root, "recipe", "check").status, 0)
    write(root, "jam/recipes/loose.json", recipe("loose", { steps: [{ id: "a", checks: ["nope"] }] }))
    assert.equal(cli(root, "recipe", "check").status, 2)
  })
})
