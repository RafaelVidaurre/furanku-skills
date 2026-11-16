import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { listJobs, type OpenJobInput, openJob, updateJobState } from "../../src/jam/runs/jobs.ts"
import { CONFIG, jam, jamFailure, jamProject, write } from "./fixtures.ts"
import { AGENT_MODE, makeFiles, record, recordFailure, runFile, start, stateOf } from "./flow.ts"

const REQUEST = "work/requests/concept.json"
const intent = (run: string, extra: Partial<OpenJobInput> = {}): OpenJobInput => ({
  run,
  step: "concept",
  provider: "meshy",
  operation: "text to image",
  estimate: 7,
  request: REQUEST,
  price: "estimate",
  priceSource: "dry run on 2026-11-16",
  authorized: "Sam, 2026-11-16: go ahead within ten credits",
  ...extra
})
const open = (root: string, run: string, extra?: Partial<OpenJobInput>) => jam(root, openJob(intent(run, extra)))
const refused = (root: string, run: string, extra?: Partial<OpenJobInput>) => jamFailure(root, openJob(intent(run, extra)))
const update = (root: string, run: string, job: string, to: Parameters<typeof updateJobState>[0]["to"], extra: Partial<Parameters<typeof updateJobState>[0]> = {}) =>
  jam(root, updateJobState({ run, job, to, ...extra }))
const updateRefused = (root: string, run: string, job: string, to: Parameters<typeof updateJobState>[0]["to"], extra: Partial<Parameters<typeof updateJobState>[0]> = {}) =>
  jamFailure(root, updateJobState({ run, job, to, ...extra }))

const project = (config: Record<string, unknown> = {}) =>
  jamProject({ config: { ...AGENT_MODE, ...config }, files: { [REQUEST]: JSON.stringify({ prompt: "a barrel" }) } })

describe("opening a job", () => {
  it("records the intent with the provider's unit, the price basis and who authorized it", async () => {
    const root = project()
    await start(root, "asset", "barrel", { budget: "prop" })
    const { job, next } = await open(root, "barrel", { price: "quote", scope: "team art", transport: "cli" })
    assert.deepEqual({ ...job, created: "", history: [], request: job.request.path, price: { ...job.price, date: "" } }, {
      id: "j1", step: "concept", provider: "meshy", operation: "text to image", request: REQUEST, estimate: 7, unit: "credits",
      price: { kind: "quote", source: "dry run on 2026-11-16", date: "" }, authorization: "Sam, 2026-11-16: go ahead within ten credits",
      transport: "cli", scope: "team art", state: "open", created: "", history: []
    })
    assert.match(next, /jam job submitted barrel j1 --provider-job .*jam job lost barrel j1/)
    assert.equal(runFile(root, "barrel").jobs.length, 1)
  })

  it("refuses when the step may not pay, the provider is unknown or disabled, or approval or price basis is missing", async () => {
    const root = project({ spend: { meshy: { perRun: 10 }, scenario: { perRun: 0 }, tripo: { perRun: null, total: 0 } } })
    await start(root, "asset", "barrel", { budget: "prop" })
    assert.match((await refused(root, "barrel", { step: "delivery" })).message, /step delivery of recipe asset does not allow provider jobs/)
    assert.match((await refused(root, "barrel", { provider: "nobody" })).fix!, /use one of: .*meshy.*jam\/providers\/nobody\.json/)
    for (const [provider, why] of [["scenario", /a cap is 0/], ["tripo", /a cap is 0/], ["elevenlabs", /no spend\.elevenlabs entry/]] as const) {
      // Disabled means disabled: even a job estimated at nothing is refused.
      const error = await refused(root, "barrel", { provider, estimate: 0 })
      assert.equal(error.code, "forbidden", provider)
      assert.match(error.message, why)
      assert.match(error.fix!, /only the person can enable it/)
    }
    assert.match((await refused(root, "barrel", { authorized: undefined })).message, /--authorized is required/)
    assert.match((await refused(root, "barrel", { priceSource: " " })).message, /--price-source is required/)
    assert.match((await refused(root, "barrel", { estimate: -1 })).message, /--estimate -1/)
    assert.match((await refused(root, "barrel", { step: "mesh" })).message, /paid work on mesh needs turnaround accepted first/)
    assert.match((await refused(root, "barrel", { request: "work/requests/absent.json" })).message, /absent\.json does not exist/)
    assert.equal(runFile(root, "barrel").jobs.length, 0)
  })

  it("a standing authorization in the configuration stands in for per-job approval; a provider that is not billed needs neither cap nor approval", async () => {
    const root = project({ spend: { meshy: { perRun: 10, standing: "Sam 2026-11-14: approve 10 a run, decide within it and report after" } } })
    await start(root, "asset", "barrel", { budget: "prop" })
    assert.match((await open(root, "barrel", { authorized: undefined })).job.authorization, /^Sam 2026-11-14: approve 10 a run/)
    write(root, "work/requests/plan.json", "{}")
    const free = await open(root, "barrel", { provider: "codex", authorized: undefined, priceSource: undefined, estimate: 0, request: "work/requests/plan.json" })
    assert.deepEqual([free.job.unit, free.job.authorization], ["plan", "not billed per job"])
  })
})

