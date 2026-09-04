#!/usr/bin/env python3
"""Validate log files against the agent-readable log record shape.

Usage: check_log_shape.py [--allow-empty] [--max-line-bytes N] <file> [<file> ...]

Each file is JSON Lines or logfmt, detected from its first event. Every line
must be strict UTF-8, parse in that encoding with unique keys, and carry `ts`
(RFC 3339 UTC, `Z`, >= millisecond precision), `level` (TRACE/DEBUG/INFO/
WARN/ERROR/FATAL) and `msg`. Attribute keys follow the dotted snake_case
grammar and hold scalar values. `trace_id`/`span_id`/`trace_flags` follow the
W3C shapes, `span_id` requires `trace_id`, and secret-looking keys must hold a
masked value. Violations print as `<file>:<line>: <reason>`. Exit 1 when any
line failed or a file has no events, 2 on usage error, 0 otherwise.
"""
import datetime
import json
import re
import sys

LEVELS = ("TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL")
SEVERITY_RANGES = {
    "TRACE": (1, 4), "DEBUG": (5, 8), "INFO": (9, 12),
    "WARN": (13, 16), "ERROR": (17, 20), "FATAL": (21, 24),
}
TS_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3,9})Z$")
TRACE_ID_RE = re.compile(r"^[0-9a-f]{32}$")
SPAN_ID_RE = re.compile(r"^[0-9a-f]{16}$")
TRACE_FLAGS_RE = re.compile(r"^[0-9a-f]{2}$")
KEY_RE = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$")
SECRET_KEYS = frozenset((
    "password", "passwd", "secret", "token", "access_token", "refresh_token",
    "authorization", "cookie", "set_cookie", "api_key", "apikey",
    "secret_key", "private_key", "access_key",
))
MASKED_VALUES = frozenset(("", "[REDACTED]", "<redacted>", "REDACTED"))
CORE_KEYS = ("ts", "level", "msg")
BOM = b"\xef\xbb\xbf"
SCALAR_TYPES = (str, int, float, bool, type(None))
LOGFMT_ESCAPES = {'"': '"', "\\": "\\", "n": "\n", "t": "\t"}


class LineError(Exception):
    pass


def _reject_duplicates(pairs):
    seen = set()
    result = {}
    for key, value in pairs:
        if key in seen:
            raise LineError("duplicate key %r" % key)
        seen.add(key)
        result[key] = value
    return result


def parse_json(line):
    try:
        obj = json.loads(line, object_pairs_hook=_reject_duplicates)
    except LineError:
        raise
    except ValueError:
        raise LineError("not a json event")
    if not isinstance(obj, dict):
        raise LineError("not a json event (top level is not an object)")
    return obj


def _unquote_logfmt(raw, pos):
    """Parse a quoted value starting at raw[pos] == '"'. Return (value, end)."""
    out = []
    i = pos + 1
    n = len(raw)
    while i < n:
        ch = raw[i]
        if ch == "\\":
            if i + 1 >= n or raw[i + 1] not in LOGFMT_ESCAPES:
                raise LineError("not a logfmt event (invalid escape at column %d)" % (i + 1))
            out.append(LOGFMT_ESCAPES[raw[i + 1]])
            i += 2
        elif ch == '"':
            return "".join(out), i + 1
        else:
            out.append(ch)
            i += 1
    raise LineError("not a logfmt event (unterminated quote)")


def parse_logfmt(line):
    fields = {}
    pos = 0
    n = len(line)
    while pos < n:
        if line[pos] == " ":
            pos += 1
            continue
        eq = line.find("=", pos)
        key = line[pos:eq] if eq != -1 else ""
        if eq == -1 or not key or " " in key or '"' in key:
            raise LineError("not a logfmt event (expected key=value at column %d)" % (pos + 1))
        pos = eq + 1
        if pos < n and line[pos] == '"':
            value, pos = _unquote_logfmt(line, pos)
        else:
            end = pos
            while end < n and line[end] not in ' "=':
                end += 1
            value = line[pos:end]
            pos = end
        if pos < n and line[pos] != " ":
            raise LineError("not a logfmt event (unexpected %r at column %d)" % (line[pos], pos + 1))
        if key in fields:
            raise LineError("duplicate key %r" % key)
        fields[key] = value
    return fields


def detect_encoding(line):
    return "json" if line.lstrip().startswith("{") else "logfmt"


def _check_ts(value):
    if not isinstance(value, str):
        return "ts missing or not a string"
    m = TS_RE.match(value)
    if not m:
        return "ts is not RFC 3339 UTC with Z and >= millisecond precision"
    y, mo, d, h, mi, s = (int(m.group(i)) for i in range(1, 7))
    try:
        datetime.datetime(y, mo, d, h, mi, s)
    except ValueError:
        return "ts has an invalid date or time"
    return None


