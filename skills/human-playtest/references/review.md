# Extract and organize feedback

Run commands from the installed skill directory. `SESSION` below is an absolute
session directory. For typed notes alone, skip media commands and retain supplied
times as unverified annotations.

## Commands

```sh
# Inspect audio/video coverage; writes review/media-report.json.
python3 scripts/review.py inspect SESSION

# Transcribe locally using an existing faster-whisper model directory.
python3 scripts/review.py transcribe SESSION --model-path /path/to/local/model

# Find saved images nearest a media timestamp.
python3 scripts/review.py frames SESSION --time 42.5 --count 3

# Optionally hash and make raw media/images read-only.
python3 scripts/review.py seal SESSION --lock
```

`inspect` requires `ffprobe`. `transcribe` also requires `ffmpeg` and an installed
`faster_whisper` in the Python environment used to run it. It refuses model
downloads and existing output directories; it writes raw ASR, normalized text,
word/segment times and provenance under `review/transcription/`. Report missing
tools/models; recording review does not authorize installations or uploads.

`frames` returns existing image paths, source times and distance from the requested
instant. Open those images with the available image viewer. For events between
screenshots, inspect the video where possible. The tool selects images; it does
not render new ones.

## Interpret the evidence

Use media timestamps rather than transcript arrival times. Preserve audio/video
start offsets and mark uncovered spans, including a video-only tail. The report
compares decoded audio coverage with packet timing because packet durations can
hide gaps. Coverage alone does not establish intelligible speech.

During review, keep machine ASR unchanged and labeled as such. Correct doubtful words in a
separate annotation after listening; retain uncertain alternatives and unknown
speakers. Direct user text is its own source, not an audio quote. Frame proximity
provides context, not proof of exact speech synchronization or an unseen action.

## Organize the notes

Group by topic and retain quotes, source timestamps and relevant frame links.
For structured output, use [feedback.schema.json](feedback.schema.json).
Separate:

| Judgment | Meaning |
| --- | --- |
| User intent | Clear change direction, clear observation, tentative, exploratory, or positive |
| Evidence uncertainty | Confidence in the words, target and observed behavior |
| Solution specificity | No proposed solution, a direction, an example, a concrete action, or an exact replacement |

A definite complaint without a proposed fix is a clear observation, not a
tentative request. Removing a named sentence is a concrete action; supplied
replacement text is an exact replacement. Omit invented priorities.

Consolidate repeated occurrences of the same concern while preserving their
references. Keep distinct concerns separate, even on one screen: excess margins
and redundant copy are different observations. Retain positive feedback and
link withdrawals or revisions to the earlier statement. Omit entries with no
concrete meaning rather than turning them into requirements.

Deliver one self-contained feedback report with a topic overview, concrete
observations, user suggestions, quoted excerpts and relevant timestamps. Copy
only useful screenshots into a relative `evidence/` directory, deduplicating them
without changing their rendered fidelity. Use relative links so another checkout
can open the results. Distinguish user statements, visible observations and your
interpretation; keep uncertainty where it affects a conclusion.

Raw recordings, full transcripts, ASR outputs, logs and intermediate reports are
working material, not the default deliverable. Once the retained feedback and
image links are verified, remove that session's working material if source
cleanup was authorized; otherwise ask before deleting it. Honor a request to
keep sources. Cleanup is scoped to identified session files, never shared model
caches, unrelated recordings or application data. The helper does not delete
sources automatically.
