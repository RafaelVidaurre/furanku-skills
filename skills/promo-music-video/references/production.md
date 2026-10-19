# Capture, composition, and delivery

## Capture and assets

Keep editable source and small timing/manifests in the project. Put large source
media and render outputs in a configurable asset directory appropriate to the
project. Document both locations and how a recipient obtains the necessary media.
Use relative asset IDs inside the edit; machine-specific paths belong in local
configuration, not reusable components.

For each asset, record ID, relative path, origin, dimensions, duration/FPS when
applicable, intended use, and any trim or transparency treatment. Track whether
it is native capture, staged fixture, scripted replay, illustration, or generated
material, plus relevant permission/license information. Keep originals separately.

For software, capture a consistent fictional sample world through the actual product. Populate
empty states with plausible projects, avatars, attachments, and actions. Use an
isolated demo account or supported fixtures. Inspect the result for private data
before including it in a shareable video.

For physical products, use a real sample and a concise shot list: overall form,
material/detail, use in context, and the feature or outcome being claimed. Keep
lighting, scale, color, handling, and props consistent across takes. Capture clean
holds and room around actions so the edit can land them on musical cues. Verify
that retouching, illustration, or generated context preserves the actual product's
appearance and capabilities; record illustrative material as such.

Capture enough pixels for the largest planned crop or zoom. For mostly static UI,
lossless stills and alpha layers animated in the editor can retain sharper detail
than repeatedly encoded screen recordings. Use real video when motion or behavior
is the proof. Preserve glass, shadows, and transparency when extracting layers;
inspect them over both bright and dark backgrounds.

A simulator shortcut may omit the subsystem that makes the feature look right.
Check the captured feature itself: avatars, rich media, system presentation,
input behavior, and animations. Use a supported full path or a physical capture
when the shortcut is visibly incomplete. Note any remaining limitation in the
manifest rather than painting over it.

**Complete when:** the edit's required assets are available, visually inspected,
and traceable to their origin and intended demonstration.

## Composition and rendering

### Frame-driven composition

Use the existing editor if it can consume explicit timing. Remotion is one
code-based option, not an installation requirement for this skill. Inspect its
locked package versions and current API documentation before adapting examples.

Separate reviewed timing, editorial shot/card choices, layout, and finish. Read
the same timing data for pictures and QA event lists. Avoid manually copying cut
times into multiple scripts.

In Remotion, derive animations from `useCurrentFrame()` and composition FPS.
Account for the local clock inside a timed parent: source offset, scene placement,
and current frame are different quantities. Drive shader time from the same
frame clock. Seed randomness, wait for fonts/assets/shaders before capture, and
avoid wall-clock animation or state that depends on previously rendered frames.
Frames may render out of order or in separate browser processes.

Use the selected music excerpt once at the intended speed. Keep its source
in-point distinct from its position on the final timeline. Check version-specific
audio trim semantics; the current online API can differ from an older project.
Use supported static asset loaders instead of assuming local absolute file URLs
will work in a render worker.

Build layouts independently for the requested formats. Vertical often needs
different phrase breaks, product scale, positioning, and safe margins. Share
timing and design tokens; a blind crop of the wide video rarely preserves them.

**Complete when:** rendering an arbitrary frame produces the intended state,
audio and visuals share the same clock, and each format has an inspected layout.

### Render in bounded passes

Record composition ID, dimensions, FPS, frame count, source/map versions, tool
versions, output path, and command. Derive frame count from this brief's
duration and FPS under the chosen rounding policy.

For a quick preview, reduce resolution or render a short excerpt while preserving
the timebase. Frame skipping is suitable for diagnostic still samples, not a
playback-speed shortcut. Check both stream durations before sharing a preview.

If a heavy composition exhausts the renderer, preserve the error, lower
concurrency or simplify the costly effect, and retry a bounded excerpt. If
chunking is needed, render contiguous frame ranges at unchanged FPS, with fresh
workers if necessary. Confirm whether the tool's range endpoints are inclusive;
at 30 FPS an inclusive 10-second chunk is frames 0–299 and the next is 300–599.
Keep scene and shader time global across chunks.

