# Audio: sounds and voiced lines

What `jam audio` keeps, how it processes, and the rules both audio skills share. The `jam-sfx` and `jam-voice` skills say how the work is done; `docs/cli.md` and `--help` list every flag; `jam audio settings` prints this project's values.

## Layout

```
<roots.sfx>/<name>/unit.json                    the sound's record
<roots.sfx>/<name>/<name>.wav, <name>_2.wav     processed takes (take 1, take 2, ...)
<roots.sfx>/<name>/variants/<name>_v01.wav      level-matched variants
<roots.voice>/<script>/<line id>/unit.json      the voiced line's record
<roots.voice>/<script>/<line id>/<line id>.wav  processed takes, numbered the same way
<roots.sources>/sfx/<name>/...                  originals, exactly as received or supplied
<roots.sources>/voice/<script>/<line id>/...
```

The roots, the lines patterns and the speakers file are the `audio` section of `jam.config.json` (defaults `Audio/SFX`, `Audio/Voice`, `Audio/Sources`, `Audio/Lines/*.json`, `Audio/speakers.json`). `<script>` is a lines file's name without `.json`. A take's number is never reused, so a file name always means the same take. Commit the audio roots; originals belong in the repository, because every processed file is made from its original.

## Records

`unit.json` follows `schemas/audio-unit.schema.json` and is written only by the tool. It is what a catalog or a game's own tooling reads to list sounds and lines.

| Field | Holds |
| --- | --- |
| `id`, `kind`, `name`, `target` | `sfx/<name>` or `voice/<script>/<line id>`; `sfx` or `voice`; the display name (a line's text); which loudness target applies (`effect`, `loop`, `voice`) |
| `line` | Voice: the authored line as last voiced (`script`, `file`, `id`, `speaker`, `text`, `textHash`, `language`) |
| `selected` | Voice: the take that stands for the line; absent means the lowest-numbered take of the current text |
| `takes[]` | `n`, `file`, `sha256`, `original` (path and hash), `generation`, `processing`, `facts`, `level`; for voice also `textHash`, `words`, `transcript` |
| `takes[].generation` | `origin` (`generated` or `supplied`), and for a generated take the provider, model, prompt or text sent, settings, the run and job that paid, the provider's own job id, the request file's hash, the charge; for a supplied one its creator, license and source |
| `takes[].processing` | `loop`, `stereo`, the `window` of the original that was kept (seconds), `tighten` |
| `takes[].facts`, `.level` | Measured duration, channels, sample rate, bit depth, integrated and loudest-400-ms loudness, true peak; the target it was levelled to, the level reached, and why it is under the target when it is |
| `takes[].words` | Voice: `{word, start, end}` for each authored word, in seconds of the processed file |
| `takes[].transcript` | Voice: `match`, `mismatch` or `by-ear`, what the transcriber heard, the word error rate, whether timings were aligned or spread by word length, and a person's acceptance with their words |
| `variants[]` | `n`, `file`, `sha256`, the take it was cut `from`, `start` and `end` in that take (absent for a whole take), `facts`, `level` |

A voiced take is **current** while its `textHash` equals the hash of the line's text now; otherwise the line is stale. The engine's asset id of an imported file is on the run's `import` step (`engineAssets[].source` is the file's path). Records hold project-relative paths only: no absolute path, credential or link.

## Format and loudness targets

Each value comes from the first place that states it: the engine adapter's `audio` facts (with the project's `engine.facts` overrides), then `audio.format` and `audio.loudness` in `jam.config.json`, then these defaults.

| | Default | Measured as |
| --- | --- | --- |
| Format | 48000 Hz, 24-bit WAV; mono unless a sound is made with `--stereo`; voice is mono | |
| `effect` (one-shot) | -26 LUFS | its loudest 400 ms (`momentary-max`) |
| `loop` (loop, ambience) | -26 LUFS | its loudest 400 ms |
| `voice` (voiced line) | -20 LUFS | the whole file (`integrated`); a line too short to measure that way is judged by its loudest 400 ms |
| True-peak ceiling | -1 dBTP | |

Effects are levelled by their loudest moment so that a short knock and a long hum set to the same value sound equally loud, and a gain in game data means the same for every sound. Loudness between different sounds is mix data and stays out of the files. A sound whose peak would cross the ceiling stays under it and its record says how far under the target it is. Variants of one sound share one level.

A target is `{"measure": "integrated" | "momentary-max", "lufs": <n>, "truePeakDb"?: <n>}` under `audio.loudness.<kind>`, or under `audio.loudness.targets.<kind>` in the engine facts. After changing a target or the format: `jam audio sfx reprocess --all` and `jam audio voice process --all`, then record and import the affected run steps again.

## Processing

Every processed file is made from its original in one chain:

1. Decode to the project's sample rate, mono or stereo.
2. Keep the part that is the sound. An effect runs from just before its first transient to where its tail settles into the noise floor, so a ringing tail stays. A voice line is the speech with 60 ms of room on each side. A loop is kept whole. The window found the first time is written in the record, and `trim` replaces it.
3. Fade the cut edges; with `tighten`, fade the room tail once it has decayed.
4. Set the level to the target, held under the true-peak ceiling.

