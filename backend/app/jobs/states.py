from __future__ import annotations

from enum import Enum


class ProjectStatus(str, Enum):
    VALIDATED = "VALIDATED"
    MASK_PROPOSED = "MASK_PROPOSED"
    MASK_CONFIRMED = "MASK_CONFIRMED"


class JobStatus(str, Enum):
    QUEUED = "QUEUED"
    PREPROCESSING = "PREPROCESSING"
    GENERATING = "GENERATING"
    VALIDATING = "VALIDATING"
    REPAIRING = "REPAIRING"
    EXPORTING = "EXPORTING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class Outcome(str, Enum):
    USABLE = "USABLE"
    USABLE_WITH_WARNINGS = "USABLE_WITH_WARNINGS"
    NOT_USABLE = "NOT_USABLE"


# 워커가 실행하는 단계 순서
STAGES: tuple[JobStatus, ...] = (
    JobStatus.PREPROCESSING,
    JobStatus.GENERATING,
    JobStatus.VALIDATING,
    JobStatus.REPAIRING,
    JobStatus.EXPORTING,
)

TERMINAL = {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED}
