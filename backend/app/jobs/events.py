from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import JobEvent


def add_event(
    session: Session,
    job_id: str,
    stage: str,
    kind: str,
    message: str = "",
    elapsed_ms: int | None = None,
) -> JobEvent:
    """kind: status(상태 변경) | enter(단계 시작) | exit(단계 종료) | log | error"""
    seq = session.scalar(
        select(func.coalesce(func.max(JobEvent.seq), 0)).where(JobEvent.job_id == job_id)
    )
    event = JobEvent(
        job_id=job_id, seq=seq + 1, stage=stage, kind=kind, message=message, elapsed_ms=elapsed_ms
    )
    session.add(event)
    session.flush()
    return event
