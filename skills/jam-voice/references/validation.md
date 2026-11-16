# What has been proven: voiced lines

Three levels of evidence, as of 2026-11-16. "The jam" is the game jam (November 2026) whose dialogue tools this toolkit carries forward; its tools voiced 275 English lines in 108 invocations with the real provider.

## Exercised in this version

By the toolkit's test suite (`test/jam/audio-*.test.ts`, `test/test_audio_align.py`), on macOS with ffmpeg 9.0 and Node 22.20 and 26.8, using speech-like synthetic audio, a stand-in provider program and a stand-in aligner. No test reached a real provider or loaded a speech model.

- **Line status:** missing, voiced, stale after a text edit, voiced again from the new text with a new numbered take; the review mark and the missing voice show as needs; `--reviewed` sends only marked lines.
- **Voices:** listing, assigning with a lookup of the voice's name, refusing an unknown voice id and an unknown setting; a preview link is shown and never stored.
- **Performance:** a markup that changes the words is refused before anything is sent.
- **Processing:** a line is trimmed to its speech with 60 ms of room and set to -20 LUFS integrated within 0.5 LU as ffmpeg's own `ebur128` filter measures it independently, under the true-peak ceiling.
- **The ledger:** each line is one job, settled with the stand-in's charge; the estimate is the characters sent. Caps, refusals, lost answers and the duplicate guard share one code path with sound effects and are exercised there.
- **The transcript check, with the stand-in:** a match stores word timings on the take; a mismatch blocks the record and reports what was heard; a same-sound spelling from the shipped English list is a match; not installed, the record is refused with the install command, and goes through only with a person's acceptance by ear written on the take.
- **A supplied recording** becomes a take; `--take` picks the take that stands for a line.
- **The recipe:** `voice-line` from start to an accepted `process` step with no engine adapter (import skipped with its reason).
- **The comparison rules in the Python script:** punctuation, case, dropped letters, same-sound lists as data, other languages untouched by English rules, fallback timings. The number rule is tested only where `num2words` is installed (it was not here: 1 test skipped).

## Proven only in the jam

With the real provider, real models and real ears, by the tools this code was ported from.

- Speech through the provider's program with the argument lists the adapter still sends, including that the speech model rejects a seed.
- Forced alignment with a separate transcription as cross-check on English lines, in a Python 3.11 environment with the pinned package versions.
- The same-sound list cutting false mismatches; three takes of 81 still needed a person's ear.
- The delivery-markup advice in the provider document.
- The -20 LUFS voice level, judged by ear in that game's mix.

## Never run

- **The Python script as it ships** with real models. It was restructured (language as a parameter, same-sound lists as data, `--check`); only its pure parts ran here.
- **Any language other than English**, anywhere: neither the multilingual transcription model path nor alignment of non-English text.
- **The shipped adapter against the real provider program.** The speech request is carried over unchanged; new and unexercised are reading the account's usage figure for the actual charge, telling a refusal from a lost answer from real error output, and voice listing through this code.
- **Any engine's real audio import** driven from these commands.
- **Windows.**
- **The catalog** listing lines and showing word timings from `unit.json`, which is another work package.

## Differences from the jam's output

- Level: a plain gain to the measured integrated loudness. The jam used ffmpeg's two-pass `loudnorm`, which falls back to dynamic compression when a plain gain would pass the peak ceiling; this holds the level lower instead and records the shortfall.
- Trim: speech bounds from the tool's own envelope at -45 dB. The jam used ffmpeg's `silenceremove` at the same threshold and padding.
- Format: 24-bit unless the engine or project says otherwise. The jam wrote 16-bit.
- A stale line keeps its old takes in the record. The jam dropped them.
