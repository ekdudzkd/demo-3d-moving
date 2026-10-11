"""평가 지표 (proposal §10). GL 없이 numpy·OpenCV만 써서 CI에서도 돈다."""

from __future__ import annotations

import cv2
import numpy as np

from app.report.silhouette import (  # noqa: F401 — 평가 지표로 다시 내보냄
    SIL_SIZE,
    fit_square,
    front_silhouette,
    mask_iou,
    silhouette_iou,
    silhouette_scores,
)


def background_inclusion(pred: np.ndarray, gt: np.ndarray) -> float:
    """예측 마스크 중 정답 밖(배경)인 비율. 종이·책상을 물체로 잡으면 커진다."""
    n = pred.sum()
    return float((pred & ~gt).sum() / n) if n else 0.0


def _boundary(mask: np.ndarray) -> np.ndarray:
    m = mask.astype(np.uint8)
    return cv2.morphologyEx(m, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0


def boundary_f1(pred: np.ndarray, gt: np.ndarray, tolerance: float | None = None) -> float:
    """경계 F1. 허용 거리 기본값은 이미지 대각선의 0.75% (최소 2px)."""
    if tolerance is None:
        tolerance = max(2.0, 0.0075 * float(np.hypot(*gt.shape)))
    bp, bg = _boundary(pred), _boundary(gt)
    if not bp.any() and not bg.any():
        return 1.0
    if not bp.any() or not bg.any():
        return 0.0
    dist_to_gt = cv2.distanceTransform((~bg).astype(np.uint8), cv2.DIST_L2, 3)
    dist_to_pred = cv2.distanceTransform((~bp).astype(np.uint8), cv2.DIST_L2, 3)
    precision = float((dist_to_gt[bp] <= tolerance).mean())
    recall = float((dist_to_pred[bg] <= tolerance).mean())
    return 0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall)
