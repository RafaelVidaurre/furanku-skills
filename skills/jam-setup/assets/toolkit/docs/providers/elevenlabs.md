# ElevenLabs

Serves the sound and voice routes. Unit: ElevenLabs credits. `jam audio` drives it through the official `elevenlabs` program; this page holds what is true of ElevenLabs only. Model ids, limits and prices are dated observations: ElevenLabs ships changes weekly, so read the live page before building on one.

## Reach

- **Program:** `elevenlabs` (`npm i -g @elevenlabs/cli`, or `brew install elevenlabs/tap/elevenlabs`). `jam provider probe elevenlabs` says whether it runs. A path other than the one on PATH goes under `providers.elevenlabs` in `jam.local.json`.
- **Sign-in:** the person runs `elevenlabs auth login` (it opens a browser), or provides `ELEVENLABS_API_KEY` in the environment through their own secret handling. An agent never asks for, places or echoes a key.
- **Windows:** an npm install is a `.cmd` launcher, which `jam audio` refuses because prompts cannot be passed through it safely. Point `providers.elevenlabs` at the program's executable or at its JavaScript entry file.
- **Hosted MCP server:** for browsing and designing voices in conversation only. Its sound-effects node uses the deprecated model and it returns expiring links, so generation for the project goes through `jam audio`. When the server adds permissions (two read scopes on 2026-11-17), each connected client asks the person to consent again before its tools answer.

Free calls: `jam audio voice voices` (lists voices), and the account read `jam audio` makes before and after each paid call.

## Pricing a job

`--dry-run` on `jam audio sfx generate` and `jam audio voice speak` prints the upper bound and sends nothing.

