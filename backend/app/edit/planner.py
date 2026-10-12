"""EditPlanner: 자연어 편집 문장 → 화면 기준 op (docs/designs/view-and-edit.md, D-028).

플래너는 op JSON만 낸다. 월드 축 변환·범위 검사·메시 적용은 결정적 코드(compose·versions)가 한다.
부분 편집·형태 추가·색 변경처럼 v1 범위 밖 요청은 추측하지 않고 refuse/clarify로 돌려준다.
플래너로 보내는 데이터는 문장·패널 id·숫자뿐이고 이미지는 보내지 않는다 (D-028).

- MockPlanner: 한국어 규칙 기반. CI·테스트·기본값.
- ClaudePlanner: Claude API 구조화 출력. `EDIT_PLANNER=claude`일 때만, anthropic 패키지 필요.
"""

from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from typing import Any, Literal

from pydantic import BaseModel, Field, TypeAdapter, ValidationError

from .basis import Panel
from .ops import ScreenOp

RefuseCode = Literal[
    "part_edit", "out_of_scope", "angle_not_supported", "out_of_range", "unparseable"
]


class PlanInput(BaseModel):
    text: str
    panel: Panel
    history: list[dict[str, Any]] = Field(default_factory=list)  # 최근 사용자 월드 op (최대 5)
    extents_world: list[float] = Field(default_factory=list)
    cumulative_scale: list[float] = Field(default_factory=list)


class PlanResult(BaseModel):
    kind: Literal["ops", "refuse", "clarify", "noop"]
    ops: list[ScreenOp] = Field(default_factory=list, max_length=4)
    reason_code: RefuseCode | None = None
    message: str = ""
    suggested_text: str | None = None


class EditPlanner(ABC):
    name: str

    @abstractmethod
    def plan(self, req: PlanInput) -> PlanResult: ...


EXAMPLES = "예: '세워줘', '더 두껍게', '옆으로 2배 길게', '시계방향으로 90도 돌려', '좌우 반전'"


# ---- MockPlanner ------------------------------------------------------------------

PARTS = (
    "귀", "다리", "팔", "머리", "꼬리", "바퀴", "손잡이", "눈", "코", "입", "날개", "뿔",
    "지붕", "문", "창문", "손", "발", "목", "몸통", "얼굴", "부리", "줄기", "잎", "뚜껑",
)  # fmt: skip
SHAPE_EDIT = ("추가", "달아", "붙여", "없애", "지워", "빼줘", "만들어", "그려")
COLOR = ("색", "빨갛", "파랗", "노랗", "까맣", "하얗", "칠해", "무늬", "텍스처")
INCREASE = ("두껍", "두툼", "뚱뚱", "통통", "길게", "길쭉", "높게", "높여", "크게", "키워",
            "넓게", "넓혀", "늘려", "늘여")  # fmt: skip
DECREASE = ("얇", "날씬", "홀쭉", "납작", "짧게", "줄여", "낮게", "낮춰", "작게", "좁게", "좁혀")
DEPTH = ("두껍", "두툼", "두께", "뚱뚱", "통통", "얇", "날씬", "홀쭉", "납작")
WIDTH = ("옆으로", "가로", "넓", "좁", "폭")
HEIGHT = ("길게", "길쭉", "짧게", "높", "낮", "키를", "키가", "세로", "위아래로")
UNIFORM = ("크게", "작게", "키워", "줄여", "전체 크기", "크기")


def _has(text: str, words) -> bool:
    return any(w in text for w in words)


def _part_mentioned(text: str) -> str | None:
    for p in PARTS:
        if re.search(rf"{p}(?:을|를|이|가|은|는|만|도|쪽|부분|\s|$)", text):
            return p
    return None


def _factor(text: str) -> float:
    if m := re.search(r"(\d+(?:\.\d+)?)\s*배", text):
        return float(m.group(1))
    if _has(text, ("절반", "반으로")):
        return 2.0  # 줄이는 방향과 함께 1/2
    if _has(text, ("많이", "훨씬", "아주", "엄청")):
        return 1.5
    if _has(text, ("조금", "살짝", "약간")):
        return 1.1
    return 1.25


def _clauses(text: str) -> list[str]:
    parts = re.split(r"[,.\n]|그리고|그다음|그 다음|하고 나서", text)
    return [p.strip() for p in parts if p.strip()]


