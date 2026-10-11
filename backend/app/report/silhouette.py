"""생성 메시 정면 실루엣과 모델 입력 마스크 비교 (실패 분류·평가 공용).

GL 없이 정사영 + 삼각형 채우기로 계산해 CI에서도 돈다. 좌표 규약: y 위, 정면 +z (D-022).
"""

from __future__ import annotations

import cv2
import numpy as np
import trimesh

SIL_SIZE = 256


def mask_iou(pred: np.ndarray, gt: np.ndarray) -> float:
    union = (pred | gt).sum()
    return float((pred & gt).sum() / union) if union else 1.0


def fit_square(mask: np.ndarray, size: int = SIL_SIZE) -> np.ndarray:
    """bbox로 자르고 비율을 유지해 size×size 가운데에 놓는다."""
    ys, xs = np.nonzero(mask)
    out = np.zeros((size, size), bool)
    if len(xs) == 0:
        return out
    crop = mask[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1].astype(np.uint8)
    h, w = crop.shape
    s = size / max(h, w)
    nh, nw = max(1, round(h * s)), max(1, round(w * s))
    small = cv2.resize(crop, (nw, nh), interpolation=cv2.INTER_NEAREST) > 0
    y0, x0 = (size - nh) // 2, (size - nw) // 2
    out[y0 : y0 + nh, x0 : x0 + nw] = small
    return out


def front_silhouette(mesh: trimesh.Trimesh, size: int = SIL_SIZE) -> np.ndarray:
    """정면(+z에서 본 x·y) 정사영 실루엣. 규약: y 위, 정면 +z (D-022)."""
    if len(mesh.faces) == 0:
        return np.zeros((size, size), bool)
    v = np.asarray(mesh.vertices)[:, :2]
    lo, hi = v.min(0), v.max(0)
    scale = (size - 1) / max(float((hi - lo).max()), 1e-9)
    px = (v[:, 0] - lo[0]) * scale
    py = (hi[1] - v[:, 1]) * scale  # 이미지는 y가 아래로
    tris = np.stack([px, py], axis=1)[mesh.faces].round().astype(np.int32)
    canvas = np.zeros((size, size), np.uint8)
    # fillPoly에 여러 삼각형을 한 번에 넘기면 겹친 곳(앞면·뒷면)이 짝수-홀수 규칙으로 지워진다
    for tri in tris:
        cv2.fillConvexPoly(canvas, tri, 1)
    return fit_square(canvas > 0, size)


def silhouette_scores(mesh: trimesh.Trimesh, input_mask: np.ndarray) -> dict:
    """정면 실루엣 vs 입력 마스크 (둘 다 bbox 기준으로 맞춤).

    iou: 전체 일치, recall: 입력 중 메시가 덮은 비율(낮으면 빠진 부분), precision: 메시 중 입력 안 비율.
    """
    sil, inp = front_silhouette(mesh), fit_square(input_mask)
    inter = float((sil & inp).sum())
    return {
        "iou": round(mask_iou(sil, inp), 4),
        "recall": round(inter / inp.sum(), 4) if inp.any() else 0.0,
        "precision": round(inter / sil.sum(), 4) if sil.any() else 0.0,
    }


def silhouette_iou(mesh: trimesh.Trimesh, input_mask: np.ndarray) -> float:
    return silhouette_scores(mesh, input_mask)["iou"]
