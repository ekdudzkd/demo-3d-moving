from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.context import AppContext
from app.db.models import Job, JobEvent, Project
from app.generation.base import GenerationOptions
from app.generation.registry import is_enabled
from app.jobs.queue import create_job, request_cancel
from app.jobs.states import TERMINAL, JobStatus, ProjectStatus
from app.preprocess.normalize import PreprocessOptions

from .deps import get_ctx, get_session
from .schemas import JobCreateIn, JobOut
from .serialize import job_out

router = APIRouter(tags=["jobs"])

SSE_POLL_SECONDS = 0.5
SSE_HEARTBEAT_SECONDS = 15


def get_job_or_404(session: Session, job_id: str) -> Job:
    job = session.get(Job, job_id)
    if job is None:
        raise HTTPException(404, "작업이 없습니다.")
    return job


def _validated_options(ctx: AppContext, body: JobCreateIn) -> tuple[str, dict, dict]:
    generator = body.generator or ctx.settings.generator
    enabled, reason = is_enabled(generator, ctx.settings)
    if not enabled:
        raise HTTPException(422, f"생성기 '{generator}'를 사용할 수 없습니다: {reason}")
    try:
        options = GenerationOptions(**body.options).model_dump()
        preprocess = PreprocessOptions(**body.preprocess).model_dump()
    except ValidationError as exc:
        raise HTTPException(422, exc.errors(include_url=False)) from exc
    return generator, options, preprocess


@router.post("/api/projects/{project_id}/jobs", status_code=201, response_model=JobOut)
def create(
    project_id: str,
    body: JobCreateIn,
    ctx: AppContext = Depends(get_ctx),
    session: Session = Depends(get_session),
):
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "프로젝트가 없습니다.")
    if project.status != ProjectStatus.MASK_CONFIRMED.value:
        raise HTTPException(409, "마스크를 먼저 확정해 주세요.")
    generator, options, preprocess = _validated_options(ctx, body)
    job = create_job(
        session, project, project.confirmed_mask_version, generator, options, preprocess
    )
    session.commit()
    return job_out(ctx, session, job)


@router.get("/api/jobs/{job_id}", response_model=JobOut)
def get(job_id: str, ctx: AppContext = Depends(get_ctx), session: Session = Depends(get_session)):
    return job_out(ctx, session, get_job_or_404(session, job_id))


@router.post("/api/jobs/{job_id}/cancel", response_model=JobOut)
def cancel(
    job_id: str, ctx: AppContext = Depends(get_ctx), session: Session = Depends(get_session)
):
    job = get_job_or_404(session, job_id)
    if not request_cancel(session, job):
        raise HTTPException(409, "이미 끝난 작업입니다.")
    session.commit()
    return job_out(ctx, session, job)


@router.post("/api/jobs/{job_id}/retry", status_code=201, response_model=JobOut)
def retry(
    job_id: str,
    body: JobCreateIn | None = None,
    ctx: AppContext = Depends(get_ctx),
    session: Session = Depends(get_session),
):
    """같은 마스크로 새 job을 만든다. 이전 job은 그대로 보존 (retry_of로 연결)."""
    old = get_job_or_404(session, job_id)
    if JobStatus(old.status) not in TERMINAL:
        raise HTTPException(409, "실행 중인 작업은 다시 시도할 수 없습니다.")
    body = body or JobCreateIn()
    merged = JobCreateIn(
        generator=body.generator or old.generator,
        options={**old.options, **body.options},
        preprocess={**old.preprocess_options, **body.preprocess},
    )
    generator, options, preprocess = _validated_options(ctx, merged)
    project = session.get(Project, old.project_id)
    job = create_job(
        session, project, old.mask_version, generator, options, preprocess, retry_of=old.id
    )
    session.commit()
    return job_out(ctx, session, job)


@router.get("/api/jobs/{job_id}/events")
async def events(job_id: str, request: Request, ctx: AppContext = Depends(get_ctx)):
    """단계 이벤트 SSE. 퍼센트 진행률은 보내지 않는다 (D-007). Last-Event-ID로 이어받기."""
    with ctx.session() as session:
        get_job_or_404(session, job_id)
    try:
        last = int(request.headers.get("last-event-id") or request.query_params.get("after") or 0)
    except ValueError:
        last = 0

    async def stream():
        nonlocal last
        idle = 0.0
        yield "retry: 2000\n\n"
        while True:
            with ctx.session() as session:
                rows = session.scalars(
                    select(JobEvent)
                    .where(JobEvent.job_id == job_id, JobEvent.seq > last)
                    .order_by(JobEvent.seq)
                ).all()
                status = session.get(Job, job_id).status
            for e in rows:
                last = e.seq
                data = {
                    "seq": e.seq,
                    "stage": e.stage,
                    "kind": e.kind,
                    "message": e.message,
                    "elapsed_ms": e.elapsed_ms,
                    "at": e.at.isoformat(),
                    "status": status,
                }
                yield f"id: {e.seq}\nevent: stage\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
                idle = 0.0
            if JobStatus(status) in TERMINAL and not rows:
                yield f"event: end\ndata: {json.dumps({'status': status})}\n\n"
                return
            if await request.is_disconnected():
                return
            await asyncio.sleep(SSE_POLL_SECONDS)
            idle += SSE_POLL_SECONDS
            if idle >= SSE_HEARTBEAT_SECONDS:
                idle = 0.0
                yield ": heartbeat\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
