# Sound effect recipe

Notes for each step of the `sfx` recipe. `jam run next` points here; `jam recipe show sfx` lists the steps.

The `jam-sfx` skill says how a sound is made; these notes say what each step of a run records. A run covers one sound (give the run the sound's name and `jam audio` finds it) or a batch reviewed together (give `--run <batch id>` to each `jam audio sfx generate`).

Agents cannot hear. A step's checks prove format, level and peak; whether the sound is right is a person's judgement, which is why the gate sits on `process`.

## generate

`jam audio sfx generate` records this step itself: each request is a job in this run's ledger, the originals it received are the step's files, and the last job is its provenance. There is no gate, because nothing can be judged before a person listens.

- A take is processed the moment it arrives, so `jam audio sfx show <name>` already lists playable files.
- A near-silent result is charged and kept as an original but is not a take; generate again with a revised prompt.
- A refusal stops the batch with the provider's words; a lost answer leaves its job `lost` and the error says how to settle it. The provider's document says what each means for that provider.
- **A sound made outside the tools** (recorded, bought, made in a provider's app) is added with `jam audio sfx add`, and its run starts at the next step: `jam run start sfx <id> --from process --brief-text "..."`.

## process

The takes are already at the loudness target. This step settles which files are the sound, by ear.

1. Shape what the reviewer will hear: `split` or `variants` when the sound should vary, `trim` and `tighten` on feedback.
2. Record the files that are the sound, one `--file` per take or variant:

   ```
   jam run record <id> process --file <take.wav> --tool "jam audio" --note "<which take or variants, and what they are for>"
   ```

   A run that started here adds `--source "<origin>" --source-evidence <document>` alongside `--tool`. The `loudness` check measures every file: its level against the target for its kind, its true peak against the ceiling, its sample rate and bit depth. It refuses a file that is not a processed take or variant.
3. Ask the person: `jam run request-review <id> process` prints the link where they listen. Tell them what the sound is for, which files to compare, and the exact prompt of each. Their verdict accepts the step or returns it with their words.
4. On feedback, change the files (a trim, a tighter tail, a new take), then record and ask again. Changed files make the earlier record stale.

With `review.mode` set to `agent`, an agent may accept this step: state in the reason that nobody has listened.

## import

Applies when the engine adapter provides `import`; otherwise the tool skips it and the run ends at the processed WAV files under the sfx root, each beside its `unit.json`.

- One file per sound: `jam engine import --kind audio --run <id>`.
- Variants of one sound, played at random: `jam engine import --kind audio-variants --run <id>`.

Both import the files of the `process` record and write the engine's asset ids onto this step. After `jam audio sfx reprocess`, record `process` again and import again; the engine keeps the same ids.

## After the last step

`jam run next <id>` then offers `jam run deliver <id>`. Delivering puts the run's record (its ledger and who accepted what) and a frozen copy of the accepted files under the delivered root, so they can be committed. The game keeps using the files under the sfx root, or the assets the engine imported from them.
