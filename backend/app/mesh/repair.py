"""메시 자동 보정 (docs/proposal.md §7).

단계마다 전후 지표를 기록하고, 지표가 나빠지면 그 단계만 되돌린다.
원본(raw.obj)은 건드리지 않고 보정본을 따로 저장한다.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import trimesh
from scipy.spatial import cKDTree

from mesh_ready_check import Thresholds, inspect_mesh, load_mesh

from .inspect import inspect_file

TARGET_SIZE = 1.0  # 최대 축 길이 1m
SMALL_COMPONENT_RATIO = 0.02
MAX_FACE_LOSS = 0.5  # 감소 단계 외에 면이 절반 넘게 사라지면 롤백


@dataclass
class Step:
    name: str
    fn: Callable[[trimesh.Trimesh, int], trimesh.Trimesh]
    may_drop_faces: bool = False


def metrics(mesh: trimesh.Trimesh, budget: int) -> dict:
    r = inspect_mesh(mesh, Thresholds(face_budget=budget, target_size=TARGET_SIZE))
    return {
        "vertex_count": r.vertex_count,
        "face_count": r.face_count,
        "connected_components": r.connected_components,
        "small_components": r.small_components,
        "open_boundary_edges": r.open_boundary_edges,
        "non_manifold_edges": r.non_manifold_edges,
        "duplicate_vertices": r.duplicate_vertices,
        "degenerate_faces": r.degenerate_faces,
        "winding_consistent": r.winding_consistent,
        "inverted_normals": r.inverted_normals,
        "centered": r.centered,
        "grounded": r.grounded,
        "extents": r.extents,
        "errors": sorted(c.code for c in r.errors),
        "warnings": sorted(c.code for c in r.warnings),
    }


# ---- 보정 단계 ----------------------------------------------------------------


def merge_vertices(m: trimesh.Trimesh, _: int) -> trimesh.Trimesh:
    m.merge_vertices()
    return m


def remove_degenerate_faces(m: trimesh.Trimesh, _: int) -> trimesh.Trimesh:
    m.update_faces(m.nondegenerate_faces(height=1e-10))
    m.update_faces(m.unique_faces())
    m.remove_unreferenced_vertices()
    return m


def remove_small_components(m: trimesh.Trimesh, _: int) -> trimesh.Trimesh:
    parts = m.split(only_watertight=False)
    if len(parts) <= 1:
        return m
    total = sum(len(p.faces) for p in parts)
    largest = max(parts, key=lambda p: len(p.faces))
    keep = [p for p in parts if p is largest or len(p.faces) >= SMALL_COMPONENT_RATIO * total]
    return trimesh.util.concatenate(keep)


def fix_normals(m: trimesh.Trimesh, _: int) -> trimesh.Trimesh:
    trimesh.repair.fix_normals(m, multibody=True)
    return m


def fill_small_holes(m: trimesh.Trimesh, _: int) -> trimesh.Trimesh:
    # trimesh는 삼각형·사각형 크기의 작은 구멍만 채운다. 큰 구멍은 보정 대상이 아님
    trimesh.repair.fill_holes(m)
    return m


def decimate(m: trimesh.Trimesh, budget: int) -> trimesh.Trimesh:
    if len(m.faces) <= budget:
        return m
    colors = _vertex_colors(m)
    out = m.simplify_quadric_decimation(face_count=budget)
    if colors is not None:
        # 감소 후 정점 색은 원래 메시에서 가장 가까운 정점 색으로 복원
        _, idx = cKDTree(m.vertices).query(out.vertices)
        out.visual = trimesh.visual.ColorVisuals(out, vertex_colors=colors[idx])
    return out


def normalize_scale(m: trimesh.Trimesh, _: int) -> trimesh.Trimesh:
    size = float(m.extents.max())
    if size > 0:
        m.apply_scale(TARGET_SIZE / size)
    return m


def center_and_ground(m: trimesh.Trimesh, _: int) -> trimesh.Trimesh:
    lo, hi = m.bounds
    m.apply_translation([-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2])
    return m


def _vertex_colors(m: trimesh.Trimesh) -> np.ndarray | None:
    if m.visual is not None and m.visual.kind == "vertex":
        return np.asarray(m.visual.vertex_colors).copy()
    return None


STEPS: list[Step] = [
    Step("merge_vertices", merge_vertices),
    Step("remove_degenerate_faces", remove_degenerate_faces),
    Step("remove_small_components", remove_small_components, may_drop_faces=True),
    Step("fix_normals", fix_normals),
    Step("fill_small_holes", fill_small_holes),
    Step("decimate", decimate, may_drop_faces=True),
    Step("normalize_scale", normalize_scale),
    Step("center_and_ground", center_and_ground),
]


def repair_mesh(mesh: trimesh.Trimesh, budget: int, steps: list[Step] | None = None):
    """보정된 메시와 단계 기록을 돌려준다."""
    log = []
    current = mesh.copy()
    before = metrics(current, budget)
    for step in steps or STEPS:
        started = time.perf_counter()
        entry = {"name": step.name, "applied": False, "rolled_back": False, "reason": ""}
        try:
            candidate = step.fn(current.copy(), budget)
            after = metrics(candidate, budget)
            reason = _regression(step, before, after)
        except Exception as exc:  # noqa: BLE001 - 단계 실패는 롤백하고 계속
            candidate, after, reason = None, before, f"{type(exc).__name__}: {exc}"
        if reason:
            entry.update(rolled_back=True, reason=reason, before=before, after=before)
        else:
            entry.update(applied=True, before=before, after=after)
            current, before = candidate, after
        entry["elapsed_ms"] = round((time.perf_counter() - started) * 1000)
        log.append(entry)
    return current, log


def _regression(step: Step, before: dict, after: dict) -> str:
    if after["face_count"] == 0:
        return "면이 모두 사라짐"
    new_errors = set(after["errors"]) - set(before["errors"])
    if new_errors:
        return f"새 오류 발생: {sorted(new_errors)}"
    if step.name != "decimate":
        lost = 1 - after["face_count"] / max(before["face_count"], 1)
        if lost > MAX_FACE_LOSS:
            return f"면 {lost:.0%} 손실"
    return ""


def repair_file(raw_path: Path, out_dir: Path, face_budget: int) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    mesh, _ = load_mesh(raw_path)
    repaired, steps = repair_mesh(mesh, face_budget)
    repaired_path = out_dir / "repaired.ply"
    repaired.export(repaired_path)
    report = inspect_file(repaired_path, face_budget, TARGET_SIZE)
    (out_dir / "repair_steps.json").write_text(
        json.dumps(steps, ensure_ascii=False, indent=2), "utf-8"
    )
    (out_dir / "inspect_repaired.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), "utf-8"
    )
    return {"repaired_path": str(repaired_path), "steps": steps, "inspect_repaired": report}
