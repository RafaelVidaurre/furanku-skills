import io
import os
import subprocess
import sys

import pytest

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)

import check_log_shape as m  # noqa: E402

TS = "2026-09-04T12:03:45.123Z"
GOOD_JSON = (
    '{"ts":"%s","level":"INFO","msg":"request finished","logger":"http.server",'
    '"request_id":"9f2c1a","http.response.status_code":200,"duration_ms":12}\n'
    '{"ts":"2026-09-04T12:03:46.001Z","level":"ERROR","msg":"query failed",'
    '"exception.type":"TimeoutError","exception.stacktrace":"TimeoutError: x\\n    at Pool.acquire",'
    '"password":"***","api_key":null}\n'
) % TS
GOOD_LOGFMT = (
    'ts=%s level=INFO msg="request finished" request_id=9f2c1a http.route=/users/:id duration_ms=12\n'
    "ts=2026-09-04T12:03:46.001Z level=WARN msg=slow severity_number=13 "
    'trace_id=0123456789abcdef0123456789abcdef span_id=0123456789abcdef trace_flags=01 note="a \\"q\\" \\n b"\n'
) % TS


def event(**overrides):
    fields = {"ts": TS, "level": "INFO", "msg": "a"}
    fields.update(overrides)
    import json
    return json.dumps(fields) + "\n"


def run(tmp_path, content, name="x.log", args=(), binary=False):
    path = tmp_path / name
    if binary:
        path.write_bytes(content)
    else:
        path.write_text(content, encoding="utf-8")
    out = io.StringIO()
    code = m.main(["check_log_shape.py", *args, str(path)], out)
    return code, out.getvalue()


def test_valid_json_lines_pass(tmp_path):
    code, out = run(tmp_path, GOOD_JSON)
    assert code == 0, out
    assert out.strip() == "read 2 lines, validated 2 events, 0 failed"


def test_valid_logfmt_passes(tmp_path):
    code, out = run(tmp_path, GOOD_LOGFMT)
    assert code == 0, out


def test_crlf_and_serializer_whitespace_pass(tmp_path):
    content = '{"ts": "%s", "level": "INFO", "msg": "a"}\r\n' % TS
    code, out = run(tmp_path, content)
    assert code == 0, out


def test_free_text_line_fails_with_location(tmp_path):
    code, out = run(tmp_path, GOOD_JSON + "Server listening on :3000\n")
    assert code == 1
    assert "x.log:3: not a json event" in out


def test_missing_required_fields_reported(tmp_path):
    code, out = run(tmp_path, '{"level":"NOTICE","msg":""}\n')
    assert code == 1
    assert "ts missing" in out
    assert "level missing or not one of" in out
    assert "msg missing or empty" in out


@pytest.mark.parametrize("ts", [
    "2026-09-04T12:03:45Z",            # no fraction
    "2026-09-04T12:03:45.12Z",         # two digits
    "2026-09-04T12:03:45.123+00:00",   # offset instead of Z
    "2026-09-04T12:03:45.123-00:00",
    "2026-09-04T12:03:45.123",         # no zone
    "2026-99-99T29:70:80.000Z",        # invalid calendar values
])
def test_bad_timestamps_fail(tmp_path, ts):
    code, out = run(tmp_path, event(ts=ts))
    assert code == 1, out
    assert "ts " in out


def test_nine_digit_fraction_passes(tmp_path):
    code, out = run(tmp_path, event(ts="2026-09-04T12:03:45.123456789Z"))
    assert code == 0, out


def test_empty_file_fails_unless_allowed(tmp_path):
    code, out = run(tmp_path, "")
    assert code == 1
    assert "no log events found" in out
    code, out = run(tmp_path, "", args=["--allow-empty"])
    assert code == 0, out


def test_missing_file_reports_and_fails(tmp_path):
    out = io.StringIO()
    code = m.main(["check_log_shape.py", str(tmp_path / "nope.log")], out)
    assert code == 1
    assert "cannot open" in out.getvalue()


def test_blank_line_counts_in_summary(tmp_path):
    code, out = run(tmp_path, event() + "\n")
    assert code == 1
    assert "x.log:2: blank line" in out
    assert "read 2 lines, validated 1 events, 1 failed" in out


def test_trace_rules(tmp_path):
    zero = "0" * 32
    code, out = run(tmp_path, event(trace_id=zero))
    assert code == 1 and "trace_id" in out
    code, out = run(tmp_path, event(span_id="0123456789abcdef"))
    assert code == 1 and "span_id present without trace_id" in out
    code, out = run(tmp_path, event(trace_id="0123456789abcdef0123456789abcdef"))
    assert code == 0, out
    code, out = run(tmp_path, event(trace_id="ABC"))
    assert code == 1 and "trace_id is not 32 lowercase hex" in out
    code, out = run(tmp_path, event(trace_id="0123456789abcdef0123456789abcdef", trace_flags="1"))
    assert code == 1 and "trace_flags" in out