| Operation | Upper bound used | Source (read 2026-11-15) |
| --- | --- | --- |
| Sound effect | 40 credits per second when `--duration` is set, 200 per generation otherwise, whichever is more | [Sound effects](https://elevenlabs.io/docs/overview/capabilities/sound-effects), [pricing](https://elevenlabs.io/pricing); the two pages disagree, so the higher figure is taken |
| Speech | 1 credit per character sent, markup included | [API pricing](https://elevenlabs.io/pricing/api) |

Every request is charged whether its take is kept or not. The charge recorded on the job is how far the account's own usage figure (`character_count`) moved across the call; when that figure cannot be read, the upper bound is recorded and the job's evidence says so. Usage by anything else on the account at the same moment lands in the same figure.

Rights: a free plan carries no commercial license; paid plans do, except for beta services. `jam audio` records the plan's terms on each take; confirm them before distribution ([publishing terms](https://elevenlabs.io/docs/help-center/legal/can-i-publish-the-content-i-generate-on-the-platform)).

## Sound effects

Model `eleven_text_to_sound_v3`, requested as 48 kHz WAV. One request returns one sound and takes no seed, so a take cannot be reproduced: keep every take worth keeping.

### The prompt

- **One physical event per sound.** Name what touches what, and how: "a glass wine bottle set down hard on a wooden table". A word with a stronger everyday meaning wins over what you meant ("knocks" comes back as knocking on a door).
- **Name the materials and the action, not a category.** "Ceramic vase shattering on a wooden floor", not "breaking"; "heavy rain on a tin roof", not "rain".
- **An object's sound is that object's own.** When the game plays both bodies of a collision, describe one body's material and how it gives, and leave out what it hits.
- **Ask for a close, dry recording** unless the sound is the room (an ambience bed): "close, dry, no reverb, sound effects foley". The room still rings in many results, and rewording does not remove it: fade the tail afterwards with `jam audio sfx tighten`, or generate with `--tighten`.
- **A requested series is unreliable.** "Several footsteps with clear gaps" often returns fewer or merged hits, and exact counts are not followed. For variants, generate one hit per take (`--takes <n>`) and combine the good ones with `jam audio sfx variants`; split a take only when it happens to hold separate events.
- **A moment with several parts** is generated as parts the game layers.
- Sound-design vocabulary helps where it fits: impact, whoosh, one-shot, loop, ambience, drone. Prompts are short; the app caps them at 450 characters.

### Settings

| Flag | Use |
| --- | --- |
| `--duration <s>` | 0.5 to 30. Set it for one-shots, short for impacts. Left out, the model chooses from the prompt. |
| `--setting influence=<0-1>` | Default 0.3. Higher follows the prompt more literally and varies less (0.8 with a 1 s duration for literal foley); lower allows more invention. |
| `--loop` | A seamless loop, for beds and continuous sounds; up to 30 s per request. |
| `--setting model=<id>` | Another sound model. The API's own default is a deprecated model, so `jam audio` always names one. |

## Voices

A speaker's voice is an account voice named by its id. The person chooses it.

- **Existing:** `jam audio voice voices --search <text>` lists the account's voices with a link to hear each. Show the person the names, descriptions and links; assign their pick with `jam audio voice assign <speaker> --voice <id>`.
- **New:** the person designs it in the app at [Voice Design](https://elevenlabs.io/app/voice-lab?create=true&creationType=voiceDesign) (their voices: [My Voices](https://elevenlabs.io/app/voice-lab); shared ones: [Voice Library](https://elevenlabs.io/app/voice-library)). Designing costs credits, so offer it; do not assume it. Then find it by name with `voices --search` and assign it.

A design prompt in the shape ElevenLabs recommends:

```
Native <language>, <regional variant>. <Gender>, <age range>. <Quality level> quality.
Persona: <2-5 words>. Emotion: <2-3 adjectives>.
<1-2 sentences on timbre, pacing and delivery.>
```

State pacing explicitly ("deliberate and measured"). Say "accent" only for a regional accent and "intonation" for melody. Describe the voice itself, without reverb, phone or tape effects. For the preview text, use one of the character's own lines.

Voice settings, set once per speaker: `jam audio voice assign <speaker> --voice <id> --setting stability=0.4 --setting similarityBoost=0.75` (defaults 0.5 and 0.75). Lower stability widens the emotional range and, too low, turns erratic. The speech model has no style or speed setting.

## Speech

Model `eleven_v4`, requested as 48 kHz WAV, one request per line. The model rejects a seed (HTTP 400 `invalid_parameters`, observed 2026-11-15), so takes are not repeatable: for a lively read, lower stability and ask for a few takes (`--takes 3`).

### Delivery markup

A line's `performance` for this provider is `"performance": {"elevenlabs": "<the line's exact text with tags>"}`. A tag is a short instruction in square brackets placed where the delivery changes: before the words it colours, or after them for a reaction (`This is hard. [sighs]`). `jam audio` refuses a performance whose spoken words differ from the text.

- **Describe the voice.** The model also generates sound effects, so a bare one-word tag can come out as a noise. Multi-word voice descriptions land reliably: `[low, gravelly voice]`, `[under his breath]`, `[quietly, with controlled fear]`.
- **Known tags.** Reactions: `[laughs]`, `[chuckles]`, `[sighs]`, `[exhales sharply]`, `[clears throat]`, `[gulps]`. Delivery: `[whispers]`, `[shouts]`, `[sarcastic]`, `[excited]`, `[annoyed]`, `[thoughtful]`. Timing: `[short pause]`, `[long pause]`. More work beyond these.
- **Fit the voice.** A tag lands when the voice can plausibly do it. When a voice keeps ignoring a delivery, change the voice or the line; stacking tags does not help.
- **Tags are for the voice only.** Gestures and movement (`[pacing]`, `[grinning]`) belong in the line's `direction`.

A take whose transcript check reports a mismatch has usually read a tag aloud or dropped words: revise the performance and speak it again.

### The words

- Punctuation directs: an ellipsis adds a pause and weight, capitals add emphasis. The model takes no SSML pause tags.
- Spell numbers and symbols as spoken words, in the text itself.
- A name that keeps coming out wrong takes IPA between slashes inside quotes (`"/kalˈtsoːne/"`); that changes the text and so the subtitle, so prefer a plain respelling.

## After a refusal or a lost answer

- **Refused:** the program prints the service's answer and `jam audio` shows it under "refused by the provider"; nothing was made, and the job is settled as never made. A stated wait in that answer is the time to wait; a plan or permission refusal is not cleared by retrying. Concurrency limits depend on the plan (for sound effects, 4 to 8 at once as read on 2026-11-15); `jam audio` sends one request at a time.
- **Lost:** when the program dies or times out with no answer, the generation may exist and be charged. The job is left `lost` and the same request is blocked. Open the account's history in the app, look for a generation with that text at that time, then settle the job with the command the error printed. Each start is charged, so a request is never repeated to find out.

Which answers count as a refusal is read from the program's output (an HTTP 4xx status or a named client error); anything unrecognised counts as lost. That reading has not been exercised against every error the service can return.

Sources: the pages linked above, the [models overview](https://elevenlabs.io/docs/overview/models), [speech best practices](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices) and the [program's reference](https://github.com/elevenlabs/cli). Researched 2026-11-15; the prompting advice and the seed refusal were observed during a game jam in November 2026 (149 sound and 108 dialogue runs through this program).
