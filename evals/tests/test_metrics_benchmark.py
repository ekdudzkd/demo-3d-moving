"""4-2: 지표와 benchmark 스모크 (Mock)."""

import csv
import json

import numpy as np
import pytest
import trimesh

from evals import benchmark, metrics


def disk(size=200, r=60, cx=100, cy=100):
    yy, xx = np.mgrid[0:size, 0:size]
    return (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r


def test_mask_metrics():
    gt = disk()
    assert metrics.mask_iou(gt, gt) == 1.0
    assert metrics.boundary_f1(gt, gt) == 1.0
    assert metrics.background_inclusion(gt, gt) == 0.0
    whole = np.ones_like(gt)
    assert metrics.background_inclusion(whole, gt) > 0.7
    assert metrics.mask_iou(whole, gt) < 0.3
    shifted = disk(cx=130)
    assert metrics.boundary_f1(shifted, gt) < 0.5


def test_silhouette_iou_matches_front_view_only():
    # 정면이 원인 납작한 원기둥(z 방향 두께) → 원 마스크와 높고, 정사각형 마스크와 낮아야 한다
    cyl = trimesh.creation.cylinder(radius=0.5, height=0.2, sections=64)  # 축이 z
    circle = disk()
    square = np.zeros((200, 200), bool)
    square[40:160, 40:160] = True
    assert metrics.silhouette_iou(cyl, circle) > 0.9
    assert metrics.silhouette_iou(cyl, square) < 0.85
    # 옆으로 눕히면(축 x) 정면이 직사각형이 되어 원과 맞지 않는다
    side = cyl.copy()
    side.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0]))
    assert metrics.silhouette_iou(side, circle) < 0.5


def test_config_rejects_bad_values(tmp_path):
    bad = tmp_path / "bad.yaml"
    bad.write_text("segmenter: magic\n", encoding="utf-8")
    with pytest.raises(ValueError):
        benchmark.load_config(bad)
    bad.write_text("options: {mc_resolution: 9999}\n", encoding="utf-8")
    with pytest.raises(ValueError):
        benchmark.load_config(bad)


def test_smoke_benchmark_mock(tmp_path, monkeypatch):
    monkeypatch.setattr(benchmark, "RESULTS", tmp_path)
    cfg = benchmark.load_config(benchmark.ROOT / "evals/configs/smoke.yaml")
    out = benchmark.run(cfg, "smoke-test")
    summary = json.loads((out / "summary.json").read_text("utf-8"))
    assert summary["runs"] == 3 and summary["images"] == 3
    assert summary["generation_success_rate"] == 1.0
    assert summary["usable_rate"] == 1.0 and summary["world_load_rate"] == 1.0
    assert summary["silhouette_iou_mean"] > 0.9  # Mock은 실루엣을 그대로 돌출
    rows = list(csv.DictReader((out / "per_image.csv").open(encoding="utf-8")))
    assert [r["status"] for r in rows] == ["COMPLETED"] * 3
    config = json.loads((out / "config.json").read_text("utf-8"))
    assert config["model_info"]["name"] == "mock"
