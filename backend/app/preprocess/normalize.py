"""3D 생성 전 이미지 정규화. 모든 adapter는 이 결과(정사각 RGBA)를 입력으로 받는다 (D-006)."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from pydantic import BaseModel, Field

from app.core.errors import ErrorCode, PipelineError
from app.input.foreground import bbox

# 전경 L(0~255) 1~99 백분위 범위가 이보다 좁을 때만 밝기 보정. 4단계 실험으로 조정
LOW_CONTRAST_RANGE = 100


class PreprocessOptions(BaseModel):
    size: int = Field(512, ge=64, le=2048)
    foreground_ratio: float = Field(0.85, gt=0.1, le=1.0)
    feather_px: float = Field(1.0, ge=0.0, le=10.0)
    min_speck_ratio: float = Field(0.005, ge=0.0, lt=1.0)
    normalize_brightness: bool = True


class PreprocessResult(BaseModel):
    cutout: str
    cropped: str
    normalized: str
    options: PreprocessOptions
    bbox: list[int]
    scale: float
    foreground_ratio_actual: float
    brightness_adjusted: bool


def normalize(
    image: np.ndarray, mask: np.ndarray, out_dir: Path, options: PreprocessOptions | None = None
) -> PreprocessResult:
    opts = options or PreprocessOptions()
    if not mask.any():
        raise PipelineError(ErrorCode.INPUT_INVALID, "빈 마스크")
    out_dir.mkdir(parents=True, exist_ok=True)

    rgb = image[..., :3].copy()
    mask = remove_specks(mask, opts.min_speck_ratio)
    alpha = mask.astype(np.float32)
    if opts.feather_px > 0:
        alpha = cv2.GaussianBlur(alpha, (0, 0), opts.feather_px)
    if image.shape[2] == 4:
        alpha *= image[..., 3].astype(np.float32) / 255.0

    adjusted = False
    if opts.normalize_brightness:
        rgb, adjusted = stretch_lightness(rgb, mask)

    rgba = np.dstack([rgb, np.clip(alpha * 255, 0, 255).astype(np.uint8)])
    cutout_path = out_dir / "01_cutout.png"
    Image.fromarray(rgba, "RGBA").save(cutout_path)

    box = bbox(rgba[..., 3] > 0)
    assert box is not None
    x0, y0, x1, y1 = box
    cropped = Image.fromarray(rgba[y0:y1, x0:x1], "RGBA")
    cropped_path = out_dir / "02_cropped.png"
    cropped.save(cropped_path)

    target = opts.size * opts.foreground_ratio
    scale = target / max(cropped.size)
    new_size = (max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale)))
    # 미리 곱한 알파(RGBa)로 리사이즈해 경계에 검은 테두리가 생기지 않게 한다
    resized = cropped.convert("RGBa").resize(new_size, Image.LANCZOS).convert("RGBA")
    canvas = Image.new("RGBA", (opts.size, opts.size), (0, 0, 0, 0))
    canvas.paste(resized, ((opts.size - new_size[0]) // 2, (opts.size - new_size[1]) // 2))
    normalized_path = out_dir / "03_normalized.png"
    canvas.save(normalized_path)

    result = PreprocessResult(
        cutout=str(cutout_path),
        cropped=str(cropped_path),
        normalized=str(normalized_path),
        options=opts,
        bbox=list(box),
        scale=round(scale, 5),
        foreground_ratio_actual=round(max(new_size) / opts.size, 4),
        brightness_adjusted=adjusted,
    )
    (out_dir / "preprocess.json").write_text(json.dumps(result.model_dump(), indent=2), "utf-8")
    return result


def remove_specks(mask: np.ndarray, min_ratio: float) -> np.ndarray:
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    if n <= 2:
        return mask
    areas = stats[:, cv2.CC_STAT_AREA]
    keep = np.zeros(n, bool)
    keep[1:] = areas[1:] >= min_ratio * areas[1:].sum()
    return keep[labels]


def stretch_lightness(rgb: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, bool]:
    """전경 밝기 범위가 좁을 때(어둡거나 흐린 사진)만 L 채널을 늘린다. 색조는 유지."""
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    lightness = lab[..., 0][mask]
    lo, hi = np.percentile(lightness, [1, 99])
    if hi - lo >= LOW_CONTRAST_RANGE or hi - lo < 1:  # 8bit L 기준 (0~255)
        return rgb, False
    stretched = (lab[..., 0] - lo) / (hi - lo) * (235 - 20) + 20
    lab[..., 0] = np.where(mask, np.clip(stretched, 0, 255), lab[..., 0])
    return cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2RGB), True
