"""생성 adapter 등록소. 모델은 프로세스당 한 번만 로드한다."""

from __future__ import annotations

import importlib

from app.core.config import Settings
from app.core.errors import ErrorCode, PipelineError

from .base import ImageTo3DAdapter

# 이름 → (모듈, 클래스). 실제 모델 adapter는 무거운 의존성 때문에 필요할 때만 import
ADAPTERS = {
    "mock": ("app.generation.mock", "MockAdapter"),
    "triposr": ("app.generation.triposr", "TripoSRAdapter"),
    "sf3d": ("app.generation.sf3d", "StableFast3DAdapter"),
}

_instances: dict[str, ImageTo3DAdapter] = {}


def is_enabled(name: str, settings: Settings) -> tuple[bool, str]:
    if name not in ADAPTERS:
        return False, "알 수 없는 생성기"
    if name == "sf3d" and not (settings.sf3d_enabled and settings.sf3d_license_accepted):
        return (
            False,
            "SF3D_ENABLED와 SF3D_LICENSE_ACCEPTED가 모두 true여야 합니다 (docs/licenses.md)",
        )
    return True, ""


def _load_class(name: str):
    module, cls = ADAPTERS[name]
    return getattr(importlib.import_module(module), cls)


def get_adapter(name: str, settings: Settings) -> ImageTo3DAdapter:
    enabled, reason = is_enabled(name, settings)
    if not enabled:
        raise PipelineError(ErrorCode.MODEL_UNAVAILABLE, f"{name}: {reason}")
    if name == "mock":
        # 실패 주입 설정이 테스트마다 바뀌므로 캐시하지 않는다
        from .mock import MockAdapter

        return MockAdapter(fail=settings.mock_fail, delay_ms=settings.mock_delay_ms)
    if name not in _instances:
        try:
            _instances[name] = _load_class(name)(settings)
        except ImportError as exc:
            raise PipelineError(
                ErrorCode.MODEL_UNAVAILABLE, f"{name}: 의존성 없음 ({exc})"
            ) from exc
    return _instances[name]


def describe_all(settings: Settings) -> list[dict]:
    out = []
    for name in ADAPTERS:
        enabled, reason = is_enabled(name, settings)
        entry: dict = {
            "name": name,
            "enabled": enabled,
            "reason": reason,
            "info": None,
            "environment": None,
        }
        if enabled:
            try:
                cls = _load_class(name)
                adapter = _instances.get(name) or (
                    cls() if name == "mock" else cls(settings, load=False)
                )
                entry["info"] = adapter.get_model_info().model_dump()
                entry["environment"] = adapter.validate_environment().model_dump()
            except ImportError as exc:
                entry["environment"] = {
                    "ok": False,
                    "device": "-",
                    "problems": [f"의존성 없음: {exc}"],
                }
        out.append(entry)
    return out
