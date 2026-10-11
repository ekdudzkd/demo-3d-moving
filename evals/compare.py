"""두 benchmark run 비교표(markdown). docs/experiments.md에 그대로 붙인다.

사용: python evals/compare.py <기준 run 폴더> <비교 run 폴더> [--out compare.md]
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

# (summary 키, 표시 이름, 높을수록 좋은가 — None이면 방향 없음)
METRICS = [
    ("runs", "실행 수", None),
    ("rejected", "입력 거부", False),
    ("generation_success_rate", "생성 성공률", True),
    ("usable_rate", "사용 가능률", True),
    ("world_load_rate", "월드 로딩률", True),
    ("mask_iou_mean", "마스크 IoU", True),
    ("boundary_f1_mean", "경계 F1", True),
    ("background_inclusion_mean", "배경 포함률", False),
    ("silhouette_iou_mean", "실루엣 IoU", True),
    ("repaired_components_mean", "보정 후 조각 수", False),
    ("repaired_non_manifold_mean", "보정 후 non-manifold", False),
    ("generation_ms_median", "생성 시간 중앙값(ms)", False),
    ("total_ms_median", "전체 시간 중앙값(ms)", False),
    ("peak_vram_mb_max", "최대 VRAM(MiB)", False),
]
PER_IMAGE = [("usable", "사용"), ("mask_iou", "마스크 IoU"), ("silhouette_iou", "실루엣 IoU")]


def load_run(path: Path) -> tuple[dict, list[dict]]:
    summary = json.loads((path / "summary.json").read_text("utf-8"))
    with (path / "per_image.csv").open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    return summary, rows


def _fmt(v) -> str:
    if v is None or v == "":
        return "-"
    if isinstance(v, bool):
        return "예" if v else "아니오"
    if isinstance(v, float):
        return f"{v:.3f}" if abs(v) < 10 else f"{v:,.0f}"
    if isinstance(v, int):
        return f"{v:,}"
    return str(v)


def _delta(a, b, better_high: bool | None) -> str:
    if not isinstance(a, int | float) or not isinstance(b, int | float):
        return ""
    d = b - a
    if d == 0:
        return "="
    sign = "+" if d > 0 else ""
    if isinstance(d, int) or abs(d) >= 10:
        text = f"{sign}{d:,.0f}"
    else:
        text = f"{sign}{d:.3f}"
    if better_high is None:
        return text
    good = (d > 0) == better_high
    return f"{text} {'✅' if good else '⚠️'}"


def _num(v: str):
    if v in ("", None):
        return None
    if v in ("True", "False"):
        return v == "True"
    try:
        return float(v)
    except ValueError:
        return v


def compare(base: Path, new: Path) -> str:
    sa, ra = load_run(base)
    sb, rb = load_run(new)
    lines = [
        f"| 지표 | 기준 `{sa['run_id']}` | 비교 `{sb['run_id']}` | 변화 |",
        "|---|---|---|---|",
    ]
    for key, label, better in METRICS:
        a, b = sa.get(key), sb.get(key)
        lines.append(f"| {label} | {_fmt(a)} | {_fmt(b)} | {_delta(a, b, better)} |")

    fa, fb = sa.get("unresolved_failures", {}), sb.get("unresolved_failures", {})
    for t in sorted(set(fa) | set(fb)):
        a, b = fa.get(t, 0), fb.get(t, 0)
        lines.append(f"| 미해결 {t} | {a} | {b} | {_delta(a, b, False)} |")

    # 이미지별: 같은 id·seed끼리
    key = lambda r: (r["id"], r["seed"])  # noqa: E731
    ia, ib = {key(r): r for r in ra}, {key(r): r for r in rb}
    lines += [
        "",
        "| 이미지 | seed | " + " | ".join(f"{n} 기준→비교" for _, n in PER_IMAGE) + " |",
        "|---|---|" + "---|" * len(PER_IMAGE),
    ]
    for k in sorted(set(ia) | set(ib)):
        cells = []
        for col, _ in PER_IMAGE:
            a = _num(ia.get(k, {}).get(col, ""))
            b = _num(ib.get(k, {}).get(col, ""))
            mark = ""
            if isinstance(a, float) and isinstance(b, float) and abs(b - a) >= 0.05:
                mark = " ✅" if b > a else " ⚠️"
            elif isinstance(a, bool) and isinstance(b, bool) and a != b:
                mark = " ✅" if b else " ⚠️"
            cells.append(f"{_fmt(a)}→{_fmt(b)}{mark}")
        lines.append(f"| {k[0]} | {k[1]} | " + " | ".join(cells) + " |")

    diff_cfg = {
        k: (sa.get(k), sb.get(k))
        for k in ("segmenter", "generator", "options", "preprocess", "seeds")
        if sa.get(k) != sb.get(k)
    }
    head = "변경 조건: " + (
        ", ".join(f"{k} {a} → {b}" for k, (a, b) in diff_cfg.items()) or "없음 (같은 설정 재실행)"
    )
    return head + "\n\n" + "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("base", type=Path)
    ap.add_argument("new", type=Path)
    ap.add_argument("--out", type=Path)
    args = ap.parse_args(argv)
    md = compare(args.base, args.new)
    if args.out:
        args.out.write_text(md, "utf-8")
    sys.stdout.write(md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
