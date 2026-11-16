# Voiced dialogue line recipe

Notes for each step of the `voice-line` recipe. `jam run next` points here; `jam recipe show voice-line` lists the steps.

The `jam-voice` skill says how lines are voiced; these notes say what each step of a run records. A run covers one line (give the run the line's id) or a batch reviewed together (give `--run <batch id>` to `jam audio voice speak`).

Agents cannot hear. The transcript check proves the words and the loudness check proves the level; whether the performance is right is a person's judgement, which is why the gate sits on `process`.

## voice

`jam audio voice speak --run <id>` records this step itself: each request is a job in this run's ledger, the originals it received are the step's files, and the last job is its provenance. There is no gate.

- Voice lines a person has marked reviewed (`--reviewed`); the words of the others may still change, and a text edit makes a paid take stale.
- Every line's speaker needs a voice first; the person chooses it.
- A refusal stops the batch with the provider's words; a lost answer leaves its job `lost` and the error says how to settle it.
- **A recording made outside the tools** is added with `jam audio voice process <line> --file <recording>`, and its run starts at the next step: `jam run start voice-line <id> --from process --brief-text "..."`.

## process

`jam audio voice process --run <id>` settles the take that stands for each line this run voiced and records them on this step. Two checks must pass for every line:

- `loudness`: the take is at the voice target, under the true-peak ceiling, in the project's audio format.
- `transcript-match`: the take says the line's current text. A transcription that differs is a mismatch: revise the line's performance and speak it again. When the transcript check is not installed, the step is recorded only after a person has listened, with their words on the take: `jam audio voice process <line> ... --run <id> --by-ear "<where they answered>: <their words>"`. The same flag settles a take the transcriber misheard.

Then ask the person: `jam run request-review <id> process` prints the link where they listen to each line. Their verdict accepts the step or returns it with their words. On feedback, change the performance or the take (`--take <n>` picks another), speak again where needed, and run `process --run <id>` again.

With `review.mode` set to `agent`, an agent may accept this step: state in the reason that nobody has listened.

## import

Applies when the engine adapter provides `import`; otherwise the tool skips it and the run ends at the processed WAV files under the voice root, each beside its `unit.json`, which also holds the line's word timings.

`jam engine import --kind audio --run <id>` imports the files of the `process` record and writes the engine's asset ids onto this step. After the voice target or the audio format changes, run `jam audio voice process --all`, record `process` again and import again; the engine keeps the same ids.

## After the last step

`jam run next <id>` then offers `jam run deliver <id>`. Delivering puts the run's record (its ledger and who accepted what) and a frozen copy of the accepted files under the delivered root, so they can be committed. The game keeps using the files under the voice root, or the assets the engine imported from them.
