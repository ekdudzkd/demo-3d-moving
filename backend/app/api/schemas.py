from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.input.validate import ValidationResult


class MaskOut(BaseModel):
    version: int
    method: str
    coverage: float
    url: str
    prompts: dict[str, Any]
    elapsed_ms: int


class ProjectOut(BaseModel):
    id: str
    status: str
    width: int
    height: int
    validation: ValidationResult
    original_url: str
    masks: list[MaskOut]
    confirmed_mask_version: int | None
    job_ids: list[str]
    created_at: datetime


class RejectedOut(BaseModel):
    status: str = "REJECTED"
    validation: ValidationResult


class Point(BaseModel):
    x: float
    y: float
    label: int = Field(1, description="1 = 포함, 0 = 제외")


class SegmentIn(BaseModel):
    points: list[Point] = Field(default_factory=list)
    box: list[float] | None = Field(None, description="[x0, y0, x1, y1] 원본 픽셀 좌표")


class ConfirmIn(BaseModel):
    version: int | None = None


class JobCreateIn(BaseModel):
    generator: str | None = None
    options: dict[str, Any] = Field(default_factory=dict)
    preprocess: dict[str, Any] = Field(default_factory=dict)


class JobError(BaseModel):
    stage: str
    code: str
    user_message: str
    retryable: bool
    detail: str = ""
    log_url: str | None = None


class StageTiming(BaseModel):
    stage: str
    started_at: datetime | None = None
    finished_at: datetime | None = None
    elapsed_ms: int | None = None


class JobEventOut(BaseModel):
    seq: int
    stage: str
    kind: str
    message: str
    elapsed_ms: int | None
    at: datetime


class JobOut(BaseModel):
    id: str
    project_id: str
    mask_version: int
    status: str
    generator: str
    model_name: str | None = None
    outcome: str | None
    error: JobError | None
    options: dict[str, Any]
    preprocess_options: dict[str, Any]
    retry_of: str | None
    cancel_requested: bool
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    stages: list[StageTiming]
    events: list[JobEventOut]
    files: dict[str, str]
    asset_id: str | None = None
