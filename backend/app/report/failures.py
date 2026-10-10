"""실패 유형 후보 분류 (project-brief §19). 메시 검사 결과 기반 규칙.

4-3에서 실루엣 비교 등 지표를 더해 확장한다.
"""

from __future__ import annotations

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


def classify(inspect_raw: dict, inspect_repaired: dict, collider: dict | None) -> list[dict]:
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

    if collider and collider.get("type") != "convex_hull":
        found["COLLISION_FAILURE"] = {
            "type": "COLLISION_FAILURE",
            "evidence": [collider.get("reason") or "convex hull 미사용"],
            "fixed_by_repair": False,
            "remedy": REMEDIES["COLLISION_FAILURE"],
        }
    return list(found.values())
