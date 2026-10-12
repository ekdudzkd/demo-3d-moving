"""op 리스트 → 행렬 하나 → 메시, 그리고 화면 op를 월드 op로 푸는 결정적 처리 (D-026·D-027).

버전 = (v0 보정 메시, [label, ...사용자 op]). 매번 v0에서 다시 계산해 오차가 쌓이지 않는다.
회전은 90° 배수, scale은 월드 축 기준이라 합성 행렬은 항상 "부호 있는 축 치환 × 대각"이다(shear 없음).
피벗은 bbox 중심이고 계산 뒤 xz 중앙·y=0 바닥에 맞추므로 결과는 피벗과 무관하다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import trimesh

from .basis import screen_to_world
from .ops import (
    AXES,
    MAX_FACTOR,
    MIN_FACTOR,
    InvertLast,
    Mirror,
    Rotate90,
    ScaleAxis,
    ScaleUniform,
    StandUp,
    axis_index,
    inverse,
    linear,
)

MAX_RATIO = 20.0  # 결과 extents 최대/최소 (E11)
UPRIGHT_TOLERANCE = 0.02  # 가장 긴 축 비교 허용 오차
CENTROID_TOLERANCE = 0.02  # stand_up 두 후보의 무게중심 높이 차이 / 높이


def compose(ops: list[dict]) -> np.ndarray:
    """앞에서부터 차례로 적용한 3×3 선형 변환."""
    m = np.eye(3)
    for op in ops:
        m = linear(op) @ m
    return m


def ground(vertices: np.ndarray) -> np.ndarray:
    """bbox 중심 xz를 원점에, 최저점을 y=0에."""
    lo, hi = vertices.min(0), vertices.max(0)
    offset = np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])
    return vertices - offset


def apply(v0: trimesh.Trimesh, ops: list[dict]) -> trimesh.Trimesh:
    """v0에 op 리스트를 적용한 새 메시. UV·정점 색·텍스처는 그대로, 법선은 다시 계산된다."""
    m = compose(ops)
    out = v0.copy()
    out.vertices = ground(np.asarray(v0.vertices, dtype=float) @ m.T)
    if np.linalg.det(m) < 0:
        # 반전 변환은 면 감김을 뒤집는다 → 정점 순서를 바꿔 바깥 법선 유지 (E6)
        out.faces = np.asarray(out.faces)[:, ::-1]
    return out


def extents_of(v0_extents: np.ndarray, m: np.ndarray) -> np.ndarray:
    """축 치환×대각 행렬이면 변환 후 bbox 크기를 정확히 계산할 수 있다."""
    return np.abs(m) @ v0_extents


def ratio(extents: np.ndarray) -> float:
    lo = float(extents.min())
    return float("inf") if lo <= 0 else float(extents.max()) / lo


def user_factors(ops: list[dict]) -> np.ndarray:
    """e0 물체 축 기준 누적 배율 (= 사용자 op 합성 행렬의 열 길이)."""
    user = [op for op in ops if op["op"] != "label"]
    return np.linalg.norm(compose(user), axis=0)


def centroid(mesh: trimesh.Trimesh) -> np.ndarray:
    """닫힌 메시는 부피 중심, 아니면 면적 가중 중심."""
    if mesh.is_volume:
        return np.asarray(mesh.center_mass, dtype=float)
    areas = mesh.area_faces
    return (mesh.triangles_center * areas[:, None]).sum(0) / max(float(areas.sum()), 1e-12)


@dataclass
class Resolution:
    kind: str  # "ops" | "refuse" | "noop"
    ops: list[dict] = field(default_factory=list)  # 새로 추가할 월드 op
    message: str = ""
    reason_code: str | None = None
    notes: list[str] = field(default_factory=list)


def _stand_up(mesh: trimesh.Trimesh) -> tuple[dict | None, str | None]:
    """가장 긴 축을 y로 세우는 90° 회전. 무거운 쪽이 아래로 가는 방향을 고른다."""
    e = np.asarray(mesh.extents, dtype=float)
    if e[1] >= e.max() * (1 - UPRIGHT_TOLERANCE):
        return None, None
    longest = 0 if e[0] >= e[2] * (1 - UPRIGHT_TOLERANCE) else 2  # x·z가 비슷하면 x
    axis = 2 if longest == 0 else 0  # 가장 긴 축과 y에 모두 수직인 축
    v = np.asarray(mesh.vertices, dtype=float)
    c = centroid(mesh)
    scores = {}
    for k in (1, -1):
        r = linear({"op": "rotate", "axis": AXES[axis], "k": k})
        vy = v @ r[1]
        scores[k] = (float(c @ r[1]) - (vy.min() + vy.max()) / 2) / max(float(e[longest]), 1e-12)
    if abs(scores[1] - scores[-1]) < CENTROID_TOLERANCE:
        return {"op": "rotate", "axis": AXES[axis], "k": 1}, "거꾸로 섰다면 '뒤집어줘'라고 하세요."
    k = min(scores, key=scores.get)
    return {"op": "rotate", "axis": AXES[axis], "k": k}, None


def _screen_op(op, panel: str) -> dict:
    if isinstance(op, ScaleUniform):
        return {"op": "scale", "factors": [op.factor] * 3}
    i, sign = axis_index(screen_to_world(panel, op.axis))
    if isinstance(op, Rotate90):
        return {"op": "rotate", "axis": AXES[i], "k": op.k * sign}
    if isinstance(op, ScaleAxis):
        factors = [1.0, 1.0, 1.0]
        factors[i] = op.factor
        return {"op": "scale", "factors": factors}
    if isinstance(op, Mirror):
        return {"op": "mirror", "axis": AXES[i]}
    raise TypeError(type(op).__name__)


def resolve(
    screen_ops: list, panel: str, active_ops: list[dict], v0: trimesh.Trimesh
) -> Resolution:
    """화면 op → 활성 버전 뒤에 붙일 월드 op. 범위·no-op 검사까지 여기서 끝낸다."""
    ops = list(active_ops)
    new: list[dict] = []
    notes: list[str] = []
    already_up = False
    for sop in screen_ops:
        if isinstance(sop, StandUp):
            op, note = _stand_up(apply(v0, ops))
            if op is None:
                already_up = True
                continue
            if note:
                notes.append(note)
        elif isinstance(sop, InvertLast):
            user = [o for o in ops if o["op"] != "label"]
            if not user:
                return Resolution(
                    "refuse", reason_code="nothing_to_invert", message="되돌릴 편집이 없어요."
                )
            op = inverse(user[-1])
        else:
            op = _screen_op(sop, panel)
        ops.append(op)
        new.append(op)

    before, after = compose(active_ops), compose(ops)
    if np.allclose(before, after):
        message = "이미 서 있어요." if already_up else "바뀌는 것이 없어요. 이미 그 상태예요."
        return Resolution("noop", message=message)

    factors = user_factors(ops)
    if factors.min() < MIN_FACTOR - 1e-9 or factors.max() > MAX_FACTOR + 1e-9:
        shown = ", ".join(f"{f:.2f}" for f in user_factors(active_ops))
        return Resolution(
            "refuse",
            reason_code="out_of_range",
            message=f"크기는 처음 대비 축마다 {MIN_FACTOR}~{MAX_FACTOR:g}배까지예요. 지금 배율: {shown}.",
        )
    base = np.asarray(v0.extents, dtype=float)
    limit = max(MAX_RATIO, ratio(extents_of(base, before)))
    if ratio(extents_of(base, after)) > limit + 1e-9:
        return Resolution(
            "refuse",
            reason_code="out_of_range",
            message=f"가장 긴 변이 가장 짧은 변의 {MAX_RATIO:g}배를 넘으면 쓸 수 없는 형상이 돼요.",
        )
    return Resolution("ops", ops=new, notes=notes)
