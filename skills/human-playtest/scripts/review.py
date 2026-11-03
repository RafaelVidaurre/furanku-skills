#!/usr/bin/env python3
"""Inspect and correlate playtest evidence without changing source media."""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
from datetime import datetime, timezone


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    temporary.replace(path)


def session_path(session, value):
    """Evidence references must remain within the selected session."""
    path = (session / value).resolve()

    if not path.is_relative_to(session.resolve()):
        raise ValueError(f"Evidence path escapes session: {value}")

    return path


def media_path(session):
    manifest_path = session / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    value = manifest.get("media", {}).get("video", "screen.mov")
    path = session_path(session, value)

    if not path.is_file():
        raise ValueError(f"Finalized movie is unavailable: {path}; leave active capture running.")

    return path


def require_finished_session(session):
    manifest_path = session / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    final_path = session / "native-final.json"

    if final_path.is_file():
        final = json.loads(final_path.read_text())
        expected_pid = (manifest.get("process") or {}).get("pid")

        if expected_pid is not None and final.get("pid") != expected_pid:
            raise ValueError("Native final receipt belongs to a different capture process.")

        if final.get("state") not in {"stopped", "failed"}:
            raise ValueError("Native final receipt does not confirm that recording ended.")

        return

    state = manifest.get("state")

    if state in {"starting", "recording", "running", "capturing", "stopping", "finalizing"}:
        raise ValueError(f"Session state is {state}; leave active capture running and finalize before media review.")

    if (session / "native-status.json").exists():
        raise ValueError("Native recording has no final receipt; finalize before media review.")


def run_tool(command, timeout=120):
    if shutil.which(command[0]) is None:
        raise RuntimeError(f"Required tool unavailable: {command[0]}; no substitute was run.")

    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)

    if result.returncode or result.stderr.strip():
        raise RuntimeError(f"{command[0]} failed ({result.returncode}): {result.stderr.strip()}")

    return result.stdout


def number(value):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None

    return result if math.isfinite(result) else None


def packet_coverage(packets, *, video_start, video_end, declared_start=None, tolerance=0.05):
    """Report timestamp coverage only; quiet samples still count as audio."""
    spans = []
    unknown_duration = 0

    for packet in packets:
        start = number(packet.get("pts_time"))
        duration = number(packet.get("duration_time"))

        if start is None:
            continue

        if duration is None or duration < 0:
            unknown_duration += 1
            continue

        spans.append((start, start + duration))

    spans.sort()

    if not spans:
        return {
            "status": "no_timed_packets",
            "timed_unit_count": 0,
            "unknown_duration_unit_count": unknown_duration,
            "gaps": [],
            "signal_analysis_performed": False,
        }

    first, covered_end = spans[0]
    gaps = []

    for start, end in spans[1:]:
        if start - covered_end > tolerance:
            gaps.append({"start": covered_end - video_start, "end": start - video_start,
                         "duration": start - covered_end})

        covered_end = max(covered_end, end)

    effective_start = max(first, declared_start) if declared_start is not None else first
    leading = max(0.0, effective_start - video_start)
    tail = None if video_end is None else max(0.0, video_end - covered_end)

    return {
        "status": "packet_timestamps_present",
        "timed_unit_count": len(spans),
        "unknown_duration_unit_count": unknown_duration,
        "first_pts_seconds": first,
        "effective_start_seconds": effective_start,
        "last_end_seconds": covered_end,
        "leading_uncovered_seconds": leading if leading > tolerance else 0.0,
        "trailing_uncovered_seconds": tail if tail is None or tail > tolerance else 0.0,
        "gaps": gaps,
        "gap_tolerance_seconds": tolerance,
        "signal_analysis_performed": False,
        "interpretation": "Packet absence is distinct from silence, mic audibility, and speaker identity.",
    }


