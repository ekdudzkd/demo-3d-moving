"""4-3: 유형별 픽스처 메시가 기대한 실패 유형으로 분류되는지."""

import numpy as np
import pytest
import trimesh

from app.export.collider import build_collider
from app.mesh.repair import TARGET_SIZE
from app.report.failures import classify, mask_signals
from app.report.silhouette import silhouette_scores
from mesh_ready_check import Thresholds, inspect_mesh

BUDGET = 50_000


def inspect(mesh):
    return inspect_mesh(mesh, Thresholds(face_budget=BUDGET, target_size=TARGET_SIZE)).to_dict()


def placed(mesh, color=True):
    """1m 크기, 원점 중앙·바닥 정렬, 정점 색 — 문제가 없는 기준 상태."""
    m = mesh.copy()
    m.apply_scale(TARGET_SIZE / m.extents.max())
    lo, hi = m.bounds
    m.apply_translation([-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2])
    if color:
        m.visual = trimesh.visual.ColorVisuals(m, vertex_colors=[200, 80, 60, 255])
    return m


def types(mesh, signals=None, collider=None):
    r = inspect(mesh)
    found = classify(r, r, collider if collider is not None else build_collider(mesh), signals)
    return {f["type"] for f in found}


def disk_mask(size=256):
    yy, xx = np.mgrid[0:size, 0:size]
    return (xx - size / 2) ** 2 + (yy - size / 2) ** 2 <= (size * 0.4) ** 2


def body():
    return trimesh.creation.icosphere(subdivisions=3)


def test_clean_mesh_has_no_failure():
    assert types(placed(body())) == set()


def test_floating_component():
    chip = trimesh.creation.box(extents=(0.05, 0.05, 0.05))
    chip.apply_translation([2, 0, 0])
    assert "FLOATING_COMPONENT" in types(placed(trimesh.util.concatenate([body(), chip])))


def test_collapsed_back():
    plate = trimesh.creation.box(extents=(1.0, 1.0, 0.01))
    assert "COLLAPSED_BACK" in types(placed(plate))


def test_too_many_faces():
    dense = trimesh.creation.icosphere(subdivisions=7)  # 327k 면
    assert len(dense.faces) > BUDGET
    assert "TOO_MANY_FACES" in types(placed(dense))


def test_wrong_scale():
    big = placed(body())
    big.apply_scale(10)
    lo = big.bounds[0]
    big.apply_translation([0, -lo[1], 0])
    assert "WRONG_SCALE" in types(big)


def test_invalid_origin():
    off = placed(body())
    off.apply_translation([3, 2, 0])
    assert "INVALID_ORIGIN" in types(off)


def test_non_manifold():
    # 모든 면의 한 모서리에 지느러미 면을 붙여 모서리 하나를 세 면이 공유하게 한다
    m = body()
    a, b = m.faces[:, 0], m.faces[:, 1]
    tips = m.vertices[m.faces].mean(axis=1) + m.face_normals * 0.3
    v = np.vstack([m.vertices, tips])
    fins = np.column_stack([a, b, len(m.vertices) + np.arange(len(m.faces))])
    finned = trimesh.Trimesh(v, np.vstack([m.faces, fins]), process=False)
    assert "NON_MANIFOLD" in types(placed(finned))


def test_broken_texture_without_color():
    assert "BROKEN_TEXTURE" in types(placed(body(), color=False))


def test_missing_part_from_silhouette():
    # 입력은 원인데 메시는 위쪽 절반만 있음
    half = placed(body())
    half = half.slice_plane([0, 0.5, 0], [0, 1, 0], cap=True)
    sil = silhouette_scores(half, disk_mask())
    assert sil["recall"] < 0.85
    assert "MISSING_PART" in types(half, {"silhouette": sil})
    full = silhouette_scores(placed(body()), disk_mask())
    assert full["recall"] > 0.9
    assert "MISSING_PART" not in types(placed(body()), {"silhouette": full})


@pytest.mark.parametrize(
    "mask,leak",
    [
        (np.pad(np.ones((60, 60), bool), 20), False),  # 가운데 물체
        (np.ones((100, 100), bool), True),  # 종이 전체
        (np.pad(np.ones((90, 100), bool), ((10, 0), (0, 0))), True),  # 테두리 3변
    ],
)
def test_background_leak_from_mask(mask, leak):
    signals = mask_signals(mask)
    assert ("BACKGROUND_LEAK" in types(placed(body()), signals)) is leak


def test_collision_failure():
    bad = {"type": "box", "reason": "convex hull 실패"}
    assert "COLLISION_FAILURE" in types(placed(body()), collider=bad)


def test_repair_fixed_types_marked():
    off = placed(body())
    off.apply_translation([3, 2, 0])
    raw = inspect(off)
    repaired = inspect(placed(body()))
    found = {f["type"]: f for f in classify(raw, repaired, None)}
    assert found["INVALID_ORIGIN"]["fixed_by_repair"]
