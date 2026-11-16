// Paid audio through the run ledger, with a stand-in provider program: the estimate, the caps, a
// success settled with the actual charge, a refusal, a lost answer and the duplicate guard. Then
// the sfx recipe end to end, with no engine adapter and with one that imports audio.
import * as Effect from "effect/Effect"
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { sha256 } from "../../src/kernel/hash.ts"
import type { AudioUnit } from "../../src/jam/audio/schema.ts"
import { AudioProvider } from "../../src/jam/audio/AudioProvider.ts"
import { generate, type GenerateInput } from "../../src/jam/audio/sfx.ts"
import { Checks } from "../../src/jam/checks/Checks.ts"
import { importFor } from "../../src/jam/engine/host.ts"
import { listJobs, updateJobState } from "../../src/jam/runs/jobs.ts"
import { audioProject, bytesOf, NO_FFMPEG, paidCalls, PROVIDER_ID, STANDING } from "./audio-fixtures.ts"
import { cli, jam, jamFailure, readJson } from "./fixtures.ts"
import { record, recordFailure, review, runFile, start, stateOf, status } from "./flow.ts"

const request = (name: string, extra: Partial<GenerateInput> = {}): GenerateInput => ({
  name, prompt: "A wooden mallet striking an oak plank, close and dry", takes: 1, settings: {}, dryRun: false, loop: false, stereo: false, tighten: false, ...extra
})
const unitOf = (root: string, name: string): AudioUnit => readJson<AudioUnit>(root, `Audio/SFX/${name}/unit.json`)
const skip = NO_FFMPEG