def inspect_media(path):
    metadata = json.loads(run_tool([
        "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path),
    ]))
    streams = metadata.get("streams", [])
    videos = [stream for stream in streams if stream.get("codec_type") == "video"]

    if not videos:
        raise ValueError("No video stream found; this is not a verified window/display recording.")

    video = videos[0]
    origin = number(video.get("start_time"))

    if origin is None:
        raise ValueError("Video stream has no start timestamp; automatic media alignment is unavailable.")

    duration = number(video.get("duration"))
    end = origin + duration if duration is not None else None
    packets = json.loads(run_tool([
        "ffprobe", "-v", "error", "-select_streams", "a", "-show_packets",
        "-show_entries", "packet=stream_index,pts_time,duration_time", "-of", "json", str(path),
    ])).get("packets", [])
    decoded = json.loads(run_tool([
        "ffprobe", "-v", "error", "-select_streams", "a", "-show_frames",
        "-show_entries", "frame=stream_index,pts_time,nb_samples", "-of", "json", str(path),
    ])).get("frames", [])
    audio = []

    for stream in streams:
        if stream.get("codec_type") != "audio":
            continue

        selected = [packet for packet in packets if packet.get("stream_index") == stream["index"]]
        sample_rate = number(stream.get("sample_rate"))
        frame_spans = []

        for frame in decoded:
            if frame.get("stream_index") != stream["index"]:
                continue

            samples = number(frame.get("nb_samples"))
            frame_spans.append({"pts_time": frame.get("pts_time"),
                                "duration_time": samples / sample_rate if samples is not None and sample_rate else None})

        coverage = packet_coverage(frame_spans, video_start=origin, video_end=end,
                                   declared_start=number(stream.get("start_time")))
        coverage["basis"] = "decoded_audio_frame_pts_and_sample_count"
        coverage["interpretation"] = "Decoded sample absence is distinct from silence. Packet durations alone may stretch across missing samples in MOV; decoded nb_samples/sample_rate detects that case."
        audio.append({
            "stream": stream,
            "coverage": coverage,
            "packet_coverage": packet_coverage(selected, video_start=origin, video_end=end,
                                               declared_start=number(stream.get("start_time"))),
        })

    return {
        "version": 1,
        "inspected_at": utc_now(),
        "source": str(path),
        "source_bytes": path.stat().st_size,
        "video": video,
        "video_origin_pts_seconds": origin,
        "video_duration_seconds": duration,
        "audio_streams": audio,
        "microphone_track_verified": False,
        "audio_stream_presence": "present" if audio else "absent",
        "format": metadata.get("format", {}),
        "limits": [
            "Stream and packet inspection does not verify audible speech, microphone provenance, or window-only content.",
            "Times in coverage gaps are relative to the first video stream start; native AV timestamps remain in stream metadata.",
            "Audio frames are decoded for sample coverage; video is not fully decoded and no acoustic latency calibration or speaker attribution is claimed.",
            "MOV packet duration can span a missing-audio gap; coverage uses decoded frame sample counts while packet_coverage retains the container timestamps for comparison.",
        ],
    }


def frame_records(session):
    index = session / "frames" / "index.jsonl"

    if not index.is_file():
        raise ValueError(f"Frame index unavailable: {index}")

    rows = []

    for line_number, line in enumerate(index.read_text().splitlines(), 1):
        if not line.strip():
            continue

        row = json.loads(line)
        time_key = "source_media_seconds" if row.get("source_media_seconds") is not None else "media_seconds"
        timestamp = number(row.get(time_key))

        if timestamp is None:
            raise ValueError(f"Frame index line {line_number} lacks a finite media timestamp.")

        path = session_path(session, row["file"])

        if not path.is_file():
            raise ValueError(f"Indexed frame is missing: {path}")

        rows.append({**row, "resolved_path": str(path), "correlation_seconds": timestamp,
                     "correlation_time_field": time_key})

    return rows


def select_frames(session, requested, *, count=3, radius=2.0):
    if count < 1 or radius < 0 or not math.isfinite(requested):
        raise ValueError("Use a positive count, nonnegative radius, and finite media time.")

    rows = sorted(frame_records(session), key=lambda row: abs(row["correlation_seconds"] - requested))
    chosen = []

    for row in rows[:count]:
        delta = row["correlation_seconds"] - requested
        chosen.append({**row, "delta_seconds": delta, "within_requested_radius": abs(delta) <= radius})

    return {
        "requested_media_seconds": requested,
        "radius_seconds": radius,
        "frames": chosen,
        "uncertainty": "Native sample times are normalized to the first video sample, not transcript receipt time. Final movie/sample epoch alignment must be verified; nearest frame is not exact speech synchronization.",
    }


def sha256(path):
    digest = hashlib.sha256()

    with path.open("rb") as source:
        for block in iter(lambda: source.read(8 * 1024 * 1024), b""):
            digest.update(block)

    return digest.hexdigest()


def seal(session, extra_paths, lock):
    session = session.resolve()
    require_finished_session(session)
    paths = {media_path(session)}

    if (session / "frames" / "index.jsonl").is_file():
        paths.add(session / "frames" / "index.jsonl")
        paths.update(Path(row["resolved_path"]) for row in frame_records(session))

    for value in extra_paths:
        path = session_path(session, value)

        if not path.is_file():
            raise ValueError(f"Evidence file unavailable: {path}")

        paths.add(path)

    records = []

    for path in sorted(paths):
        record = {"file": str(path.relative_to(session)), "bytes": path.stat().st_size,
                  "sha256": sha256(path)}

        if lock:
            path.chmod(stat.S_IMODE(path.stat().st_mode) & ~0o222)

        records.append(record)

    manifest = {"version": 1, "sealed_at": utc_now(), "write_bits_removed": lock, "files": records}
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    destination = session / "review" / f"evidence-manifest-{stamp}.json"
    write_json(destination, manifest)
    return {"manifest": str(destination), "files": len(records), "write_bits_removed": lock}


