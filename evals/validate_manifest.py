"""manifest 검증 CLI. 오류가 있으면 exit 1.

사용: python evals/validate_manifest.py [manifest.csv] [--no-files]
  --no-files: 형식만 검사 (파일 존재·체크섬 생략)
EVAL_DATA_DIR가 없으면 eval_data 행은 파일 검사를 건너뛰고 목록만 알린다.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from evals.manifest import MANIFEST, validate  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest", nargs="?", default=str(MANIFEST))
    ap.add_argument("--no-files", action="store_true")
    args = ap.parse_args(argv)

    report = validate(Path(args.manifest), check_files=not args.no_files)
    groups = Counter(e.group for e in report.entries)
    roots = Counter(e.root for e in report.entries)
    print(f"{len(report.entries)}행 · group {dict(sorted(groups.items()))} · root {dict(roots)}")
    for line in report.skipped:
        print(f"  건너뜀 {line}")
    for line in report.errors:
        print(f"  ✗ {line}")
    print("✓ 통과" if report.ok else f"✗ 오류 {len(report.errors)}개")
    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main())
