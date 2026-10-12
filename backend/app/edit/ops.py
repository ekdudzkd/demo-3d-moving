"""편집 op 스키마.

ScreenOp: 플래너(LLM·Mock)가 내는 패널 화면 기준 op. 대상은 항상 전체(target="whole").
WorldOp: 월드 축으로 풀어 버전에 저장하는 구체 op (dict). stand_up·invert_last는 저장 전에 풀린다.
"""

from __future__ import annotations

from typing import Annotated, Literal

import numpy as np
from pydantic import BaseModel, Field, field_validator

from .basis import ScreenAxis, label_rotation

MIN_FACTOR = 0.1
MAX_FACTOR = 10.0
AXES = "xyz"


class _Op(BaseModel):
    target: Literal["whole"] = "whole"


class Rotate90(_Op):
    type: Literal["rotate90"] = "rotate90"
    axis: ScreenAxis
    k: int = Field(ge=-3, le=3)

    @field_validator("k")
    @classmethod
    def _nonzero(cls, k: int) -> int:
        if k == 0:
            raise ValueError("k는 0이 아니어야 합니다")
        return k


class ScaleAxis(_Op):
    type: Literal["scale_axis"] = "scale_axis"
    axis: ScreenAxis
    factor: float = Field(ge=MIN_FACTOR, le=MAX_FACTOR)


class ScaleUniform(_Op):
    type: Literal["scale_uniform"] = "scale_uniform"
    factor: float = Field(ge=MIN_FACTOR, le=MAX_FACTOR)


class Mirror(_Op):
    type: Literal["mirror"] = "mirror"
    axis: ScreenAxis


class StandUp(_Op):
    type: Literal["stand_up"] = "stand_up"


class InvertLast(_Op):
    type: Literal["invert_last"] = "invert_last"


ScreenOp = Annotated[
    Rotate90 | ScaleAxis | ScaleUniform | Mirror | StandUp | InvertLast,
    Field(discriminator="type"),
]


# ---- WorldOp (dict) ------------------------------------------------------------
# {"op": "label", "label": "left"}
# {"op": "rotate", "axis": "y", "k": 1}        # +축 기준 오른손 법칙 k×90°
# {"op": "scale", "factors": [sx, sy, sz]}
# {"op": "mirror", "axis": "x"}


def axis_index(vec: np.ndarray) -> tuple[int, int]:
    """부호 있는 월드 단위축 → (축 번호, 부호)."""
    i = int(np.argmax(np.abs(vec)))
    return i, int(np.sign(vec[i]))


def rotation_matrix(axis: int, k: int) -> np.ndarray:
    """+axis 기준 오른손 법칙 k×90° 회전. 정수 행렬이라 오차가 없다."""
    k %= 4
    c, s = [(1, 0), (0, 1), (-1, 0), (0, -1)][k]
    a, b = [(1, 2), (2, 0), (0, 1)][axis]  # axis에 수직인 두 축 (a→b가 양의 방향)
    m = np.eye(3)
    m[a, a], m[a, b], m[b, a], m[b, b] = c, -s, s, c
    return m


def linear(op: dict) -> np.ndarray:
    """WorldOp 하나의 3×3 선형 부분."""
    kind = op["op"]
    if kind == "label":
        return label_rotation(op["label"])
    if kind == "rotate":
        return rotation_matrix(AXES.index(op["axis"]), op["k"])
    if kind == "scale":
        return np.diag(op["factors"]).astype(float)
    if kind == "mirror":
        m = np.eye(3)
        m[AXES.index(op["axis"]), AXES.index(op["axis"])] = -1
        return m
    raise ValueError(f"알 수 없는 op: {kind}")


def inverse(op: dict) -> dict:
    """사용자 WorldOp의 역연산 ("반대로")."""
    kind = op["op"]
    if kind == "rotate":
        return {"op": "rotate", "axis": op["axis"], "k": -op["k"]}
    if kind == "scale":
        return {"op": "scale", "factors": [1.0 / f for f in op["factors"]]}
    if kind == "mirror":
        return dict(op)
    raise ValueError(f"역연산이 없는 op: {kind}")
