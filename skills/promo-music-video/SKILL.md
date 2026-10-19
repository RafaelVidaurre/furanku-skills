---
name: promo-music-video
description: Produce a product promo music video from a song, built on reviewed lyric and beat timing, real product footage, kinetic typography, and music-driven motion. Use when asked to turn a song into a product video, check lyric sync before designing visuals, or polish an existing music-led promo.
license: MIT
metadata:
  author: rafaelvidaurre
---

# Promo music video

Let the song carry the story; show the product doing what the song promises.
Build from a reviewed timing map, then develop a visual language around the
product and music. The workflow works with any product and editing system;
[the production reference](references/production.md) includes a Remotion route.

## 1. Establish the brief and the checkpoints

Inspect the supplied project and existing takes before proposing new assets.
Record only missing decisions that affect the work:

- Audience, the single benefit to remember, supported product claims, and CTA.
- Final mix, lyric text, vocal stem if available, and any musical markers.
- Existing brand assets, usable product footage, and visual references.
- Destinations, aspect ratios, duration, and any budget for capture or generation.
- Whether the user wants timing proof, creative exploration, production, or a
  revision of a particular cut.

**Checkpoints** are the user's review gates: the timing proof, the concept
frames, and the first full render. A timing-only request ends at the timing
proof; approving sync does not approve the visual direction. A full production
request still stops at each checkpoint unless the user waived it. Costed
generation or capture and public publication each need explicit authorization;
preparing a shareable file is not publishing it.

For a revision of an existing cut, keep the accepted music, timing, and
direction. Classify the note as timing, product truth, layout, motion, finish,
or delivery; enter at the step that owns that layer and repeat only the checks
the change invalidates.

Keep a compact production record: brief, current artifact versions, decisions,
approvals, unresolved dependencies, and next checkpoint.

If the song is missing, prepare the brief or song requirements. If songwriting
is requested, develop the message and lyrics with the user and use their chosen
music workflow. A generated or newly edited song returns through step 2.
Report unavailable skills or tools rather than emulating them.

**Done when:** inputs, requested outcome, and next checkpoint are recorded; any
missing prerequisite has a concrete next action.

## 2. Prove the timing before styling it

Read [Song timing](references/song-timing.md) before starting this step.

Establish one timebase for mix, stems, lyrics, markers, and pictures. Draft
word/phrase timings and musical markers, then correct them against the actual
audio in the bundled timing player (`assets/timing-player/`). Every marker carries
a status (`estimated`, `listened`, or `reviewed`), and corrections survive any
analysis rerun.

**Done when:** `scripts/check-timing-map.js --min-status listened` passes (held
entries included), the player stays synced at the start/middle/end, and the
timing checkpoint is approved when the request includes it.

## 3. Turn the song into an edit

Read [Visual direction](references/visual-direction.md) before storyboarding or
responding to requests for more variety, intensity, or polish.

Map the song's actual sections to a visual arc. For each shot, record:

| Field | Purpose |
| --- | --- |
| Time range / musical cue | Why the shot enters and leaves here |
| Lyric phrase / idea | What the viewer should understand |
| Focal subject / product proof | What earns the viewer's attention |
| Asset and provenance | What exists and what must be captured |
| Layout per requested format | Where type and subject remain readable |
| Motion and exit | How the shot lands and yields to the next |

Keep the shot list and lyric cards separate: a phrase can span shots, and a shot
can hold several phrases. Choose cuts from musical and semantic cues; document
an intentional early exit or delayed cut instead of forcing every event to a beat.

For the concept checkpoint, show frames for the **key moments** (opening,
strongest musical hit, product proof, CTA), plus a short motion sample where the
look depends on movement. Use supplied footage first.

**Done when:** the shot list covers the selected excerpt end to end, every row
names an existing asset or a capture gap, every product shot keeps product
truth, and key-moment frames are ready for the concept checkpoint.

## 4. Capture credible product material

Use [Capture and assets](references/production.md#capture-and-assets) when the
edit needs new footage, cleaner UI, transparent layers, or higher-resolution takes.

**Product truth**: anything presented as the product shows behavior it actually
has. For software, build a coherent fictional demo world with consistent names,
images, and states. For physical products, establish the actual sample, setting,
handling, and feature demonstration. Label staged fixtures, scripted replays,
and illustrative motion graphics in the asset manifest so the edit keeps them
distinct from live behavior.

**Done when:** every required shot has an inspected asset at sufficient resolution,
the manifest records its origin and use, and remaining capture gaps are explicit.

## 5. Compose and finish

Read [Composition and rendering](references/production.md#composition-and-rendering)
for frame timing, deterministic effects, separate aspect-ratio layouts, and render
recovery. Drive cuts, word emphasis, and effects from the reviewed timing map.

Work in passes: readable edit → motion and transitions → material/light/grade →
restrained finishing. Review a representative excerpt at final resolution before
rendering every format.

**Done when:** requested compositions render reproducibly; the key moments read
in each format; no draft placeholders are presented as finished footage.

## 6. Review the encoded result and deliver

Follow [Render acceptance](references/production.md#render-acceptance) on the actual
encoded files. Combine media probes, timing checks, transition inspection, and
continuous playback. Report which checks are exhaustive and which are samples.

Deliver per [Review and handoff](references/production.md#review-and-handoff):
the playable review copy, requested downloads, poster frame, editable source,
reviewed timing map, asset manifest, and a reproduction note. Keep the accepted
version identifiable.

**Done when:** the user can play and save the deliverables, known gaps are stated,
and technical verification is distinguished from the user's creative acceptance.