def transcribe(session, model_path, output, language, threads):
    session = session.resolve()
    require_finished_session(session)
    model_path = model_path.expanduser().resolve()

    if not model_path.is_dir():
        raise ValueError("--model-path must be an existing local faster-whisper model directory; no download is permitted.")

    try:
        from faster_whisper import WhisperModel
    except ImportError as error:
        raise RuntimeError("Installed faster_whisper is required; no package installation or substitute was attempted.") from error

    media = media_path(session)
    report = inspect_media(media)

    if len(report["audio_streams"]) != 1:
        raise ValueError("Automatic transcription requires exactly one audio stream; inspect and select the intended source explicitly outside this helper.")

    destination = session_path(session, output)
    destination.mkdir(parents=True, exist_ok=False)
    status_path = destination / "status.json"
    write_json(status_path, {"state": "running", "started_at": utc_now()})

    try:
        origin = report["video_origin_pts_seconds"]
        wav = destination / "audio-media-timeline.wav"
        run_tool([
            "ffmpeg", "-nostdin", "-v", "error", "-copyts", "-i", str(media),
            "-map", "0:a:0", "-vn", "-af",
            f"asetpts=PTS-({origin})/TB,aresample=16000:async=1:first_pts=0",
            "-ac", "1", "-c:a", "pcm_s16le", str(wav),
        ], timeout=300)
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        model = WhisperModel(str(model_path), device="cpu", compute_type="int8",
                             cpu_threads=threads, local_files_only=True)
        segments, info = model.transcribe(str(wav), language=language, word_timestamps=True,
                                          vad_filter=True, condition_on_previous_text=False)
        provenance = {
            "tool": "faster_whisper", "version": importlib.metadata.version("faster-whisper"),
            "model_path": str(model_path), "local_files_only": True, "uploads": False,
            "source_media": str(media.relative_to(session)), "source_sha256": sha256(media),
            "video_origin_pts_seconds": origin, "audio_coverage": report["audio_streams"][0]["coverage"],
            "timestamp_basis": "Movie-relative seconds; source PTS preserved, video origin subtracted, leading/internal missing audio padded in derivative. No absent tail invented.",
            "transcription_kind": "machine_asr_unverified", "speaker": "unknown",
            "settings": {"language": language, "threads": threads, "compute_type": "int8",
                         "word_timestamps": True, "vad_filter": True, "condition_on_previous_text": False},
            "language_detected": info.language, "language_probability": info.language_probability,
            "uncertainty": "Model words and timings may be wrong. Speaker identity, completeness of every utterance, and verbatim accuracy require review.",
        }
        write_json(destination / "provenance.json", provenance)
        count = 0

        with (destination / "raw-asr.jsonl").open("x", buffering=1) as raw, \
                (destination / "transcript.jsonl").open("x", buffering=1) as normalized:
            for segment in segments:
                raw_record = dataclasses.asdict(segment)
                raw.write(json.dumps(raw_record, ensure_ascii=False) + "\n")
                record = {
                    "id": segment.id, "media_start": segment.start, "media_end": segment.end,
                    "text": segment.text, "speaker": "unknown", "attribution": "unverified",
                    "transcription_kind": "machine_asr_unverified", "words": raw_record.get("words", []),
                    "raw_source": "raw-asr.jsonl", "uncertainty": ["ASR words and speaker attribution are unverified."],
                }
                normalized.write(json.dumps(record, ensure_ascii=False) + "\n")
                count += 1

        write_json(status_path, {"state": "complete", "completed_at": utc_now(), "segments": count,
                                 "raw_sha256": sha256(destination / "raw-asr.jsonl")})
    except Exception as error:
        write_json(status_path, {"state": "failed", "failed_at": utc_now(), "error": str(error),
                                 "partial_outputs_preserved": True})
        raise

    return {"output": str(destination), "segments": count, "kind": "machine_asr_unverified"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    for name in ("inspect", "frames", "seal", "transcribe"):
        command = commands.add_parser(name)
        command.add_argument("session", type=Path)

        if name == "frames":
            command.add_argument("--time", type=float, required=True)
            command.add_argument("--count", type=int, default=3)
            command.add_argument("--radius", type=float, default=2.0)
        elif name == "seal":
            command.add_argument("--lock", action="store_true")
            command.add_argument("--path", action="append", default=[])
        elif name == "transcribe":
            command.add_argument("--model-path", type=Path, required=True)
            command.add_argument("--output", default="review/transcription")
            command.add_argument("--language", default=None)
            command.add_argument("--threads", type=int, default=4)

    args = parser.parse_args()
    session = args.session.resolve()

    try:
        if not session.is_dir():
            raise ValueError(f"Session directory unavailable: {session}")

        if args.command == "inspect":
            require_finished_session(session)
            result = inspect_media(media_path(session))
            write_json(session / "review" / "media-report.json", result)
        elif args.command == "frames":
            result = select_frames(session, args.time, count=args.count, radius=args.radius)
        elif args.command == "seal":
            result = seal(session, args.path, args.lock)
        else:
            if args.threads < 1:
                raise ValueError("--threads must be positive.")
            result = transcribe(session, args.model_path, args.output, args.language, args.threads)

        print(json.dumps(result, indent=2, ensure_ascii=False))
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        print(f"review: {error}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