describe("the estimate", () => {
  it("a dry run states the cost in the provider's unit with its basis, needs no run and sends nothing", async () => {
    const root = audioProject()
    const plan = await jam(root, generate(request("mallet", { takes: 3, duration: 8, dryRun: true })))
    assert.deepEqual([plan.spending.perRequest, plan.spending.requests, plan.spending.total, plan.spending.unit], [320, 3, 960, "ElevenLabs credits"])
    assert.match(plan.spending.words, /at most 960 ElevenLabs credits for 3 requests \(list price: 40 credits per second/)
    assert.equal(plan.planned!.request["text"], "A wooden mallet striking an oak plank, close and dry")
    assert.match(plan.next, /nothing was sent/)
    assert.deepEqual(paidCalls(root), [])
  })

  it("a request the provider cannot take is refused before anything is opened, naming the setting", async () => {
    const root = audioProject()
    assert.match((await jamFailure(root, generate(request("mallet", { duration: 45 })))).message, /--duration must be 0\.5 to 30 seconds/)
    assert.match((await jamFailure(root, generate(request("mallet", { settings: { loudness: 3 } })))).message, /--setting loudness is not a sound setting/)
    assert.match((await jamFailure(root, generate(request("Mallet Hit")))).message, /lowercase words joined by hyphens/)
    assert.match((await jamFailure(root, generate(request("mallet", { takes: 9 })))).message, /--takes 9: expected 1 to 5/)
  })
})

describe("spending rules", () => {
  it("paid generation needs a run; the fix is the command that starts one", async () => {
    const root = audioProject()
    const error = await jamFailure(root, generate(request("mallet")))
    assert.equal(error.code, "not_found")
    assert.match(error.fix!, /jam run start sfx mallet --brief-text/)
    assert.deepEqual(paidCalls(root), [])
  })

  it("a batch over the per-run cap is refused whole, before the first request", async () => {
    const root = audioProject({ config: { spend: { [PROVIDER_ID]: { perRun: 300, standing: STANDING } } } })
    await start(root, "sfx", "mallet")
    const error = await jamFailure(root, generate(request("mallet", { takes: 2 })))
    assert.equal(error.code, "forbidden")
    assert.match(error.message, /would take the run to 400 ElevenLabs credits, over the per-run cap of 300/)
    assert.deepEqual([paidCalls(root).length, runFile(root, "mallet").jobs.length], [0, 0])
  })

  it("with no spend entry paid work is disabled, and without a standing authorization the approval must be given", async () => {
    const disabled = audioProject({ config: { spend: {} } })
    await start(disabled, "sfx", "mallet")
    assert.match((await jamFailure(disabled, generate(request("mallet")))).message, /paid work is disabled \(no spend\.elevenlabs entry/)
    const asking = audioProject({ config: { spend: { [PROVIDER_ID]: { perRun: 1000 } } } })
    await start(asking, "sfx", "mallet")
    const error = await jamFailure(asking, generate(request("mallet")))
    assert.match(error.message, /--authorized is required: who approved spending ElevenLabs credits/)
    assert.deepEqual(paidCalls(asking), [])
  })
})

describe("a paid request", { skip }, () => {
  it("is opened with the estimate, settled with what the account was charged, and its original is kept untouched beside the processed take", async () => {
    const root = audioProject()
    await start(root, "sfx", "mallet")
    const result = await jam(root, generate(request("mallet", { takes: 2 })))
    assert.deepEqual([result.takes.length, result.charged, result.warnings], [2, 300, []])
    const jobs = runFile(root, "mallet").jobs
    assert.deepEqual(jobs.map((job) => [job.id, job.state, job.estimate, job.actual, job.unit, job.price.kind]), [["j1", "succeeded", 200, 150, "credits", "list"], ["j2", "succeeded", 200, 150, "credits", "list"]])
    assert.equal(jobs[0]!.authorization, STANDING)
    assert.equal(jobs[0]!.providerJob, "req_1")
    assert.match(jobs[0]!.history.at(-1)!.evidence!, /the account's usage moved by 150 ElevenLabs credits/)
    // Two takes of one prompt are one request file: the same content, sent twice on purpose once the first was settled.
    assert.equal(jobs[0]!.request.path, jobs[1]!.request.path)
    assert.deepEqual(Object.keys(readJson(root, jobs[0]!.request.path)).sort(), ["duration_seconds", "loop", "model_id", "operation", "output_format", "prompt_influence", "text"])

    const unit = unitOf(root, "mallet")
    assert.deepEqual([unit.id, unit.kind, unit.target, unit.takes.map((take) => take.file)], ["sfx/mallet", "sfx", "effect", ["Audio/SFX/mallet/mallet.wav", "Audio/SFX/mallet/mallet_2.wav"]])
    const [first] = unit.takes
    assert.deepEqual([first!.generation.origin, first!.generation.provider, first!.generation.run, first!.generation.job, first!.generation.charge], ["generated", "elevenlabs", "mallet:1", "j1", 150])
    assert.equal(first!.generation.prompt, "A wooden mallet striking an oak plank, close and dry")
    assert.equal(first!.generation.request!.sha256, jobs[0]!.request.sha256)
    assert.match(first!.original.path, /^Audio\/Sources\/sfx\/mallet\/.+_1\.wav$/)
    assert.equal(sha256(bytesOf(root, first!.original.path)), first!.original.sha256)
    assert.equal(sha256(bytesOf(root, first!.file)), first!.sha256)
    assert.notEqual(first!.sha256, first!.original.sha256)
    assert.deepEqual([first!.level.level, first!.level.reference, first!.facts.sampleRate, first!.facts.bitDepth], [-26, -26, 48000, 24])
    assert.doesNotMatch(JSON.stringify(unit), /"\/|[A-Za-z]:\\\\|https?:/, "the record holds no absolute path or URL")

    // The step that received the takes is recorded against the last job, with every original.
    assert.deepEqual(result.recorded!.records.map((entry) => [entry.step, entry.state]), [["generate", "accepted"]])
    const generated = runFile(root, "mallet").steps["generate"]!.records.at(-1)!
    assert.deepEqual([generated.files.map((file) => file.role), generated.provenance], [["original", "original"], { kind: "job", job: "j2", provider: "elevenlabs" }])
    assert.match(result.next, /a person listens.*jam run record mallet process/)
  })

  it("one run can gather a batch: each sound's takes are jobs of that run, and the step holds every original", async () => {
    const root = audioProject()
    await start(root, "sfx", "kitchen-batch")
    await jam(root, generate(request("pan-drop", { run: "kitchen-batch", prompt: "A steel pan dropped on a tiled floor, close and dry" })))
    await jam(root, generate(request("cork-pop", { run: "kitchen-batch", prompt: "A cork pulled from a glass bottle, close and dry" })))
    const run = runFile(root, "kitchen-batch")
    assert.deepEqual(run.jobs.map((job) => [job.id, job.state]), [["j1", "succeeded"], ["j2", "succeeded"]])
    assert.notEqual(run.jobs[0]!.request.sha256, run.jobs[1]!.request.sha256)
    assert.deepEqual(run.steps["generate"]!.records.at(-1)!.files.map((file) => file.path.split("/")[3]), ["pan-drop", "cork-pop"])
    assert.deepEqual([unitOf(root, "pan-drop").takes[0]!.generation.run, unitOf(root, "cork-pop").takes[0]!.generation.job], ["kitchen-batch:1", "j2"])
  })

  it("a refusal makes nothing and costs nothing: the job is settled as never made, with the provider's stated wait", async () => {
    const root = audioProject()
    await start(root, "sfx", "mallet")
    const result = await jam(root, generate(request("mallet", { prompt: "REFUSE a mallet on oak" })))
    assert.match(result.refused!, /Retry after 37 seconds/)
    assert.match(result.next, /a stated wait is the time to wait/)
    const [job] = runFile(root, "mallet").jobs
    assert.deepEqual([job!.state, job!.actual], ["not-submitted", 0])
    assert.match(job!.history.at(-1)!.evidence!, /the provider refused the request and made nothing/)
    assert.equal(result.recorded, undefined)
  })

  it("a lost answer leaves the job lost and blocks the same request in every run until someone settles it", async () => {
    const root = audioProject()
    await start(root, "sfx", "mallet")
    const lost = await jamFailure(root, generate(request("mallet", { prompt: "LOSE a mallet on oak", takes: 2 })))
    assert.equal(lost.code, "unavailable")
    assert.match(lost.message, /job j1 of run mallet:1: no answer was read from elevenlabs.*It may have been made and charged, so it was not sent again/)
    assert.match(lost.fix!, /jam job submitted mallet j1 --provider-job .*jam job cancelled mallet j1 --evidence/)
    assert.deepEqual(runFile(root, "mallet").jobs.map((job) => job.state), ["lost"])
    assert.equal(paidCalls(root).length, 1, "the second take was not attempted")

    const again = await jamFailure(root, generate(request("mallet", { prompt: "LOSE a mallet on oak" })))
    assert.equal(again.code, "conflict")
    assert.match(again.message, /the same request is still unsettled as job j1 \(lost\) of run mallet:1/)
    await start(root, "sfx", "other-run")
    assert.match((await jamFailure(root, generate(request("mallet", { prompt: "LOSE a mallet on oak", run: "other-run" })))).message, /still unsettled as job j1 \(lost\) of run mallet:1/)
    assert.equal(paidCalls(root).length, 1, "a blocked request never reaches the provider")
    assert.deepEqual((await jam(root, listJobs({ open: true }))).map((row) => [row.run, row.job, row.state]), [["mallet:1", "j1", "lost"]])

    // Once a person confirms the provider has no such generation, the request may be sent again.
    await jam(root, updateJobState({ run: "mallet", job: "j1", to: "cancelled", evidence: "history checked 14:02: no generation with this text" }))
    assert.equal((await jam(root, generate(request("mallet", { prompt: "a mallet on oak, dry" })))).takes.length, 1)
  })

  it("a batch stopped by a lost answer keeps what arrived before it: the take, its settled job and the step's record", async () => {
    const root = audioProject()
    await start(root, "sfx", "mallet")
    const lost = await jamFailure(root, generate(request("mallet", { prompt: "a mallet on oak, LATER takes", takes: 3 })))
    assert.match(lost.message, /job j2 of run mallet:1: no answer was read/)
    const run = runFile(root, "mallet")
    assert.deepEqual([run.jobs.map((job) => job.state), paidCalls(root).length], [["succeeded", "lost"], 2])
    assert.deepEqual(unitOf(root, "mallet").takes.map((take) => [take.n, take.generation.job]), [[1, "j1"]])
    assert.deepEqual(run.steps["generate"]!.records.at(-1)!.files.map((file) => file.path), [unitOf(root, "mallet").takes[0]!.original.path])
  })

  it("a near-silent result is kept as an original and charged, but never becomes a take", async () => {
    const root = audioProject()
    await start(root, "sfx", "mallet")
    const result = await jam(root, generate(request("mallet", { prompt: "SILENT room tone" })))
    assert.deepEqual([result.takes.length, result.charged], [0, 150])
    assert.match(result.warnings[0]!, /near-silent result \(peak -\d+.*dBTP\), kept as an original but not made a take; it was still charged \(job j1\)/)
    assert.equal(runFile(root, "mallet").jobs[0]!.state, "succeeded")
  })
})

describe("the check registry", () => {
  it("is handed the audio checks before it is built, so the recipes' loudness and transcript-match are implemented", async () => {
    const listed = await jam(audioProject(), Effect.flatMap(Checks, (checks) => checks.list))
    assert.deepEqual(listed.filter((check) => check.id === "loudness" || check.id === "transcript-match").map((check) => [check.id, check.when, check.source, check.implemented]), [
      ["loudness", "record", "shipped", true], ["transcript-match", "record", "shipped", true]
    ])
    // A registry built without them still names both, and says they are not installed.
    const bare = Checks.layerOf(Effect.succeed([{ id: "loudness", description: "declared only", when: "record" as const }]))
    const without = await jam(audioProject(), Effect.flatMap(Checks, (checks) => checks.list).pipe(Effect.provide(bare)))
    assert.deepEqual(without.map((check) => [check.id, check.implemented]), [["loudness", false]])
  })
})

describe("the sfx recipe, end to end", { skip }, () => {
  it("finishes with no engine adapter at a processed WAV a person accepted by ear; the import step is skipped with its reason", async () => {
    const root = audioProject()
    await start(root, "sfx", "mallet")
    assert.deepEqual((await status(root, "mallet")).steps.map((step) => [step.step, step.state, step.gate.required]), [["generate", "ready", "none"], ["process", "waiting", "human"], ["import", "skipped", "none"]])
    await jam(root, generate(request("mallet", { takes: 2 })))
    const take = unitOf(root, "mallet").takes[1]!

    // A file that is not a processed take cannot stand in for one.
    assert.match((await recordFailure(root, "mallet", "process", { files: [take.original.path] })).message, /is not a processed take or variant of a sound/)
    const recorded = await record(root, "mallet", "process", { files: [take.file], tool: "jam audio", note: "Take 2: the reviewer preferred its shorter tail" })
    assert.deepEqual(recorded.records.map((entry) => [entry.step, entry.state, entry.gate.required]), [["process", "review", "human"]])
    assert.match(recorded.next, /a person must accept process/)
    await review(root, "mallet", "process", { relay: "chat: take 2 is the one, ship it" })
    assert.deepEqual((await status(root, "mallet")).steps.map((step) => step.state), ["accepted", "accepted", "skipped"])
    const accepted = runFile(root, "mallet").steps["process"]!.records.at(-1)!
    assert.deepEqual([accepted.files[0]!.path, accepted.checks.map((check) => check.id), accepted.reviews[0]!.actor, accepted.reviews[0]!.via], [take.file, ["loudness"], "human", "relay"])
  })

  it("with an adapter that imports audio, the import step is handed the processed files and records the engine's asset ids", async () => {
    const adapter = {
      "jam/engines/fake/adapter.json": JSON.stringify({ id: "fake", label: "Fake engine", facts: { unitsPerMeter: 1, up: "+Y", forward: "+Z", handedness: "right", audio: { container: "wav", sampleRate: 44100, bitDepth: 16 } }, commands: { import: { run: ["node", "commands/import.mjs"], kinds: ["audio", "audio-variants"] } } }),
      "jam/engines/fake/commands/import.mjs": `
        const args = process.argv.slice(2)
        const files = args.filter((arg) => arg.endsWith(".wav"))
        console.log(JSON.stringify({ assets: files.map((file) => ({ id: "audio://" + file.split("/").at(-1).replace(".wav", ""), kind: args[args.indexOf("--kind") + 1], source: file })), args }))`
    }
    const root = audioProject({ config: { engine: { adapter: "fake", facts: {} }, review: { mode: "agent" } }, files: adapter })
    await start(root, "sfx", "mallet")
    await jam(root, generate(request("mallet")))
    const take = unitOf(root, "mallet").takes[0]!
    // The engine's audio facts decide the processed format.
    assert.deepEqual([take.facts.sampleRate, take.facts.bitDepth], [44100, 16])
    await record(root, "mallet", "process", { files: [take.file], tool: "jam audio", accept: "measured at the target; a person will listen in the engine" })
    assert.equal(await stateOf(root, "mallet", "import"), "ready")
    const imported = await jam(root, importFor({ kind: "audio", files: [], run: "mallet" }))
    assert.equal(imported.outcome.status, "ran")
    const step = runFile(root, "mallet").steps["import"]!.records.at(-1)!
    assert.deepEqual(step.engineAssets, [{ id: "audio://mallet", kind: "audio", source: take.file }])
    assert.deepEqual(step.arguments, ["--kind", "audio"])
    assert.deepEqual((await status(root, "mallet")).steps.map((step) => step.state), ["accepted", "accepted", "accepted"])
  })

  it("the command line tells a cold reader how to use each command", () => {
    const root = audioProject()
    for (const [group, commands] of [["sfx", ["generate", "add", "split", "variants", "trim", "tighten", "reprocess", "show"]], ["voice", ["status", "voices", "assign", "speak", "process"]]] as const) {
      for (const command of commands) {
        const help = cli(root, "audio", group, command, "--help")
        assert.equal(help.status, 0, `${group} ${command}`)
        assert.match(help.stdout, new RegExp(`EXAMPLES\\s+jam audio ${group} ${command}`), `${group} ${command} has an example`)
      }
    }
    const plan = cli(root, "audio", "sfx", "generate", "mallet", "--prompt", "A mallet on oak", "--dry-run", "--json")
    assert.equal(plan.status, 0, plan.stderr)
    assert.equal(plan.json<{ spending: { total: number } }>().spending.total, 200)
    const missing = cli(root, "audio", "sfx", "generate", "mallet", "--prompt", "A mallet on oak")
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /error: there is no run mallet to pay through.*\n\s+fix: start one, then run this again: jam run start sfx mallet/)
  })
})

describe("project audio providers", () => {
  const descriptor = JSON.stringify({ id: "foley", label: "Studio foley", unit: { id: "credits", label: "foley credits", paid: true }, capabilities: { sound: {} }, transports: [{ kind: "cli", command: "foley" }] })
  const routed = { config: { routes: { sound: "foley" }, spend: {} } }

  it("a project adds a provider with its own audio adapter beside its descriptor", async () => {
    const root = audioProject({ ...routed, files: { "jam/providers/foley.json": descriptor, "jam/providers/foley.audio.mjs": "export const adapter = { voice: {} }\n" } })
    const provider = await jam(root, Effect.flatMap(AudioProvider, (audio) => audio.resolve("sound")))
    assert.equal(provider.id, "foley")
    // The project's module was loaded: it serves voice only, so asking it for sound names that.
    assert.match((await jamFailure(root, Effect.flatMap(AudioProvider, (audio) => audio.sound(provider)))).message, /audio adapter of foley does not serve sound/)
  })

  it("a provider without an adapter is refused with where to write one", async () => {
    const root = audioProject({ ...routed, files: { "jam/providers/foley.json": descriptor } })
    const missing = await jamFailure(root, Effect.flatMap(AudioProvider, (audio) => audio.resolve("sound")))
    assert.match(missing.message, /provider foley has no audio adapter/)
    assert.match(missing.fix!, /jam\/providers\/foley\.audio\.ts/)
  })
})