class MockPlanner(EditPlanner):
    """한국어 규칙 기반 플래너. 이해하지 못하면 clarify로 예시를 보여준다."""

    name = "mock"

    def plan(self, req: PlanInput) -> PlanResult:
        text = req.text.strip()
        if not text:
            return PlanResult(kind="clarify", message=f"어떻게 바꿀지 적어 주세요. {EXAMPLES}")
        if _has(text, SHAPE_EDIT):
            return PlanResult(
                kind="refuse",
                reason_code="out_of_scope",
                message="모양을 더하거나 빼는 편집은 아직 못 해요. 돌리기·크기·반전만 할 수 있어요.",
            )
        if _has(text, COLOR):
            return PlanResult(
                kind="refuse", reason_code="out_of_scope", message="색 바꾸기는 아직 못 해요."
            )
        if (part := _part_mentioned(text)) and "전체" not in text:
            return PlanResult(
                kind="refuse",
                reason_code="part_edit",
                message=f"'{part}'만 따로 바꾸는 부분 편집은 아직 못 해요. 전체에 적용할까요?",
                suggested_text=re.sub(rf"{part}\S*\s*", "전체를 ", text, count=1),
            )
        if _has(text, ("아까처럼", "아까 같이", "전처럼")):
            return PlanResult(
                kind="clarify",
                message="어느 상태로 돌아갈지 버전 목록에서 골라 주세요.",
            )
        if _has(text, ("되돌려", "취소", "원래대로", "처음으로")):
            return PlanResult(kind="clarify", message="되돌리기 버튼이나 버전 목록을 써 주세요.")

        ops: list[dict] = []
        for clause in _clauses(text):
            res = self._clause(clause)
            if isinstance(res, PlanResult):
                return res
            ops.extend(res)
        if not ops:
            return PlanResult(kind="clarify", message=f"무엇을 바꿀지 잘 모르겠어요. {EXAMPLES}")
        try:
            return PlanResult(kind="ops", ops=ops[:4])
        except ValidationError:
            return PlanResult(
                kind="refuse",
                reason_code="out_of_range",
                message="크기는 한 번에 0.1~10배까지만 바꿀 수 있어요.",
            )

    def _clause(self, t: str) -> list[dict] | PlanResult:
        if _has(t, ("반대로", "거꾸로 해", "방금 거 반대")):
            return [{"type": "invert_last"}]
        if _has(t, ("세워", "일으켜", "똑바로", "서게")):
            return [{"type": "stand_up"}]
        if _has(t, ("반전", "거울", "대칭")) or (
            "뒤집" in t and _has(t, ("좌우", "상하", "위아래", "앞뒤"))
        ):
            if _has(t, ("상하", "위아래")):
                return [{"type": "mirror", "axis": "screen_up"}]
            if "앞뒤" in t:
                return [{"type": "mirror", "axis": "toward_viewer"}]
            return [{"type": "mirror", "axis": "screen_right"}]
        if _has(t, ("뒤집", "거꾸로")):
            return [{"type": "rotate90", "axis": "screen_right", "k": 2}]

        angle = re.search(r"(-?\d+)\s*도", t)
        turning = _has(t, ("돌려", "회전", "돌리", "틀어", "숙여", "젖혀"))
        if angle or turning:
            deg = int(angle.group(1)) if angle else 90
            if deg % 90:
                return PlanResult(
                    kind="refuse",
                    reason_code="angle_not_supported",
                    message="90도 단위로만 돌릴 수 있어요 (90·180·270도).",
                )
            k = (deg // 90) % 4
            if k == 0:
                return PlanResult(kind="noop", message="한 바퀴 돌리면 그대로예요.")
            if k == 3:
                k = -1  # 270° = 반대 방향 90°
            if _has(t, ("옆모습", "옆으로 돌", "좌우로 돌", "빙글")):
                axis = "screen_up"
            elif _has(t, ("앞으로", "숙여")):
                axis = "screen_right"
            elif _has(t, ("뒤로", "젖혀")):
                axis, k = "screen_right", -k
            else:
                axis = "toward_viewer"
                if "시계" in t and not _has(t, ("반시계", "시계 반대")):
                    k = -k
                elif _has(t, ("오른쪽으로",)) and "시계" not in t:
                    k = -k
            return [{"type": "rotate90", "axis": axis, "k": k}]
        if _has(t, ("눕혀", "눕게", "넘어뜨려")):
            return [{"type": "rotate90", "axis": "toward_viewer", "k": -1}]

        up, down = _has(t, INCREASE), _has(t, DECREASE)
        if not (up or down) and re.search(r"\d+(?:\.\d+)?\s*배", t):
            up = True  # "두께 2배로"처럼 방향 없이 배수만 있으면 늘리기
        if up or down:
            f = _factor(t)
            factor = 1 / f if down and not up else f
            if _has(t, DEPTH):
                return [{"type": "scale_axis", "axis": "toward_viewer", "factor": factor}]
            if _has(t, WIDTH):
                return [{"type": "scale_axis", "axis": "screen_right", "factor": factor}]
            if _has(t, HEIGHT):
                return [{"type": "scale_axis", "axis": "screen_up", "factor": factor}]
            if _has(t, UNIFORM):
                return [{"type": "scale_uniform", "factor": factor}]
        return []


# ---- ClaudePlanner ----------------------------------------------------------------

SYSTEM_PROMPT = """너는 3D 모델 편집 문장을 정해진 JSON으로 바꾸는 변환기다. 메시를 직접 바꾸지 않는다.

사용자는 6방향 패널(front/back/left/right/top/bottom) 중 하나를 보고 말한다. 방향어는 그 패널의 화면 기준이다.
화면 축: screen_right(화면 오른쪽), screen_up(화면 위), toward_viewer(화면 밖, 보는 사람 쪽).

op 종류 (대상은 항상 물체 전체):
- rotate90 {axis, k}: axis 기준 오른손 법칙으로 k×90°. k는 -3..3, 0 제외. toward_viewer k=1은 화면에서 반시계방향.
  "앞으로 숙여"는 screen_right k=1, "뒤로 젖혀"는 screen_right k=-1, "옆모습이 보이게 돌려"는 screen_up k=1.
- scale_axis {axis, factor}: 그 화면 방향으로만 늘이거나 줄인다. 두께 = toward_viewer, 높이·길이 = screen_up, 폭 = screen_right. factor 0.1..10.
  배수가 없으면 "더/조금" 1.25(줄이면 0.8), "많이" 1.5, "살짝" 1.1.
- scale_uniform {factor}: 전체 크기.
- mirror {axis}: 그 방향 반전. 좌우 반전 = screen_right.
- stand_up: "세워줘" — 가장 긴 축을 위로 세운다(방향은 코드가 고른다).
- invert_last: "반대로" — 직전 편집의 역연산.

거절 규칙 (추측하지 말 것):
- 특정 부위만 바꾸라는 요청(귀만 길게 등) → kind=refuse, reason_code=part_edit, 전체에 적용할지 묻는 message와 suggested_text.
- 모양 추가·삭제, 색·텍스처 변경 → refuse, out_of_scope.
- 90° 배수가 아닌 회전 → refuse, angle_not_supported.
- 0.1~10배 밖 크기 → refuse, out_of_range.
- 무엇을 바라는지 불분명 → kind=clarify, message에 질문과 예시.
- 아무것도 바뀌지 않는 요청(360도 회전 등) → kind=noop.

message는 짧은 한국어 존댓말. op는 최대 4개. ops에 쓰지 않는 필드는 null."""

_OP_SCHEMA = {
    "type": "object",
    "properties": {
        "type": {
            "type": "string",
            "enum": [
                "rotate90",
                "scale_axis",
                "scale_uniform",
                "mirror",
                "stand_up",
                "invert_last",
            ],
        },
        "axis": {
            "type": ["string", "null"],
            "enum": ["screen_right", "screen_up", "toward_viewer", None],
        },
        "k": {"type": ["integer", "null"]},
        "factor": {"type": ["number", "null"]},
    },
    "required": ["type", "axis", "k", "factor"],
    "additionalProperties": False,
}

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["ops", "refuse", "clarify", "noop"]},
        "ops": {"type": "array", "items": _OP_SCHEMA},
        "reason_code": {
            "type": ["string", "null"],
            "enum": [
                "part_edit",
                "out_of_scope",
                "angle_not_supported",
                "out_of_range",
                "unparseable",
                None,
            ],
        },
        "message": {"type": "string"},
        "suggested_text": {"type": ["string", "null"]},
    },
    "required": ["kind", "ops", "reason_code", "message", "suggested_text"],
    "additionalProperties": False,
}

