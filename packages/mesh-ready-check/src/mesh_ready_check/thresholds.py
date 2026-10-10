from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class Thresholds:
    """검사 기준값. 근거는 docs/mesh-quality.md."""

    # 폴리곤 예산 (웹 실시간 렌더 기준)
    face_budget: int = 50_000
    # 전체 면 대비 이 비율 미만인 조각은 "작은 분리 조각"
    small_component_ratio: float = 0.02
    # 가장 큰 조각의 면 비율이 이보다 작으면 배경 누수·분리 의심 → ERROR
    min_largest_component_ratio: float = 0.8
    # non-manifold edge 수 / 면 수
    non_manifold_warn_ratio: float = 0.01
    non_manifold_error_ratio: float = 0.05
    # 중앙값 대비 이 배수를 넘는 edge는 "비정상적으로 긴 edge"
    long_edge_factor: float = 20.0
    # 최소 축 / 최대 축이 이보다 작으면 종잇장처럼 납작한 형상
    flat_ratio: float = 0.02
    # 중앙·바닥 판정 허용 오차 (최대 축 길이 대비 비율)
    center_tolerance: float = 0.05
    ground_tolerance: float = 0.01
    # 기대 최대 축 길이(예: 1.0m). None이면 크기 검사 생략
    target_size: float | None = None
    size_tolerance: float = 0.1

    def to_dict(self) -> dict:
        return asdict(self)
