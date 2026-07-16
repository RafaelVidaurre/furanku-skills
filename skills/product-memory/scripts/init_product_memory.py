#!/usr/bin/env python3
"""Initialize product-memory templates without overwriting project files."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--path", type=Path, default=Path("docs/product-memory"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    root = args.root.expanduser().resolve()
    destination = root / args.path
    source = Path(__file__).resolve().parent.parent / "assets" / "product-memory"

    if not root.is_dir():
        parser.error(f"repository root does not exist: {root}")
    if not source.is_dir():
        parser.error(f"skill templates are missing: {source}")

    created = 0
    skipped = 0
    for template in sorted(source.rglob("*")):
        relative = template.relative_to(source)
        target = destination / relative
        if template.is_dir():
            if not args.dry_run:
                target.mkdir(parents=True, exist_ok=True)
            continue
        if target.exists():
            print(f"SKIP {target}")
            skipped += 1
            continue
        print(f"CREATE {target}")
        if not args.dry_run:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(template, target)
        created += 1

    print(f"created={created} skipped={skipped} dry_run={args.dry_run}")
    print("Next: merge the product-memory protocol into the canonical AGENTS.md.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
