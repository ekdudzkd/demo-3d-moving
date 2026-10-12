"""5-3 EditPlanner: MockPlanner 한국어 규칙 + ClaudePlanner 계약(가짜 클라이언트, 네트워크 없음)."""

import json
from types import SimpleNamespace

import pytest

from app.edit.planner import (
    PLAN_SCHEMA,
    ClaudePlanner,
    MockPlanner,
    PlanInput,
    PlanResult,
    get_planner,
)

# (문장, 패널, 기대 kind, 기대 ops 또는 reason_code)
CASES = [
    ("세워줘", "front", "ops", [{"type": "stand_up"}]),
    ("옆으로 누워 있어, 세워줘", "left", "ops", [{"type": "stand_up"}]),
    (
        "더 두껍게",
        "front",
        "ops",
        [{"type": "scale_axis", "axis": "toward_viewer", "factor": 1.25}],
    ),
    ("두께 2배로", "back", "ops", [{"type": "scale_axis", "axis": "toward_viewer", "factor": 2.0}]),
    (
        "조금 얇게",
        "front",
        "ops",
        [{"type": "scale_axis", "axis": "toward_viewer", "factor": 1 / 1.1}],
    ),
    (
        "옆으로 2배 길게",
        "front",
        "ops",
        [{"type": "scale_axis", "axis": "screen_right", "factor": 2.0}],
    ),
    (
        "높이를 절반으로 낮게",
        "front",
        "ops",
        [{"type": "scale_axis", "axis": "screen_up", "factor": 0.5}],
    ),
    ("전체 크기를 많이 크게", "top", "ops", [{"type": "scale_uniform", "factor": 1.5}]),
    (
        "시계방향으로 90도 돌려",
        "front",
        "ops",
        [{"type": "rotate90", "axis": "toward_viewer", "k": -1}],
    ),
    ("반시계로 90도 회전", "front", "ops", [{"type": "rotate90", "axis": "toward_viewer", "k": 1}]),
    ("180도 돌려", "right", "ops", [{"type": "rotate90", "axis": "toward_viewer", "k": 2}]),
    ("270도 돌려", "front", "ops", [{"type": "rotate90", "axis": "toward_viewer", "k": -1}]),
    ("앞으로 숙여", "front", "ops", [{"type": "rotate90", "axis": "screen_right", "k": 1}]),
    ("뒤로 젖혀줘", "left", "ops", [{"type": "rotate90", "axis": "screen_right", "k": -1}]),
    ("옆모습이 보이게 돌려", "front", "ops", [{"type": "rotate90", "axis": "screen_up", "k": 1}]),
    ("거꾸로 뒤집어", "front", "ops", [{"type": "rotate90", "axis": "screen_right", "k": 2}]),
    ("좌우 반전", "front", "ops", [{"type": "mirror", "axis": "screen_right"}]),
    ("위아래 뒤집어", "front", "ops", [{"type": "mirror", "axis": "screen_up"}]),
    ("반대로", "front", "ops", [{"type": "invert_last"}]),
    (
        "세워주고 그리고 더 두껍게",
        "front",
        "ops",
        [{"type": "stand_up"}, {"type": "scale_axis", "axis": "toward_viewer", "factor": 1.25}],
    ),
    ("귀만 길게", "front", "refuse", "part_edit"),
    ("다리를 더 두껍게", "front", "refuse", "part_edit"),
    ("모자 추가해줘", "front", "refuse", "out_of_scope"),
    ("빨갛게 칠해", "front", "refuse", "out_of_scope"),
    ("45도 돌려", "front", "refuse", "angle_not_supported"),
    ("2배 키워", "front", "ops", [{"type": "scale_uniform", "factor": 2.0}]),
    ("20배 크게", "front", "refuse", "out_of_range"),
    ("360도 돌려", "front", "noop", None),
    ("아까처럼 해줘", "front", "clarify", None),
    ("음 별로야", "front", "clarify", None),
    ("", "front", "clarify", None),
]


def check(result: PlanResult, kind, expected):
    assert result.kind == kind, result
    if kind == "ops":
        got = [op.model_dump(exclude={"target"}) for op in result.ops]
        for g, e in zip(got, expected, strict=True):
            assert g.keys() == e.keys()
            for key, value in e.items():
                assert g[key] == pytest.approx(value) if key == "factor" else g[key] == value
    elif kind == "refuse":
        assert result.reason_code == expected
    assert kind == "ops" or result.message


