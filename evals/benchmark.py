"""평가 실행기: config(YAML)의 분할기·생성기·전처리·seed 조합으로 manifest 이미지를 돌린다.

사용: python evals/benchmark.py --config evals/configs/smoke.yaml [--run-id ID]
결과: evals/generation-results/<run_id>/{config.json, per_image.csv, summary.json}

서버 없이 API·워커가 쓰는 단계 함수를 그대로 호출한다 (업로드 검사 → 분할 → 전처리 → 생성 →
검사 → 보정 → GLB·충돌체). 분할은 사람 수정 없는 자동 제안(빈 프롬프트) 기준.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import statistics
import sys
import time
from datetime import datetime
from pathlib import Path

import numpy as np
import yaml
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))

from app.core.config import Settings  # noqa: E402
from app.export.build import to_glb  # noqa: E402
from app.export.collider import build_collider  # noqa: E402
from app.generation.base import GenerationOptions  # noqa: E402
from app.generation.registry import get_adapter  # noqa: E402
from app.input.validate import load_and_validate  # noqa: E402
from app.mesh.inspect import inspect_file  # noqa: E402
from app.mesh.repair import repair_file  # noqa: E402
from app.preprocess.normalize import PreprocessOptions, normalize  # noqa: E402
from app.report.build import outcome_of  # noqa: E402
from app.report.failures import classify, mask_signals  # noqa: E402
from app.segmentation.base import Prompts  # noqa: E402
from app.segmentation.postprocess import refine_mask  # noqa: E402
from app.segmentation.service import get_segmenter  # noqa: E402
from evals import manifest as mf  # noqa: E402
from evals import metrics  # noqa: E402
from mesh_ready_check import load_mesh  # noqa: E402

RESULTS = ROOT / "evals" / "generation-results"
SEGMENTERS = {"grabcut", "sam2", "gt", "none"}

CSV_COLUMNS = [
    "id", "group", "difficulty", "seed", "status", "error",
    "mask_iou", "boundary_f1", "background_inclusion", "mask_coverage", "segment_ms",
    "generated", "usable", "outcome", "failure_types",
    "raw_faces", "raw_components", "raw_non_manifold",
    "repaired_faces", "repaired_components", "repaired_non_manifold",
    "silhouette_iou", "world_load", "collider_type",
    "generation_ms", "peak_vram_mb", "total_ms",
]  # fmt: skip


def load_config(path: Path) -> dict:
    cfg = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    cfg.setdefault("name", path.stem)
    cfg.setdefault("manifest", "evals/manifest.csv")
    cfg.setdefault("select", {})
    cfg.setdefault("segmenter", "grabcut")
    cfg.setdefault("generator", "mock")
    cfg.setdefault("options", {})
    cfg.setdefault("preprocess", {})
    cfg.setdefault("seeds", [0])
    cfg.setdefault("face_budget", 50_000)
    if cfg["segmenter"] not in SEGMENTERS:
        raise ValueError(f"segmenter는 {sorted(SEGMENTERS)} 중 하나")
    GenerationOptions(**cfg["options"])  # 잘못된 옵션은 시작 전에 실패
    PreprocessOptions(**cfg["preprocess"])
    return cfg


def select_entries(entries: list[mf.Entry], select: dict) -> list[mf.Entry]:
    out = []
    for e in entries:
        if "ids" in select and e.id not in select["ids"]:
            continue
        if "roots" in select and e.root not in select["roots"]:
            continue
        if "groups" in select and e.group not in select["groups"]:
            continue
        out.append(e)
    return out


def run(cfg: dict, run_id: str) -> Path:
    out_dir = RESULTS / run_id
    work = out_dir / "work"
    work.mkdir(parents=True, exist_ok=True)
    settings = Settings(
        _env_file=None,
        data_dir=work,
        segmenter="sam2" if cfg["segmenter"] == "sam2" else "grabcut",
        generator=cfg["generator"],
        face_budget=cfg["face_budget"],
        model_cache_dir=Path(os.environ.get("MODEL_CACHE_DIR", ROOT / "data/models")),
        mock_fail="",
    )
    roots = mf.default_roots()
    # 구조는 전체 행을 보고, 파일은 이번에 돌릴 행만 본다 (안 쓰는 합성 그림이 없어도 실행 가능)
    report = mf.validate(ROOT / cfg["manifest"], roots, check_files=False)
    selected = select_entries(report.entries, cfg["select"])
    for e in selected:
        mf.check_entry_files(e, roots, report)
    if not report.ok:
        raise SystemExit("manifest 오류:\n" + "\n".join(report.errors))
    entries = [e for e in selected if e.path(roots) is not None]
    if not entries:
        raise SystemExit("실행할 이미지가 없습니다 (select·EVAL_DATA_DIR·합성 그림 생성 확인)")

    adapter = get_adapter(cfg["generator"], settings)
    env = adapter.validate_environment()
    if not env.ok:
        raise SystemExit(f"{cfg['generator']} 환경 문제: {env.problems}")
    segmenter = None if cfg["segmenter"] in ("gt", "none") else get_segmenter(settings)
    (out_dir / "config.json").write_text(
        json.dumps(
            {
                "run_id": run_id,
                "config": cfg,
                "model_info": adapter.get_model_info().model_dump(),
                "environment": env.model_dump(),
                "images": [e.id for e in entries],
                "started_at": datetime.now().isoformat(timespec="seconds"),
            },
            ensure_ascii=False,
            indent=2,
        ),
        "utf-8",
    )

    rows = []
    for e in entries:
        for seed in cfg["seeds"]:
            row = run_one(e, seed, cfg, roots, settings, adapter, segmenter, work)
            rows.append(row)
            print(
                f"{e.id:20s} seed={seed} {row['status']:9s} usable={row.get('usable')} "
                f"mask_iou={row.get('mask_iou')} sil_iou={row.get('silhouette_iou')} "
                f"gen={row.get('generation_ms')}ms",
                flush=True,
            )

    with (out_dir / "per_image.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CSV_COLUMNS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in CSV_COLUMNS})
    summary = summarize(rows, cfg, run_id)
    (out_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), "utf-8"
    )
    return out_dir


def run_one(e, seed, cfg, roots, settings, adapter, segmenter, work: Path) -> dict:
    row: dict = {"id": e.id, "group": e.group, "difficulty": e.difficulty, "seed": seed}
    case = work / f"{e.id}-s{seed}"
    started = time.perf_counter()
    try:
        loaded = load_and_validate(e.path(roots).read_bytes(), settings)
        if not loaded.result.is_valid:
            row.update(status="REJECTED", error=",".join(i.code for i in loaded.result.errors))
            return row
        image = np.asarray(loaded.image)
        gt = None
        mpath = e.mask_path(roots)
        if mpath is not None:
            g = Image.open(mpath).convert("L")
            if g.size != loaded.image.size:
                g = g.resize(loaded.image.size, Image.Resampling.NEAREST)
            gt = np.asarray(g) >= 128

        t = time.perf_counter()
        if cfg["segmenter"] == "gt":
            if gt is None:
                row.update(status="SKIPPED", error="gt_mask 없음")
                return row
            mask = gt
        elif cfg["segmenter"] == "none":
            mask = np.ones(image.shape[:2], bool)
        else:
            mask = refine_mask(segmenter.segment(image, Prompts()), Prompts())
        row["segment_ms"] = round((time.perf_counter() - t) * 1000)
        row["mask_coverage"] = round(float(mask.mean()), 4)
        if gt is not None:
            row["mask_iou"] = round(metrics.mask_iou(mask, gt), 4)
            row["boundary_f1"] = round(metrics.boundary_f1(mask, gt), 4)
            row["background_inclusion"] = round(metrics.background_inclusion(mask, gt), 4)

        pre = normalize(image, mask, case / "preprocess", PreprocessOptions(**cfg["preprocess"]))
        result = adapter.generate(
            Path(pre.normalized),
            GenerationOptions(**{**cfg["options"], "seed": seed}),
            case / "generation",
            f"bench-{e.id}-{seed}",
        )
        row["generation_ms"] = result.generation_time_ms
        row["peak_vram_mb"] = result.peak_vram_mb
        raw = inspect_file(Path(result.mesh_path), cfg["face_budget"])
        row.update(
            raw_faces=raw["face_count"],
            raw_components=raw["connected_components"],
            raw_non_manifold=raw["non_manifold_edges"],
            generated=raw["face_count"] > 0,
        )
        if raw["face_count"] == 0:
            row.update(status="FAILED", error="MESH_EMPTY", usable=False)
            return row

        rep = repair_file(Path(result.mesh_path), case / "mesh", cfg["face_budget"])
        repaired = rep["inspect_repaired"]
        row.update(
            repaired_faces=repaired["face_count"],
            repaired_components=repaired["connected_components"],
            repaired_non_manifold=repaired["non_manifold_edges"],
        )
        # 월드 로딩: GLB로 쓰고 다시 읽어 충돌체까지 만들어지는지
        glb = case / "repaired.glb"
        to_glb(Path(rep["repaired_path"]), glb)
        world_mesh, _ = load_mesh(glb)
        collider = build_collider(world_mesh)
        row["world_load"] = len(world_mesh.faces) > 0
        row["collider_type"] = collider["type"]
        alpha = np.asarray(Image.open(pre.normalized))[..., 3] >= 128
        sil = metrics.silhouette_scores(world_mesh, alpha)
        row["silhouette_iou"] = sil["iou"]
        signals = {"silhouette": sil, **mask_signals(mask)}

        outcome = outcome_of(repaired)
        row["outcome"] = outcome.value
        row["usable"] = outcome.value != "NOT_USABLE"
        row["failure_types"] = ";".join(
            f["type"] + ("*" if f["fixed_by_repair"] else "")
            for f in classify(raw, repaired, collider, signals)
        )
        row["status"] = "COMPLETED"
    except Exception as exc:  # noqa: BLE001 — 한 장 실패가 전체 평가를 멈추지 않게
        row.update(status="FAILED", error=f"{type(exc).__name__}: {exc}"[:200], usable=False)
    finally:
        row["total_ms"] = round((time.perf_counter() - started) * 1000)
    return row


def _mean(values) -> float | None:
    vals = [v for v in values if v is not None and v != ""]
    return round(statistics.fmean(vals), 4) if vals else None


def _median(values) -> float | None:
    vals = [v for v in values if v is not None and v != ""]
    return round(statistics.median(vals), 1) if vals else None


def summarize(rows: list[dict], cfg: dict, run_id: str) -> dict:
    n = len(rows)
    done = [r for r in rows if r.get("status") == "COMPLETED"]

    def rate(pred) -> float | None:
        return round(sum(1 for r in rows if pred(r)) / n, 4) if n else None

    by_group = {}
    for g in sorted({r["group"] for r in rows}):
        rs = [r for r in rows if r["group"] == g]
        by_group[g] = {
            "runs": len(rs),
            "usable_rate": round(sum(bool(r.get("usable")) for r in rs) / len(rs), 4),
            "mask_iou_mean": _mean(r.get("mask_iou") for r in rs),
            "silhouette_iou_mean": _mean(r.get("silhouette_iou") for r in rs),
        }
    failure_counts: dict[str, int] = {}
    for r in done:
        for f in filter(None, (r.get("failure_types") or "").split(";")):
            if not f.endswith("*"):  # 보정으로 해결되지 않은 것만 센다
                failure_counts[f] = failure_counts.get(f, 0) + 1
    return {
        "run_id": run_id,
        "name": cfg["name"],
        "segmenter": cfg["segmenter"],
        "generator": cfg["generator"],
        "options": cfg["options"],
        "preprocess": cfg["preprocess"],
        "seeds": cfg["seeds"],
        "runs": n,
        "images": len({r["id"] for r in rows}),
        "rejected": sum(r.get("status") == "REJECTED" for r in rows),
        "generation_success_rate": rate(lambda r: bool(r.get("generated"))),
        "usable_rate": rate(lambda r: bool(r.get("usable"))),
        "world_load_rate": rate(lambda r: bool(r.get("world_load"))),
        "mask_iou_mean": _mean(r.get("mask_iou") for r in rows),
        "boundary_f1_mean": _mean(r.get("boundary_f1") for r in rows),
        "background_inclusion_mean": _mean(r.get("background_inclusion") for r in rows),
        "silhouette_iou_mean": _mean(r.get("silhouette_iou") for r in done),
        "repaired_components_mean": _mean(r.get("repaired_components") for r in done),
        "repaired_non_manifold_mean": _mean(r.get("repaired_non_manifold") for r in done),
        "generation_ms_median": _median(r.get("generation_ms") for r in done),
        "total_ms_median": _median(r.get("total_ms") for r in rows),
        "peak_vram_mb_max": max((r.get("peak_vram_mb") or 0 for r in rows), default=0) or None,
        "unresolved_failures": dict(sorted(failure_counts.items())),
        "by_group": by_group,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--run-id")
    args = ap.parse_args(argv)
    cfg = load_config(Path(args.config))
    run_id = args.run_id or f"{datetime.now():%Y%m%d-%H%M%S}-{cfg['name']}"
    out = run(cfg, run_id)
    summary = json.loads((out / "summary.json").read_text("utf-8"))
    print(json.dumps({k: v for k, v in summary.items() if k != "by_group"}, ensure_ascii=False))
    print(f"결과: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
