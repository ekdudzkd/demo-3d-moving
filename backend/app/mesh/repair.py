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

from app.export.glb import write_glb
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
    # 연결성은 위치만으로 병합한 사본에서 판단한다. 텍스처 메시는 UV 섬마다 정점이 나뉘어 있어
    # 그대로 split하면 UV 섬을 작은 조각으로 보고 지운다 (D-014와 같은 이유)
    merged = m.copy()
    merged.merge_vertices(merge_tex=True, merge_norm=True)
    labels = trimesh.graph.connected_component_labels(
        merged.face_adjacency, node_count=len(merged.faces)
    )
    sizes = np.bincount(labels)
    if len(sizes) <= 1:
        return m
    keep = (sizes >= SMALL_COMPONENT_RATIO * len(labels)) | (
        np.arange(len(sizes)) == sizes.argmax()
    )
    m.update_faces(keep[labels])
    m.remove_unreferenced_vertices()
    return m


def fix_normals(m: trimesh.Trimesh, _: int) -> trimesh.Trimesh:
    trimesh.repair.fix_normals(m, multibody=True)
    return m


def fill_small_holes(m: trimesh.Trimesh, _: int) -> trimesh.Trimesh:
    # trimesh는 삼각형·사각형 크기의 작은 구멍만 채운다. 큰 구멍은 보정 대상이 아님.
    # 텍스처 메시는 UV 이음새가 열린 경계로 보여 가짜 면이 생기고, 새 면에 UV도 줄 수 없어 건너뛴다
    if _has_texture(m):
        return m
    trimesh.repair.fill_holes(m)
    return m


def decimate(m: trimesh.Trimesh, budget: int) -> trimesh.Trimesh:
    if len(m.faces) <= budget:
        return m
    if _has_texture(m):
        # quadric 감소는 UV를 보존하지 못한다. 텍스처를 정점 색으로 옮겨 색은 유지한다.
        # TripoSR 베이크는 감소 후에 굽기 때문에 보통 여기까지 오지 않는다 (D-023)
        m.visual = m.visual.to_color()
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


def _has_texture(m: trimesh.Trimesh) -> bool:
    v = m.visual
    if v is None or v.kind != "texture" or getattr(v, "uv", None) is None:
        return False
    material = getattr(v, "material", None)
    return material is not None and (
        getattr(material, "image", None) is not None
        or getattr(material, "baseColorTexture", None) is not None
    )


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
    # quadric 감소가 얇은 연결부를 끊어 작은 조각을 만들 수 있다 (3-6 스파이크에서 1→4조각)
    Step("remove_small_components_after_decimate", remove_small_components, may_drop_faces=True),
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
    # 텍스처는 PLY에 담을 수 없어 GLB로, 정점 색은 GLB로 다시 읽으면 trimesh가 COLOR_0을 버려서 PLY로 (D-019)
    if _has_texture(repaired):
        repaired_path = out_dir / "repaired.glb"
        write_glb(repaired, repaired_path)
    else:
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