describe("caps", () => {
  it("the per-run cap counts estimates of unsettled jobs and actual charges of settled ones", async () => {
    const root = project()
    await start(root, "asset", "barrel", { budget: "prop" })
    await open(root, "barrel")
    write(root, "work/requests/second.json", JSON.stringify({ prompt: "a second barrel" }))
    const over = await refused(root, "barrel", { request: "work/requests/second.json", estimate: 4 })
    assert.equal(over.code, "forbidden")
    assert.match(over.message, /would take the run to 11 Meshy credits, over the per-run cap of 10/)
    await open(root, "barrel", { request: "work/requests/second.json", estimate: 3 })
    await update(root, "barrel", "j1", "submitted", { providerJob: "task-1" })
    await update(root, "barrel", "j1", "succeeded", { actual: 2, evidence: "task-1 billing" })
    write(root, "work/requests/third.json", JSON.stringify({ prompt: "a third barrel" }))
    await open(root, "barrel", { request: "work/requests/third.json", estimate: 5 })
    assert.match((await refused(root, "barrel", { request: "work/requests/third.json", estimate: 1 })).message, /over the per-run cap|still unsettled/)
  })

  it("the total cap spans every run; no cap removes only that limit", async () => {
    const root = project({ spend: { meshy: { perRun: 10, total: 12 } } })
    await start(root, "asset", "barrel", { budget: "prop" })
    await start(root, "asset", "crate", { budget: "prop" })
    await open(root, "barrel", { estimate: 8 })
    write(root, "work/requests/crate.json", JSON.stringify({ prompt: "a crate" }))
    const over = await refused(root, "crate", { request: "work/requests/crate.json", estimate: 5 })
    assert.match(over.message, /would take all runs to 13 Meshy credits, over the total cap of 12/)
    await open(root, "crate", { request: "work/requests/crate.json", estimate: 4 })
    const uncapped = project({ spend: { meshy: { perRun: null, total: null } } })
    await start(uncapped, "asset", "barrel", { budget: "prop" })
    assert.equal((await open(uncapped, "barrel", { estimate: 1_000_000 })).job.estimate, 1_000_000)
    assert.match((await refused(uncapped, "barrel", { authorized: " " })).message, /--authorized is required/, "no cap is not an approval")
  })

  it("a step may limit how many jobs it opens: a provider test gets one", async () => {
    const root = project()
    await start(root, "provider-test", "meshy-check")
    await open(root, "meshy-check", { step: "test" })
    write(root, "work/requests/again.json", "{}")
    assert.match((await refused(root, "meshy-check", { step: "test", request: "work/requests/again.json" })).message, /step test allows 1 provider job per run and has 1/)
  })
})

describe("a job's life", () => {
  it("moves open > submitted > done only with the provider's id, the real charge and evidence", async () => {
    const root = project()
    await start(root, "asset", "barrel", { budget: "prop" })
    await open(root, "barrel")
    assert.match((await updateRefused(root, "barrel", "j1", "succeeded", { actual: 7, evidence: "x" })).message, /job j1 is open; it cannot become succeeded/)
    assert.match((await updateRefused(root, "barrel", "j1", "submitted")).message, /--provider-job is required/)
    assert.match((await updateRefused(root, "barrel", "j9", "submitted", { providerJob: "t" })).fix!, /jobs: j1 \(open\)/)
    await update(root, "barrel", "j1", "submitted", { providerJob: "task-8841" })
    assert.match((await updateRefused(root, "barrel", "j1", "succeeded", { evidence: "done" })).message, /--actual is required/)
    assert.match((await updateRefused(root, "barrel", "j1", "succeeded", { actual: 9 })).message, /--evidence is required/)
    assert.match((await updateRefused(root, "barrel", "j1", "lost")).message, /job j1 is submitted; it cannot become lost/)
    const done = await update(root, "barrel", "j1", "succeeded", { actual: 9, evidence: "task-8841 billing" })
    assert.deepEqual([done.job.state, done.job.actual, done.job.providerJob], ["succeeded", 9, "task-8841"])
    assert.deepEqual(done.job.history.map((entry) => entry.state), ["open", "submitted", "succeeded"])
    assert.match((await updateRefused(root, "barrel", "j1", "failed", { actual: 0, evidence: "x" })).fix!, /the job is settled/)
  })

  it("a lost response is a state, never a silent resubmission: the same request is blocked in every run until it is found or confirmed absent", async () => {
    const root = project()
    await start(root, "asset", "barrel", { budget: "prop" })
    await start(root, "asset", "crate", { budget: "prop" })
    await open(root, "barrel")
    await update(root, "barrel", "j1", "lost")
    const same = await refused(root, "barrel")
    assert.equal(same.code, "conflict")
    assert.match(same.message, /the same request is still unsettled as job j1 \(lost\) of run barrel:1/)
    assert.match((await refused(root, "crate")).message, /still unsettled as job j1 \(lost\) of run barrel:1/, "a fresh run cannot get around it")
    assert.match((await updateRefused(root, "barrel", "j1", "cancelled")).fix!, /how the provider confirmed that no job exists; never assume it/)
    assert.match((await updateRefused(root, "barrel", "j1", "cancelled", { evidence: "list checked", actual: 0 })).message, /--actual belongs to a job the provider ran/)
    // Found again in the provider's history: it resumes under its id.
    await update(root, "barrel", "j1", "submitted", { providerJob: "task-recovered", evidence: "history matched the exact input" })
    assert.match((await refused(root, "crate")).message, /\(submitted\) of run barrel:1/)
    await update(root, "barrel", "j1", "failed", { actual: 7, evidence: "task-recovered: charged, no refund" })
    assert.equal((await open(root, "crate")).job.id, "j1", "a settled request may be tried again")
    // Confirmed never created: the reservation is released at no cost.
    const released = await update(root, "crate", "j1", "cancelled", { evidence: "task list at 14:02 shows no such task" })
    assert.deepEqual([released.job.state, released.job.actual], ["not-submitted", 0])
    assert.equal((await open(root, "crate", { estimate: 10 })).job.id, "j2", "what it held is free again")
  })

  it("a job the provider cancelled or failed needs its real charge; list shows what is unsettled across runs", async () => {
    const root = project()
    await start(root, "asset", "barrel", { budget: "prop" })
    await start(root, "asset", "crate", { budget: "prop" })
    await open(root, "barrel")
    write(root, "work/requests/crate.json", "{}")
    await open(root, "crate", { request: "work/requests/crate.json", estimate: 2 })
    await update(root, "barrel", "j1", "submitted", { providerJob: "t1" })
    assert.match((await updateRefused(root, "barrel", "j1", "cancelled", { evidence: "cancelled in the UI" })).fix!, /a failure is not proof of a refund/)
    await update(root, "barrel", "j1", "cancelled", { actual: 0, evidence: "t1 refunded per billing page" })
    assert.deepEqual((await jam(root, listJobs({ open: false }))).map((row) => [row.run, row.job, row.state]), [["barrel:1", "j1", "cancelled"], ["crate:1", "j1", "open"]])
    assert.deepEqual((await jam(root, listJobs({ open: true }))).map((row) => row.run), ["crate:1"])
  })
})

