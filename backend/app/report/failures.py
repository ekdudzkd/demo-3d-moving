"""실패 유형 후보 분류 (project-brief §19). 규칙 기반.

- 메시 검사 코드 → 유형 (CODE_TO_FAILURE)
- 실루엣 비교: 입력 그림 중 3D 정면이 덮지 못한 부분이 크면 MISSING_PART
- 마스크 모양: 원본 대부분을 덮거나 테두리 여러 변에 닿으면 BACKGROUND_LEAK
- 충돌체: convex hull을 못 쓰면 COLLISION_FAILURE
"""

from __future__ import annotations

import numpy as np

# 입력 마스크 중 메시 정면 실루엣이 덮는 비율이 이보다 낮으면 빠진 부분
MISSING_PART_RECALL = 0.85
# 마스크가 원본 이미지의 이 비율을 넘거나, 테두리 이 개수 이상 변에 닿으면 배경 포함 의심
LEAK_COVERAGE = 0.6
LEAK_BORDER_SIDES = 2

# 검사 코드 → 실패 유형
CODE_TO_FAILURE = {
    "fragmented": "BACKGROUND_LEAK",
    "small_components": "FLOATING_COMPONENT",
    "non_manifold": "NON_MANIFOLD",
    "too_many_faces": "TOO_MANY_FACES",
    "not_centered": "INVALID_ORIGIN",
    "not_grounded": "INVALID_ORIGIN",
    "wrong_scale": "WRONG_SCALE",
    "no_color": "BROKEN_TEXTURE",
    "uv_without_texture": "BROKEN_TEXTURE",
    "flat_geometry": "COLLAPSED_BACK",
}

REMEDIES = {
    "BACKGROUND_LEAK": "마스크에서 배경을 제외점으로 지우고 다시 생성하세요.",
    "MISSING_PART": "마스크에 빠진 부분을 포함점으로 추가하고 다시 생성하세요.",
    "COLLAPSED_BACK": "한 장의 이미지로는 뒷면을 알 수 없습니다. 다른 seed나 모델로 다시 생성해 보세요.",
    "FLOATING_COMPONENT": "작은 분리 조각은 자동 보정에서 제거합니다.",
    "BROKEN_TEXTURE": "텍스처 굽기 옵션을 바꿔 다시 생성하세요.",
    "NON_MANIFOLD": "관찰용으로는 쓸 수 있습니다. 물리 충돌은 단순 충돌체를 사용합니다.",
    "TOO_MANY_FACES": "자동 보정에서 폴리곤 수를 줄입니다.",
    "WRONG_SCALE": "자동 보정에서 크기를 1m로 맞춥니다.",
    "INVALID_ORIGIN": "자동 보정에서 원점과 바닥을 맞춥니다.",
    "COLLISION_FAILURE": "convex hull 대신 상자 충돌체를 사용합니다.",
    "RIGGING_UNSUITABLE": "MVP에서는 리깅을 지원하지 않습니다.",
}


def mask_signals(mask: np.ndarray) -> dict:
    """확정 마스크의 원본 대비 면적과 닿은 테두리 변 수."""
    h, w = mask.shape
    margin = max(1, round(min(h, w) * 0.005))
    sides = sum(
        bool(edge.any())
        for edge in (mask[:margin], mask[-margin:], mask[:, :margin], mask[:, -margin:])
    )
    return {"mask_coverage": round(float(mask.mean()), 4), "mask_border_sides": int(sides)}


def classify(
    inspect_raw: dict,
    inspect_repaired: dict,
    collider: dict | None,
    signals: dict | None = None,
) -> list[dict]:
    """signals(선택): silhouette {iou, recall, precision}, mask_coverage, mask_border_sides."""
    raw_codes = {c["code"] for c in inspect_raw["errors"] + inspect_raw["warnings"]}
    fixed_codes = {c["code"] for c in inspect_repaired["errors"] + inspect_repaired["warnings"]}
    found: dict[str, dict] = {}

    for code in sorted(raw_codes | fixed_codes):
        failure = CODE_TO_FAILURE.get(code)
        if failure is None:
            continue
        entry = found.setdefault(
            failure,
            {"type": failure, "evidence": [], "fixed_by_repair": True, "remedy": REMEDIES[failure]},
        )
        entry["evidence"].append(code)
        if code in fixed_codes:
            entry["fixed_by_repair"] = False

    def add(failure: str, evidence: str) -> None:
        entry = found.setdefault(
            failure,
            {
                "type": failure,
                "evidence": [],
                "fixed_by_repair": False,
                "remedy": REMEDIES[failure],
            },
        )
        entry["evidence"].append(evidence)
        entry["fixed_by_repair"] = False

    signals = signals or {}
    sil = signals.get("silhouette")
    if sil and sil.get("recall") is not None and sil["recall"] < MISSING_PART_RECALL:
        add("MISSING_PART", f"silhouette_recall={sil['recall']:.2f}<{MISSING_PART_RECALL}")
    coverage = signals.get("mask_coverage")
    if coverage is not None and coverage > LEAK_COVERAGE:
        add("BACKGROUND_LEAK", f"mask_coverage={coverage:.2f}>{LEAK_COVERAGE}")
    sides = signals.get("mask_border_sides")
    if sides is not None and sides >= LEAK_BORDER_SIDES:
        add("BACKGROUND_LEAK", f"mask_border_sides={sides}>={LEAK_BORDER_SIDES}")

    if collider and collider.get("type") != "convex_hull":
        add("COLLISION_FAILURE", collider.get("reason") or "convex hull 미사용")
    return list(found.values())
