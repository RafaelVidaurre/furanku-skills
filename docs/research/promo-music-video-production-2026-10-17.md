# Product promo music video: timing and delivery evidence

Retrieved: 2026-10-17. Scope: lyric timing, musical timing, Remotion composition, and FFmpeg delivery. Sources below are official project documentation/source code or original research. **Source finding** describes evidence; **Workflow inference** is an editorial recommendation derived from it. No production track was analyzed or rendered during this research.

## Lyrics: separate the words from their estimated times

**Source finding.** Whisper's `word_timestamps` implementation uses cross-attention patterns and dynamic time warping. Its CLI still labels this feature experimental; `initial_prompt` supplies context rather than a fixed transcript. The implementation warns that word timestamps on translations may be unreliable. These are properties of the open-source implementation, not a statement about every hosted transcription API. [OpenAI implementation](https://github.com/openai/whisper/blob/main/whisper/transcribe.py)

**Source finding.** OpenAI's model card says Whisper is trained for speech recognition/translation and can output text absent from the audio. An ASR output is therefore a candidate transcription, including when it is presented with precise-looking timestamps. [Whisper model card](https://github.com/openai/whisper/blob/main/model-card.md)

**Source finding.** Forced alignment instead takes transcript labels and finds a likely temporal path through acoustic model emissions. The official PyTorch tutorial demonstrates this with a supplied transcript and finishes by listening to individual aligned segments. It demonstrates the method on speech, not a guarantee of singing accuracy. [PyTorch forced alignment tutorial](https://docs.pytorch.org/audio/stable/tutorials/forced_alignment_tutorial.html)

**Source finding.** WhisperX adds phoneme alignment for word timing. Its documented limitations include unalignable words absent from the alignment model's character dictionary, weak handling of overlapping speech, and a requirement for a language-specific wav2vec2 model. Its published scope is speech transcription. [WhisperX repository](https://github.com/m-bain/whisperX), [original paper](https://arxiv.org/abs/2303.00747)

**Source finding.** Singing-specific adaptation is an actual research problem. One Mandarin study fine-tunes Whisper on singing, uses augmentation/source separation, and reports mean alignment error on its evaluated dataset. Those results describe that adapted method and dataset, not stock Whisper or arbitrary songs. [Original Mandarin lyrics study](https://arxiv.org/abs/2311.12488)

**Workflow inference.** Keep three distinct artifacts: authoritative lyric text; machine-proposed word/phrase intervals with tool/model/version provenance; reviewed intervals used by the edit. Use supplied or confirmed lyrics as the text source. Correct text before alignment, preserve repeat occurrences explicitly, and mark missing/uncertain timings for review. An aligner constrains a path to its input text; a returned path does not independently establish that the input lyrics were sung.

**Workflow inference.** Check sung phrases against the actual selected master, especially repeated hooks, layered vocals, sustained syllables, pickups, and instrumental gaps. For a word reveal, define the intended visual event (vocal onset, syllable accent, or phrase entrance); a word interval alone does not select that creative timing. No universal timing-error tolerance for songs was established by the sources reviewed here.

## Musical timing: beat candidates are not bar or section labels

**Source finding.** `librosa.beat.beat_track` measures onset strength, estimates tempo from onset correlation, and selects onset peaks approximately consistent with that tempo. It returns estimated tempo and beat locations. Default units are analysis frames; `units="time"` returns time positions. `hop_length` is samples between onset-envelope values. Silent input can yield zero BPM and no beats. [librosa 0.11 beat tracker](https://librosa.org/doc/0.11.0/generated/librosa.beat.beat_track.html)

**Source finding.** By default the tracker estimates one tempo across the signal. The official tutorial shows why major tempo changes can defeat that assumption and demonstrates time-varying estimates. This tutorial is from the current/latest documentation; the API reference above is explicitly pinned to 0.11.0. [librosa dynamic-tempo tutorial](https://librosa.org/doc/latest/auto_tutorials/03-advanced/plot_dynamic_beat.html)

**Source finding.** Structural segmentation is a separate API: `librosa.segment.agglomerative` partitions feature data into a caller-selected number of contiguous segments and returns boundaries. It does not return semantic labels such as verse, chorus, or product reveal. [librosa segmentation API](https://librosa.org/doc/0.11.0/generated/librosa.segment.agglomerative.html)

**Workflow inference.** Call the output `estimated beats`. A beat list supplies neither meter nor which beat begins a bar: selecting every fourth event would assume both 4/4 meter and the correct phase. Establish downbeats/bar counts and verse/chorus/drop boundaries independently by listening or a dedicated, verified annotation method. Store them as separate event types with review status.

**Workflow inference.** Confirm the grid across the selected excerpt, including the first pickup and last cadence, before assigning cuts to it. Convert analysis frames using the analysis sample rate/hop size; convert seconds to video frames using the composition FPS. Treat this as explicit quantization onto a video-frame grid, not additional acoustic precision. Keep source-audio time, excerpt offset, and final timeline time distinguishable.

## Remotion: one explicit timeline and reproducible frame states

**Source finding.** `useCurrentFrame()` is zero-indexed and normally becomes relative to a timed parent. Remotion recommends animations driven by this frame value and warns that CSS transitions can flicker during rendering. [Current-frame API](https://www.remotion.dev/docs/use-current-frame), [animation guidance](https://www.remotion.dev/docs/animating-properties)

**Source finding.** Timing operations distinguish placement (`from`), source offset (`trimBefore`), selected source duration (`durationInFrames`), playback speed, and looping. At normal speed without looping, child time is `trimBefore + frame - from`; nested timed parents introduce their own local coordinates. [Timing and trimming](https://www.remotion.dev/docs/timing)

**Source finding.** `<Sequence>` remains available for timed children; the current documentation now recommends directly timed components instead. This is a current API recommendation, not grounds to rewrite a working project's older composition. [Sequence API](https://www.remotion.dev/docs/sequence)

**Source finding.** Current `Audio` documentation imports it from `@remotion/media`. At 30 FPS, `trimBefore={60}` with `durationInFrames={60}` plays source seconds 2–4 for two seconds; `from` controls when that clip enters the parent timeline. `trimAfter` is currently deprecated in favor of `durationInFrames`. `/docs/audio` now redirects to the distinct `Html5Audio` documentation. [Audio API](https://www.remotion.dev/docs/media/audio), [Html5Audio API](https://www.remotion.dev/docs/html5-audio)

**Workflow inference.** Inspect the project's locked Remotion version before writing examples: current online docs and older installed packages may expose different props/imports. Put the music excerpt offset in one explicit timing decision, then derive lyric entrances, beat events, and visual cues in the same final timeline. Verify first/last included frames and transitions into nested scenes; avoid applying the excerpt offset twice.

**Source finding.** `staticFile()` produces an asset URL from `public/`, which belongs beside the `package.json` containing the Remotion dependency. It also handles URL encoding. The CLI render command accepts an entry point or serve URL, a composition ID, and an output location. [Static asset API](https://www.remotion.dev/docs/staticfile), [render CLI](https://www.remotion.dev/docs/cli/render)

**Workflow inference.** Package referenced fonts, images, audio, and video with stable project-relative asset names and use supported loaders. Record the composition ID, FPS, dimensions, duration, inputs, and exact render command. A successful browser preview establishes less than a successful final render; inspect the rendered file around lyric entrances, cut boundaries, and the ending.

## FFmpeg: measure the final mix, then verify the encoded delivery

**Source finding.** `loudnorm` targets integrated loudness, loudness range, and maximum true peak, with single/double pass and linear/dynamic modes. Linear normalization requires `measured_I`, `measured_LRA`, `measured_TP`, and `measured_thresh`; unsuitable LRA or peak conditions cause fallback to dynamic mode. Dynamic mode upsamples to 192 kHz; set the output sample rate explicitly. JSON reporting is supported. [FFmpeg loudnorm](https://ffmpeg.org/ffmpeg-filters.html#loudnorm)

**Workflow inference.** For a two-pass file workflow, measure the exact final excerpt/mix with chosen targets and JSON reporting, then supply those measurements on the normalization pass. Preserve the report, including actual normalization mode. Select targets from the delivery brief; the filter defaults are not platform requirements. Re-measure the encoded delivery and listen for distortion or unwanted dynamic changes; an input peak measurement does not prove the final encoded peak.

**Source finding.** For normal MOV/MP4 output, `-movflags +faststart` runs a second pass relocating the `moov` index to the beginning for improved playback startup. FFmpeg says it does not work in some situations, including fragmented output. It changes metadata placement, not the quality of the edit. [FFmpeg MOV/MP4 muxer documentation](https://ffmpeg.org/ffmpeg-formats.html#mov_002c-mp4_002c-ismv)

**Workflow inference.** Check the finished file's streams, duration, frame rate, dimensions, playback, audio presence, and measured loudness/peak. Confirm the first intended sound, music ending, and final held frame in that artifact. Reserve claims about device or platform playback for an actual playback/upload check.

## Source production: observed lessons

The `promo-music-video` skill abstracts a completed product music-video
production, then checks its technical assumptions against primary documentation.
The original song, lyrics, captures, fonts, product branding, private conversation,
and local hosting configuration are not distributed with the skill.

The local review included the creator's conversation and revisions; the production
README; `timing.ts`, lyric/beat maps, and shader source; song-analysis and render
scripts; QA implementations and retained reports; intermediate contact sheets;
and an exported poster. The final wide file was independently probed: 60 seconds,
1920×1080, 60 FPS, 3,600 frames, H.264 video and a 60-second AAC stream. These facts
describe that artifact only. This skill-extraction pass did not independently
listen to or play the entire original film.

Source snapshot: production tree commit
`4abdf26904cb0a1af7a969e44f8da4b82ad3efb3`; accepted creative cut identified in the
production record as `1afbb468`. Paths below are relative to that private
production tree's `marketing/video/`, supplied as provenance, not dependencies.

| Evidence inspected | Observation | Transferable decision |
| --- | --- | --- |
| Creator conversation; README song-timing section | The user requested a timing player before deciding the visuals and accepted the corrected sync | Make timing independently reviewable; preserve the requested checkpoint |
| `scripts/song-timing.py`; reviewed maps | Transcription plus onset/phrase cues supplied a draft; reviewed starts differed from the reconstructed script by up to roughly 0.6 seconds | Preserve manual corrections and mark regenerated analysis as draft |
| `scripts/song-analysis.py` | Bar phase was selected from four candidates using energy rises and accents | Treat 4/4 and phase as assumptions to verify, not a general detector |
| `src/music/timing.ts` | Phrase cards and shots were separate; cuts mostly followed downbeats, with semantic exceptions | Separate lyric timing from editorial timing; document exceptions |
| Creator revisions; contact sheets | Dense text, flat-looking decorative forms, unsuitable scenery, and transition collisions required repeated revision | Diagnose hierarchy, material, and transitions instead of merely adding effects |
| Creator revision; `src/music/features.tsx` | A feature needed the product interface showing an attachment, not just the attachment full-screen | Preserve product context in feature proof |
| `src/music/ShaderBackground.tsx` | Shader time used composition frame/FPS | Keep procedural effects on the render clock |
| `scripts/master-music.sh` | Contiguous ProRes chunks kept the render bounded; audio was muxed afterward | Preserve frame coverage and one audio clock when recovering expensive renders |
| `scripts/music-qa.py`; retained reports | Contrast used selected frames and median glyph/background values; cut checks used a selected list | Describe sample coverage and avoid claiming blanket accessibility or exhaustive sync |
| `scripts/motion-qa.py` | Low-resolution frame differences excluded windows around planned events | Use anomaly detection as triage, then inspect transitions directly |
| `scripts/music-qa-all.sh` | The wrapper printed summaries and did not make every subcommand/threshold a failing exit | If packaging automated QA, ensure failures actually propagate |
| Production handoff | Documentation and reconstructed scripts were added after creative acceptance; no fresh-checkout run was claimed | Distinguish accepted artwork from reproducible tooling |

The original palette, brand-specific lyrics, precise word lead, typography,
aggressive drop treatment, 4/4 song, fixed duration, and particular shader motifs
are examples. The skill intentionally makes those creative and technical choices
adaptable to another product.

## Limits and unresolved checks

- This is documentation research, not timing or quality validation on a song, aligner, render, or target platform.
- No source reviewed establishes exact stock Whisper sung-word timing, universal downbeat detection from `beat_track`, or automatic semantic song sections.
- Forced alignment depends on model/language, valid transcript coverage, and the particular performance; singing accuracy remains a per-track review question.
- Online Remotion docs are evolving. Verify installed package versions and available APIs when executing the workflow.
- A guessed historical librosa tutorial URL failed; the linked official current tutorial loaded successfully. No other research blocker remains.
