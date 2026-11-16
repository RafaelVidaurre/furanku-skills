"""Word timings and a transcript cross-check for voiced lines. Local models only, no cloud calls.

Reads one JSON object on standard input and prints one on standard output:

    in:  {"items": [{"file": "<wav>", "text": "<authored words>", "language": "en"}],
          "homophones": {"en": {"<as transcribed>": "<as written>"}}}
    out: {"results": [{"alignment": "forced" | "proportional", "alignmentError"?: "...",
                       "words": [{"word", "start", "end"}], "duration": <seconds>,
                       "transcript": "<what was heard>", "mismatch": bool, "wordErrorRate": <0..>}]}

`--check` prints {"available": bool, "missing": [...], "tool": "..."} and never loads a model.

Forced alignment places the authored words on the audio (it never takes timings from a
transcription); a separate speech recogniser then transcribes the audio, and its words are compared
with the authored ones. The comparison ignores case, punctuation and the spellings a transcriber
writes for the same sound (the homophone list, per language, is data).
"""
import importlib.util
import json
import re
import sys
import unicodedata

REQUIRED = ["torch", "torchaudio", "soundfile", "faster_whisper", "num2words"]
TOOL = "forced alignment (MMS_FA) + transcription (faster-whisper small)"
WHISPER_ENGLISH = ("small.en", "d1d751a5f8271d482d14ca55d9e2deeebbae577f")
WHISPER_ANY = ("small", None)


def base_language(language):
    return (language or "en").split("-")[0].lower()


def spell_number(digits, language):
    from num2words import num2words
    try:
        return num2words(int(digits), lang=base_language(language))
    except NotImplementedError:
        return num2words(int(digits))


def normalized_words(text, language="en", homophones=None):
    """The words of a text as they are compared: lower case, letters only, numbers spelled out."""
    same_sound = homophones or {}
    english = base_language(language) == "en"
    result = []
    for word in text.split():
        value = unicodedata.normalize("NFKD", word.lower())
        if english:
            # Dropped g ("lookin'") and "what're" are the same spoken words as their full forms.
            value = re.sub(r"in['’](?=[.!?,]*$)", "ing", value)
            value = re.sub(r"what['’]re", "whatare", value)
        if re.fullmatch(r"\d+[.!?,]?", value):
            value = spell_number(re.sub(r"\D", "", value), language)
        letters = "".join(ch for ch in value if ch.isalpha() and not unicodedata.combining(ch))
        result.append(same_sound.get(letters, letters))
    return result


def proportional(text, duration):
    """Fallback timings: every authored word, in order, spread over the recording by its length."""
    words = text.split()
    total = sum(len(word) for word in words) or 1
    at = 0.0
    result = []
    for word in words:
        end = at + duration * len(word) / total
        result.append({"word": word, "start": at, "end": min(duration, end)})
        at = end
    return result


def mismatch(expected, transcript, language="en", homophones=None):
    """Word error rate of a transcript against the authored text; any difference is a mismatch."""
    english = base_language(language) == "en"

    def compared(text):
        text = re.sub(r"[-‐‑–—]", " ", text)
        if english:
            text = re.sub(r"\bwhat['’]re\b", "what are", text, flags=re.IGNORECASE)
        return [word for word in normalized_words(text, language, homophones) if word]

    wanted = compared(expected)
    heard = compared(transcript)
    row = list(range(len(heard) + 1))
    for i, a in enumerate(wanted, 1):
        next_row = [i]
        for j, b in enumerate(heard, 1):
            next_row.append(min(next_row[-1] + 1, row[j] + 1, row[j - 1] + (a != b)))
        row = next_row
    error = row[-1] / max(1, len(wanted))
    return {"mismatch": error > 0, "wordErrorRate": error, "transcript": transcript}


def check():
    missing = [name for name in REQUIRED if importlib.util.find_spec(name) is None]
    return {"available": not missing, "missing": missing, "tool": TOOL}


def process(items, homophones):
    import soundfile
    import torch
    import torchaudio
    from faster_whisper import WhisperModel

    torch.set_num_threads(4)
    bundle = torchaudio.pipelines.MMS_FA
    model = tokenizer = aligner = None
    model_error = None
    try:
        model = bundle.get_model().eval()
        tokenizer = bundle.get_tokenizer()
        aligner = bundle.get_aligner()
    except Exception as exc:  # the model could not be fetched or loaded
        model_error = f"alignment model unavailable: {exc}"
    recognisers = {}

    def recogniser(language):
        name, revision = WHISPER_ENGLISH if base_language(language) == "en" else WHISPER_ANY
        if name not in recognisers:
            recognisers[name] = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=4, **({"revision": revision} if revision else {}))
        return recognisers[name]

    results = []
    for item in items:
        language = item.get("language") or "en"
        same_sound = (homophones or {}).get(language) or (homophones or {}).get(base_language(language)) or {}
        samples, rate = soundfile.read(item["file"], dtype="float32", always_2d=True)
        waveform = torch.from_numpy(samples.mean(axis=1)).reshape(1, -1)
        waveform = torchaudio.functional.resample(waveform, rate, bundle.sample_rate)
        duration = len(samples) / rate
        result = {"alignment": "forced", "duration": duration}
        try:
            if model_error:
                raise RuntimeError(model_error)
            words = item["text"].split()
            tokens = normalized_words(item["text"], language, same_sound)
            if not all(tokens) or any(re.search(r"[^a-z]", token) for token in tokens):
                raise ValueError("a word has letters the alignment model does not know (it reads Latin letters a-z)")
            with torch.inference_mode():
                emission, _ = model(waveform)
                spans = aligner(emission[0], tokenizer(tokens))
            ratio = waveform.size(1) / emission.size(1) / bundle.sample_rate
            result["words"] = [{"word": word, "start": spans[i][0].start * ratio, "end": min(duration, spans[i][-1].end * ratio)} for i, word in enumerate(words)]
            end = 0
            for word in result["words"]:
                if not (end <= word["start"] < word["end"] <= duration):
                    raise ValueError("the alignment is out of order or outside the recording")
                end = word["end"]
        except Exception as exc:
            result.update(alignment="proportional", alignmentError=str(exc), words=proportional(item["text"], duration))
        segments, _ = recogniser(language).transcribe(item["file"], language=base_language(language), beam_size=5, vad_filter=False)
        result.update(mismatch(item["text"], " ".join(segment.text.strip() for segment in segments).strip(), language, same_sound))
        results.append(result)
    return results


def main(argv):
    if "--check" in argv:
        json.dump(check(), sys.stdout)
        return 0
    request = json.load(sys.stdin)
    state = check()
    if not state["available"]:
        print(f"missing Python packages: {', '.join(state['missing'])}", file=sys.stderr)
        return 3
    json.dump({"results": process(request.get("items", []), request.get("homophones", {}))}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
