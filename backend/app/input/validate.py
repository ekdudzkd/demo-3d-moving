"""입력 이미지 검사. 기준은 docs/proposal.md §1."""

from __future__ import annotations

import io
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field
from scipy import ndimage

from app.core.config import Settings

from .foreground import bbox, estimate_foreground, to_lab

SUPPORTED_FORMATS = {"PNG", "JPEG", "WEBP"}

# 경고 임계값 — 평가셋(4단계)으로 재조정
MIN_COVERAGE = 0.05
SMALL_COVERAGE = 0.10
LARGE_COVERAGE = 0.90
SIGNIFICANT_COMPONENT = 0.05
EDGE_MARGIN = 0.01
MAX_CENTER_OFFSET = 0.25
MIN_BLUR_SCORE = 50.0
MIN_DELTA_E = 15.0


class Issue(BaseModel):
    code: str
    message: str


class ValidationResult(BaseModel):
    is_valid: bool
    width: int = 0
    height: int = 0
    format: str | None = None
    has_alpha: bool = False
    object_count: int = 0
    object_coverage: float = 0.0
    bbox: list[int] | None = None
    center_offset: float | None = None
    blur_score: float | None = None
    color_delta_e: float | None = None
    foreground_source: str | None = None
    warnings: list[Issue] = Field(default_factory=list)
    errors: list[Issue] = Field(default_factory=list)


@dataclass
class LoadedImage:
    image: Image.Image  # RGB 또는 RGBA, EXIF 제거·회전 적용·축소 완료
    result: ValidationResult


def _reject(result: ValidationResult, code: str, message: str) -> LoadedImage:
    result.errors.append(Issue(code=code, message=message))
    result.is_valid = False
    return LoadedImage(Image.new("RGB", (1, 1)), result)


def load_and_validate(data: bytes, settings: Settings) -> LoadedImage:
    result = ValidationResult(is_valid=True)
    if len(data) > settings.max_upload_bytes:
        return _reject(result, "file_too_large", f"파일이 {settings.max_upload_mb}MB를 넘습니다.")
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError):
        return _reject(result, "unsupported_format", "PNG, JPG, WEBP 이미지만 지원합니다.")
    result.format = img.format
    if img.format not in SUPPORTED_FORMATS:
        return _reject(result, "unsupported_format", "PNG, JPG, WEBP 이미지만 지원합니다.")

    img = ImageOps.exif_transpose(img)
    has_alpha = img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info)
    img = img.convert("RGBA" if has_alpha else "RGB")
    result.has_alpha = has_alpha

    if min(img.size) < settings.min_short_side:
        result.width, result.height = img.size
        return _reject(
            result,
            "resolution_too_low",
            f"짧은 변이 {settings.min_short_side}px 이상이어야 합니다.",
        )
    if max(img.size) > settings.max_long_side:
        img.thumbnail((settings.max_long_side, settings.max_long_side), Image.LANCZOS)
        result.warnings.append(
            Issue(code="downscaled", message=f"긴 변을 {settings.max_long_side}px로 줄였습니다.")
        )
    # 새 이미지로 복사해 EXIF 등 메타데이터를 남기지 않는다
    clean = Image.new(img.mode, img.size)
    clean.paste(img)
    clean.info = {}
    result.width, result.height = clean.size

    _analyze(clean, result)
    result.is_valid = not result.errors
    return LoadedImage(clean, result)


