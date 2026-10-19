# Song timing

## Preserve the source clock

Probe the mix and stems for duration, sample rate, channels, and leading silence.
Record source identifiers or hashes, tool versions, and any source offset. Equal
duration does not prove stem alignment: compare a clear vocal event near the
beginning and end. A trimmed stem needs an explicit offset into the mix.
Define the sign as `mix_time = stem_time + offset`: if stem time zero corresponds
to mix time 0.35 seconds, its offset is +0.35. Verify this correspondence from
the audio rather than assuming what a filename or "starts later" means.

Use seconds from the original mix for the analysis master. A video cut selects
an interval of that clock; it does not rewrite the original word timings.
Make mono/resampled analysis copies if needed; render with the original mix.
An instrumental track skips word alignment and uses musical/semantic markers.

**Complete when:** all inputs map to the mix clock and any trim or drift is known.

## Recover what is sung

Use supplied lyrics as the text authority, correcting them when the actual take
differs. Prefer the supplied lead-vocal stem. If no stem exists, use the mix or an
available separation tool; separation is optional and may introduce artifacts.
Check the available workflow before installing or downloading large models.

For local Whisper, a useful draft command is:

```sh
whisper vocal.wav --model turbo --word_timestamps True --output_format json --output_dir asr
```

Model/language choice depends on the song and available machine. Whisper's word
timestamps are estimates. Providing an initial prompt is not forced alignment.
When exact lyric text exists, an available forced aligner can improve the draft,
but singing, held syllables, backing vocals, and uncommon names still need review.
Use a second transcription only where disagreement would help resolve a passage.

Inspect names, sung URLs, acronyms, repetitions, rapid passages, instrumental
silence, and the final line. Preserve the distinction between the literal sung
words and a display form such as a URL. Split cards at spoken or sung phrases,
not automatically at ASR punctuation. If words cannot be aligned reliably, use
phrase-level captions and record that granularity.

Vocal onsets and non-silent spans can suggest phrase starts. Listen before
snapping: the nearest transient may be another syllable, a breath, or a drum.
After any correction, run the checker in [Keep one editable timing map](#keep-one-editable-timing-map).
Represent overlapping voices as separate phrases; they may overlap in time.

**Complete when:** the text matches the take, timestamps pass structural checks,
and ambiguous phrases are identified for listening rather than guessed.

## Recover musical structure

Estimate beats and tempo from the mix with a tool such as `librosa.beat.beat_track`.
Keep the returned timestamps: a single BPM and arithmetic grid can drift away
from a performed track. Check half/double-tempo errors and pickups by listening.

A beat tracker does not establish bar position, time signature, or chorus names.
For music confirmed to be 4/4, comparing four possible beat phases using accents
and energy rises can propose downbeats. Validate them by listening. Variable
meter, rubato, syncopation, and weak percussion require manual markers or an
appropriate meter-aware tool. Every fourth detected beat is a downbeat only
once meter and phase are confirmed.

Energy, onset strength, and changes in spectral/chroma features can suggest
sections. Name verse, build, chorus, drop, bridge, or outro only after listening
to the song. Separate ordinary beats from the few hits that warrant major effects.

**Complete when:** the chosen beat/bar/section markers agree with the heard music,
and estimated markers remain distinguishable from reviewed ones.

## Keep one editable timing map

The exact schema can match the editor. Keep at least these concepts together;
the values below are illustrative, not a prescribed song structure. Phrases,
words, and marker objects carry one status: `estimated` (tool output), `listened`
(checked against the audio, for example by looping the phrase), or `reviewed`
(accepted by the user). Words inherit their phrase's status unless set. Bare
beat times carry no status. `"held": true` with a `note` marks an entry
deliberately left unresolved.

```json
{
  "schemaVersion": 1,
  "mix": {"asset": "mix.wav", "duration": 12.0},
  "sourceOffsets": {"vocal.wav": 0.0},
  "beats": [1.0, 1.5, 2.0, 2.5, 3.0],
  "downbeats": [{"time": 1.0, "status": "listened"}],
  "sections": [{"start": 0.0, "end": 12.0, "label": "opening", "status": "estimated"}],
  "hits": [{"time": 3.0, "reason": "accent", "status": "estimated"}],
  "phrases": [{
    "id": "p01", "start": 1.0, "end": 2.4,
    "text": "Make room", "status": "estimated",
    "words": [
      {"text": "Make", "start": 1.0, "end": 1.45},
      {"text": "room", "start": 1.5, "end": 2.4}
    ]
  }]
}
```

Record the analysis method and review notes beside the map. Analysis reruns write
a separate `estimated` file and leave the reviewed map untouched. A new mix invalidates timing unless
equivalence is checked. Each render identifies the exact map and audio it used.

Check structure after every correction, and gate the end of timing review on
status (exit 1 lists each problem):

```sh
node <skill-dir>/scripts/check-timing-map.js timing.json --duration <mix seconds>
node <skill-dir>/scripts/check-timing-map.js timing.json --min-status listened
```

The checker covers finite times, start < end, chronological order, containment
in the audio, words inside their phrases, and status values. Use
`--min-status reviewed` when the user approves timing.

**Complete when:** the checker passes, the editor can consume the map, and
corrected timing survives a fresh analysis run.

## Make the timing proof useful

Use the bundled player in `assets/timing-player/` rather than building one: copy
the folder beside the mix and map, then either open `index.html` and pick (or
drop) both files, or serve the folder and open
`index.html?map=timing.json` (the mix loads from `mix.asset`; add `&audio=<file>`
to override). It plays the original mix on the audio element's clock and shows
the current phrase, word highlighting when the phrase has words, sections, and
beat/downbeat markers on an overview and a zoomed timeline. Phrases can be
looped, retimed to the playhead or nudged by 10 ms, marked
`estimated`/`listened`/`reviewed`, or held; the key list is on the page.
Retiming an `estimated` phrase marks it `listened`. **Download map** saves the
corrected JSON under its loaded name; that file replaces the reviewed map.

Check ordinary playback and seeks near the start, middle, and final phrase.
Use wired/local playback when checking fine sync; wireless output latency can
mislead. Review sung starts and held endings by ear. The browser preview is
listening evidence, not frame-exact proof of the final encoded video.

For rendering at frame rate `fps`, convert a marker with `round(seconds * fps)`
under one documented rounding policy. Subtract the selected mix in-point before
conversion. Review phrase boundaries after quantization; two distinct timestamps
can become the same frame. A visual lead-in is a style parameter, not a correction
to the word's recorded onset.

**Complete when:** the timing preview has been reviewed to the requested level,
corrections are saved, and production uses that same reviewed map.
