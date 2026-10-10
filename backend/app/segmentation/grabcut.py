"""OpenCV GrabCut 분할. GPU 없는 개발·CI와 SAM 2 비교 기준선용."""

from __future__ import annotations

import cv2
import numpy as np

from app.input.foreground import alpha_is_meaningful, bbox, estimate_foreground

from .base import Prompts, Segmenter

WORK_SIZE = 512
ITERATIONS = 5


class GrabCutSegmenter(Segmenter):
    name = "grabcut"

    def segment(self, image: np.ndarray, prompts: Prompts) -> np.ndarray:
        rgb = image[..., :3]
        alpha = image[..., 3] if image.shape[2] == 4 else None
        if prompts.empty and alpha is not None and alpha_is_meaningful(alpha):
            return alpha >= 128

        h, w = rgb.shape[:2]
        scale = min(1.0, WORK_SIZE / max(h, w))
        small = cv2.resize(rgb, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
        sh, sw = small.shape[:2]

        estimate = estimate_foreground(
            small, None if alpha is None else _resize_mask(alpha >= 128, sw, sh)
        ).mask
        gc = self._init_mask(estimate, prompts, scale, sw, sh)
        if not ((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD)).any():
            return np.zeros((h, w), bool)
        if not ((gc == cv2.GC_BGD) | (gc == cv2.GC_PR_BGD)).any():
            return np.ones((h, w), bool)

        bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
        bgr = cv2.cvtColor(small, cv2.COLOR_RGB2BGR)
        cv2.grabCut(bgr, gc, None, bgd, fgd, ITERATIONS, cv2.GC_INIT_WITH_MASK)
        fg = ((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD)).astype(np.float32)
        return cv2.resize(fg, (w, h), interpolation=cv2.INTER_LINEAR) >= 0.5

    def _init_mask(self, estimate, prompts: Prompts, scale: float, sw: int, sh: int) -> np.ndarray:
        if prompts.box is not None:
            x0, y0, x1, y1 = (round(v * scale) for v in prompts.box)
        else:
            box = bbox(estimate)
            if box is None:
                x0, y0, x1, y1 = round(sw * 0.1), round(sh * 0.1), round(sw * 0.9), round(sh * 0.9)
            else:
                x0, y0, x1, y1 = box
                mx, my = round((x1 - x0) * 0.05) + 2, round((y1 - y0) * 0.05) + 2
                x0, y0, x1, y1 = x0 - mx, y0 - my, x1 + mx, y1 + my
        x0, x1 = sorted((max(0, min(sw, x0)), max(0, min(sw, x1))))
        y0, y1 = sorted((max(0, min(sh, y0)), max(0, min(sh, y1))))

        gc = np.full((sh, sw), cv2.GC_BGD, np.uint8)
        inside = np.zeros((sh, sw), bool)
        inside[y0:y1, x0:x1] = True
        gc[inside] = cv2.GC_PR_BGD
        # 상자 안에서 색 기반 추정이 전경이면 "아마 전경"으로 시작. 추정이 비면 상자 전체를 전경 후보로
        seed = inside & estimate
        gc[seed if seed.any() else inside] = cv2.GC_PR_FGD

        radius = max(3, round(min(sw, sh) * 0.015))
        for x, y, label in prompts.points:
            value = cv2.GC_FGD if label == 1 else cv2.GC_BGD
            cv2.circle(gc, (round(x * scale), round(y * scale)), radius, int(value), -1)
        return gc


def _resize_mask(mask: np.ndarray, w: int, h: int) -> np.ndarray:
    return cv2.resize(mask.astype(np.uint8), (w, h), interpolation=cv2.INTER_NEAREST).astype(bool)
