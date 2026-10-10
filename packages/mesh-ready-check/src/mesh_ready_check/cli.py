"""mesh-ready-check CLI.

exit code: 0 통과 · 1 --fail-on 기준 위반 · 2 파일을 읽을 수 없음
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .inspect import inspect_path
from .report import Report
from .thresholds import Thresholds


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="mesh-ready-check",
        description="AI 생성 메시가 게임·웹 자산으로 쓸 수 있는지 검사합니다.",
    )
    p.add_argument("path", type=Path, help="OBJ / GLB / GLTF / PLY / STL")
    p.add_argument("--budget", type=int, default=Thresholds.face_budget, help="면 수 예산")
    p.add_argument("--target-size", type=float, default=None, help="기대 최대 축 길이")
    p.add_argument(
        "--fail-on",
        choices=["error", "warn", "never"],
        default="error",
        help="이 등급 이상이 있으면 exit 1",
    )
    p.add_argument("--json", dest="json_out", default=None, help="JSON 보고서 경로 ('-'는 stdout)")
    return p


def summarize(report: Report) -> str:
    lines = [
        f"usable: {'YES' if report.is_usable else 'NO'}",
        f"vertices {report.vertex_count} · faces {report.face_count} · "
        f"components {report.connected_components} · non-manifold {report.non_manifold_edges}",
    ]
    for c in report.errors + report.warnings:
        value = "" if c.value is None else f" ({c.value})"
        lines.append(f"  [{c.severity.value.upper()}] {c.code}: {c.message}{value}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    thresholds = Thresholds(face_budget=args.budget, target_size=args.target_size)
    try:
        report = inspect_path(args.path, thresholds)
    except Exception as exc:  # noqa: BLE001 - 어떤 로드 실패든 사용자에게 같은 방식으로 보고
        print(f"메시를 읽을 수 없습니다: {args.path}: {exc}", file=sys.stderr)
        return 2

    if args.json_out == "-":
        print(report.to_json())
    else:
        print(summarize(report))
        if args.json_out:
            Path(args.json_out).write_text(report.to_json(), encoding="utf-8")

    if args.fail_on == "error" and report.errors:
        return 1
    if args.fail_on == "warn" and (report.errors or report.warnings):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