@pytest.mark.parametrize("text, panel, kind, expected", CASES)
def test_mock_planner(text, panel, kind, expected):
    check(MockPlanner().plan(PlanInput(text=text, panel=panel)), kind, expected)


def test_part_edit_suggests_whole_object():
    r = MockPlanner().plan(PlanInput(text="귀만 길게", panel="front"))
    assert "전체" in r.message and r.suggested_text.startswith("전체를")
    # 제안 문장은 그대로 다시 보내면 전체 편집으로 해석된다
    again = MockPlanner().plan(PlanInput(text=r.suggested_text, panel="front"))
    assert again.kind == "ops"


def test_get_planner_defaults_to_mock(settings):
    assert get_planner(settings).name == "mock"


# ---- ClaudePlanner 계약 -----------------------------------------------------------


def _llm_json(kind, expected, message="좋아요"):
    if kind == "ops":
        ops = [{"type": o["type"], "axis": None, "k": None, "factor": None} | o for o in expected]
    else:
        ops = []
    return json.dumps(
        {
            "kind": kind,
            "ops": ops,
            "reason_code": expected if kind == "refuse" else None,
            "message": message,
            "suggested_text": None,
        },
        ensure_ascii=False,
    )


class FakeClient:
    """client.beta.messages.create 자리. 응답을 차례로 돌려주고 요청을 기록한다."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.requests.append(kwargs)
        item = self.responses.pop(0)
        stop, text = item if isinstance(item, tuple) else ("end_turn", item)
        return SimpleNamespace(stop_reason=stop, content=[SimpleNamespace(type="text", text=text)])


@pytest.mark.parametrize("text, panel, kind, expected", [c for c in CASES if c[0]])
def test_claude_planner_output_contract(text, panel, kind, expected):
    """Mock과 같은 기대값을 LLM이 냈다고 가정하면 같은 PlanResult가 된다 (adapter 동등성)."""
    client = FakeClient(_llm_json(kind, expected))
    result = ClaudePlanner("claude-opus-5-5", client=client).plan(PlanInput(text=text, panel=panel))
    check(result, kind, expected)


def test_claude_planner_request_shape():
    client = FakeClient(_llm_json("ops", [{"type": "stand_up"}]))
    ClaudePlanner("claude-opus-5-5", client=client).plan(
        PlanInput(text="세워줘", panel="left", history=[{"op": "scale", "factors": [2, 1, 1]}])
    )
    (req,) = client.requests
    assert req["model"] == "claude-opus-5-5"
    assert req["output_config"]["format"] == {"type": "json_schema", "schema": PLAN_SCHEMA}
    assert "tool_choice" not in req  # 최신 모델은 강제 도구 호출을 받지 않는다
    assert req["fallbacks"] == "default"
    # 문장·패널·숫자만 보낸다 (D-028): 이미지 블록 없음
    (msg,) = req["messages"]
    assert isinstance(msg["content"], str)
    sent = json.loads(msg["content"])
    assert sent["text"] == "세워줘" and sent["panel"] == "left"


def test_claude_planner_retries_once_on_bad_output():
    bad = json.dumps({"kind": "ops", "ops": [{"type": "rotate90", "axis": "screen_up", "k": 0, "factor": None}],
                      "reason_code": None, "message": "", "suggested_text": None})  # fmt: skip
    client = FakeClient(bad, _llm_json("ops", [{"type": "mirror", "axis": "screen_right"}]))
    result = ClaudePlanner("m", client=client).plan(PlanInput(text="좌우 반전", panel="front"))
    assert result.kind == "ops" and len(client.requests) == 2


@pytest.mark.parametrize(
    "responses",
    [
        ("not json", "{}"),
        (("refusal", ""), ("refusal", "")),
        (("max_tokens", '{"kind": "op'), "also bad"),
    ],
)
def test_claude_planner_gives_up_after_retry(responses):
    client = FakeClient(*responses)
    result = ClaudePlanner("m", client=client).plan(PlanInput(text="세워줘", panel="front"))
    assert (result.kind, result.reason_code) == ("refuse", "unparseable")
    assert len(client.requests) == 2
