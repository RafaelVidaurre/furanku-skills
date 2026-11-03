#!/usr/bin/env python3
"""Hermetic review checks using generated media; never opens a real app/mic."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "skills/human-playtest/scripts"))

import review


class TimestampCoverageTests(unittest.TestCase):
    def test_distinguishes_offset_internal_gap_and_missing_tail(self):
        report = review.packet_coverage([
            {"pts_time": "10.25", "duration_time": "0.25"},
            {"pts_time": "10.50", "duration_time": "0.25"},
            {"pts_time": "11.25", "duration_time": "0.25"},
        ], video_start=10, video_end=12, declared_start=10.25)
        self.assertEqual(report["leading_uncovered_seconds"], 0.25)
        self.assertEqual(report["trailing_uncovered_seconds"], 0.5)
        self.assertEqual(report["gaps"], [{"start": 0.75, "end": 1.25, "duration": 0.5}])

    def test_silent_or_overlapping_packets_are_not_missing_audio(self):
        report = review.packet_coverage([
            {"pts_time": "0", "duration_time": "0.5"},
            {"pts_time": "0.49", "duration_time": "0.51"},
        ], video_start=0, video_end=1)
        self.assertEqual(report["status"], "packet_timestamps_present")
        self.assertEqual(report["gaps"], [])
        self.assertEqual(report["trailing_uncovered_seconds"], 0)
        self.assertFalse(report["signal_analysis_performed"])

    def test_missing_packet_duration_is_uncertain_not_fabricated(self):
        report = review.packet_coverage([{ "pts_time": "0" }], video_start=0, video_end=1)
        self.assertEqual(report["status"], "no_timed_packets")
        self.assertEqual(report["unknown_duration_unit_count"], 1)


class FrameCorrelationTests(unittest.TestCase):
    def test_selects_content_time_not_later_write_time_without_changing_frame(self):
        with tempfile.TemporaryDirectory() as directory:
            session = Path(directory)
            frames = session / "frames"
            frames.mkdir()
            (frames / "a.png").write_bytes(b"first controlled fixture")
            (frames / "b.png").write_bytes(b"second controlled fixture")
            rows = [
                {"file": "frames/a.png", "source_media_seconds": 2.0, "media_seconds": 8.0},
                {"file": "frames/b.png", "source_media_seconds": 4.0, "media_seconds": 4.1},
            ]
            (frames / "index.jsonl").write_text("\n".join(json.dumps(row) for row in rows))
            before = (frames / "a.png").read_bytes()
            result = review.select_frames(session, 2.1, count=1, radius=0.2)
            self.assertEqual(result["frames"][0]["file"], "frames/a.png")
            self.assertTrue(result["frames"][0]["within_requested_radius"])
            self.assertEqual(before, (frames / "a.png").read_bytes())
            far = review.select_frames(session, 50, count=1, radius=1)
            self.assertFalse(far["frames"][0]["within_requested_radius"])

    def test_evidence_reference_cannot_escape_session(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "escapes session"):
                review.session_path(Path(directory), "../private.mov")

    def test_active_session_cannot_be_sealed(self):
        with tempfile.TemporaryDirectory() as directory:
            session = Path(directory)
            (session / "manifest.json").write_text(json.dumps({"state": "recording"}))
            with self.assertRaisesRegex(ValueError, "active capture"):
                review.seal(session, [], True)

    def test_matching_final_receipt_supersedes_stale_manifest_recording_state(self):
        with tempfile.TemporaryDirectory() as directory:
            session = Path(directory)
            (session / "manifest.json").write_text(json.dumps({"state": "recording", "process": {"pid": 42}}))
            (session / "native-final.json").write_text(json.dumps({"state": "stopped", "pid": 42}))
            review.require_finished_session(session)
            (session / "native-final.json").write_text(json.dumps({"state": "stopped", "pid": 43}))
            with self.assertRaisesRegex(ValueError, "different capture process"):
                review.require_finished_session(session)


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg/ffprobe required for generated fixtures")
class SyntheticMediaTests(unittest.TestCase):
    def make_media(self, session, *, silent=False, audio=True, gap=False):
        command = ["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=4:d=2"]

        if audio:
            source = "anullsrc=r=48000:cl=mono:d=1.25" if silent else "sine=frequency=440:sample_rate=48000:duration=1.25"
            audio_filter = "aselect='not(between(t,0.5,0.9))'," if gap else ""
            audio_filter += "asetpts=PTS+0.25/TB"
            command += ["-f", "lavfi", "-i", source, "-af", audio_filter, "-c:a", "aac"]

        command += ["-c:v", "mpeg4", "-t", "2", str(session / "screen.mov")]
        subprocess.run(command, check=True, capture_output=True, timeout=30)

    def test_inspects_real_streams_offset_and_tail_without_modifying_source(self):
        with tempfile.TemporaryDirectory() as directory:
            session = Path(directory)
            self.make_media(session)
            movie = session / "screen.mov"
            before = hashlib.sha256(movie.read_bytes()).hexdigest()
            result = review.inspect_media(movie)
            self.assertEqual(result["audio_stream_presence"], "present")
            coverage = result["audio_streams"][0]["coverage"]
            self.assertGreater(coverage["leading_uncovered_seconds"], 0.15)
            self.assertGreater(coverage["trailing_uncovered_seconds"], 0.3)
            self.assertEqual(result["video"]["width"], 64)
            self.assertEqual(before, hashlib.sha256(movie.read_bytes()).hexdigest())
            self.assertFalse(result["microphone_track_verified"])

    def test_silent_audio_track_still_counts_as_present(self):
        with tempfile.TemporaryDirectory() as directory:
            session = Path(directory)
            self.make_media(session, silent=True)
            report = review.inspect_media(session / "screen.mov")
            self.assertEqual(report["audio_stream_presence"], "present")
            self.assertGreater(report["audio_streams"][0]["coverage"]["timed_unit_count"], 0)

    def test_generated_audio_timestamp_gap_is_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            session = Path(directory)
            self.make_media(session, gap=True)
            report = review.inspect_media(session / "screen.mov")
            gaps = report["audio_streams"][0]["coverage"]["gaps"]
            self.assertTrue(gaps)
            self.assertGreater(gaps[0]["duration"], 0.3)
            self.assertEqual(report["audio_streams"][0]["packet_coverage"]["gaps"], [])

    def test_no_audio_stream_reported_explicitly_and_sealing_requires_lock_flag(self):
        with tempfile.TemporaryDirectory() as directory:
            session = Path(directory)
            self.make_media(session, audio=False)
            movie = session / "screen.mov"
            report = review.inspect_media(movie)
            self.assertEqual(report["audio_stream_presence"], "absent")
            self.assertEqual(report["audio_streams"], [])
            initial_mode = movie.stat().st_mode
            result = review.seal(session, [], False)
            self.assertEqual(movie.stat().st_mode, initial_mode)
            self.assertEqual(json.loads(Path(result["manifest"]).read_text())["files"][0]["sha256"], hashlib.sha256(movie.read_bytes()).hexdigest())
            review.seal(session, [], True)
            self.assertEqual(movie.stat().st_mode & 0o222, 0)


if __name__ == "__main__":
    unittest.main()
