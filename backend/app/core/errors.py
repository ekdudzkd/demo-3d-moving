from __future__ import annotations

from enum import Enum


class ErrorCode(str, Enum):
    INPUT_INVALID = "INPUT_INVALID"
    MODEL_UNAVAILABLE = "MODEL_UNAVAILABLE"
    CUDA_OOM = "CUDA_OOM"
    GENERATION_TIMEOUT = "GENERATION_TIMEOUT"
    MESH_EMPTY = "MESH_EMPTY"
    MESH_UNUSABLE = "MESH_UNUSABLE"
    EXPORT_FAILED = "EXPORT_FAILED"
    CANCELLED = "CANCELLED"
    INTERNAL = "INTERNAL"


USER_MESSAGES = {
    ErrorCode.INPUT_INVALID: "입력 이미지나 마스크를 처리할 수 없습니다. 다른 이미지를 사용해 주세요.",
    ErrorCode.MODEL_UNAVAILABLE: "3D 생성 모델을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    ErrorCode.CUDA_OOM: "GPU 메모리가 부족했습니다. 더 낮은 해상도로 다시 시도할 수 있습니다.",
    ErrorCode.GENERATION_TIMEOUT: "생성 시간이 너무 오래 걸려 중단했습니다.",
    ErrorCode.MESH_EMPTY: "모델이 빈 메시를 만들었습니다. 마스크를 수정하거나 다시 생성해 주세요.",
    ErrorCode.MESH_UNUSABLE: "생성된 메시를 자산으로 쓸 수 없습니다.",
    ErrorCode.EXPORT_FAILED: "GLB 변환에 실패했습니다.",
    ErrorCode.CANCELLED: "사용자가 작업을 취소했습니다.",
    ErrorCode.INTERNAL: "알 수 없는 오류가 발생했습니다.",
}

RETRYABLE = {
    ErrorCode.MODEL_UNAVAILABLE,
    ErrorCode.CUDA_OOM,
    ErrorCode.GENERATION_TIMEOUT,
    ErrorCode.MESH_EMPTY,
    ErrorCode.EXPORT_FAILED,
    ErrorCode.CANCELLED,
    ErrorCode.INTERNAL,
}


class PipelineError(Exception):
    """파이프라인 단계 실패. 워커가 잡아서 job.error로 기록한다."""

    def __init__(self, code: ErrorCode, detail: str = "", user_message: str | None = None):
        super().__init__(detail or code.value)
        self.code = code
        self.detail = detail
        self.user_message = user_message or USER_MESSAGES[code]
        self.retryable = code in RETRYABLE
