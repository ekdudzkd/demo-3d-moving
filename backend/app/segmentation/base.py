from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

import numpy as np


@dataclass
class Prompts:
    """원본 이미지 픽셀 좌표 기준 프롬프트."""

    points: list[tuple[float, float, int]] = field(default_factory=list)  # (x, y, 1=포함/0=제외)
    box: tuple[float, float, float, float] | None = None

    @property
    def positive(self) -> list[tuple[float, float]]:
        return [(x, y) for x, y, label in self.points if label == 1]

    @property
    def negative(self) -> list[tuple[float, float]]:
        return [(x, y) for x, y, label in self.points if label == 0]

    @property
    def empty(self) -> bool:
        return not self.points and self.box is None

    def to_dict(self) -> dict:
        return {
            "points": [{"x": x, "y": y, "label": label} for x, y, label in self.points],
            "box": list(self.box) if self.box else None,
        }


class Segmenter(ABC):
    name: str

    @abstractmethod
    def segment(self, image: np.ndarray, prompts: Prompts) -> np.ndarray:
        """image: HxWx3(RGB) 또는 HxWx4(RGBA) uint8 → HxW bool 마스크 (후처리 전)."""