def check_fields(fields, encoding):
    problems = []
    problem = _check_ts(fields.get("ts"))
    if problem:
        problems.append(problem)
    level = fields.get("level")
    if level not in LEVELS:
        problems.append("level missing or not one of %s" % "/".join(LEVELS))
    msg = fields.get("msg")
    if not isinstance(msg, str) or not msg.strip():
        problems.append("msg missing or empty")

    sev = fields.get("severity_number")
    if sev is not None:
        if encoding == "logfmt" and isinstance(sev, str) and sev.isdigit():
            sev = int(sev)
        if not isinstance(sev, int) or isinstance(sev, bool) or not 1 <= sev <= 24:
            problems.append("severity_number is not an integer in 1..24")
        elif level in SEVERITY_RANGES:
            lo, hi = SEVERITY_RANGES[level]
            if not lo <= sev <= hi:
                problems.append("severity_number %d is outside the %s range %d..%d" % (sev, level, lo, hi))

    trace_id = fields.get("trace_id")
    span_id = fields.get("span_id")
    flags = fields.get("trace_flags")
    if trace_id is not None and not (isinstance(trace_id, str) and TRACE_ID_RE.match(trace_id) and set(trace_id) != {"0"}):
        problems.append("trace_id is not 32 lowercase hex chars (non-zero)")
    if span_id is not None:
        if not (isinstance(span_id, str) and SPAN_ID_RE.match(span_id) and set(span_id) != {"0"}):
            problems.append("span_id is not 16 lowercase hex chars (non-zero)")
        if trace_id is None:
            problems.append("span_id present without trace_id")
    if flags is not None and not (isinstance(flags, str) and TRACE_FLAGS_RE.match(flags)):
        problems.append("trace_flags is not 2 lowercase hex chars")

    for key, value in fields.items():
        if not KEY_RE.match(key):
            problems.append("key %r is not lowercase dotted snake_case" % key)
        if not isinstance(value, SCALAR_TYPES):
            problems.append("key %r holds a nested value; flatten with dotted keys" % key)
            continue
        if key.rsplit(".", 1)[-1] in SECRET_KEYS:
            masked = value is None or str(value) in MASKED_VALUES or re.match(r"^\*{3,}$", str(value))
            if not masked:
                problems.append("secret-looking key %r has an unmasked value" % key)
    return problems


def check_file(path, out, allow_empty=False, max_line_bytes=1 << 20):
    """Return (physical_lines, events, failed_lines)."""
    read = events = failed = 0
    encoding = None
    try:
        handle = open(path, "rb")
    except OSError as exc:
        out.write("%s: cannot open: %s\n" % (path, exc.strerror or exc))
        return 0, 0, 1
    with handle:
        for lineno, raw in enumerate(handle, 1):
            read += 1
            if lineno == 1 and raw.startswith(BOM):
                out.write("%s:1: UTF-8 BOM is not allowed\n" % path)
                failed += 1
                raw = raw[len(BOM):]
            if len(raw) > max_line_bytes:
                out.write("%s:%d: line exceeds %d bytes\n" % (path, lineno, max_line_bytes))
                failed += 1
                continue
            try:
                line = raw.decode("utf-8").rstrip("\r\n")
            except UnicodeDecodeError as exc:
                out.write("%s:%d: invalid UTF-8 at byte %d\n" % (path, lineno, exc.start))
                failed += 1
                continue
            if not line.strip():
                out.write("%s:%d: blank line\n" % (path, lineno))
                failed += 1
                continue
            events += 1
            if encoding is None:
                encoding = detect_encoding(line)
            try:
                fields = parse_json(line) if encoding == "json" else parse_logfmt(line)
            except LineError as exc:
                out.write("%s:%d: %s\n" % (path, lineno, exc))
                failed += 1
                continue
            problems = check_fields(fields, encoding)
            if problems:
                failed += 1
                for problem in problems:
                    out.write("%s:%d: %s\n" % (path, lineno, problem))
    if events == 0 and not allow_empty:
        out.write("%s: no log events found\n" % path)
        failed += 1
    return read, events, failed


def parse_args(argv):
    allow_empty = False
    max_line_bytes = 1 << 20
    paths = []
    args = list(argv[1:])
    while args:
        arg = args.pop(0)
        if arg == "--allow-empty":
            allow_empty = True
        elif arg == "--max-line-bytes":
            if not args or not args[0].isdigit():
                return None
            max_line_bytes = int(args.pop(0))
        elif arg.startswith("-") and arg != "-":
            return None
        else:
            paths.append(arg)
    if not paths:
        return None
    return allow_empty, max_line_bytes, paths


def main(argv, out=sys.stdout):
    parsed = parse_args(argv)
    if parsed is None:
        out.write("usage: check_log_shape.py [--allow-empty] [--max-line-bytes N] <file> [<file> ...]\n")
        return 2
    allow_empty, max_line_bytes, paths = parsed
    total = [0, 0, 0]
    for path in paths:
        counts = check_file(path, out, allow_empty, max_line_bytes)
        total = [a + b for a, b in zip(total, counts)]
    out.write("read %d lines, validated %d events, %d failed\n" % tuple(total))
    return 1 if total[2] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
