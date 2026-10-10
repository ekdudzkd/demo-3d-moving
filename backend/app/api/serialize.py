from __future__ import annotations

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.context import AppContext
from app.db.models import Asset, Job, Project

from .schemas import JobError, JobEventOut, JobOut, MaskOut, ProjectOut, StageTiming


def project_out(ctx: AppContext, p: Project) -> ProjectOut:
    st = ctx.storage
    return ProjectOut(
        id=p.id,
        status=p.status,
        width=p.width,
        height=p.height,
        validation=p.validation,
        original_url=st.url(st.original(p.id)),
        masks=[
            MaskOut(
                version=m.version,
                method=m.method,
                coverage=m.coverage,
                url=st.url(st.mask(p.id, m.version)),
                prompts=m.prompts,
                elapsed_ms=m.elapsed_ms,
            )
            for m in p.masks
        ],
        confirmed_mask_version=p.confirmed_mask_version,
        job_ids=[j.id for j in p.jobs],
        created_at=p.created_at,
    )


FILE_KEYS = {
    "input_normalized": ("preprocess", "03_normalized.png"),
    "input_cutout": ("preprocess", "01_cutout.png"),
    "raw_mesh": ("generation", "raw.obj"),
    "model_log": ("generation", "model.log"),
    "raw_glb": ("export", "raw.glb"),
    "repaired_glb": ("export", "repaired.glb"),
    "asset": ("export", "asset.json"),
    "collider": ("export", "collider.json"),
    "inspect_raw": ("mesh", "inspect_raw.json"),
    "inspect_repaired": ("mesh", "inspect_repaired.json"),
    "repair_steps": ("mesh", "repair_steps.json"),
    "report": (".", "report.json"),
    "worker_log": (".", "worker.log"),
}


def job_out(ctx: AppContext, session: Session, job: Job) -> JobOut:
    st = ctx.storage
    job_dir = st.job_dir(job.project_id, job.id)
    files = {}
    for key, (sub, name) in FILE_KEYS.items():
        path = job_dir / sub / name
        if path.is_file():
            files[key] = st.url(path)

    stages: dict[str, StageTiming] = {}
    for e in job.events:
        if e.kind == "enter":
            stages[e.stage] = StageTiming(stage=e.stage, started_at=e.at)
        elif e.kind == "exit" and e.stage in stages:
            stages[e.stage].finished_at = e.at
            stages[e.stage].elapsed_ms = e.elapsed_ms

    error = None
    if job.error:
        log = Path(job.error["log_path"]) if job.error.get("log_path") else None
        error = JobError(
            stage=job.error["stage"],
            code=job.error["code"],
            user_message=job.error["user_message"],
            retryable=job.error["retryable"],
            detail=job.error.get("detail", ""),
            log_url=st.url(log) if log and log.is_file() else None,
        )

    asset_id = session.scalar(select(Asset.id).where(Asset.job_id == job.id))
    model_info = job.result.get("model_info") or {}
    return JobOut(
        id=job.id,
        project_id=job.project_id,
        mask_version=job.mask_version,
        status=job.status,
        generator=job.generator,
        model_name=model_info.get("name"),
        outcome=job.outcome,
        error=error,
        options=job.options,
        preprocess_options=job.preprocess_options,
        retry_of=job.retry_of,
        cancel_requested=job.cancel_requested,
        created_at=job.created_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
        stages=list(stages.values()),
        events=[
            JobEventOut(
                seq=e.seq,
                stage=e.stage,
                kind=e.kind,
                message=e.message,
                elapsed_ms=e.elapsed_ms,
                at=e.at,
            )
            for e in job.events
        ],
        files=files,
        asset_id=asset_id,
    )