describe("paid results", () => {
  it("bind to a succeeded job whose request file is unchanged, in this run or by name in another", async () => {
    const root = project()
    await start(root, "asset", "barrel", { budget: "prop" })
    const made = await makeFiles(root, "barrel")
    assert.match((await recordFailure(root, "barrel", "concept", { files: [made.concept], job: "j1" })).message, /run barrel:1 has no job j1/)
    await open(root, "barrel")
    assert.match((await recordFailure(root, "barrel", "concept", { files: [made.concept], job: "j1" })).message, /the job is open; a paid result binds to a succeeded job/)
    await update(root, "barrel", "j1", "submitted", { providerJob: "t1" })
    await update(root, "barrel", "j1", "succeeded", { actual: 7, evidence: "t1" })
    await record(root, "barrel", "concept", { files: [made.concept], job: "j1", accept: "ok" })
    const stored = runFile(root, "barrel").steps["concept"]!.records[0]!
    assert.deepEqual(stored.provenance, { kind: "job", job: "j1", provider: "meshy" })
    assert.deepEqual(stored.inputs.map((file) => file.path), [REQUEST], "the request becomes an input, so changing it makes the result stale")
    // Another run reuses the paid result by naming the run whose ledger holds the job.
    await start(root, "asset", "barrel-two", { budget: "prop" })
    const again = await makeFiles(root, "barrel-two")
    await record(root, "barrel-two", "concept", { files: [again.concept], job: "barrel/j1", accept: "same image, new attempt" })
    assert.deepEqual(runFile(root, "barrel-two").steps["concept"]!.records[0]!.provenance, { kind: "job", job: "j1", provider: "meshy", run: "barrel:1" })
    assert.equal(runFile(root, "barrel-two").jobs.length, 0, "no second submission is invented")
    write(root, REQUEST, JSON.stringify({ prompt: "something else" }))
    assert.match((await recordFailure(root, "barrel-two", "concept", { files: [again.concept], job: "barrel/j1" })).message, /request file .* changed after submission/)
    assert.equal(await stateOf(root, "barrel", "concept"), "stale")
  })

  it("a provider test proves the provider works and nothing more: its job cannot become content", async () => {
    const root = project()
    await start(root, "provider-test", "meshy-check")
    await open(root, "meshy-check", { step: "test" })
    await update(root, "meshy-check", "j1", "submitted", { providerJob: "t" })
    await update(root, "meshy-check", "j1", "succeeded", { actual: 7, evidence: "t" })
    await start(root, "asset", "barrel", { budget: "prop" })
    const made = await makeFiles(root, "barrel")
    const error = await recordFailure(root, "barrel", "concept", { files: [made.concept], job: "meshy-check/j1" })
    assert.equal(error.code, "forbidden")
    assert.match(error.message, /is a test or exploration; its results cannot be used as content/)
    assert.equal(CONFIG.spend.meshy.perRun, 10)
  })
})