A result that peaks under -45 dBTP is a failed generation: it is kept as an original, never made a take.

## Listening and review

Agents cannot hear. State what was measured (length, level, how many events, what the transcriber heard) and nothing about how something sounds.

- The gate on the processed result is a person's. `jam run request-review <id> process` prints the catalog link where they play each file; give them the link, what each sound or line is for, which files to compare, and for a generated sound its exact prompt.
- When they answer you directly, record their words: `jam run review <id> process --accept --relay "<where they answered>: <their words>"`.
- Their feedback is the next instruction: a new take, a trim, a tighter tail, another performance. Changed files are recorded and reviewed again.

## Spending

Each request to a provider is one job in a run's ledger: opened with its estimate before anything is sent, settled with the charge afterwards. `jam audio` does this itself.

- **Show the cost first.** `--dry-run` prints a `cost:` line (requests, upper bound, unit, where the number comes from) and sends nothing. Give the person that line as it is.
- **Ask once per batch.** One approval covers the sounds or lines it named. With a standing authorization (`spend.<provider>.standing`, shown by `jam audio settings`), work inside the caps without asking and report what was spent afterwards. Otherwise pass their approval as `--authorized "<who, when: their words>"`.
- **Caps are the person's.** A batch that would pass `spend.<provider>.perRun` or `total` is refused before the first request. Split the batch or report; only the person changes a cap.
- Every request is charged, kept or not. The recorded charge is what the provider's usage figure moved by, or the estimate when the provider reports none; the job's evidence says which.

## Waiting, refusals and lost answers

- `jam audio` waits for each request and returns when it is settled; there is nothing to poll.
- **Refused:** the provider answered and made nothing. Its words are printed under "refused by the provider" and the job is settled as never made. A wait it states is the time to wait before running the command again; do not wait a time nobody stated, and do not retry a refusal that names a plan, a permission or the input.
- **Lost:** no answer was read, so the request may have been made and charged. The job stays `lost` and the same request is blocked in every run. The error prints the commands that settle it once the provider's own history shows what happened. A request is never sent again to find out.
- `jam job list --open` shows every job that still needs settling.

## Providers

The sound and voice routes (`routes.sound`, `routes.voice`) each name a provider. A provider that can serve them is two files in the toolkit's `providers/` folder: its descriptor `<id>.json` (unit, capabilities `sound` and `voice`, a `cli` transport naming its program, its guide) and its adapter module `<id>.audio.ts`, which exports `adapter` as `AudioAdapter` in `src/jam/audio/AudioProvider.ts` describes: how to validate, price, describe and send a request, list voices, and read the account's usage. Everything that names the vendor's commands and flags stays in that module; its prompting and pricing advice goes in `docs/providers/<id>.md`. The program's path on this machine is `providers.<id>` in `jam.local.json` when it is not on PATH; a `.js` or `.mjs` path is run with Node.

## The transcript check

For a voiced take it places the authored words on the audio (word timings) and, separately, transcribes the audio and compares the words with the line's text. Case, punctuation and same-sound spellings are not differences.

- It runs in an optional Python environment: `jam python -m pip install -r <toolkit>/scripts/audio/requirements.txt`. The first run downloads speech models (about 1.5 GB). Another environment or program is named as an argument list under `aligner` in `jam.local.json`.
- Not installed, the check reports `unavailable` with that command, and a line is recorded only with a person's acceptance by ear on its take (`jam audio voice process <line> --by-ear "<where they answered>: <their words>"`).
- Same-sound spellings are data, by language: `<toolkit>/scripts/audio/homophones/<language>.json`, plus the project's own file named by `audio.homophones` (`{"en": {"dawn": "don"}}` maps what a transcriber writes to how the script spells it).
- The alignment model reads Latin letters. For other scripts the timings fall back to a spread by word length, marked `proportional`, and the comparison still runs.

## Dialogue files

A lines file (`schemas/audio-lines.schema.json`):

```json
{
  "language": "en",
  "lines": [
    { "id": "greet", "speaker": "innkeeper", "text": "Welcome, traveller.", "direction": "wiping a mug, not looking up", "review": "reviewed" },
    { "id": "warn", "speaker": "innkeeper", "text": "Mind the step.", "performance": { "<provider id>": "<the same words with that provider's delivery markup>" } }
  ]
}
```

`text` is what is spoken and shown; editing it makes a voiced take stale. `direction` is for people and is never sent. `performance` is sent instead of `text` to that provider and must keep the exact words. `review` is the person's mark that the words are final (`true` or `"reviewed"`). Fields of the project's own go under `extra`.

The speakers file (`schemas/audio-speakers.schema.json`) is written by `jam audio voice assign`: `{"speakers": [{"id": "innkeeper", "voice": {"provider": "<id>", "id": "<voice id>", "name": "...", "settings": {}}}]}`.