def test_severity_number_range(tmp_path):
    code, out = run(tmp_path, event(severity_number=9))
    assert code == 0, out
    code, out = run(tmp_path, event(severity_number=21))
    assert code == 1 and "outside the INFO range" in out
    code, out = run(tmp_path, event(severity_number=30))
    assert code == 1 and "1..24" in out


def test_nested_values_and_bad_keys_fail(tmp_path):
    code, out = run(tmp_path, event(auth={"token": "live"}))
    assert code == 1 and "holds a nested value" in out
    code, out = run(tmp_path, event(items=[1, 2]))
    assert code == 1 and "holds a nested value" in out
    code, out = run(tmp_path, event(**{"bad-key": 1}))
    assert code == 1 and "not lowercase dotted snake_case" in out
    code, out = run(tmp_path, event(reqId=1))
    assert code == 1 and "'reqId'" in out


def test_duplicate_keys_fail(tmp_path):
    code, out = run(tmp_path, '{"ts":"%s","level":"ERROR","level":"INFO","msg":"a"}\n' % TS)
    assert code == 1 and "duplicate key 'level'" in out
    code, out = run(tmp_path, "ts=%s level=ERROR level=INFO msg=a\n" % TS)
    assert code == 1 and "duplicate key 'level'" in out


def test_logfmt_grammar(tmp_path):
    code, out = run(tmp_path, 'ts=%s level=INFO msg="bad\\q"\n' % TS)
    assert code == 1 and "invalid escape" in out
    code, out = run(tmp_path, "ts=%s level=INFO msg=a=b\n" % TS)
    assert code == 1 and "unexpected '='" in out
    code, out = run(tmp_path, 'ts=%s level=INFO msg="unterminated\n' % TS)
    assert code == 1 and "unterminated" in out
    code, out = run(tmp_path, "ts=%s   level=INFO  msg=a empty=\n" % TS)
    assert code == 0, out


def test_secret_heuristic(tmp_path):
    code, out = run(tmp_path, event(api_key="sk-live-1"))
    assert code == 1 and "secret-looking key 'api_key'" in out
    code, out = run(tmp_path, event(**{"auth.token": "live"}))
    assert code == 1 and "'auth.token'" in out
    for masked in ("***", "[REDACTED]", "<redacted>", ""):
        code, out = run(tmp_path, event(token=masked))
        assert code == 0, out
    code, out = run(tmp_path, event(public_key="abc", keyboard="qwerty", ssh_key="x"))
    assert code == 0, out


def test_bom_and_invalid_utf8(tmp_path):
    code, out = run(tmp_path, b"\xef\xbb\xbf" + event().encode(), binary=True)
    assert code == 1 and "UTF-8 BOM is not allowed" in out
    code, out = run(tmp_path, event(msg="ok").encode() + b'{"ts":"' + TS.encode() + b'","level":"INFO","msg":"\xff"}\n', binary=True)
    assert code == 1 and "x.log:2: invalid UTF-8" in out


def test_oversized_line(tmp_path):
    code, out = run(tmp_path, event(big="x" * 200), args=["--max-line-bytes", "100"])
    assert code == 1 and "exceeds 100 bytes" in out


def test_multiple_files_one_failing(tmp_path):
    (tmp_path / "good.log").write_text(GOOD_JSON, encoding="utf-8")
    (tmp_path / "bad.log").write_text("plain text\n", encoding="utf-8")
    out = io.StringIO()
    code = m.main(["check_log_shape.py", str(tmp_path / "good.log"), str(tmp_path / "bad.log")], out)
    assert code == 1
    assert "bad.log:1: not a logfmt event" in out.getvalue()
    assert "read 3 lines, validated 3 events, 1 failed" in out.getvalue()


def test_usage_errors(tmp_path):
    out = io.StringIO()
    assert m.main(["check_log_shape.py"], out) == 2
    assert "usage" in out.getvalue()
    assert m.main(["check_log_shape.py", "--bogus", "x"], io.StringIO()) == 2


def test_cli_exit_codes(tmp_path):
    good = tmp_path / "good.log"
    good.write_text(GOOD_JSON, encoding="utf-8")
    bad = tmp_path / "bad.log"
    bad.write_text("nope\n", encoding="utf-8")
    script = os.path.join(HERE, "check_log_shape.py")
    ok = subprocess.run([sys.executable, script, str(good)], capture_output=True, text=True)
    assert ok.returncode == 0, ok.stdout + ok.stderr
    failing = subprocess.run([sys.executable, script, str(bad)], capture_output=True, text=True)
    assert failing.returncode == 1
    assert "bad.log:1:" in failing.stdout
