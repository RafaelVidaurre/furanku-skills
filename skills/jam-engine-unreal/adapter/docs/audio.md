# Audio

## Sound waves

`jam engine import --kind audio <take.wav> ... --destination /Game/Audio/<folder>` imports each file as a SoundWave named after the file, reimporting into the same package, and saves it.

What to deliver:

- **WAV, 16-bit.** Unreal imports `.wav`, `.ogg`, `.flac`, `.aif`, `.opus` and `.mp3`, converts all of them to 16-bit internally, and does not dither 24-bit files, so Epic recommends importing 16-bit.
- **The project's sample rate.** The jam delivered 48 kHz, matching the project's `AudioSampleRate`; the `audio.sampleRate` fact carries it, and a project with another rate overrides the fact.
- **Mono for positional sounds**, stereo only for a sound that is not placed in the world.
- **Loudness** (the jam's starting points, checked by ear): true peak at or under −1 dBTP for everything; voice around −20 LUFS integrated; a sound effect's loudest moment (maximum momentary loudness) at −26 LUFS, so a short knock and a long hum sound equally loud at the same gain; music beds around −24 LUFS. The facts carry the true-peak ceiling; the per-kind targets belong to the project's audio settings.

With an editor on another machine the processed takes must be in its checkout first; ignored or temporary files are not carried by a source sync, so upload them to the same relative path ([transport.md](transport.md)). The import stops when a file's bytes differ from the ones here.

## Random-variant sources

`jam engine import --kind audio-variants <take.wav> ...` imports the takes as SoundWaves and makes or updates one MetaSound Source that plays a random one of them, named after the folder that holds the takes (or `--name`, or `--asset /Game/<folder>/<Name>`); `--variant /Game/<sound wave>` adds takes that are imported already. The Source holds a single node of a shared MetaSound Patch with the waves as its `Variants` input, so variation (shuffle, random pitch and gain) is authored once in the patch and every sound picks it up. On an existing Source the node is replaced, so inputs added to the patch since appear.

It needs, in `jam.config.json` under `engine.facts.extra.audio`:

```json
{ "variantPatch": "/Game/Audio/Patches/MSP_RandomVariant",
  "toolsets": { "authoring": "MetaSoundToolset.MetaSoundAuthoringToolset",
                "inspection": "MetaSoundToolset.MetaSoundInspectionToolset",
                "discovery": "MetaSoundToolset.MetaSoundDiscoveryToolset" },
  "author": "<text stored as the asset's author>" }
```

The values shown are the jam's (UE 5.9's editor toolsets); read the names your editor exposes before setting them. The patch is the project's own asset and must exist: one with a `Play` trigger, `Variants` (wave array), `VariantIndices` and `Label` inputs, and `Left`, `Right` and `Finished` outputs. The script reaches the MetaSound toolsets through the editor Python tool's `call_tool` and uses top-level await, so it needs a `command` transport with `"await": true` or a handoff ([transport.md](transport.md)).

Done when the receipt lists the Source and it plays a different take on repeated triggers in the editor.