def _analyze(img: Image.Image, r: ValidationResult) -> None:
    arr = np.asarray(img)
    rgb = arr[..., :3]
    alpha = arr[..., 3] if arr.shape[2] == 4 else None
    if alpha is not None:
        transparent = float((alpha < 128).mean())
        if transparent <= 0.01 or transparent >= 0.99:
            r.warnings.append(
                Issue(
                    code="invalid_alpha",
                    message="투명 영역이 없거나 전부 투명합니다. 색으로 배경을 추정합니다.",
                )
            )

    fg = estimate_foreground(rgb, alpha)
    # 크기는 잉크 픽셀이 아니라 윤곽선 안쪽까지 채운 실루엣으로 잰다.
    # 윤곽선만 그린 그림은 잉크가 2% 정도라 그대로 재면 "너무 작음"으로 거부된다 (D-024)
    mask = ndimage.binary_fill_holes(fg.mask)
    r.foreground_source = fg.source
    r.object_coverage = round(float(mask.mean()), 4)

    if r.object_coverage < MIN_COVERAGE:
        box = bbox(mask)
        extent = 0.0 if box is None else (box[2] - box[0]) * (box[3] - box[1]) / mask.size
        if extent < SMALL_COVERAGE:
            r.errors.append(
                Issue(
                    code="object_too_small",
                    message="객체를 찾지 못했거나 너무 작습니다. 객체를 크게 찍어 주세요.",
                )
            )
            return
        # 막대 사람처럼 선만 있고 감싼 면이 없는 그림: 범위는 충분하니 거부하지 않고 경고
        r.warnings.append(
            Issue(
                code="thin_drawing",
                message="선이 가늘고 색칠된 면이 적어 3D가 얇거나 끊어질 수 있습니다. "
                "선을 굵게 그리고 안쪽을 색칠하면 좋아집니다.",
            )
        )
    if r.object_coverage < SMALL_COVERAGE and not any(w.code == "thin_drawing" for w in r.warnings):
        r.warnings.append(
            Issue(
                code="object_small", message="객체가 작습니다. 더 가까이 찍으면 결과가 좋아집니다."
            )
        )
    if r.object_coverage > LARGE_COVERAGE:
        r.warnings.append(
            Issue(
                code="object_too_large",
                message="객체가 화면을 거의 채웁니다. 배경과 구분이 어려울 수 있습니다.",
            )
        )

    n, _, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    areas = stats[1:, cv2.CC_STAT_AREA]
    r.object_count = int((areas >= SIGNIFICANT_COMPONENT * areas.sum()).sum())
    if r.object_count >= 2:
        r.warnings.append(
            Issue(
                code="multiple_objects", message="객체가 여러 개로 보입니다. 하나만 선택해 주세요."
            )
        )

    h, w = mask.shape
    box = bbox(mask)
    assert box is not None
    r.bbox = list(box)
    x0, y0, x1, y1 = box
    mx, my = EDGE_MARGIN * w, EDGE_MARGIN * h
    touching = sum([x0 <= mx, y0 <= my, x1 >= w - mx, y1 >= h - my])
    if touching:
        r.warnings.append(
            Issue(code="object_cropped", message="객체 일부가 이미지 밖으로 잘린 것 같습니다.")
        )

    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    r.center_offset = round(float(np.hypot(cx - w / 2, cy - h / 2) / np.hypot(w, h)), 4)
    if r.center_offset > MAX_CENTER_OFFSET:
        r.warnings.append(
            Issue(code="off_center", message="객체가 가운데에서 많이 벗어나 있습니다.")
        )

    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)[y0:y1, x0:x1]
    r.blur_score = round(float(cv2.Laplacian(gray, cv2.CV_64F).var()), 2)
    if r.blur_score < MIN_BLUR_SCORE:
        r.warnings.append(
            Issue(code="blurry", message="이미지가 흐립니다. 초점을 맞춰 다시 찍어 주세요.")
        )

    if (~mask).any():
        lab = to_lab(rgb)
        # 평균이면 진한 윤곽선이 연한 안쪽 색을 가린다. 실루엣 대부분의 색(중앙값)으로 비교
        delta = float(np.linalg.norm(np.median(lab[mask], axis=0) - np.median(lab[~mask], axis=0)))
        r.color_delta_e = round(delta, 2)
        if delta < MIN_DELTA_E:
            r.warnings.append(
                Issue(
                    code="low_contrast",
                    message="객체와 배경 색이 비슷합니다. 흰 종이 위에서 찍어 주세요.",
                )
            )