Use matching intermediate codecs/settings, join without gaps or duplicated
boundary frames, and mux the selected audio once. Inspect chunk boundaries and
first/last included frames. Reuse a chunk only when its source, assets, timing,
settings, and relevant code still match. Do not hide a duration mismatch with
truncation or time-stretching.

**Complete when:** the requested frame coverage is present, chunks join correctly,
and both audio and video have the intended duration and content.

### Audio and encoding

Preserve an approved mix unless the brief calls for a change. Adding product
sounds or voiceover creates a new mix that needs listening and level checks.
Measure integrated loudness and true peak on the final encoded file; targets
come from the actual destination or brief, not a universal social-media number.

If normalization is needed, FFmpeg `loudnorm` supports two passes: measure the
exact final excerpt/mix, then feed those measurements into the normalization pass.
Inspect the reported mode because linear processing can fall back to dynamic.
Set the output sample rate explicitly and remeasure the encoded output.

A common review/download format is H.264 MP4 with AAC and `yuv420p`. For an
already composed master containing the selected audio, this is an example, not
a destination-specific delivery specification:

```sh
ffmpeg -n -i master.mov -map 0:v:0 -map 0:a:0 \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart review.mp4

ffprobe -v error -show_entries \
  stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,duration,nb_frames:format=duration \
  -of json review.mp4

ffmpeg -hide_banner -i review.mp4 -vn -af ebur128=peak=true -f null -
```

Faststart improves ordinary MP4 startup by relocating its metadata; it does not
repair sync. Keep an archival master and derive delivery copies from it instead
of repeatedly transcoding an already compressed copy. Check current destination
requirements if producing an upload-specific file. An app-store preview is a
separate deliverable with its own rules, not an automatic reuse of the promo.

**Complete when:** the delivery file meets the selected specification, audio is
audible and intentionally mixed, and the encoded result has been measured.

## Render acceptance

Review the actual exported file in each requested format. Use these evidence
levels explicitly:

| Check | What to inspect | Limit of the evidence |
| --- | --- | --- |
| Media integrity | Streams, resolution, FPS, frame count when available, duration, first/last sound | Correct metadata does not prove sync or visual quality |
| Lyric sync | Compare audible phrase/word starts with displayed events; spot-check start/middle/end, then unresolved passages | A contact sheet cannot prove what the voice says or when |
| Cut timing | Compare intended event frames with encoded transitions | Difference peaks can be animation or flashes; inspect ambiguous results |
| Text lifetime | All card/shot boundaries, including incoming product UI | A card schedule does not measure actual pixels, bloom, or geometric collisions |
| Legibility | Held frames and moving transitions at intended viewing size, after compression | A median contrast sample cannot certify every glyph or frame |
| Motion | Continuous playback, frame stepping around every transition and render-chunk join | Threshold-based spike detection can miss smooth defects and defects near planned hits |
| Product truth | Claimed feature, visible state, demo consistency, asset provenance | A staged sequence is not proof of a live end-to-end operation |
| Delivery | Play and download the exact exported file in the intended review surface | A local render does not prove target-device or platform playback |

For measured cut checks, state the chosen tolerance in frames; one frame is a
useful target for deliberately quantized cuts, not a universal sung-alignment
guarantee. If automated QA is added, missing inputs, empty masks, insufficient
frames, and failed subcommands must fail the check. Do not report a pass from an
empty sample or let a later shell command hide an earlier failure.

Keep an issue list keyed by timecode and version. Label sampled checks as sampled;
do not turn selected contrast frames into a blanket accessibility claim. If
accessibility certification or intense-flash evaluation is required, use an
appropriate dedicated process. When audio/visual playback cannot be inspected
with available tools, state that limit and provide a reviewable artifact.

**Complete when:** technical failures are fixed, the evidence names its actual
coverage, and creative feedback is tied to the current file.

## Review and handoff

Provide a simple player and direct, clearly named downloads for the requested
formats. Verify that the links point to the current files and use a versioned
name or cache key so a cached earlier cut cannot masquerade as the revision.
Check access from the intended viewer when authorized; never repurpose another
project's server or public tunnel.

The reproduction note covers how to obtain/place source assets, install locked
dependencies, select a composition, render, and run checks. Make missing
proprietary assets or unavailable tools explicit.

**Complete when:** the recipient has playable, savable files and sufficient
source/asset instructions to reproduce or revise them, with acceptance status clear.