_OPS = TypeAdapter(list[ScreenOp])


def parse_plan(raw: str) -> PlanResult:
    """LLM 출력(JSON 문자열) → 검증된 PlanResult. null 필드는 버리고 op 스키마로 다시 검사한다."""
    data = json.loads(raw)
    ops = [{k: v for k, v in op.items() if v is not None} for op in data.get("ops") or []]
    return PlanResult(
        kind=data["kind"],
        ops=_OPS.validate_python(ops),
        reason_code=data.get("reason_code"),
        message=data.get("message") or "",
        suggested_text=data.get("suggested_text"),
    )


class ClaudePlanner(EditPlanner):
    """Claude API 구조화 출력으로 계획한다. 스키마 위반이면 1회 재시도, 그래도 실패하면 refuse."""

    name = "claude"

    def __init__(self, model: str, client=None):
        if client is None:
            import anthropic  # 선택 의존성: pip install 'draw2world-backend[llm]'

            client = anthropic.Anthropic()
        self.client = client
        self.model = model

    def _request(self, req: PlanInput) -> str | None:
        user = json.dumps(req.model_dump(), ensure_ascii=False)
        response = self.client.beta.messages.create(
            model=self.model,
            max_tokens=4000,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user}],
            output_config={
                "effort": "low",
                "format": {"type": "json_schema", "schema": PLAN_SCHEMA},
            },
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
        if response.stop_reason in ("refusal", "max_tokens"):
            return None
        return next((b.text for b in response.content if b.type == "text"), None)

    def plan(self, req: PlanInput) -> PlanResult:
        for _ in range(2):
            raw = self._request(req)
            if raw is None:
                continue
            try:
                return parse_plan(raw)
            except (ValueError, KeyError, ValidationError):
                continue
        return PlanResult(
            kind="refuse",
            reason_code="unparseable",
            message=f"요청을 이해하지 못했어요. {EXAMPLES}",
        )


def get_planner(settings) -> EditPlanner:
    if settings.edit_planner == "claude":
        return ClaudePlanner(settings.edit_planner_model)
    return MockPlanner()
