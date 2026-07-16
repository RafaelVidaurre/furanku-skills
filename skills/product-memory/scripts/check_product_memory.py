#!/usr/bin/env python3
"""Check basic product-memory structure and stable-ID integrity."""

from __future__ import annotations

import argparse
import re
from collections import defaultdict
from pathlib import Path


ID_PATTERN = r"(?:U|R|D|Q|H|K|X)-\d{3}"
REFERENCE_RE = re.compile(rf"\b({ID_PATTERN})\b")
HEADING_RE = re.compile(rf"^#{{1,6}}\s+({ID_PATTERN})\b")
TABLE_RE = re.compile(rf"^\|\s*({ID_PATTERN})\s*\|")
REQUIRED = (
    "protocol.md",
    "spec.md",
    "decisions.md",
    "discovery.md",
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--path", type=Path, default=Path("docs/product-memory"))
    args = parser.parse_args()

    memory = args.root.expanduser().resolve() / args.path
    errors: list[str] = []
    for name in REQUIRED:
        if not (memory / name).is_file():
            errors.append(f"missing required file: {memory / name}")

    definitions: dict[str, list[str]] = defaultdict(list)
    references: dict[str, list[str]] = defaultdict(list)
    for path in sorted(memory.rglob("*.md")) if memory.is_dir() else []:
        relative = path.relative_to(memory)
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            location = f"{relative}:{line_number}"
            heading = HEADING_RE.match(line)
            table = TABLE_RE.match(line)
            if heading or table:
                definitions[(heading or table).group(1)].append(location)
            for identifier in REFERENCE_RE.findall(line):
                references[identifier].append(location)

    for identifier, locations in sorted(definitions.items()):
        if len(locations) > 1:
            errors.append(f"duplicate definition {identifier}: {', '.join(locations)}")
    for identifier, locations in sorted(references.items()):
        if identifier not in definitions:
            errors.append(f"unknown reference {identifier}: first seen at {locations[0]}")

    if errors:
        for error in errors:
            print(f"ERROR {error}")
        return 1

    print(f"OK definitions={len(definitions)} references={len(references)} path={memory}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
