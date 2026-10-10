"""GPU 없이 쓰는 초기 전경 추정. 입력 검사와 GrabCut 초기값에 쓴다."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class Foreground:
    mask: np.ndarray  # bool HxW
    source: str  # alpha | border_color
    background_lab: np.ndarray | None


def alpha_is_meaningful(alpha: np.ndarray) -> bool:
    transparent = float((alpha < 128).mean())
    return 0.01 < transparent < 0.99


def to_lab(rgb: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(rgb.astype(np.float32) / 255.0, cv2.COLOR_RGB2LAB)


def estimate_foreground(rgb: np.ndarray, alpha: np.ndarray | None = None) -> Foreground:
    if alpha is not None and alpha_is_meaningful(alpha):
        return Foreground(clean_mask(alpha >= 128), "alpha", None)

    h, w = rgb.shape[:2]
    lab = to_lab(rgb)
    b = max(2, int(min(h, w) * 0.01))
    border = np.concatenate(
        [
            lab[:b].reshape(-1, 3),
            lab[-b:].reshape(-1, 3),
            lab[:, :b].reshape(-1, 3),
            lab[:, -b:].reshape(-1, 3),
        ]
    )
    bg = np.median(border, axis=0)
    dist = np.linalg.norm(lab - bg, axis=2)
    scaled = np.clip(dist * 2.0, 0, 255).astype(np.uint8)
    otsu, _ = cv2.threshold(scaled, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # 종이 질감·조명 얼룩을 전경으로 잡지 않도록 최소 ΔE 15
    threshold = max(otsu / 2.0, 15.0)
    return Foreground(clean_mask(dist > threshold), "border_color", bg)


def clean_mask(mask: np.ndarray, min_area_ratio: float = 0.001) -> np.ndarray:
    m = mask.astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    min_area = min_area_ratio * mask.size
    keep = np.zeros(n, bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= min_area
    return keep[labels]


def bbox(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
