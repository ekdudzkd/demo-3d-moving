"""패널 기준표와 라벨 회전 (D-026). 값은 basis.json 하나에서 읽는다."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

import numpy as np

Panel = Literal["front", "back", "left", "right", "top", "bottom"]
ScreenAxis = Literal["screen_right", "screen_up", "toward_viewer"]

BASIS_PATH = Path(__file__).with_name("basis.json")
_DATA = json.loads(BASIS_PATH.read_text("utf-8"))

PANELS: dict[str, dict[str, np.ndarray]] = {
    name: {k: np.asarray(v, dtype=float) for k, v in axes.items()}
    for name, axes in _DATA["panels"].items()
}
STABLE_LABELS: tuple[str, ...] = tuple(_DATA["labels"]["stable"])
EXPERIMENTAL_LABELS: tuple[str, ...] = tuple(_DATA["labels"]["experimental"])


def screen_to_world(panel: str, axis: str) -> np.ndarray:
    """패널의 화면 축 → 월드 단위 벡터(부호 포함)."""
    return PANELS[panel][axis]


def label_rotation(label: str) -> np.ndarray:
    """정면으로 가정하고 생성된 메시를 라벨 시점으로 돌리는 회전 R = [r, u, t] (열)."""
    p = PANELS[label]
    return np.column_stack([p["screen_right"], p["screen_up"], p["toward_viewer"]])
