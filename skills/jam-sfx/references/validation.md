# What has been proven: sound effects

Three levels of evidence, as of 2026-11-16. "The jam" is the game jam (November 2026) whose sound tools this toolkit carries forward; its tools made 52 sound units in 149 invocations with the real provider.

## Exercised in this version

By the toolkit's test suite (`test/jam/audio-*.test.ts`), on macOS with ffmpeg 9.0 and Node 22.20 and 26.8, using sounds synthesised in memory (sines, struck sounds with decaying tails over a noise floor) and a stand-in provider program. No test reached a real provider.

- **Level:** a processed one-shot's loudest 400 ms lands within 0.5 LU of the target as ffmpeg's own `ebur128` filter measures it independently, and its true peak is at or under the ceiling. A sound too peaky to reach the target stays under the ceiling and records the shortfall.
- **Trimming:** silent lead-in and tail are removed, a ringing tail is kept, a loop is kept whole, a near-silent file is refused.
- **Events:** three struck sounds separated by gaps are found as three events; a heel-and-toe pair and a quieter sound inside a ringing tail stay one event; a blip 38 dB down is dropped.
- **Variants:** from one take by splitting and from several takes, all at one level, held down together when one is peak-limited.
- **Edits:** trim and tighten from the original, repeatable; variants follow the take or are removed with a warning.
- **A changed target:** `reprocess --all` brings takes and variants to the new level from their originals, keeps trims and cuts, leaves a take whose original is missing untouched and says so; the loudness check refuses files processed for the old target and passes after reprocessing.
- **The ledger:** estimate, per-run cap refused before any request, missing approval, a success settled with the charge read from the stand-in's usage figure (which differs from the estimate), a refusal settled as never made, a lost answer left `lost` and the same request blocked in the same and another run, a near-silent result charged but not made a take.
- **The recipe:** `sfx` from start to an accepted `process` step with no engine adapter (import skipped with its reason), and with a fake adapter whose import receives the processed files and returns asset ids that are recorded; the engine's audio facts set the processed format (44.1 kHz, 16-bit).
- **ffmpeg missing:** the command fails with how to install it.

## Proven only in the jam

With the real provider and real ears, by the tools this code was ported from. The rules are the same; the code around them was rewritten.

- Generating through the provider's program with the argument lists the adapter still sends.
- The prompting advice in the provider document (one physical event, name materials, dry; a requested series is unreliable; room ring is not removed by wording).
- Event detection and its default thresholds on generated sounds, including the ringing-tail and faint-event rules, reviewed with the waveform preview.
- Tightening at 30 dB with a 100 ms fade, accepted by a reviewer on contact sounds.
- The -26 LUFS loudest-400-ms reference, judged by ear in that game's mix across one-shots and loops.

## Never run

- **The shipped adapter against the real provider program.** Its sound request is carried over unchanged, but three things are new and unexercised with the real program: reading the account's usage figure before and after a request for the actual charge; telling a refusal from a lost answer from the program's real error output; picking a request id out of its output (when none is found the job records "unreported").
- **Any engine's real audio import** driven from these commands; only a fake adapter.
- **Windows.** A `.cmd` launcher of the provider's program is refused by design; nothing was run there.
- **Loops and stereo from the provider** through this code; loop and stereo processing ran on supplied synthetic files only.
- **The catalog** listing sounds from `unit.json`, which is another work package.

## Differences from the jam's output

- The gain is now capped by the measured true peak at the ceiling. The jam capped by sample peak 0.5 dB lower and then corrected, so a peak-limited sound can come out up to 0.5 dB louder here.
- Reprocessing now starts from the original with the recorded cut. The jam reprocessed the processed file in place.
