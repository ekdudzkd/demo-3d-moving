"""분할 결과 후처리: 조각 정리, 구멍 채우기, 경계 다듬기."""

from __future__ import annotations

import cv2
import numpy as np

from .base import Prompts

# 테두리에 닿지 않는 구멍은 크기와 무관하게 채운다 (D-015). None이면 제한 없음
MAX_HOLE_RATIO: float | None = None


def refine_mask(
    mask: np.ndarray, prompts: Prompts, max_hole_ratio: float | None = MAX_HOLE_RATIO
) -> np.ndarray:
    if not mask.any():
        return mask
    m = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    m = keep_main_components(m.astype(bool), prompts.positive)
    m = fill_holes(m, prompts.negative, max_hole_ratio)
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    return m.astype(bool)


def keep_main_components(mask: np.ndarray, positive: list[tuple[float, float]]) -> np.ndarray:
    """가장 큰 조각 + 포함점이 찍힌 조각만 남긴다."""
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    if n <= 2:
        return mask
    keep = {1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))}
    h, w = mask.shape
    for x, y in positive:
        xi, yi = int(np.clip(x, 0, w - 1)), int(np.clip(y, 0, h - 1))
        if labels[yi, xi] > 0:
            keep.add(int(labels[yi, xi]))
    return np.isin(labels, list(keep))


def fill_holes(
    mask: np.ndarray, negative: list[tuple[float, float]], max_hole_ratio: float | None
) -> np.ndarray:
    """테두리에 닿지 않는 배경 구멍 중 작은 것을 채운다. 제외점이 있는 구멍은 유지.

    그림은 윤곽선만 잡히고 안쪽이 비는 경우가 많아 기본값은 크기 제한 없음.
    """
    inv = (~mask).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(inv, connectivity=4)
    h, w = mask.shape
    fg_area = mask.sum()
    protected = set()
    for x, y in negative:
        xi, yi = int(np.clip(x, 0, w - 1)), int(np.clip(y, 0, h - 1))
        protected.add(int(labels[yi, xi]))
    out = mask.copy()
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        touches_border = x == 0 or y == 0 or x + bw == w or y + bh == h
        too_big = max_hole_ratio is not None and area > max_hole_ratio * fg_area
        if touches_border or i in protected or too_big:
            continue
        out[labels == i] = True
    return out
