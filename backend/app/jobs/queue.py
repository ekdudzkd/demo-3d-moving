"""SQLite job 큐 (D-002). 워커 1개가 오래된 순서로 하나씩 가져간다."""

from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.db.models import Job, Project, utcnow

from .events import add_event
from .states import STAGES, TERMINAL, JobStatus

RUNNING = {s.value for s in STAGES}


def create_job(
    session: Session,
    project: Project,
    mask_version: int,
    generator: str,
    options: dict,
    preprocess_options: dict,
    retry_of: str | None = None,
) -> Job:
    job = Job(
        project_id=project.id,
        mask_version=mask_version,
        status=JobStatus.QUEUED.value,
        generator=generator,
        options=options,
        preprocess_options=preprocess_options,
        result={},
        retry_of=retry_of,
    )
    session.add(job)
    session.flush()
    add_event(session, job.id, JobStatus.QUEUED.value, "status", "대기열에 추가됨")
    return job


def claim_next(session: Session) -> Job | None:
    """QUEUED job 하나를 원자적으로 가져간다. 다른 워커가 먼저 가져가면 None."""
    candidate = session.scalar(
        select(Job.id).where(Job.status == JobStatus.QUEUED.value).order_by(Job.created_at).limit(1)
    )
    if candidate is None:
        return None
    claimed = session.execute(
        update(Job)
        .where(Job.id == candidate, Job.status == JobStatus.QUEUED.value)
        .values(status=STAGES[0].value, started_at=utcnow())
    )
    session.commit()
    if claimed.rowcount != 1:
        return None
    return session.get(Job, candidate)


def request_cancel(session: Session, job: Job) -> bool:
    """대기 중이면 바로 취소, 실행 중이면 다음 단계 경계에서 워커가 취소. 종료된 job이면 False."""
    status = JobStatus(job.status)
    if status in TERMINAL:
        return False
    if status is JobStatus.QUEUED:
        job.status = JobStatus.CANCELLED.value
        job.finished_at = utcnow()
        add_event(session, job.id, JobStatus.CANCELLED.value, "status", "대기 중 취소됨")
    else:
        job.cancel_requested = True
        add_event(session, job.id, job.status, "log", "취소 요청됨. 현재 단계가 끝나면 중단합니다.")
    return True


def recover_stale(session: Session) -> int:
    """워커가 죽어 실행 상태로 남은 job을 실패 처리한다. 워커 시작 시 호출."""
    stale = session.scalars(select(Job).where(Job.status.in_(RUNNING))).all()
    for job in stale:
        job.error = {
            "stage": job.status,
            "code": "INTERNAL",
            "user_message": "작업 처리 중 서버가 재시작되었습니다. 다시 시도해 주세요.",
            "retryable": True,
            "detail": "worker restarted",
        }
        add_event(session, job.id, job.status, "error", "워커 재시작으로 중단됨")
        job.status = JobStatus.FAILED.value
        job.finished_at = utcnow()
    session.commit()
    return len(stale)
