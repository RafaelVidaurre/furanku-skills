// Ported from the version 1 engine: audio is recognised by its bytes, and frozen audio evidence
// keeps its bytes, type and digest.
//
// Asserted over HTTP in http.test.ts ("media answers"), as in the original:
// - `GET <asset.url>` answers `content-type: audio/wav`, `x-content-type-options: nosniff` and a
//   `content-security-policy` with `sandbox`.
// - `GET <asset.url>` with `range: bytes=0-11` answers 206 with the first twelve bytes.
// - `GET <view.before.url>` answers `content-type: audio/wav`.
// The bytes and types those requests returned are asserted here through the facade.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { kindByExtension, sniffWith } from "../../src/catalog/MediaKinds.ts"
import { mediaCore } from "../../src/catalog/plugins/media-core.ts"
import { cleanup, makeProject, open, png, rejects, tone, W, write } from "./helpers.ts"

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")
const soundType = {
  label: "Sound",
  thumb: "audio",
  fields: [{ key: "speaker", label: "Speaker" }, { key: "duration", label: "Duration", derived: true }],
  roles: [{ key: "audio", label: "Take", mediaKinds: ["audio"], many: true }]
}
// Was `sniff(bytes)` and `KIND_BY_EXT[ext]`: the kinds are now those the media-core plugin registers.
const kinds = mediaCore.mediaKinds ?? []
const sniff = (bytes: Uint8Array) => sniffWith(kinds, bytes)

test("audio magic bytes distinguish WAV from WEBP and reject incomplete/invalid headers", () => {
  const headers: ReadonlyArray<readonly [Buffer, string]> = [
    [tone(), "audio/wav"],
    [Buffer.from("OggS"), "audio/ogg"],
    [Buffer.from("fLaC"), "audio/flac"],
    [Buffer.from("ID3"), "audio/mpeg"],
    [Buffer.from([0xff, 0xfb, 0x90, 0x64]), "audio/mpeg"]
  ]
  for (const [bytes, mime] of headers) assert.deepEqual(sniff(bytes), { kind: "audio", mime })
  assert.deepEqual(sniff(Buffer.from("RIFFxxxxWEBP")), { kind: "image", mime: "image/webp" })
  // An Ogg file is audio unless its first packet is a Theora video header.
  const oggPage = (packet: string): Buffer => Buffer.concat([Buffer.from("OggS"), Buffer.alloc(22), Buffer.from([1, packet.length]), Buffer.from(packet, "latin1")])
  assert.deepEqual(sniff(oggPage("\x80theora\x03\x02\x01")), { kind: "video", mime: "video/ogg" })
  assert.deepEqual(sniff(oggPage("\x01vorbis\x00\x00")), { kind: "audio", mime: "audio/ogg" })
  for (const bytes of [Buffer.from("RIFFxxxx"), Buffer.from("RIFFxxxxFAKE"), Buffer.from("Og"), Buffer.from([0xff, 0xff, 0xff, 0xff])]) assert.equal(sniff(bytes), null)
  for (const ext of ["wav", "ogg", "flac", "mp3"]) assert.equal(kindByExtension(kinds, `x.${ext}`), "audio")
})

test("audio HTTP serving and frozen evidence preserve bytes, MIME, range and digest integrity", async () => {
  const original = tone()
  const second = tone({ frequency: 660 })
  const dir = await makeProject({
    assets: { "art/a.wav": original, "art/b.wav": second, "art/icon.png": png() },
    units: [{ id: "sound/test", type: "sound", name: "Tone", attrs: { speaker: "test", duration: 1 }, links: [{ role: "audio", asset: "art/a.wav" }, { role: "audio", asset: "art/b.wav" }] }],
    extra: { types: { sound: soundType } }
  })
  const app = await open(dir)
  try {
    const unit = await app.run("unit.get", { id: "sound/test" })
    assert.equal(unit.links.length, 2)
    assert.equal(unit.links[0].asset.kind, "audio")
    // Was a fetch of asset.url: the served type and bytes are those of the asset's file.
    const served = await app.assetFile(unit.links[0].asset.id)
    assert.equal(served.mime, "audio/wav")
    assert.deepEqual(readFileSync(served.file), original)
    const run = W(app)
    const submitted = await run("review.submit", { title: "Audio comparison", items: [{ target: { kind: "unit", id: "sound/test" }, views: [{ part: "audio:art/b.wav", before: { path: "art/a.wav" } }] }] })
    const sub = await app.run("review.get", { submission: submitted.submission.id })
    const item = sub.items[0]
    const part = item.parts.find((p: { id: string }) => p.id === "audio:art/a.wav")
    assert.equal(part.leaves[0].sha256, sha256(original))
    assert.equal(part.leaves[0].storage, "git")
    write(dir, "art/a.wav", second)
    // Was a fetch of the leaf's url: the frozen leaf is addressed by the ids of the review.
    const frozen = await app.evidenceMedia(sub.id, item.id, part.id, part.leaves[0].key)
    assert.deepEqual(Buffer.from(frozen.bytes), original)
    // Was a fetch of the view's before url.
    const before = await app.beforeMedia(sub.id, item.id, item.views[0].id)
    assert.equal(before.mime, "audio/wav")
    assert.deepEqual(Buffer.from(before.bytes), original)
    await run("review.decide", { submission: sub.id, item: item.id, whole: "approved" })
    await rejects(run("review.submit", { title: "Wrong kind", items: [{ target: { kind: "unit", id: "sound/test" }, views: [{ part: "audio:art/b.wav", before: { path: "art/icon.png" } }] }] }), "invalid")
    // Dirty audio freezes to content-addressed evidence, with no fallback to current content.
    const dirty = await run("review.submit", { title: "Dirty take", items: [{ target: { kind: "unit", id: "sound/test" } }] })
    const snapshot = await app.run("review.get", { submission: dirty.submission.id })
    assert.equal(snapshot.items[0].parts.find((p: { id: string }) => p.id === "audio:art/a.wav").leaves[0].storage, "catalog")
  } finally {
    cleanup(dir)
  }
})
