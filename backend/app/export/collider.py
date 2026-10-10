"""물리 충돌체 생성. 생성 메시를 그대로 충돌체로 쓰지 않는다 (D-009)."""

from __future__ import annotations

import numpy as np
import trimesh

MAX_HULL_POINTS = 64
FLAT_RATIO = 0.01  # 최소 축 / 최대 축이 이보다 작으면 납작해서 hull 대신 두께를 준 상자
MIN_THICKNESS_RATIO = 0.02  # 납작한 형상의 상자 두께 하한 (물리 엔진 관통 방지)


def farthest_points(points: np.ndarray, k: int) -> np.ndarray:
    if len(points) <= k:
        return points
    chosen = [int(np.argmax(np.linalg.norm(points - points.mean(axis=0), axis=1)))]
    dist = np.linalg.norm(points - points[chosen[0]], axis=1)
    for _ in range(k - 1):
        nxt = int(np.argmax(dist))
        chosen.append(nxt)
        dist = np.minimum(dist, np.linalg.norm(points - points[nxt], axis=1))
    return points[chosen]


def build_collider(mesh: trimesh.Trimesh) -> dict:
    lo, hi = mesh.bounds
    center = (lo + hi) / 2
    size = float((hi - lo).max())
    half = np.maximum((hi - lo) / 2, size * MIN_THICKNESS_RATIO / 2)
    box = {"center": center.round(5).tolist(), "half_extents": half.round(5).tolist()}
    sphere_radius = float(np.linalg.norm(mesh.vertices - center, axis=1).max())
    sphere = {"center": center.round(5).tolist(), "radius": round(sphere_radius, 5)}

    collider = {"type": "bounding_box", "box": box, "sphere": sphere, "points": None, "reason": ""}
    try:
        if size <= 0 or float((hi - lo).min()) / size < FLAT_RATIO:
            collider["reason"] = "형상이 납작해 convex hull 대신 두께를 준 상자 사용"
            return collider
        hull = mesh.convex_hull
        points = farthest_points(np.asarray(hull.vertices), MAX_HULL_POINTS)
        simplified = trimesh.convex.convex_hull(points)
        if simplified.volume > 0:
            collider.update(
                type="convex_hull",
                points=np.asarray(simplified.vertices).round(5).tolist(),
                hull_volume=round(float(simplified.volume), 6),
            )
    except Exception as exc:  # noqa: BLE001 - qhull 실패 시 상자로 폴백
        collider["reason"] = f"convex hull 실패: {exc}"
    return collider
